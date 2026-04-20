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

  const latestDate = await sql`
    SELECT MAX(snapshot_date) as d FROM youtube_videos WHERE client_id = ${client.id}
  `;
  const videos = await sql`
    SELECT * FROM youtube_videos
    WHERE client_id = ${client.id} AND snapshot_date = ${latestDate[0].d}
    ORDER BY spend DESC
  `;

  const videosList = videos.map((v: any) => ({
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

  return new Response(JSON.stringify({ videos: videosList }), { headers: corsHeaders() });
};
