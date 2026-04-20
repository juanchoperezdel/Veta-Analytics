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

  // KPIs agregados del período
  const [curr] = await sql`
    SELECT
      SUM(spend)::numeric   AS spend,
      SUM(carts)::bigint    AS carts,
      SUM(revenue)::numeric AS revenue
    FROM google_ads_campaigns
    WHERE client_id = ${client.id}
      AND snapshot_date BETWEEN ${startDate} AND ${endDate}
  `;

  const [prev] = await sql`
    SELECT SUM(spend)::numeric AS spend, SUM(carts)::bigint AS carts, SUM(revenue)::numeric AS revenue
    FROM google_ads_campaigns
    WHERE client_id = ${client.id}
      AND snapshot_date BETWEEN
        (${startDate}::date - INTERVAL '1 month')
        AND (${endDate}::date - INTERVAL '1 month')
  `;

  function delta(c: number, p: number) { return (!p || p === 0) ? 0 : (c - p) / p; }

  const spend   = Number(curr?.spend ?? 0);
  const carts   = Number(curr?.carts ?? 0);
  const revenue = Number(curr?.revenue ?? 0);
  const roas    = spend > 0 ? revenue / spend : 0;
  const cpa     = carts > 0 ? spend / carts : 0;
  const aov     = carts > 0 ? revenue / carts : 0;

  const kpis = {
    spend:   { value: spend,   delta: delta(spend,   Number(prev?.spend ?? 0)) },
    carts:   { value: carts,   delta: delta(carts,   Number(prev?.carts ?? 0)) },
    tickets: { value: 0,       delta: 0 },
    revenue: { value: revenue, delta: delta(revenue, Number(prev?.revenue ?? 0)) },
    cpa:     { value: cpa,     delta: 0 },
    roas:    { value: roas,    delta: 0 },
    aov:     { value: aov,     delta: 0 },
  };

  // Campañas agregadas del período
  const rows = await sql`
    SELECT
      campaign_id,
      MAX(name) AS name,
      SUM(spend)::numeric       AS spend,
      SUM(impressions)::bigint  AS impressions,
      SUM(clicks)::bigint       AS clicks,
      AVG(ctr)::numeric         AS ctr,
      AVG(cpc)::numeric         AS cpc,
      SUM(carts)::bigint        AS carts,
      SUM(revenue)::numeric     AS revenue
    FROM google_ads_campaigns
    WHERE client_id = ${client.id}
      AND snapshot_date BETWEEN ${startDate} AND ${endDate}
    GROUP BY campaign_id
    ORDER BY SUM(spend) DESC
  `;

  const campaigns = rows.map((c: any) => {
    const s = Number(c.spend), r = Number(c.revenue);
    return {
      id: c.campaign_id, name: c.name,
      spend: s, impressions: Number(c.impressions), clicks: Number(c.clicks),
      ctr: Number(c.ctr), cpc: Number(c.cpc),
      users: 0, retention: 0,
      carts: Number(c.carts), revenue: r,
      roas: s > 0 ? r / s : 0,
    };
  });

  return new Response(JSON.stringify({ kpis, campaigns }), { headers: corsHeaders() });
};
