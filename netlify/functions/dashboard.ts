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

  const [kpis] = await sql`
    SELECT * FROM business_kpis
    WHERE client_id = ${client.id}
    ORDER BY snapshot_date DESC
    LIMIT 1
  `;

  // Buscar período anterior para calcular deltas
  const [prevKpis] = await sql`
    SELECT * FROM business_kpis
    WHERE client_id = ${client.id}
    ORDER BY snapshot_date DESC
    LIMIT 1 OFFSET 1
  `;

  function delta(curr: number, prev: number) {
    if (!prev || prev === 0) return 0;
    return (curr - prev) / prev;
  }

  const businessKpis = kpis ? {
    users:              { value: Number(kpis.users),            delta: kpis.users_delta            ?? delta(kpis.users, prevKpis?.users) },
    sessions:           { value: Number(kpis.sessions),         delta: kpis.sessions_delta         ?? delta(kpis.sessions, prevKpis?.sessions) },
    avgSessionDuration: { value: kpis.avg_session_duration,     delta: kpis.avg_session_duration_delta ?? 0 },
    conversionRate:     { value: Number(kpis.conversion_rate),  delta: kpis.conversion_rate_delta  ?? delta(kpis.conversion_rate, prevKpis?.conversion_rate) },
    carts:              { value: Number(kpis.carts),            delta: kpis.carts_delta            ?? delta(kpis.carts, prevKpis?.carts) },
    tickets:            { value: Number(kpis.tickets),          delta: kpis.tickets_delta          ?? delta(kpis.tickets, prevKpis?.tickets) },
    revenue:            { value: Number(kpis.revenue),          delta: kpis.revenue_delta          ?? delta(kpis.revenue, prevKpis?.revenue) },
    aov:                { value: Number(kpis.aov),              delta: kpis.aov_delta              ?? delta(kpis.aov, prevKpis?.aov) },
  } : null;

  return new Response(JSON.stringify({ businessKpis }), { headers: corsHeaders() });
};
