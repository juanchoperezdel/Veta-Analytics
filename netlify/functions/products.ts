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
      route,
      SUM(revenue)::numeric   AS revenue,
      SUM(articles)::bigint   AS articles,
      SUM(purchases)::bigint  AS purchases,
      SUM(add_to_cart)::bigint AS add_to_cart
    FROM product_routes
    WHERE client_id = ${client.id} AND snapshot_date BETWEEN ${startDate} AND ${endDate}
    GROUP BY route
    ORDER BY SUM(revenue) DESC
  `;

  // Delta vs período anterior
  const prevRows = await sql`
    SELECT route, SUM(revenue)::numeric AS revenue, SUM(articles)::bigint AS articles, SUM(purchases)::bigint AS purchases
    FROM product_routes
    WHERE client_id = ${client.id}
      AND snapshot_date BETWEEN
        (${startDate}::date - (${endDate}::date - ${startDate}::date + 1))
        AND (${startDate}::date - 1)
    GROUP BY route
  `;
  const prevMap = Object.fromEntries(prevRows.map((r: any) => [r.route, r]));

  function delta(c: number, p: number) { return (!p || p === 0) ? 0 : ((c - p) / p) * 100; }

  const routes = rows.map((r: any, i: number) => {
    const p = prevMap[r.route];
    return {
      id: String(i + 1),
      route: r.route,
      revenue:        Number(r.revenue),
      revenueDelta:   delta(r.revenue, p?.revenue),
      articles:       Number(r.articles),
      articlesDelta:  delta(r.articles, p?.articles),
      purchases:      Number(r.purchases),
      purchasesDelta: delta(r.purchases, p?.purchases),
      addToCart:      Number(r.add_to_cart),
    };
  });

  return new Response(JSON.stringify({ routes }), { headers: corsHeaders() });
};
