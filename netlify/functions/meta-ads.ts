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

  const [curr] = await sql`
    SELECT SUM(spend)::numeric AS spend, SUM(purchases)::bigint AS purchases, SUM(revenue)::numeric AS revenue
    FROM meta_ads_campaigns
    WHERE client_id = ${client.id} AND snapshot_date BETWEEN ${startDate} AND ${endDate}
  `;

  const [prev] = await sql`
    SELECT SUM(spend)::numeric AS spend, SUM(purchases)::bigint AS purchases, SUM(revenue)::numeric AS revenue
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

  const kpis = {
    spend:     { value: spend,     delta: delta(spend,     Number(prev?.spend ?? 0)) },
    purchases: { value: purchases, delta: delta(purchases, Number(prev?.purchases ?? 0)) },
    revenue:   { value: revenue,   delta: delta(revenue,   Number(prev?.revenue ?? 0)) },
    cpa:       { value: cpa,       delta: 0 },
    roas:      { value: roas,      delta: 0 },
    aov:       { value: aov,       delta: 0 },
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
