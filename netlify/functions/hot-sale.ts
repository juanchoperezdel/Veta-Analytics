import type { Context } from '@netlify/functions';
import { sql, corsHeaders, errorResponse } from './_db';

// Informe Hot Sale Andesmar — endpoint público (sin auth).
// El gate es por oscuridad: el path del front (/hot-sale-andesmar-2026) no
// está linkeado desde ningún lado y no se indexa naturalmente. Si hay que
// revocar acceso se cambia el path en App.tsx y se redeploya.
//
// Devuelve en una sola respuesta las 3 secciones del informe:
//   1. Semana base (4-10 mayo 2026) vs Hot Week (11-17 mayo 2026), con curva
//      diaria, top rutas, top creatives Meta y top search terms Google.
//   2. YoY Hot Week 2025 (12-18 mayo) vs Hot Week 2026 (11-17 mayo),
//      comparativa solo de KPIs Meta + Google (sin breakdown por ruta).
//   3. Heat-map hora×día durante la Hot Week + lift vs baseline 4 semanas
//      previas + demografía Meta del comprador Hot Week.

const SLUG = 'andesmar';
const BASE_WEEK_2026  = { start: '2026-05-04', end: '2026-05-10' };
const HOT_WEEK_2026   = { start: '2026-05-11', end: '2026-05-17' };
const HOT_WEEK_2025   = { start: '2025-05-12', end: '2025-05-18' };

const DAY_LABELS = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado'];

