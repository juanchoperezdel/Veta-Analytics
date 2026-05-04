import type { Context } from '@netlify/functions';
import { sql, corsHeaders, errorResponse } from './_db';
import { verifyToken, authorizeSlug, unauthorizedResponse } from './_auth';

// Análisis de competencia: identifica search terms que mencionan competidores
// directos y devuelve cuánto se está gastando ahí, conversion rate y proyección
// de ahorro mensual si se cortara.
//
// Lista de competidores hardcoded por cliente — cuando agregamos más clientes
// pasamos esto a una tabla `client_competitors`.

const COMPETITORS_BY_SLUG: Record<string, { token: string; canonical: string }[]> = {
  andesmar: [
    { token: 'flecha bus',       canonical: 'Flecha Bus' },
    { token: 'flechabus',        canonical: 'Flecha Bus' },
    { token: 'busplus',          canonical: 'Bus Plus' },
    { token: 'bus plus',         canonical: 'Bus Plus' },
    { token: 'cata internacional', canonical: 'Cata Internacional' },
    { token: 'cata',             canonical: 'Cata Internacional' },
    { token: 'via bariloche',    canonical: 'Vía Bariloche' },
    { token: 'vía bariloche',    canonical: 'Vía Bariloche' },
    { token: 'crucero del norte', canonical: 'Crucero del Norte' },
    { token: 'general urquiza',  canonical: 'General Urquiza' },
    { token: 'el rapido',        canonical: 'El Rápido' },
    { token: 'el rápido',        canonical: 'El Rápido' },
    { token: 'plataforma 10',    canonical: 'Plataforma 10' },
    { token: 'plataforma10',     canonical: 'Plataforma 10' },
    { token: 'omnilineas',       canonical: 'Omnilíneas' },
    { token: 'plusmar',          canonical: 'Plusmar' },
  ],
};

export default async (req: Request, _context: Context) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: corsHeaders() });

  const user = await verifyToken(req);
  if (!user) return unauthorizedResponse();

  const params = new URL(req.url).searchParams;
  const slug  = params.get('slug');
  const start = params.get('start');
  const end   = params.get('end');
  if (!slug) return errorResponse('Missing slug', 400);
  if (!(await authorizeSlug(user.userId, slug))) return unauthorizedResponse();

  const [client] = await sql`SELECT id FROM clients WHERE slug = ${slug}`;
  if (!client) return errorResponse('Client not found', 404);

  const competitors = COMPETITORS_BY_SLUG[slug] ?? [];
  if (competitors.length === 0) {
    return new Response(JSON.stringify({
      configured: false,
      message: 'No hay lista de competidores configurada para este cliente.',
    }), { headers: corsHeaders() });
  }

  const startDate = start ?? sql`CURRENT_DATE - 29`;
  const endDate   = end   ?? sql`CURRENT_DATE`;

  // Trae todas las queries del rango — ~17K filas total, manejable en memoria.
  const allRows = await sql`
    SELECT search_term,
           SUM(clicks)::bigint        AS clicks,
           SUM(impressions)::bigint   AS impressions,
           SUM(cost)::numeric         AS cost,
           SUM(conversions)::numeric  AS conversions,
           SUM(conv_value)::numeric   AS conv_value
    FROM google_ads_search_terms
    WHERE client_id = ${client.id}
      AND snapshot_date BETWEEN ${startDate} AND ${endDate}
    GROUP BY search_term
  `;

  // Filtramos en JS por match de competidores
  type CompAgg = { competitor: string; terms: number; clicks: number; impressions: number; cost: number; conversions: number; convValue: number };
  const byCompetitor = new Map<string, CompAgg>();
  const matchedTerms: { term: string; clicks: number; cost: number; conversions: number; convValue: number }[] = [];

  for (const row of allRows) {
    const term = String(row.search_term).toLowerCase();
    const matched = competitors.find(c => term.includes(c.token));
    if (!matched) continue;

    const clicks = Number(row.clicks);
    const cost   = Number(row.cost);
    const conv   = Number(row.conversions);
    const cv     = Number(row.conv_value);

    matchedTerms.push({ term: row.search_term, clicks, cost, conversions: conv, convValue: cv });

    let agg = byCompetitor.get(matched.canonical);
    if (!agg) {
      agg = { competitor: matched.canonical, terms: 0, clicks: 0, impressions: 0, cost: 0, conversions: 0, convValue: 0 };
      byCompetitor.set(matched.canonical, agg);
    }
    agg.terms += 1;
    agg.clicks += clicks;
    agg.impressions += Number(row.impressions);
    agg.cost += cost;
    agg.conversions += conv;
    agg.convValue += cv;
  }

  const breakdown = [...byCompetitor.values()]
    .map(c => ({
      ...c,
      cpa: c.conversions > 0 ? c.cost / c.conversions : 0,
      roas: c.cost > 0 ? c.convValue / c.cost : 0,
      conversionRate: c.clicks > 0 ? c.conversions / c.clicks : 0,
    }))
    .sort((a, b) => b.cost - a.cost);

  const totals = breakdown.reduce((acc, c) => ({
    cost: acc.cost + c.cost,
    clicks: acc.clicks + c.clicks,
    impressions: acc.impressions + c.impressions,
    conversions: acc.conversions + c.conversions,
    convValue: acc.convValue + c.convValue,
    terms: acc.terms + c.terms,
  }), { cost: 0, clicks: 0, impressions: 0, conversions: 0, convValue: 0, terms: 0 });

  // Proyección mensual normalizada
  const days = (start && end)
    ? Math.max(1, Math.ceil((new Date(end).getTime() - new Date(start).getTime()) / 86400000) + 1)
    : 30;
  const monthlyProjection = {
    cost: (totals.cost / days) * 30,
    conversions: (totals.conversions / days) * 30,
    convValue: (totals.convValue / days) * 30,
  };

  // Top 20 queries de competencia (más caras)
  matchedTerms.sort((a, b) => b.cost - a.cost);
  const topTerms = matchedTerms.slice(0, 20);

  return new Response(JSON.stringify({
    configured: true,
    competitors: competitors.map(c => c.canonical).filter((v, i, a) => a.indexOf(v) === i),
    breakdown,
    totals: {
      ...totals,
      cpa: totals.conversions > 0 ? totals.cost / totals.conversions : 0,
      roas: totals.cost > 0 ? totals.convValue / totals.cost : 0,
      conversionRate: totals.clicks > 0 ? totals.conversions / totals.clicks : 0,
    },
    monthlyProjection,
    topTerms,
  }), { headers: corsHeaders() });
};
