import type { Context } from '@netlify/functions';
import { sql, corsHeaders, errorResponse } from './_db';
import { verifyToken, authorizeSlug, unauthorizedResponse } from './_auth';

export default async (req: Request, _context: Context) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: corsHeaders() });

  const user = await verifyToken(req);
  if (!user) return unauthorizedResponse();

  const params = new URL(req.url).searchParams;
  const slug = params.get('slug');
  if (!slug) return errorResponse('Missing slug', 400);
  if (!(await authorizeSlug(user.userId, slug))) return unauthorizedResponse();

  const [client] = await sql`SELECT id FROM clients WHERE slug = ${slug}`;
  if (!client) return errorResponse('Client not found', 404);

  const meta = await sql`
    SELECT
      TO_CHAR(snapshot_date, 'YYYY-MM') AS month,
      SUM(spend)::numeric      AS spend,
      SUM(revenue)::numeric    AS revenue,
      SUM(purchases)::bigint   AS purchases
    FROM meta_ads_campaigns
    WHERE client_id = ${client.id}
    GROUP BY 1
    ORDER BY 1
  `;

  const google = await sql`
    SELECT
      TO_CHAR(snapshot_date, 'YYYY-MM') AS month,
      SUM(spend)::numeric      AS spend,
      SUM(revenue)::numeric    AS revenue,
      SUM(carts)::bigint       AS purchases
    FROM google_ads_campaigns
    WHERE client_id = ${client.id}
    GROUP BY 1
    ORDER BY 1
  `;

  const allMonths = Array.from(new Set([
    ...meta.map((r: any) => r.month),
    ...google.map((r: any) => r.month),
  ])).sort();

  const metaMap   = Object.fromEntries(meta.map((r: any) => [r.month, r]));
  const googleMap = Object.fromEntries(google.map((r: any) => [r.month, r]));

  const toChannel = (r: any) => {
    if (!r) return { spend: 0, revenue: 0, purchases: 0, roas: 0 };
    const spend = Number(r.spend ?? 0), revenue = Number(r.revenue ?? 0);
    return {
      spend, revenue,
      purchases: Number(r.purchases ?? 0),
      roas: spend > 0 ? revenue / spend : 0,
    };
  };

  const months = allMonths.map(month => {
    const m = toChannel(metaMap[month]);
    const g = toChannel(googleMap[month]);
    const totalSpend   = m.spend + g.spend;
    const totalRevenue = m.revenue + g.revenue;
    return {
      month,
      meta:   m,
      google: g,
      total: {
        spend: totalSpend,
        revenue: totalRevenue,
        purchases: m.purchases + g.purchases,
        roas: totalSpend > 0 ? totalRevenue / totalSpend : 0,
      },
    };
  });

  return new Response(JSON.stringify({ months }), { headers: corsHeaders() });
};
