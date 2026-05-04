import type { Context } from '@netlify/functions';
import { sql, corsHeaders, errorResponse } from './_db';
import { verifyToken, authorizeSlug, unauthorizedResponse } from './_auth';

// GET  /budgets?slug=...        → lista budgets de últimos 6 meses
// POST /budgets?slug=...        → upsert budget de un mes
//   body: { month: 'YYYY-MM-01', plannedSpend: number, notes?: string }

export default async (req: Request, _context: Context) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: corsHeaders() });

  const user = await verifyToken(req);
  if (!user) return unauthorizedResponse();

  const slug = new URL(req.url).searchParams.get('slug');
  if (!slug) return errorResponse('Missing slug', 400);
  if (!(await authorizeSlug(user.userId, slug))) return unauthorizedResponse();

  const [client] = await sql`SELECT id FROM clients WHERE slug = ${slug}`;
  if (!client) return errorResponse('Client not found', 404);

  if (req.method === 'POST') {
    const body = await req.json();
    const month = body.month;
    const plannedSpend = Number(body.plannedSpend);
    const notes = body.notes ?? null;
    if (!month || isNaN(plannedSpend) || plannedSpend < 0) {
      return errorResponse('Invalid body — needs month (YYYY-MM-01) and plannedSpend (number)', 400);
    }
    await sql`
      INSERT INTO client_budgets (client_id, month, planned_spend, notes)
      VALUES (${client.id}, ${month}, ${plannedSpend}, ${notes})
      ON CONFLICT (client_id, month)
      DO UPDATE SET planned_spend = EXCLUDED.planned_spend, notes = EXCLUDED.notes, updated_at = NOW()
    `;
    return new Response(JSON.stringify({ ok: true }), { headers: corsHeaders() });
  }

  // GET — devuelve últimos 6 meses + mes en curso
  const rows = await sql`
    SELECT month::text AS month, planned_spend::numeric AS planned_spend, notes
    FROM client_budgets
    WHERE client_id = ${client.id}
      AND month >= DATE_TRUNC('month', CURRENT_DATE - INTERVAL '5 months')
    ORDER BY month DESC
  `;

  return new Response(JSON.stringify({
    budgets: rows.map((r: any) => ({
      month: r.month,
      plannedSpend: Number(r.planned_spend),
      notes: r.notes,
    })),
  }), { headers: corsHeaders() });
};
