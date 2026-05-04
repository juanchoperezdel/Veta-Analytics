import type { Context } from '@netlify/functions';
import { sql, corsHeaders, errorResponse } from './_db';
import { verifyToken, authorizeSlug, unauthorizedResponse } from './_auth';

// Search terms reales que activaron ads. Devuelve:
//   topConverters:   queries con más conversiones (las que escalar)
//   wastedSpend:     queries con clicks/cost > X y conversiones = 0 (negative keyword candidates)
//   topByVolume:     queries con más impressions (visión de demanda)

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

  const startDate = start ?? sql`CURRENT_DATE - 29`;
  const endDate   = end   ?? sql`CURRENT_DATE`;

  // Agregamos por search_term a través del rango completo
  const allTerms = await sql`
    SELECT
      search_term,
      route,
      SUM(clicks)::bigint        AS clicks,
      SUM(impressions)::bigint   AS impressions,
      SUM(cost)::numeric         AS cost,
      SUM(conversions)::numeric  AS conversions,
      SUM(conv_value)::numeric   AS conv_value
    FROM google_ads_search_terms
    WHERE client_id = ${client.id}
      AND snapshot_date BETWEEN ${startDate} AND ${endDate}
    GROUP BY search_term, route
  `;

  type Term = {
    term: string;
    route: string | null;
    clicks: number;
    impressions: number;
    cost: number;
    conversions: number;
    convValue: number;
    cpa: number;
    roas: number;
  };
  const enriched: Term[] = allTerms.map((r: any) => {
    const cost = Number(r.cost);
    const conv = Number(r.conversions);
    const cv   = Number(r.conv_value);
    return {
      term:        r.search_term,
      route:       r.route,
      clicks:      Number(r.clicks),
      impressions: Number(r.impressions),
      cost,
      conversions: conv,
      convValue:   cv,
      cpa:         conv > 0 ? cost / conv : 0,
      roas:        cost > 0 ? cv / cost   : 0,
    };
  });

  // Top converters: con más conversiones, ordenadas por ROAS
  const topConverters = [...enriched]
    .filter(t => t.conversions > 0.5)
    .sort((a, b) => b.conversions - a.conversions)
    .slice(0, 30);

  // Wasted spend: gasto >= $1000 y 0 conversiones — candidatos a negative keywords
  const wastedSpend = [...enriched]
    .filter(t => t.cost >= 1000 && t.conversions < 0.5)
    .sort((a, b) => b.cost - a.cost)
    .slice(0, 30);

  // Ahorro mensual estimado si se cortaran TODAS las wasted queries
  // Normalizado a 30 días — si el rango es de 30 días ya es 1:1.
  const days = (start && end)
    ? Math.max(1, Math.ceil((new Date(end).getTime() - new Date(start).getTime()) / 86400000) + 1)
    : 30;
  const wastedTotalCost = wastedSpend.reduce((s, t) => s + t.cost, 0);
  const monthlySavings = (wastedTotalCost / days) * 30;
  // Lista lista para copy-paste a Google Ads (formato exact match negative keyword)
  const negativeKeywordsList = wastedSpend.map(t => `[${t.term}]`).join('\n');

  // Top by volume: más impresiones (señal de demanda agregada)
  const topByVolume = [...enriched]
    .sort((a, b) => b.impressions - a.impressions)
    .slice(0, 30);

  // Demanda agregada por ruta (para visualizar destinos más buscados)
  const demandByRoute = enriched
    .filter(t => t.route)
    .reduce<Record<string, { route: string; clicks: number; impressions: number; cost: number; conversions: number }>>((acc, t) => {
      const k = t.route!;
      if (!acc[k]) acc[k] = { route: k, clicks: 0, impressions: 0, cost: 0, conversions: 0 };
      acc[k].clicks      += t.clicks;
      acc[k].impressions += t.impressions;
      acc[k].cost        += t.cost;
      acc[k].conversions += t.conversions;
      return acc;
    }, {});
  const demand = Object.values(demandByRoute).sort((a, b) => b.clicks - a.clicks);

  return new Response(JSON.stringify({
    topConverters,
    wastedSpend,
    topByVolume,
    demand,
    totalUniqueTerms: enriched.length,
    actionable: {
      monthlySavings,
      negativeKeywordsCount: wastedSpend.length,
      negativeKeywordsList,
    },
  }), { headers: corsHeaders() });
};
