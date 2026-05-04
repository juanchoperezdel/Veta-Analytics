import type { Context } from '@netlify/functions';
import { sql, corsHeaders, errorResponse } from './_db';
import { verifyToken, authorizeSlug, unauthorizedResponse } from './_auth';

// Estacionalidad — combina dos fuentes:
//   - Heat-map día×hora y "por hora" → tablas *_hourly (siempre últimos 14 días)
//   - "Por día semana" / "por día del mes" / "por fase del mes" → tablas
//     *_campaigns (data daily desde oct 2024, respeta filtro de fechas)
//
// Querystring: slug (required), source (all/meta/google), start, end (YYYY-MM-DD)

const DAY_LABELS = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado'];

export default async (req: Request, _context: Context) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: corsHeaders() });

  const user = await verifyToken(req);
  if (!user) return unauthorizedResponse();

  const params = new URL(req.url).searchParams;
  const slug   = params.get('slug');
  const source = (params.get('source') ?? 'all').toLowerCase() as 'all' | 'meta' | 'google';
  const start  = params.get('start');
  const end    = params.get('end');
  if (!slug) return errorResponse('Missing slug', 400);
  if (!(await authorizeSlug(user.userId, slug))) return unauthorizedResponse();

  const [client] = await sql`SELECT id FROM clients WHERE slug = ${slug}`;
  if (!client) return errorResponse('Client not found', 404);

  const startDate = start ?? sql`CURRENT_DATE - 89`;  // default: últimos 90 días
  const endDate   = end   ?? sql`CURRENT_DATE`;

  // ─── 1. Heat-map día×hora — siempre últimos 14 días (data hourly) ────────
  let hourlyRows: any[];
  if (source === 'meta') {
    hourlyRows = await sql`
      SELECT EXTRACT(DOW FROM snapshot_date)::int AS dow, hour,
             SUM(spend)::numeric AS spend, SUM(purchases)::bigint AS purchases,
             SUM(revenue)::numeric AS revenue
      FROM meta_ads_hourly WHERE client_id = ${client.id}
      GROUP BY dow, hour ORDER BY dow, hour
    `;
  } else if (source === 'google') {
    hourlyRows = await sql`
      SELECT EXTRACT(DOW FROM snapshot_date)::int AS dow, hour,
             SUM(spend)::numeric AS spend, SUM(conversions)::bigint AS purchases,
             SUM(conv_value)::numeric AS revenue
      FROM google_ads_hourly WHERE client_id = ${client.id}
      GROUP BY dow, hour ORDER BY dow, hour
    `;
  } else {
    hourlyRows = await sql`
      SELECT EXTRACT(DOW FROM snapshot_date)::int AS dow, hour,
             SUM(spend)::numeric AS spend, SUM(purchases)::bigint AS purchases,
             SUM(revenue)::numeric AS revenue
      FROM (
        SELECT snapshot_date, hour, spend, purchases, revenue FROM meta_ads_hourly WHERE client_id = ${client.id}
        UNION ALL
        SELECT snapshot_date, hour, spend, conversions::bigint AS purchases, conv_value AS revenue FROM google_ads_hourly WHERE client_id = ${client.id}
      ) AS combined
      GROUP BY dow, hour ORDER BY dow, hour
    `;
  }

  type Cell = { dow: number; hour: number; spend: number; purchases: number; revenue: number; roas: number };
  const cells: Cell[] = hourlyRows.map((r: any) => {
    const spend = Number(r.spend);
    const revenue = Number(r.revenue);
    return {
      dow: Number(r.dow), hour: Number(r.hour),
      spend, purchases: Number(r.purchases), revenue,
      roas: spend > 0 ? revenue / spend : 0,
    };
  });

  const byHour = new Map<number, { spend: number; revenue: number; purchases: number }>();
  for (const c of cells) {
    if (!byHour.has(c.hour)) byHour.set(c.hour, { spend: 0, revenue: 0, purchases: 0 });
    const h = byHour.get(c.hour)!;
    h.spend += c.spend; h.revenue += c.revenue; h.purchases += c.purchases;
  }
  const hours = [...byHour.entries()].map(([hour, v]) => ({
    hour, ...v, roas: v.spend > 0 ? v.revenue / v.spend : 0,
  })).sort((a, b) => a.hour - b.hour);

  // Best/worst slot (heat-map) — con filtro anti-outliers
  const sortedSpend = cells.filter(c => c.spend > 0).sort((a, b) => a.spend - b.spend);
  const medianSpend = sortedSpend.length > 0 ? sortedSpend[Math.floor(sortedSpend.length / 2)].spend : 0;
  const minSpendThreshold = Math.max(medianSpend * 0.5, 500);
  const significantCells = cells.filter(c => c.spend >= minSpendThreshold);
  const topVolumeSlot       = [...significantCells].sort((a, b) => b.revenue - a.revenue)[0];
  const byRoas              = [...significantCells].filter(c => c.roas > 0).sort((a, b) => b.roas - a.roas);
  const bestEfficiencySlot  = byRoas[0];
  const worstEfficiencySlot = byRoas[byRoas.length - 1];
  function withLabel(c: any) { return c ? { ...c, dayLabel: DAY_LABELS[c.dow] } : null; }

  // ─── 2. Daily data del rango — la usamos para dow / dom / phase ─────────
  let dailyRows: any[];
  if (source === 'meta') {
    dailyRows = await sql`
      SELECT snapshot_date, spend, purchases, revenue
      FROM meta_ads_campaigns
      WHERE client_id = ${client.id} AND snapshot_date BETWEEN ${startDate} AND ${endDate}
    `;
  } else if (source === 'google') {
    dailyRows = await sql`
      SELECT snapshot_date, spend, carts AS purchases, revenue
      FROM google_ads_campaigns
      WHERE client_id = ${client.id} AND snapshot_date BETWEEN ${startDate} AND ${endDate}
    `;
  } else {
    dailyRows = await sql`
      SELECT snapshot_date, SUM(spend)::numeric AS spend, SUM(purchases)::bigint AS purchases, SUM(revenue)::numeric AS revenue FROM (
        SELECT snapshot_date, spend, purchases, revenue FROM meta_ads_campaigns
        WHERE client_id = ${client.id} AND snapshot_date BETWEEN ${startDate} AND ${endDate}
        UNION ALL
        SELECT snapshot_date, spend, carts AS purchases, revenue FROM google_ads_campaigns
        WHERE client_id = ${client.id} AND snapshot_date BETWEEN ${startDate} AND ${endDate}
      ) AS combined
      GROUP BY snapshot_date
    `;
  }

  // Agregamos en JS por día de semana, por día del mes y por fase del mes
  type Bucket = { spend: number; revenue: number; purchases: number; sampleSize: number };
  const dowMap = new Map<number, Bucket>();
  const domMap = new Map<number, Bucket>();
  const phaseMap = new Map<string, Bucket>();
  const PHASES = ['Principio (1-10)', 'Mitad (11-20)', 'Fin (21-31)'];

  function bucketAdd(map: Map<any, Bucket>, key: any, spend: number, revenue: number, purchases: number) {
    if (!map.has(key)) map.set(key, { spend: 0, revenue: 0, purchases: 0, sampleSize: 0 });
    const b = map.get(key)!;
    b.spend += spend; b.revenue += revenue; b.purchases += purchases;
  }
  // Para sampleSize necesitamos contar días distintos por bucket, no rows distintas.
  const dowDays   = new Map<number, Set<string>>();
  const domDays   = new Map<number, Set<string>>();
  const phaseDays = new Map<string, Set<string>>();
  function trackDay(map: Map<any, Set<string>>, key: any, dateStr: string) {
    if (!map.has(key)) map.set(key, new Set());
    map.get(key)!.add(dateStr);
  }

  for (const r of dailyRows) {
    const date = new Date(r.snapshot_date);
    const dateStr = String(r.snapshot_date).slice(0, 10);
    const dow = date.getUTCDay();          // 0=domingo, 6=sábado
    const dom = date.getUTCDate();         // 1-31
    const phase = dom <= 10 ? PHASES[0] : dom <= 20 ? PHASES[1] : PHASES[2];
    const spend = Number(r.spend ?? 0);
    const revenue = Number(r.revenue ?? 0);
    const purchases = Number(r.purchases ?? 0);
    bucketAdd(dowMap,   dow,   spend, revenue, purchases);
    bucketAdd(domMap,   dom,   spend, revenue, purchases);
    bucketAdd(phaseMap, phase, spend, revenue, purchases);
    trackDay(dowDays,   dow,   dateStr);
    trackDay(domDays,   dom,   dateStr);
    trackDay(phaseDays, phase, dateStr);
  }
  function finalize(map: Map<any, Bucket>, days: Map<any, Set<string>>) {
    return [...map.entries()].map(([key, b]) => ({
      key,
      spend: b.spend,
      revenue: b.revenue,
      purchases: b.purchases,
      roas: b.spend > 0 ? b.revenue / b.spend : 0,
      sampleSize: days.get(key)?.size ?? 0,
    }));
  }

  const dows = finalize(dowMap, dowDays).map(d => ({
    dow: d.key, label: DAY_LABELS[d.key],
    spend: d.spend, revenue: d.revenue, purchases: d.purchases, roas: d.roas, sampleSize: d.sampleSize,
  })).sort((a, b) => a.dow - b.dow);

  const daysOfMonth = finalize(domMap, domDays).map(d => ({
    day: d.key,
    spend: d.spend, revenue: d.revenue, purchases: d.purchases, roas: d.roas, sampleSize: d.sampleSize,
  })).sort((a, b) => a.day - b.day);

  const phases = PHASES.map(label => {
    const found = finalize(phaseMap, phaseDays).find(p => p.key === label);
    return found
      ? { phase: label, spend: found.spend, revenue: found.revenue, purchases: found.purchases, roas: found.roas, sampleSize: found.sampleSize }
      : { phase: label, spend: 0, revenue: 0, purchases: 0, roas: 0, sampleSize: 0 };
  });

  // ─── Best/worst rankings con filtros de tamaño de muestra dinámico ──────
  // Si el rango es chico (ej: 1 mes), cada día del mes solo aparece 1 vez,
  // así que no podemos exigir sampleSize >= 2. Si el rango es amplio (>2 meses),
  // exigimos al menos 2 muestras por bucket para evitar outliers.
  const totalDays = dailyRows.length;
  const minDowSamples = totalDays >= 60 ? 3 : totalDays >= 30 ? 2 : 1;
  const minDomSamples = totalDays >= 90 ? 2 : 1;

  const goodDows = dows.filter(d => d.sampleSize >= minDowSamples && d.spend > 0);
  const bestDow  = [...goodDows].sort((a, b) => b.roas - a.roas)[0] ?? null;
  const worstDow = [...goodDows].sort((a, b) => a.roas - b.roas)[0] ?? null;
  const goodDoms = daysOfMonth.filter(d => d.sampleSize >= minDomSamples && d.spend > 0);
  const bestDom  = [...goodDoms].sort((a, b) => b.revenue - a.revenue)[0] ?? null;
  const worstDom = [...goodDoms].sort((a, b) => a.revenue - b.revenue)[0] ?? null;
  const bestPhase = [...phases].filter(p => p.spend > 0).sort((a, b) => b.roas - a.roas)[0] ?? null;

  return new Response(JSON.stringify({
    source,
    cells,
    hours,
    dows,
    daysOfMonth,
    phases,
    minSpendThreshold,
    topVolumeSlot:       withLabel(topVolumeSlot),
    bestEfficiencySlot:  withLabel(bestEfficiencySlot),
    worstEfficiencySlot: withLabel(worstEfficiencySlot),
    bestDow,
    worstDow,
    bestDom,
    worstDom,
    bestPhase,
  }), { headers: corsHeaders() });
};
