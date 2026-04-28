import type { Context } from '@netlify/functions';
import { sql, corsHeaders, errorResponse } from './_db';
import { verifyToken, authorizeSlug, unauthorizedResponse } from './_auth';

export default async (req: Request, context: Context) => {
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

  // Sumamos spend/reach/clicks de TODAS las campañas activas en el rango, pero las ventas
  // solo de las campañas de objetivo de conversión (OUTCOME_SALES / CONVERSIONS). Las de
  // awareness, traffic, engagement igual reportan "purchases" por view-through, pero no
  // son su objetivo y sobrecuentan las ventas atribuidas a otras campañas.
  const SALES_OBJECTIVES = ['OUTCOME_SALES', 'CONVERSIONS', 'PRODUCT_CATALOG_SALES'];

  const [curr] = await sql`
    SELECT
      SUM(spend)::numeric AS spend,
      SUM(CASE WHEN type = ANY(${SALES_OBJECTIVES}::text[]) THEN purchases ELSE 0 END)::bigint AS purchases,
      SUM(CASE WHEN type = ANY(${SALES_OBJECTIVES}::text[]) THEN revenue   ELSE 0 END)::numeric AS revenue
    FROM meta_ads_campaigns
    WHERE client_id = ${client.id} AND snapshot_date BETWEEN ${startDate} AND ${endDate}
  `;

  const [prev] = await sql`
    SELECT
      SUM(spend)::numeric AS spend,
      SUM(CASE WHEN type = ANY(${SALES_OBJECTIVES}::text[]) THEN purchases ELSE 0 END)::bigint AS purchases,
      SUM(CASE WHEN type = ANY(${SALES_OBJECTIVES}::text[]) THEN revenue   ELSE 0 END)::numeric AS revenue
    FROM meta_ads_campaigns
    WHERE client_id = ${client.id}
      AND snapshot_date BETWEEN
        (${startDate}::date - INTERVAL '1 month')
        AND (${endDate}::date - INTERVAL '1 month')
  `;

  function delta(c: number, p: number) { return (!p || p === 0) ? 0 : (c - p) / p; }

  const spend     = Number(curr?.spend ?? 0);
  const purchases = Number(curr?.purchases ?? 0);
  const revenue   = Number(curr?.revenue ?? 0);
  const roas      = spend > 0 ? revenue / spend : 0;
  const cpa       = purchases > 0 ? spend / purchases : 0;
  const aov       = purchases > 0 ? revenue / purchases : 0;

  const prevSpend     = Number(prev?.spend ?? 0);
  const prevPurchases = Number(prev?.purchases ?? 0);
  const prevRevenue   = Number(prev?.revenue ?? 0);
  const prevRoas      = prevSpend > 0 ? prevRevenue / prevSpend : 0;
  const prevCpa       = prevPurchases > 0 ? prevSpend / prevPurchases : 0;
  const prevAov       = prevPurchases > 0 ? prevRevenue / prevPurchases : 0;

  const kpis = {
    spend:     { value: spend,     delta: delta(spend,     prevSpend) },
    purchases: { value: purchases, delta: delta(purchases, prevPurchases) },
    revenue:   { value: revenue,   delta: delta(revenue,   prevRevenue) },
    cpa:       { value: cpa,       delta: delta(cpa,       prevCpa) },
    roas:      { value: roas,      delta: delta(roas,      prevRoas) },
    aov:       { value: aov,       delta: delta(aov,       prevAov) },
  };

  const rows = await sql`
    SELECT
      campaign_id,
      MAX(type) AS type, MAX(segment) AS segment,
      SUM(spend)::numeric     AS spend,
      SUM(reach)::bigint      AS reach,
      SUM(purchases)::bigint  AS purchases,
      SUM(revenue)::numeric   AS revenue
    FROM meta_ads_campaigns
    WHERE client_id = ${client.id} AND snapshot_date BETWEEN ${startDate} AND ${endDate}
    GROUP BY campaign_id
    ORDER BY SUM(spend) DESC
  `;

  const campaigns = rows.map((c: any) => {
    const s = Number(c.spend), r = Number(c.revenue), p = Number(c.purchases);
    return {
      id: c.campaign_id, type: c.type, segment: c.segment,
      spend: s, reach: Number(c.reach), purchases: p, revenue: r,
      cpa: p > 0 ? s / p : 0,
      roas: s > 0 ? r / s : 0,
      ctr: 0, cpc: 0,
    };
  });

  return new Response(JSON.stringify({ kpis, campaigns }), { headers: corsHeaders() });
};
