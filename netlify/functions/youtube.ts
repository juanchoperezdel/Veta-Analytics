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

  const rows = await sql`
    SELECT
      video_id,
      MAX(title) AS title, MAX(campaign) AS campaign,
      SUM(impressions)::bigint  AS impressions,
      SUM(clicks)::bigint       AS clicks,
      AVG(ctr)::numeric         AS ctr,
      SUM(conversions)::numeric AS conversions,
      AVG(conversion_rate)::numeric AS conversion_rate,
      SUM(spend)::numeric       AS spend
    FROM youtube_videos
    WHERE client_id = ${client.id} AND snapshot_date BETWEEN ${startDate} AND ${endDate}
    GROUP BY video_id
    ORDER BY SUM(spend) DESC
  `;

  const videos = rows.map((v: any) => ({
    id:             v.video_id,
    title:          v.title,
    campaign:       v.campaign,
    impressions:    Number(v.impressions),
    clicks:         Number(v.clicks),
    ctr:            Number(v.ctr),
    conversions:    Number(v.conversions),
    conversionRate: Number(v.conversion_rate),
    spend:          Number(v.spend),
  }));

  return new Response(JSON.stringify({ videos }), { headers: corsHeaders() });
};
