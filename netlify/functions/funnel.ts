import type { Context } from '@netlify/functions';
import { sql, corsHeaders, errorResponse } from './_db';
import { verifyToken, authorizeSlug, unauthorizedResponse } from './_auth';
import { buildFunnelConclusions } from './_conclusions';

// Embudo de conversión: Sesiones → Carritos → Compras
// Datos de business_kpis (GA4). Devuelve etapas + ratios + delta vs mes pasado.

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

  const [curr] = await sql`
    SELECT
      COALESCE(SUM(users), 0)::bigint     AS users,
      COALESCE(SUM(sessions), 0)::bigint  AS sessions,
      COALESCE(SUM(carts), 0)::bigint     AS carts,
      COALESCE(SUM(tickets), 0)::bigint   AS tickets,
      COALESCE(SUM(revenue), 0)::numeric  AS revenue
    FROM business_kpis
    WHERE client_id = ${client.id}
      AND snapshot_date BETWEEN ${startDate} AND ${endDate}
  `;
  const [prev] = await sql`
    SELECT
      COALESCE(SUM(users), 0)::bigint     AS users,
      COALESCE(SUM(sessions), 0)::bigint  AS sessions,
      COALESCE(SUM(carts), 0)::bigint     AS carts,
      COALESCE(SUM(tickets), 0)::bigint   AS tickets,
      COALESCE(SUM(revenue), 0)::numeric  AS revenue
    FROM business_kpis
    WHERE client_id = ${client.id}
      AND snapshot_date BETWEEN
        (${startDate}::date - INTERVAL '1 month')
        AND (${endDate}::date - INTERVAL '1 month')
  `;

  function delta(c: number, p: number) { return (!p || p === 0) ? 0 : (c - p) / p; }

  function stage(label: string, currV: number, prevV: number, parentCurr: number, parentPrev: number) {
    const conversion = parentCurr > 0 ? currV / parentCurr : 0;
    const prevConversion = parentPrev > 0 ? prevV / parentPrev : 0;
    return {
      label,
      value: currV,
      delta: delta(currV, prevV),
      conversionFromPrevStage: conversion,
      conversionDelta: delta(conversion, prevConversion),
    };
  }

  const cUsers    = Number(curr?.users ?? 0);
  const cSessions = Number(curr?.sessions ?? 0);
  const cCarts    = Number(curr?.carts ?? 0);
  const cTickets  = Number(curr?.tickets ?? 0);
  const cRevenue  = Number(curr?.revenue ?? 0);
  const pUsers    = Number(prev?.users ?? 0);
  const pSessions = Number(prev?.sessions ?? 0);
  const pCarts    = Number(prev?.carts ?? 0);
  const pTickets  = Number(prev?.tickets ?? 0);
  const pRevenue  = Number(prev?.revenue ?? 0);

  const stages = [
    { label: 'Usuarios',    value: cUsers,    delta: delta(cUsers, pUsers),       conversionFromPrevStage: 1,                              conversionDelta: 0 },
    stage('Sesiones',  cSessions, pSessions, cUsers,    pUsers),
    stage('Carritos',  cCarts,    pCarts,    cSessions, pSessions),
    stage('Compras',   cTickets,  pTickets,  cCarts,    pCarts),
  ];

  const totalConversion     = cUsers > 0 ? cTickets / cUsers : 0;
  const prevTotalConversion = pUsers > 0 ? pTickets / pUsers : 0;

  const totalConversionDelta = delta(totalConversion, prevTotalConversion);
  const revenue = { value: cRevenue, delta: delta(cRevenue, pRevenue) };
  const conclusions = buildFunnelConclusions({ stages, totalConversion, totalConversionDelta, revenue });

  return new Response(JSON.stringify({
    stages,
    totalConversion,
    totalConversionDelta,
    revenue,
    conclusions,
  }), { headers: corsHeaders() });
};
