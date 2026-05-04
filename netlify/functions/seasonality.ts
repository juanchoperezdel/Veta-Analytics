import type { Context } from '@netlify/functions';
import { sql, corsHeaders, errorResponse } from './_db';
import { verifyToken, authorizeSlug, unauthorizedResponse } from './_auth';

// Estacionalidad: heat-map de spend, ROAS y conversiones por (día de semana × hora del día).
// Combina Meta + Google Ads. Permite identificar mejores días/horas para pautar.

export default async (req: Request, _context: Context) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: corsHeaders() });

  const user = await verifyToken(req);
  if (!user) return unauthorizedResponse();

  const slug = new URL(req.url).searchParams.get('slug');
  if (!slug) return errorResponse('Missing slug', 400);
  if (!(await authorizeSlug(user.userId, slug))) return unauthorizedResponse();

  const [client] = await sql`SELECT id FROM clients WHERE slug = ${slug}`;
  if (!client) return errorResponse('Client not found', 404);

  // Combinamos Meta + Google en una sola serie. EXTRACT(DOW) → 0=domingo, 6=sábado
  const rows = await sql`
    SELECT
      EXTRACT(DOW FROM snapshot_date)::int AS dow,
      hour,
      SUM(spend)::numeric          AS spend,
      SUM(purchases)::bigint       AS purchases,
      SUM(revenue)::numeric        AS revenue,
      SUM(impressions)::bigint     AS impressions,
      SUM(clicks)::bigint          AS clicks
    FROM (
      SELECT snapshot_date, hour, spend, purchases, revenue, impressions, clicks
      FROM meta_ads_hourly WHERE client_id = ${client.id}
      UNION ALL
      SELECT snapshot_date, hour, spend, conversions::bigint AS purchases, conv_value AS revenue, impressions, clicks
      FROM google_ads_hourly WHERE client_id = ${client.id}
    ) AS combined
    GROUP BY dow, hour
    ORDER BY dow, hour
  `;

  type Cell = { dow: number; hour: number; spend: number; purchases: number; revenue: number; roas: number; impressions: number; clicks: number };
  const cells: Cell[] = rows.map((r: any) => {
    const spend = Number(r.spend);
    const revenue = Number(r.revenue);
    return {
      dow: Number(r.dow),
      hour: Number(r.hour),
      spend,
      purchases: Number(r.purchases),
      revenue,
      roas: spend > 0 ? revenue / spend : 0,
      impressions: Number(r.impressions),
      clicks: Number(r.clicks),
    };
  });

  // Agregados por día y por hora (para los marginales del heat-map)
  const byDow = new Map<number, { spend: number; revenue: number; purchases: number }>();
  const byHour = new Map<number, { spend: number; revenue: number; purchases: number }>();
  for (const c of cells) {
    if (!byDow.has(c.dow))   byDow.set(c.dow, { spend: 0, revenue: 0, purchases: 0 });
    if (!byHour.has(c.hour)) byHour.set(c.hour, { spend: 0, revenue: 0, purchases: 0 });
    const d = byDow.get(c.dow)!;
    const h = byHour.get(c.hour)!;
    d.spend += c.spend; d.revenue += c.revenue; d.purchases += c.purchases;
    h.spend += c.spend; h.revenue += c.revenue; h.purchases += c.purchases;
  }
  const dayLabels = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado'];
  const dows = [...byDow.entries()].map(([dow, v]) => ({
    dow, label: dayLabels[dow],
    ...v,
    roas: v.spend > 0 ? v.revenue / v.spend : 0,
  })).sort((a, b) => a.dow - b.dow);
  const hours = [...byHour.entries()].map(([hour, v]) => ({
    hour,
    ...v,
    roas: v.spend > 0 ? v.revenue / v.spend : 0,
  })).sort((a, b) => a.hour - b.hour);

  // Best/worst slot identificados
  const ranked = cells.filter(c => c.spend > 100).sort((a, b) => b.roas - a.roas);
  const bestSlot = ranked[0];
  const worstSlot = ranked[ranked.length - 1];

  return new Response(JSON.stringify({
    cells,
    dows,
    hours,
    bestSlot: bestSlot ? { ...bestSlot, dayLabel: dayLabels[bestSlot.dow] } : null,
    worstSlot: worstSlot ? { ...worstSlot, dayLabel: dayLabels[worstSlot.dow] } : null,
  }), { headers: corsHeaders() });
};
