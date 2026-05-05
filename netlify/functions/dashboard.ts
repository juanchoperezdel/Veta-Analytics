import type { Context } from '@netlify/functions';
import { sql, corsHeaders, errorResponse } from './_db';
import { verifyToken, authorizeSlug, unauthorizedResponse } from './_auth';

// KPIs del Dashboard combinando 2 fuentes:
//   - business_kpis (GA4): users, sessions, avgSessionDuration, conversionRate, carts (add-to-cart events)
//   - meta_ads_campaigns + google_ads_campaigns: revenue, tickets (compras), AOV
//
// Por qué dividir: GA4 puede estar bloqueado/desactualizado (token OAuth), pero
// Meta + Google se sincronizan cada hora y son fuente de verdad para revenue real.

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
  // Period anterior: mismo rango un mes atrás
  const prevStart = sql`(${startDate}::date - INTERVAL '1 month')`;
  const prevEnd   = sql`(${endDate}::date - INTERVAL '1 month')`;

  // ─── KPIs de tráfico desde GA4 (business_kpis) ──────────────────────────
  // Si GA4 está bloqueado, estos quedan en 0 / vacíos pero el dashboard sigue mostrando lo demás.
  const [currGa] = await sql`
    SELECT
      SUM(users)::bigint           AS users,
      SUM(sessions)::bigint        AS sessions,
      SUM(carts)::bigint           AS carts,
      MAX(avg_session_duration)    AS avg_session_duration
    FROM business_kpis
    WHERE client_id = ${client.id}
      AND snapshot_date BETWEEN ${startDate} AND ${endDate}
  `;
  const [prevGa] = await sql`
    SELECT
      SUM(users)::bigint           AS users,
      SUM(sessions)::bigint        AS sessions,
      SUM(carts)::bigint           AS carts
    FROM business_kpis
    WHERE client_id = ${client.id}
      AND snapshot_date BETWEEN ${prevStart} AND ${prevEnd}
  `;

  // ─── KPIs comerciales desde Meta + Google (siempre frescos) ─────────────
  // Para Meta solo contamos campañas con objetivo de venta (no awareness/traffic
  // que reportan view-through inflado).
  const SALES_OBJECTIVES = ['OUTCOME_SALES', 'CONVERSIONS', 'PRODUCT_CATALOG_SALES'];

  const [currMeta] = await sql`
    SELECT
      COALESCE(SUM(spend), 0)::numeric    AS spend,
      COALESCE(SUM(CASE WHEN type = ANY(${SALES_OBJECTIVES}::text[]) THEN purchases ELSE 0 END), 0)::bigint AS purchases,
      COALESCE(SUM(CASE WHEN type = ANY(${SALES_OBJECTIVES}::text[]) THEN revenue   ELSE 0 END), 0)::numeric AS revenue
    FROM meta_ads_campaigns
    WHERE client_id = ${client.id} AND snapshot_date BETWEEN ${startDate} AND ${endDate}
  `;
  const [currGoogle] = await sql`
    SELECT
      COALESCE(SUM(spend), 0)::numeric   AS spend,
      COALESCE(SUM(carts), 0)::bigint    AS purchases,
      COALESCE(SUM(revenue), 0)::numeric AS revenue
    FROM google_ads_campaigns
    WHERE client_id = ${client.id} AND snapshot_date BETWEEN ${startDate} AND ${endDate}
  `;
  const [prevMeta] = await sql`
    SELECT
      COALESCE(SUM(CASE WHEN type = ANY(${SALES_OBJECTIVES}::text[]) THEN purchases ELSE 0 END), 0)::bigint AS purchases,
      COALESCE(SUM(CASE WHEN type = ANY(${SALES_OBJECTIVES}::text[]) THEN revenue   ELSE 0 END), 0)::numeric AS revenue
    FROM meta_ads_campaigns
    WHERE client_id = ${client.id} AND snapshot_date BETWEEN ${prevStart} AND ${prevEnd}
  `;
  const [prevGoogle] = await sql`
    SELECT
      COALESCE(SUM(carts), 0)::bigint    AS purchases,
      COALESCE(SUM(revenue), 0)::numeric AS revenue
    FROM google_ads_campaigns
    WHERE client_id = ${client.id} AND snapshot_date BETWEEN ${prevStart} AND ${prevEnd}
  `;

  function delta(c: number, p: number) {
    if (!p || p === 0) return 0;
    return (c - p) / p;
  }

  // Combinar Meta + Google para revenue/purchases/AOV
  const revenue       = Number(currMeta.revenue) + Number(currGoogle.revenue);
  const tickets       = Number(currMeta.purchases) + Number(currGoogle.purchases);
  const aov           = tickets > 0 ? revenue / tickets : 0;
  const prevRevenue   = Number(prevMeta.revenue) + Number(prevGoogle.revenue);
  const prevTickets   = Number(prevMeta.purchases) + Number(prevGoogle.purchases);
  const prevAov       = prevTickets > 0 ? prevRevenue / prevTickets : 0;

  // GA4 tráfico (puede estar congelado)
  const users    = Number(currGa?.users ?? 0);
  const sessions = Number(currGa?.sessions ?? 0);
  const carts    = Number(currGa?.carts ?? 0);
  const conversionRate = users > 0 ? tickets / users : 0;
  const prevUsers    = Number(prevGa?.users ?? 0);
  const prevSessions = Number(prevGa?.sessions ?? 0);
  const prevCarts    = Number(prevGa?.carts ?? 0);
  const prevConversionRate = prevUsers > 0 ? prevTickets / prevUsers : 0;

  const businessKpis = {
    users:              { value: users,           delta: delta(users, prevUsers) },
    sessions:           { value: sessions,        delta: delta(sessions, prevSessions) },
    avgSessionDuration: { value: currGa?.avg_session_duration ?? '00:00', delta: 0 },
    conversionRate:     { value: conversionRate,  delta: delta(conversionRate, prevConversionRate) },
    carts:              { value: carts,           delta: delta(carts, prevCarts) },
    tickets:            { value: tickets,         delta: delta(tickets, prevTickets) },
    revenue:            { value: revenue,         delta: delta(revenue, prevRevenue) },
    aov:                { value: aov,             delta: delta(aov, prevAov) },
  };

  // Ingresos por canal — todos frescos
  const channelRevenue = {
    google: Number(currGoogle.revenue),
    meta:   Number(currMeta.revenue),
    other:  0,  // antes era totalRev_GA4 - meta - google, daba negativo si GA4 estaba viejo
  };

  return new Response(JSON.stringify({ businessKpis, channelRevenue }), { headers: corsHeaders() });
};
