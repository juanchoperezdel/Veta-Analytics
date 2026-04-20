import type { Context } from '@netlify/functions';
import { sql, corsHeaders, errorResponse } from './_db';
import { verifyToken, authorizeSlug, unauthorizedResponse } from './_auth';

export default async (req: Request, context: Context) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: corsHeaders() });

  const user = await verifyToken(req);
  if (!user) return unauthorizedResponse();

  const slug = new URL(req.url).searchParams.get('slug');
  if (!slug) return errorResponse('Missing slug', 400);
  if (!(await authorizeSlug(user.userId, slug))) return unauthorizedResponse();

  const [client] = await sql`SELECT id FROM clients WHERE slug = ${slug}`;
  if (!client) return errorResponse('Client not found', 404);

  const [kpisRow] = await sql`
    SELECT * FROM google_ads_kpis
    WHERE client_id = ${client.id}
    ORDER BY snapshot_date DESC LIMIT 1
  `;

  const [prevKpis] = await sql`
    SELECT * FROM google_ads_kpis
    WHERE client_id = ${client.id}
    ORDER BY snapshot_date DESC LIMIT 1 OFFSET 1
  `;

  function delta(curr: number, prev: number) {
    if (!prev || prev === 0) return 0;
    return (curr - prev) / prev;
  }

  const kpis = kpisRow ? {
    spend:   { value: Number(kpisRow.spend),   delta: kpisRow.spend_delta   ?? delta(kpisRow.spend, prevKpis?.spend) },
    carts:   { value: Number(kpisRow.carts),   delta: kpisRow.carts_delta   ?? delta(kpisRow.carts, prevKpis?.carts) },
    tickets: { value: Number(kpisRow.tickets ?? 0), delta: kpisRow.tickets_delta ?? 0 },
    revenue: { value: Number(kpisRow.revenue), delta: kpisRow.revenue_delta ?? delta(kpisRow.revenue, prevKpis?.revenue) },
    cpa:     { value: Number(kpisRow.cpa),     delta: kpisRow.cpa_delta     ?? delta(kpisRow.cpa, prevKpis?.cpa) },
    roas:    { value: Number(kpisRow.roas),    delta: kpisRow.roas_delta    ?? delta(kpisRow.roas, prevKpis?.roas) },
    aov:     { value: Number(kpisRow.aov),     delta: kpisRow.aov_delta     ?? delta(kpisRow.aov, prevKpis?.aov) },
  } : null;

  const latestDate = await sql`
    SELECT MAX(snapshot_date) as d FROM google_ads_campaigns WHERE client_id = ${client.id}
  `;
  const campaigns = await sql`
    SELECT * FROM google_ads_campaigns
    WHERE client_id = ${client.id} AND snapshot_date = ${latestDate[0].d}
    ORDER BY spend DESC
  `;

  const campaignsList = campaigns.map((c: any) => ({
    id:         c.campaign_id,
    name:       c.name,
    spend:      Number(c.spend),
    impressions: Number(c.impressions),
    clicks:     Number(c.clicks),
    ctr:        Number(c.ctr),
    cpc:        Number(c.cpc),
    users:      Number(c.users ?? 0),
    retention:  Number(c.retention ?? 0),
    carts:      Number(c.carts),
    revenue:    Number(c.revenue),
    roas:       Number(c.roas),
  }));

  return new Response(JSON.stringify({ kpis, campaigns: campaignsList }), { headers: corsHeaders() });
};
