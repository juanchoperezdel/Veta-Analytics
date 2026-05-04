import type { Context } from '@netlify/functions';
import { sql, corsHeaders, errorResponse } from './_db';
import { verifyToken, authorizeSlug, unauthorizedResponse } from './_auth';

// Estacionalidad: heat-map de spend, ROAS y conversiones por (día de semana × hora del día).
// Combina Meta + Google Ads. Permite identificar mejores días/horas para pautar.

export default async (req: Request, _context: Context) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: corsHeaders() });

  const user = await verifyToken(req);
  if (!user) return unauthorizedResponse();

  const params = new URL(req.url).searchParams;
  const slug = params.get('slug');
  const source = (params.get('source') ?? 'all').toLowerCase();  // 'all' | 'meta' | 'google'
  if (!slug) return errorResponse('Missing slug', 400);
  if (!(await authorizeSlug(user.userId, slug))) return unauthorizedResponse();

  const [client] = await sql`SELECT id FROM clients WHERE slug = ${slug}`;
  if (!client) return errorResponse('Client not found', 404);

  // Filtro de fuente: combinamos Meta + Google según `source`. EXTRACT(DOW) → 0=domingo, 6=sábado
  let rows: any[];
  if (source === 'meta') {
    rows = await sql`
      SELECT EXTRACT(DOW FROM snapshot_date)::int AS dow, hour,
             SUM(spend)::numeric AS spend, SUM(purchases)::bigint AS purchases,
             SUM(revenue)::numeric AS revenue, SUM(impressions)::bigint AS impressions,
             SUM(clicks)::bigint AS clicks
      FROM meta_ads_hourly WHERE client_id = ${client.id}
      GROUP BY dow, hour ORDER BY dow, hour
    `;
  } else if (source === 'google') {
    rows = await sql`
      SELECT EXTRACT(DOW FROM snapshot_date)::int AS dow, hour,
             SUM(spend)::numeric AS spend, SUM(conversions)::bigint AS purchases,
             SUM(conv_value)::numeric AS revenue, SUM(impressions)::bigint AS impressions,
             SUM(clicks)::bigint AS clicks
      FROM google_ads_hourly WHERE client_id = ${client.id}
      GROUP BY dow, hour ORDER BY dow, hour
    `;
  } else {
    rows = await sql`
      SELECT EXTRACT(DOW FROM snapshot_date)::int AS dow, hour,
             SUM(spend)::numeric AS spend, SUM(purchases)::bigint AS purchases,
             SUM(revenue)::numeric AS revenue, SUM(impressions)::bigint AS impressions,
             SUM(clicks)::bigint AS clicks
      FROM (
        SELECT snapshot_date, hour, spend, purchases, revenue, impressions, clicks
        FROM meta_ads_hourly WHERE client_id = ${client.id}
        UNION ALL
        SELECT snapshot_date, hour, spend, conversions::bigint AS purchases, conv_value AS revenue, impressions, clicks
        FROM google_ads_hourly WHERE client_id = ${client.id}
      ) AS combined
      GROUP BY dow, hour ORDER BY dow, hour
    `;
  }

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

  // ─── Best/worst slot — con filtro de spend mínimo para evitar outliers ────
  // Calculamos el spend mediano de las celdas con datos. Solo consideramos
  // celdas con spend >= mediana × 0.5 — esto descarta slots con poco gasto
  // y conversiones aisladas que distorsionan el ROAS (ej: $14K → $2.2M = 154x
  // por una sola compra grande, no es repetible).
  const cellsWithData = cells.filter(c => c.spend > 0);
  const sortedSpend = [...cellsWithData].sort((a, b) => a.spend - b.spend);
  const medianSpend = sortedSpend.length > 0 ? sortedSpend[Math.floor(sortedSpend.length / 2)].spend : 0;
  const minSpendThreshold = Math.max(medianSpend * 0.5, 500);

  const significantCells = cells.filter(c => c.spend >= minSpendThreshold);

  // "Más vendés" = mayor revenue absoluto. Es lo que el dueño del negocio quiere
  // saber: cuándo entra más plata. Es predictivo y repetible.
  const byRevenue = [...significantCells].sort((a, b) => b.revenue - a.revenue);
  const topVolumeSlot = byRevenue[0];

  // "Mejor relación inversión/retorno" = ROAS más alto entre slots con spend significativo.
  const byRoas = [...significantCells].filter(c => c.roas > 0).sort((a, b) => b.roas - a.roas);
  const bestEfficiencySlot = byRoas[0];

  // "Peor momento" = el slot con spend significativo y peor ROAS (no 0 — esos pueden ser tracking lag).
  const worstEfficiencySlot = byRoas[byRoas.length - 1];

  function withLabel(c: any) {
    return c ? { ...c, dayLabel: dayLabels[c.dow] } : null;
  }

  return new Response(JSON.stringify({
    cells,
    dows,
    hours,
    source,
    minSpendThreshold,  // útil para mostrar en UI: "calculado sobre slots con spend ≥ $X"
    topVolumeSlot:       withLabel(topVolumeSlot),
    bestEfficiencySlot:  withLabel(bestEfficiencySlot),
    worstEfficiencySlot: withLabel(worstEfficiencySlot),
    // Compat: bestSlot/worstSlot mapean a los nuevos para no romper UI vieja
    bestSlot:            withLabel(bestEfficiencySlot),
    worstSlot:           withLabel(worstEfficiencySlot),
  }), { headers: corsHeaders() });
};
