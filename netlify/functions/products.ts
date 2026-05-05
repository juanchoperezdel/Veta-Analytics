import type { Context } from '@netlify/functions';
import { sql, corsHeaders, errorResponse } from './_db';
import { verifyToken, authorizeSlug, unauthorizedResponse } from './_auth';
import { buildRouteConclusions } from './_conclusions';

// Devuelve data agregada de rutas combinando 3 fuentes:
//   - product_routes (GA4 e-commerce, vacío para Andesmar hoy)
//   - meta_ads_campaigns + google_ads_campaigns con columna `route` (parser de nombre)
//   - google_ads_search_terms con columna `route` (parser de query)
//
// Para cada ruta:
//   spend (Meta + Google), purchases (Meta + Google), revenue, demand (search clicks),
//   sparkline (serie diaria de spend), delta vs período anterior.

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

  // ─── Período actual: agregado por ruta desde Meta + Google + Search Terms ──
  // Solo consideramos rows con route IS NOT NULL — los nulos van al pool "Sin clasificar"
  const metaRows = await sql`
    SELECT route,
           SUM(spend)::numeric     AS spend,
           SUM(purchases)::bigint  AS purchases,
           SUM(revenue)::numeric   AS revenue
    FROM meta_ads_campaigns
    WHERE client_id = ${client.id}
      AND snapshot_date BETWEEN ${startDate} AND ${endDate}
      AND route IS NOT NULL
    GROUP BY route
  `;
  const googleRows = await sql`
    SELECT route,
           SUM(spend)::numeric     AS spend,
           SUM(carts)::bigint      AS purchases,
           SUM(revenue)::numeric   AS revenue
    FROM google_ads_campaigns
    WHERE client_id = ${client.id}
      AND snapshot_date BETWEEN ${startDate} AND ${endDate}
      AND route IS NOT NULL
    GROUP BY route
  `;
  const demandRows = await sql`
    SELECT route,
           SUM(clicks)::bigint       AS demand,
           SUM(impressions)::bigint  AS impressions
    FROM google_ads_search_terms
    WHERE client_id = ${client.id}
      AND snapshot_date BETWEEN ${startDate} AND ${endDate}
      AND route IS NOT NULL
    GROUP BY route
  `;

  // ─── Período anterior (mismo rango un mes atrás) — para deltas ────────────
  const metaPrev = await sql`
    SELECT route,
           SUM(spend)::numeric     AS spend,
           SUM(purchases)::bigint  AS purchases,
           SUM(revenue)::numeric   AS revenue
    FROM meta_ads_campaigns
    WHERE client_id = ${client.id}
      AND snapshot_date BETWEEN
        (${startDate}::date - INTERVAL '1 month')
        AND (${endDate}::date - INTERVAL '1 month')
      AND route IS NOT NULL
    GROUP BY route
  `;
  const googlePrev = await sql`
    SELECT route,
           SUM(spend)::numeric     AS spend,
           SUM(carts)::bigint      AS purchases,
           SUM(revenue)::numeric   AS revenue
    FROM google_ads_campaigns
    WHERE client_id = ${client.id}
      AND snapshot_date BETWEEN
        (${startDate}::date - INTERVAL '1 month')
        AND (${endDate}::date - INTERVAL '1 month')
      AND route IS NOT NULL
    GROUP BY route
  `;

  // ─── Sparkline: serie diaria de spend (últimos 30 días) ────────────────────
  const sparkRows = await sql`
    SELECT route, snapshot_date::text AS date, SUM(spend)::numeric AS spend
    FROM (
      SELECT route, snapshot_date, spend FROM meta_ads_campaigns
      WHERE client_id = ${client.id}
        AND snapshot_date BETWEEN ${startDate} AND ${endDate}
        AND route IS NOT NULL
      UNION ALL
      SELECT route, snapshot_date, spend FROM google_ads_campaigns
      WHERE client_id = ${client.id}
        AND snapshot_date BETWEEN ${startDate} AND ${endDate}
        AND route IS NOT NULL
    ) AS combined
    GROUP BY route, snapshot_date
    ORDER BY route, snapshot_date
  `;

  // ─── Combinar fuentes en una sola estructura por ruta ──────────────────────
  type Agg = {
    route: string;
    metaSpend: number; metaPurchases: number; metaRevenue: number;
    googleSpend: number; googlePurchases: number; googleRevenue: number;
    demandClicks: number; demandImpressions: number;
    sparkline: { date: string; spend: number }[];
  };
  const map = new Map<string, Agg>();
  function ensure(route: string): Agg {
    let a = map.get(route);
    if (!a) {
      a = { route, metaSpend: 0, metaPurchases: 0, metaRevenue: 0,
            googleSpend: 0, googlePurchases: 0, googleRevenue: 0,
            demandClicks: 0, demandImpressions: 0, sparkline: [] };
      map.set(route, a);
    }
    return a;
  }
  for (const r of metaRows)   { const a = ensure(r.route); a.metaSpend = Number(r.spend); a.metaPurchases = Number(r.purchases); a.metaRevenue = Number(r.revenue); }
  for (const r of googleRows) { const a = ensure(r.route); a.googleSpend = Number(r.spend); a.googlePurchases = Number(r.purchases); a.googleRevenue = Number(r.revenue); }
  for (const r of demandRows) { const a = ensure(r.route); a.demandClicks = Number(r.demand); a.demandImpressions = Number(r.impressions); }
  for (const r of sparkRows)  { const a = ensure(r.route); a.sparkline.push({ date: r.date, spend: Number(r.spend) }); }

  const prevMap = new Map<string, { spend: number; purchases: number; revenue: number }>();
  function ensurePrev(route: string) {
    if (!prevMap.has(route)) prevMap.set(route, { spend: 0, purchases: 0, revenue: 0 });
    return prevMap.get(route)!;
  }
  for (const r of metaPrev)   { const p = ensurePrev(r.route); p.spend += Number(r.spend); p.purchases += Number(r.purchases); p.revenue += Number(r.revenue); }
  for (const r of googlePrev) { const p = ensurePrev(r.route); p.spend += Number(r.spend); p.purchases += Number(r.purchases); p.revenue += Number(r.revenue); }

  function delta(c: number, p: number) { return (!p || p === 0) ? 0 : (c - p) / p; }

  const routes = [...map.values()].map((a, i) => {
    const totalSpend     = a.metaSpend + a.googleSpend;
    const totalPurchases = a.metaPurchases + a.googlePurchases;
    const totalRevenue   = a.metaRevenue + a.googleRevenue;
    const cpa            = totalPurchases > 0 ? totalSpend / totalPurchases : 0;
    const roas           = totalSpend > 0 ? totalRevenue / totalSpend : 0;
    const prev           = prevMap.get(a.route);

    return {
      id: String(i + 1),
      route: a.route,
      spend:           totalSpend,
      spendDelta:      delta(totalSpend, prev?.spend ?? 0),
      purchases:       totalPurchases,
      purchasesDelta:  delta(totalPurchases, prev?.purchases ?? 0),
      revenue:         totalRevenue,
      revenueDelta:    delta(totalRevenue, prev?.revenue ?? 0),
      cpa,
      roas,
      // Mix de canal: % del spend que viene de cada plataforma
      channelMix: {
        meta:   totalSpend > 0 ? a.metaSpend / totalSpend : 0,
        google: totalSpend > 0 ? a.googleSpend / totalSpend : 0,
      },
      // Demanda orgánica/paid search: clicks de queries que mencionan esta ruta
      demand: {
        clicks:      a.demandClicks,
        impressions: a.demandImpressions,
      },
      sparkline: a.sparkline,
    };
  }).sort((x, y) => y.revenue - x.revenue);

  // ─── Top movers: mayores subidas y caídas (% revenue delta) ────────────────
  // Solo rutas con revenue significativo en alguno de los 2 períodos
  const movers = routes
    .filter(r => r.revenue > 0 || (prevMap.get(r.route)?.revenue ?? 0) > 0)
    .filter(r => Math.abs(r.revenueDelta) > 0.01);
  const topGainers = [...movers].sort((a, b) => b.revenueDelta - a.revenueDelta).slice(0, 5);
  const topLosers  = [...movers].sort((a, b) => a.revenueDelta - b.revenueDelta).slice(0, 5);

  // ─── Oportunidades: alta demanda (clicks) pero bajo spend ─────────────────
  // Score = demand normalizada / spend normalizada (rutas baratas con búsquedas).
  const maxDemand = Math.max(...routes.map(r => r.demand.clicks), 1);
  const maxSpend  = Math.max(...routes.map(r => r.spend), 1);
  const opportunities = routes
    .filter(r => r.demand.clicks > 0)
    .map(r => ({
      ...r,
      opportunityScore: (r.demand.clicks / maxDemand) - (r.spend / maxSpend),
    }))
    .filter(r => r.opportunityScore > 0)
    .sort((a, b) => b.opportunityScore - a.opportunityScore)
    .slice(0, 5);

  // ─── Histórico mensual por ruta (últimos 18 meses) ────────────────────────
  // Base para momentum y forecast. Solo meses CERRADOS (excluimos el mes en curso
  // para evitar ruido del mes incompleto).
  const monthlyRows = await sql`
    SELECT route,
           date_trunc('month', snapshot_date)::date AS month,
           SUM(spend)::numeric    AS spend,
           SUM(purchases)::bigint AS purchases,
           SUM(revenue)::numeric  AS revenue
    FROM (
      SELECT route, snapshot_date, spend, purchases, revenue FROM meta_ads_campaigns
      WHERE client_id = ${client.id}
        AND snapshot_date >= (CURRENT_DATE - INTERVAL '18 months')
        AND snapshot_date <  date_trunc('month', CURRENT_DATE)
        AND route IS NOT NULL
      UNION ALL
      SELECT route, snapshot_date, spend, carts AS purchases, revenue FROM google_ads_campaigns
      WHERE client_id = ${client.id}
        AND snapshot_date >= (CURRENT_DATE - INTERVAL '18 months')
        AND snapshot_date <  date_trunc('month', CURRENT_DATE)
        AND route IS NOT NULL
    ) AS combined
    GROUP BY route, date_trunc('month', snapshot_date)
    ORDER BY route, month
  `;

  // YoY apples-to-apples: mes en curso hasta HOY vs mismo período del año anterior.
  // Si hoy es 5/may, comparamos 1-5 may 2026 vs 1-5 may 2025 (NO mes completo vs parcial).
  const partialCurrentRows = await sql`
    SELECT route, SUM(spend)::numeric AS spend, SUM(revenue)::numeric AS revenue, SUM(purchases)::bigint AS purchases
    FROM (
      SELECT route, spend, purchases, revenue FROM meta_ads_campaigns
      WHERE client_id = ${client.id}
        AND snapshot_date >= date_trunc('month', CURRENT_DATE)
        AND snapshot_date <= CURRENT_DATE
        AND route IS NOT NULL
      UNION ALL
      SELECT route, spend, carts AS purchases, revenue FROM google_ads_campaigns
      WHERE client_id = ${client.id}
        AND snapshot_date >= date_trunc('month', CURRENT_DATE)
        AND snapshot_date <= CURRENT_DATE
        AND route IS NOT NULL
    ) AS combined
    GROUP BY route
  `;
  const partialYoyRows = await sql`
    SELECT route, SUM(spend)::numeric AS spend, SUM(revenue)::numeric AS revenue, SUM(purchases)::bigint AS purchases
    FROM (
      SELECT route, spend, purchases, revenue FROM meta_ads_campaigns
      WHERE client_id = ${client.id}
        AND snapshot_date >= (date_trunc('month', CURRENT_DATE) - INTERVAL '1 year')
        AND snapshot_date <= (CURRENT_DATE - INTERVAL '1 year')
        AND route IS NOT NULL
      UNION ALL
      SELECT route, spend, carts AS purchases, revenue FROM google_ads_campaigns
      WHERE client_id = ${client.id}
        AND snapshot_date >= (date_trunc('month', CURRENT_DATE) - INTERVAL '1 year')
        AND snapshot_date <= (CURRENT_DATE - INTERVAL '1 year')
        AND route IS NOT NULL
    ) AS combined
    GROUP BY route
  `;

  // Demanda histórica por mes (search terms) — solo meses cerrados también.
  const demandMonthlyRows = await sql`
    SELECT route,
           date_trunc('month', snapshot_date)::date AS month,
           SUM(clicks)::bigint AS clicks
    FROM google_ads_search_terms
    WHERE client_id = ${client.id}
      AND snapshot_date >= (CURRENT_DATE - INTERVAL '6 months')
      AND snapshot_date <  date_trunc('month', CURRENT_DATE)
      AND route IS NOT NULL
    GROUP BY route, date_trunc('month', snapshot_date)
    ORDER BY route, month
  `;

  const conclusions = buildRouteConclusions(routes, monthlyRows, demandMonthlyRows, partialCurrentRows, partialYoyRows);

  return new Response(JSON.stringify({
    routes,
    topGainers,
    topLosers,
    opportunities,
    conclusions,
  }), { headers: corsHeaders() });
};