export default async (req: Request, _context: Context) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: corsHeaders() });

  const [client] = await sql`SELECT id FROM clients WHERE slug = ${SLUG}`;
  if (!client) return errorResponse('Client not found', 404);
  const clientId = client.id;

  // ─── KPIs combinados Meta + Google + por canal en un rango ──────────────
  async function kpisInRange(start: string, end: string) {
    const [meta] = await sql`
      SELECT
        COALESCE(SUM(spend), 0)::numeric    AS spend,
        COALESCE(SUM(revenue), 0)::numeric  AS revenue,
        COALESCE(SUM(purchases), 0)::bigint AS purchases,
        COALESCE(SUM(reach), 0)::bigint     AS reach
      FROM meta_ads_campaigns
      WHERE client_id = ${clientId}
        AND snapshot_date BETWEEN ${start} AND ${end}
    `;
    const [google] = await sql`
      SELECT
        COALESCE(SUM(spend), 0)::numeric    AS spend,
        COALESCE(SUM(revenue), 0)::numeric  AS revenue,
        COALESCE(SUM(carts), 0)::bigint     AS purchases,
        COALESCE(SUM(clicks), 0)::bigint    AS clicks,
        COALESCE(SUM(impressions), 0)::bigint AS impressions
      FROM google_ads_campaigns
      WHERE client_id = ${clientId}
        AND snapshot_date BETWEEN ${start} AND ${end}
    `;
    function pack(r: any, extra: Record<string, number> = {}) {
      const spend     = Number(r?.spend ?? 0);
      const revenue   = Number(r?.revenue ?? 0);
      const purchases = Number(r?.purchases ?? 0);
      return {
        spend,
        revenue,
        purchases,
        roas: spend > 0 ? revenue / spend : 0,
        cpa:  purchases > 0 ? spend / purchases : 0,
        aov:  purchases > 0 ? revenue / purchases : 0,
        ...extra,
      };
    }
    const metaPack   = pack(meta,   { reach: Number(meta?.reach ?? 0) });
    const googlePack = pack(google, { clicks: Number(google?.clicks ?? 0), impressions: Number(google?.impressions ?? 0) });
    const total = pack({
      spend:     metaPack.spend     + googlePack.spend,
      revenue:   metaPack.revenue   + googlePack.revenue,
      purchases: metaPack.purchases + googlePack.purchases,
    });
    return { start, end, total, meta: metaPack, google: googlePack };
  }

  // ─── Curva diaria de los 14 días (4-17 mayo) ────────────────────────────
  async function dailyCurve() {
    const rows = await sql`
      SELECT snapshot_date::text AS date,
             SUM(spend)::numeric    AS spend,
             SUM(revenue)::numeric  AS revenue,
             SUM(purchases)::bigint AS purchases,
             SUM(meta_spend)::numeric        AS meta_spend,
             SUM(meta_revenue)::numeric      AS meta_revenue,
             SUM(meta_purchases)::bigint     AS meta_purchases,
             SUM(google_spend)::numeric      AS google_spend,
             SUM(google_revenue)::numeric    AS google_revenue,
             SUM(google_purchases)::bigint   AS google_purchases
      FROM (
        SELECT snapshot_date,
               spend, revenue, purchases,
               spend AS meta_spend, revenue AS meta_revenue, purchases AS meta_purchases,
               0::numeric AS google_spend, 0::numeric AS google_revenue, 0::bigint AS google_purchases
        FROM meta_ads_campaigns
        WHERE client_id = ${clientId}
          AND snapshot_date BETWEEN ${BASE_WEEK_2026.start} AND ${HOT_WEEK_2026.end}
        UNION ALL
        SELECT snapshot_date,
               spend, revenue, carts AS purchases,
               0::numeric AS meta_spend, 0::numeric AS meta_revenue, 0::bigint AS meta_purchases,
               spend AS google_spend, revenue AS google_revenue, carts::bigint AS google_purchases
        FROM google_ads_campaigns
        WHERE client_id = ${clientId}
          AND snapshot_date BETWEEN ${BASE_WEEK_2026.start} AND ${HOT_WEEK_2026.end}
      ) AS combined
      GROUP BY snapshot_date
      ORDER BY snapshot_date
    `;
    return rows.map((r: any) => {
      const date = r.date.slice(0, 10);
      return {
        date,
        spend:           Number(r.spend ?? 0),
        revenue:         Number(r.revenue ?? 0),
        purchases:       Number(r.purchases ?? 0),
        metaSpend:       Number(r.meta_spend ?? 0),
        metaRevenue:     Number(r.meta_revenue ?? 0),
        metaPurchases:   Number(r.meta_purchases ?? 0),
        googleSpend:     Number(r.google_spend ?? 0),
        googleRevenue:   Number(r.google_revenue ?? 0),
        googlePurchases: Number(r.google_purchases ?? 0),
        isHotWeek:       date >= HOT_WEEK_2026.start && date <= HOT_WEEK_2026.end,
      };
    });
  }

  // ─── Top rutas vendidas (GA4 product_routes, data REAL no inferida) ─────
  // Hot Week: top 50 por revenue para que el frontend pueda reordenar por
  // distintos criterios (pasajes, delta vs base, etc.) sin perder data.
  // Base: TODAS las rutas con revenue > 0 — el frontend la usa como mapa
  // para calcular el delta de cada ruta del Hot Week sin que aparezca como
  // "nueva" cuando en realidad sí tuvo data en la base.
  async function topRoutes(start: string, end: string, limit: number | null = 50) {
    const rows = limit !== null
      ? await sql`
          SELECT route,
                 SUM(revenue)::numeric   AS revenue,
                 SUM(articles)::bigint   AS items,
                 SUM(purchases)::bigint  AS purchases
          FROM product_routes
          WHERE client_id = ${clientId}
            AND snapshot_date BETWEEN ${start} AND ${end}
          GROUP BY route
          HAVING SUM(revenue) > 0
          ORDER BY SUM(revenue) DESC
          LIMIT ${limit}
        `
      : await sql`
          SELECT route,
                 SUM(revenue)::numeric   AS revenue,
                 SUM(articles)::bigint   AS items,
                 SUM(purchases)::bigint  AS purchases
          FROM product_routes
          WHERE client_id = ${clientId}
            AND snapshot_date BETWEEN ${start} AND ${end}
          GROUP BY route
          HAVING SUM(revenue) > 0
        `;
    return rows.map((r: any) => ({
      route:     r.route,
      revenue:   Number(r.revenue ?? 0),
      items:     Number(r.items ?? 0),
      purchases: Number(r.purchases ?? 0),
    }));
  }

  // ─── Origen del tráfico — agrupado con clasificación propia ─────────────
  // sessions, items (pasajes) y revenue vienen de GA4 con métricas item-level
  // (itemsPurchased + itemRevenue), consistente con Top Destinos.
  async function trafficChannels(start: string, end: string) {
    const rows = await sql`
      SELECT channel_group,
             SUM(sessions)::bigint     AS sessions,
             SUM(transactions)::bigint AS items,
             SUM(revenue)::numeric     AS revenue
      FROM traffic_channels
      WHERE client_id = ${clientId}
        AND snapshot_date BETWEEN ${start} AND ${end}
      GROUP BY channel_group
      HAVING SUM(revenue) > 0 OR SUM(transactions) > 0
      ORDER BY SUM(revenue) DESC, SUM(sessions) DESC
    `;
    return rows.map((r: any) => ({
      channel:  r.channel_group,
      sessions: Number(r.sessions ?? 0),
      items:    Number(r.items ?? 0),
      revenue:  Number(r.revenue ?? 0),
    }));
  }

  // ─── Totales del Hot Week (para mostrar "top 12 vs total" en la tabla) ──
  async function routesTotals(start: string, end: string) {
    const [r] = await sql`
      SELECT COUNT(DISTINCT route)::int   AS routes_count,
             COALESCE(SUM(revenue), 0)::numeric  AS revenue,
             COALESCE(SUM(articles), 0)::bigint  AS items
      FROM product_routes
      WHERE client_id = ${clientId}
        AND snapshot_date BETWEEN ${start} AND ${end}
        AND revenue > 0
    `;
    return {
      routesCount: Number(r?.routes_count ?? 0),
      revenue:     Number(r?.revenue ?? 0),
      items:       Number(r?.items ?? 0),
    };
  }

  // ─── Top creatives Meta durante la Hot Week ────────────────────────────
  // Prefiere snapshot hot_sale_2026_creatives si existe — sino cae a la
  // tabla live (rolling 7 días). El snapshot se llena con
  // scripts/snapshot-hot-sale.ts.
  async function topCreatives() {
    const [{ frozen_rows }] = await sql`
      SELECT COUNT(*)::int AS frozen_rows
      FROM hot_sale_2026_creatives
      WHERE snapshot_date BETWEEN ${HOT_WEEK_2026.start} AND ${HOT_WEEK_2026.end}
    ` as any[];

    const rows = Number(frozen_rows) > 0
      ? await sql`
          SELECT ad_id,
                 MAX(ad_name)          AS ad_name,
                 MAX(campaign_name)    AS campaign_name,
                 MAX(thumbnail_url)    AS thumbnail_url,
                 MAX(effective_status) AS status,
                 SUM(spend)::numeric        AS spend,
                 SUM(impressions)::bigint   AS impressions,
                 SUM(clicks)::bigint        AS clicks,
                 SUM(purchases)::bigint     AS purchases,
                 SUM(revenue)::numeric      AS revenue
          FROM hot_sale_2026_creatives
          WHERE snapshot_date BETWEEN ${HOT_WEEK_2026.start} AND ${HOT_WEEK_2026.end}
          GROUP BY ad_id
          HAVING SUM(spend) > 0
          ORDER BY SUM(revenue) DESC
        `
      : await sql`
          SELECT ad_id,
                 MAX(ad_name)          AS ad_name,
                 MAX(campaign_name)    AS campaign_name,
                 MAX(thumbnail_url)    AS thumbnail_url,
                 MAX(effective_status) AS status,
                 SUM(spend)::numeric        AS spend,
                 SUM(impressions)::bigint   AS impressions,
                 SUM(clicks)::bigint        AS clicks,
                 SUM(purchases)::bigint     AS purchases,
                 SUM(revenue)::numeric      AS revenue
          FROM meta_ads_creatives
          WHERE client_id = ${clientId}
            AND snapshot_date BETWEEN ${HOT_WEEK_2026.start} AND ${HOT_WEEK_2026.end}
          GROUP BY ad_id
          HAVING SUM(spend) > 0
          ORDER BY SUM(revenue) DESC
        `;
    return rows.map((r: any) => {
      const spend = Number(r.spend ?? 0);
      const revenue = Number(r.revenue ?? 0);
      const purchases = Number(r.purchases ?? 0);
      const clicks = Number(r.clicks ?? 0);
      const impressions = Number(r.impressions ?? 0);
      return {
        adId: r.ad_id,
        adName: r.ad_name,
        campaignName: r.campaign_name,
        thumbnailUrl: r.thumbnail_url,
        status: r.status,
        spend,
        impressions,
        clicks,
        purchases,
        revenue,
        roas: spend > 0 ? revenue / spend : 0,
        cpa:  purchases > 0 ? spend / purchases : 0,
        ctr:  impressions > 0 ? clicks / impressions : 0,
      };
    });
  }

  // ─── Top campañas (Meta + Google) durante la Hot Week ──────────────────
  async function topCampaigns() {
    // Meta: prefiere snapshot hot_sale_2026_creatives si existe, sino live.
    const [{ frozen_rows }] = await sql`
      SELECT COUNT(*)::int AS frozen_rows
      FROM hot_sale_2026_creatives
      WHERE snapshot_date BETWEEN ${HOT_WEEK_2026.start} AND ${HOT_WEEK_2026.end}
    ` as any[];

    const metaSource = Number(frozen_rows) > 0
      ? sql`
          SELECT campaign_name AS name,
                 SUM(spend)::numeric        AS spend,
                 SUM(revenue)::numeric      AS revenue,
                 SUM(purchases)::bigint     AS purchases,
                 SUM(impressions)::bigint   AS impressions,
                 SUM(clicks)::bigint        AS clicks
          FROM hot_sale_2026_creatives
          WHERE snapshot_date BETWEEN ${HOT_WEEK_2026.start} AND ${HOT_WEEK_2026.end}
            AND campaign_name IS NOT NULL
          GROUP BY campaign_name
          HAVING SUM(spend) > 0
        `
      : sql`
          SELECT campaign_name AS name,
                 SUM(spend)::numeric        AS spend,
                 SUM(revenue)::numeric      AS revenue,
                 SUM(purchases)::bigint     AS purchases,
                 SUM(impressions)::bigint   AS impressions,
                 SUM(clicks)::bigint        AS clicks
          FROM meta_ads_creatives
          WHERE client_id = ${clientId}
            AND snapshot_date BETWEEN ${HOT_WEEK_2026.start} AND ${HOT_WEEK_2026.end}
            AND campaign_name IS NOT NULL
          GROUP BY campaign_name
          HAVING SUM(spend) > 0
        `;

    const [metaRows, googleRows] = await Promise.all([
      metaSource,
      sql`
        SELECT name,
               SUM(spend)::numeric        AS spend,
               SUM(revenue)::numeric      AS revenue,
               SUM(carts)::bigint         AS purchases,
               SUM(impressions)::bigint   AS impressions,
               SUM(clicks)::bigint        AS clicks
        FROM google_ads_campaigns
        WHERE client_id = ${clientId}
          AND snapshot_date BETWEEN ${HOT_WEEK_2026.start} AND ${HOT_WEEK_2026.end}
          AND name IS NOT NULL
        GROUP BY name
        HAVING SUM(spend) > 0
      `,
    ]);

    function pack(r: any, channel: 'Meta' | 'Google') {
      const spend = Number(r.spend ?? 0);
      const revenue = Number(r.revenue ?? 0);
      const purchases = Number(r.purchases ?? 0);
      return {
        name: r.name,
        channel,
        spend,
        revenue,
        purchases,
        impressions: Number(r.impressions ?? 0),
        clicks: Number(r.clicks ?? 0),
        roas: spend > 0 ? revenue / spend : 0,
        cpa:  purchases > 0 ? spend / purchases : 0,
      };
    }
    const all = [
      ...metaRows.map((r: any) => pack(r, 'Meta')),
      ...googleRows.map((r: any) => pack(r, 'Google')),
    ];
    return all.sort((a, b) => b.revenue - a.revenue).slice(0, 15);
  }

  // ─── Heat-map hora×día durante la Hot Week (Meta + Google combinados) ──
  // Prefiere snapshot congelado (hot_sale_2026_hourly) si existe — sino cae
  // a las tablas live (que son rolling 14 días). El snapshot lo crea el
  // script scripts/snapshot-hot-sale-hourly.ts cuando termina el evento.
  async function heatmap() {
    const [{ frozen_rows }] = await sql`
      SELECT COUNT(*)::int AS frozen_rows
      FROM hot_sale_2026_hourly
      WHERE snapshot_date BETWEEN ${HOT_WEEK_2026.start} AND ${HOT_WEEK_2026.end}
    ` as any[];

    const rows = Number(frozen_rows) > 0
      ? await sql`
          SELECT EXTRACT(DOW FROM snapshot_date)::int AS dow, hour,
                 SUM(spend)::numeric    AS spend,
                 SUM(purchases)::bigint AS purchases,
                 SUM(revenue)::numeric  AS revenue
          FROM hot_sale_2026_hourly
          WHERE snapshot_date BETWEEN ${HOT_WEEK_2026.start} AND ${HOT_WEEK_2026.end}
          GROUP BY dow, hour
          ORDER BY dow, hour
        `
      : await sql`
          SELECT EXTRACT(DOW FROM snapshot_date)::int AS dow, hour,
                 SUM(spend)::numeric    AS spend,
                 SUM(purchases)::bigint AS purchases,
                 SUM(revenue)::numeric  AS revenue
          FROM (
            SELECT snapshot_date, hour, spend, purchases, revenue
            FROM meta_ads_hourly
            WHERE client_id = ${clientId}
              AND snapshot_date BETWEEN ${HOT_WEEK_2026.start} AND ${HOT_WEEK_2026.end}
            UNION ALL
            SELECT snapshot_date, hour, spend, conversions::bigint AS purchases, conv_value AS revenue
            FROM google_ads_hourly
            WHERE client_id = ${clientId}
              AND snapshot_date BETWEEN ${HOT_WEEK_2026.start} AND ${HOT_WEEK_2026.end}
          ) AS combined
          GROUP BY dow, hour
          ORDER BY dow, hour
        `;
    type Cell = { dow: number; hour: number; dayLabel: string; spend: number; purchases: number; revenue: number; roas: number };
    const cells: Cell[] = rows.map((r: any) => {
      const spend = Number(r.spend ?? 0);
      const revenue = Number(r.revenue ?? 0);
      const dow = Number(r.dow);
      return {
        dow,
        hour: Number(r.hour),
        dayLabel: DAY_LABELS[dow],
        spend,
        purchases: Number(r.purchases ?? 0),
        revenue,
        roas: spend > 0 ? revenue / spend : 0,
      };
    });

    // Filtro anti-outliers para best/worst slot — cells con spend significativo
    const sortedSpend = cells.filter(c => c.spend > 0).sort((a, b) => a.spend - b.spend);
    const medianSpend = sortedSpend.length > 0 ? sortedSpend[Math.floor(sortedSpend.length / 2)].spend : 0;
    const minSpendThreshold = Math.max(medianSpend * 0.5, 500);
    const significant = cells.filter(c => c.spend >= minSpendThreshold);
    const topVolumeSlot      = [...significant].sort((a, b) => b.revenue - a.revenue)[0] ?? null;
    const byRoas             = [...significant].filter(c => c.roas > 0).sort((a, b) => b.roas - a.roas);
    const bestEfficiencySlot = byRoas[0] ?? null;
    const worstEfficiencySlot = byRoas[byRoas.length - 1] ?? null;

    return { cells, minSpendThreshold, topVolumeSlot, bestEfficiencySlot, worstEfficiencySlot };
  }

  // ─── Demografía Meta durante la Hot Week ───────────────────────────────
  // Prefiere snapshot hot_sale_2026_breakdowns si existe — sino cae a la
  // tabla live (rolling 30 días).
  async function demographics() {
    const [{ frozen_rows }] = await sql`
      SELECT COUNT(*)::int AS frozen_rows
      FROM hot_sale_2026_breakdowns
      WHERE snapshot_date BETWEEN ${HOT_WEEK_2026.start} AND ${HOT_WEEK_2026.end}
    ` as any[];

    const rows = Number(frozen_rows) > 0
      ? await sql`
          SELECT dimension_type, dimension_value,
                 SUM(spend)::numeric       AS spend,
                 SUM(impressions)::bigint  AS impressions,
                 SUM(reach)::bigint        AS reach,
                 SUM(purchases)::bigint    AS purchases,
                 SUM(revenue)::numeric     AS revenue
          FROM hot_sale_2026_breakdowns
          WHERE snapshot_date BETWEEN ${HOT_WEEK_2026.start} AND ${HOT_WEEK_2026.end}
          GROUP BY dimension_type, dimension_value
          HAVING SUM(spend) > 0
          ORDER BY dimension_type, SUM(spend) DESC
        `
      : await sql`
          SELECT dimension_type, dimension_value,
                 SUM(spend)::numeric       AS spend,
                 SUM(impressions)::bigint  AS impressions,
                 SUM(reach)::bigint        AS reach,
                 SUM(purchases)::bigint    AS purchases,
                 SUM(revenue)::numeric     AS revenue
          FROM meta_ads_breakdowns
          WHERE client_id = ${clientId}
            AND snapshot_date BETWEEN ${HOT_WEEK_2026.start} AND ${HOT_WEEK_2026.end}
          GROUP BY dimension_type, dimension_value
          HAVING SUM(spend) > 0
          ORDER BY dimension_type, SUM(spend) DESC
        `;
    const byDim: Record<string, any[]> = { age: [], gender: [], region: [], publisher_platform: [] };
    for (const r of rows) {
      const spend = Number(r.spend ?? 0);
      const purchases = Number(r.purchases ?? 0);
      const revenue = Number(r.revenue ?? 0);
      const item = {
        value: r.dimension_value,
        spend,
        impressions: Number(r.impressions ?? 0),
        reach: Number(r.reach ?? 0),
        purchases,
        revenue,
        roas: spend > 0 ? revenue / spend : 0,
        cpa:  purchases > 0 ? spend / purchases : 0,
      };
      if (!byDim[r.dimension_type]) byDim[r.dimension_type] = [];
      byDim[r.dimension_type].push(item);
    }
    if (byDim.region.length > 10) byDim.region = byDim.region.slice(0, 10);
    return { age: byDim.age, gender: byDim.gender, region: byDim.region, placement: byDim.publisher_platform };
  }

  // ─── Disparamos todo en paralelo ────────────────────────────────────────
  const [
    baseKpis,
    hotWeekKpis,
    hs2025Kpis,
    daily,
    routesHotWeek,
    routesBase,
    routesHotWeekTotals,
    channels,
    creatives,
    campaigns,
    heatmapData,
    demo,
  ] = await Promise.all([
    kpisInRange(BASE_WEEK_2026.start, BASE_WEEK_2026.end),
    kpisInRange(HOT_WEEK_2026.start, HOT_WEEK_2026.end),
    kpisInRange(HOT_WEEK_2025.start, HOT_WEEK_2025.end),
    dailyCurve(),
    topRoutes(HOT_WEEK_2026.start, HOT_WEEK_2026.end, 50),
    topRoutes(BASE_WEEK_2026.start, BASE_WEEK_2026.end, null),
    routesTotals(HOT_WEEK_2026.start, HOT_WEEK_2026.end),
    trafficChannels(HOT_WEEK_2026.start, HOT_WEEK_2026.end),
    topCreatives(),
    topCampaigns(),
    heatmap(),
    demographics(),
  ]);

  // Mix de canal YoY — qué porcentaje aporta cada canal a spend y revenue
  function mix(k: any) {
    const totalS = k.total.spend;
    const totalR = k.total.revenue;
    return {
      meta:   { spendShare: totalS > 0 ? k.meta.spend / totalS : 0,   revenueShare: totalR > 0 ? k.meta.revenue / totalR : 0 },
      google: { spendShare: totalS > 0 ? k.google.spend / totalS : 0, revenueShare: totalR > 0 ? k.google.revenue / totalR : 0 },
    };
  }

  return new Response(JSON.stringify({
    config: {
      slug: SLUG,
      weekBase:    BASE_WEEK_2026,
      hotWeek:     HOT_WEEK_2026,
      hotWeek2025: HOT_WEEK_2025,
    },
    weekly: {
      base: baseKpis,
      hotWeek: hotWeekKpis,
      daily,
      routes: {
        hotWeek: routesHotWeek,
        base: routesBase,
        hotWeekTotals: routesHotWeekTotals,
      },
      channels,
      creatives,
      campaigns,
    },
    yoy: {
      hs2025: hs2025Kpis,
      hs2026: hotWeekKpis,
      mix: { 2025: mix(hs2025Kpis), 2026: mix(hotWeekKpis) },
    },
    heatmap: heatmapData,
    demographics: demo,
    generatedAt: new Date().toISOString(),
  }), { headers: corsHeaders() });
};
