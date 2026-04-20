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
    SELECT MAX(snapshot_date) as d FROM product_routes WHERE client_id = ${client.id}
  `;
  const routes = await sql`
    SELECT * FROM product_routes
    WHERE client_id = ${client.id} AND snapshot_date = ${latestDate[0].d}
    ORDER BY revenue DESC
  `;

  const routesList = routes.map((r: any) => ({
    id:             String(r.id),
    route:          r.route,
    revenue:        Number(r.revenue),
    revenueDelta:   Number(r.revenue_delta ?? 0),
    articles:       Number(r.articles),
    articlesDelta:  Number(r.articles_delta ?? 0),
    purchases:      Number(r.purchases),
    purchasesDelta: Number(r.purchases_delta ?? 0),
    addToCart:      Number(r.add_to_cart),
  }));

  return new Response(JSON.stringify({ routes: routesList }), { headers: corsHeaders() });
};
