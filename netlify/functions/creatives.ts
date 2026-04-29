import type { Context } from '@netlify/functions';
import { sql, corsHeaders, errorResponse } from './_db';
import { verifyToken, authorizeSlug, unauthorizedResponse } from './_auth';

// Creatives ad-level de Meta. Devuelve cada ad agregado en el rango con thumbnail,
// status, métricas y delta vs período anterior.

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

  const rows = await sql`
    SELECT
      ad_id,
      MAX(ad_name)          AS ad_name,
      MAX(campaign_name)    AS campaign_name,
      MAX(thumbnail_url)    AS thumbnail_url,
      MAX(effective_status) AS status,
      SUM(spend)::numeric       AS spend,
      SUM(impressions)::bigint  AS impressions,
      SUM(clicks)::bigint       AS clicks,
      SUM(reach)::bigint        AS reach,
      SUM(purchases)::bigint    AS purchases,
      SUM(revenue)::numeric     AS revenue
    FROM meta_ads_creatives
    WHERE client_id = ${client.id}
      AND snapshot_date BETWEEN ${startDate} AND ${endDate}
    GROUP BY ad_id
    HAVING SUM(spend) > 0
    ORDER BY SUM(spend) DESC
  `;

  const creatives = rows.map((r: any) => {
    const spend = Number(r.spend);
    const purchases = Number(r.purchases);
    const revenue = Number(r.revenue);
    return {
      adId:         r.ad_id,
      adName:       r.ad_name,
      campaignName: r.campaign_name,
      thumbnailUrl: r.thumbnail_url,
      status:       r.status,
      spend,
      impressions:  Number(r.impressions),
      clicks:       Number(r.clicks),
      reach:        Number(r.reach),
      purchases,
      revenue,
      cpa:          purchases > 0 ? spend / purchases : 0,
      roas:         spend > 0 ? revenue / spend : 0,
      ctr:          Number(r.impressions) > 0 ? Number(r.clicks) / Number(r.impressions) : 0,
    };
  });

  return new Response(JSON.stringify({ creatives }), { headers: corsHeaders() });
};
