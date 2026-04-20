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

  // Período actual
  const [curr] = await sql`
    SELECT
      SUM(users)::bigint           AS users,
      SUM(sessions)::bigint        AS sessions,
      SUM(revenue)::numeric        AS revenue,
      SUM(carts)::bigint           AS carts,
      SUM(tickets)::bigint         AS tickets,
      AVG(conversion_rate)::numeric AS conversion_rate,
      AVG(aov)::numeric             AS aov,
      MAX(avg_session_duration)     AS avg_session_duration
    FROM business_kpis
    WHERE client_id = ${client.id}
      AND snapshot_date BETWEEN ${start ?? sql`CURRENT_DATE - 29`} AND ${end ?? sql`CURRENT_DATE`}
  `;

  // Período anterior (mismo largo)
  const [prev] = await sql`
    SELECT
      SUM(users)::bigint           AS users,
      SUM(sessions)::bigint        AS sessions,
      SUM(revenue)::numeric        AS revenue,
      SUM(carts)::bigint           AS carts,
      SUM(tickets)::bigint         AS tickets,
      AVG(conversion_rate)::numeric AS conversion_rate,
      AVG(aov)::numeric             AS aov
    FROM business_kpis
    WHERE client_id = ${client.id}
      AND snapshot_date BETWEEN
        (${start ?? sql`CURRENT_DATE - 29`}::date - (${end ?? sql`CURRENT_DATE`}::date - ${start ?? sql`CURRENT_DATE - 29`}::date + 1))
        AND (${start ?? sql`CURRENT_DATE - 29`}::date - 1)
  `;

  function delta(c: number, p: number) {
    if (!p || p === 0) return 0;
    return (c - p) / p;
  }

  const businessKpis = curr ? {
    users:              { value: Number(curr.users ?? 0),            delta: delta(curr.users, prev?.users) },
    sessions:           { value: Number(curr.sessions ?? 0),         delta: delta(curr.sessions, prev?.sessions) },
    avgSessionDuration: { value: curr.avg_session_duration ?? '00:00', delta: 0 },
    conversionRate:     { value: Number(curr.conversion_rate ?? 0),  delta: delta(curr.conversion_rate, prev?.conversion_rate) },
    carts:              { value: Number(curr.carts ?? 0),            delta: delta(curr.carts, prev?.carts) },
    tickets:            { value: Number(curr.tickets ?? 0),          delta: delta(curr.tickets, prev?.tickets) },
    revenue:            { value: Number(curr.revenue ?? 0),          delta: delta(curr.revenue, prev?.revenue) },
    aov:                { value: Number(curr.aov ?? 0),              delta: delta(curr.aov, prev?.aov) },
  } : null;

  return new Response(JSON.stringify({ businessKpis }), { headers: corsHeaders() });
};
