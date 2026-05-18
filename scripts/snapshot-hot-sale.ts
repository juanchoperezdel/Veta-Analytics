/**
 * Congela TODA la data variable del informe Hot Sale 2026 (11-17 may) en
 * tablas snapshot dedicadas. Necesario porque varias tablas live tienen
 * rolling window:
 *   - meta_ads_hourly + google_ads_hourly → rolling 14 días
 *   - meta_ads_creatives                  → rolling 7 días
 *   - meta_ads_breakdowns                 → rolling 30 días
 *
 * Las tablas persistentes (meta_ads_campaigns, google_ads_campaigns,
 * product_routes) no necesitan snapshot porque ya guardan todo el histórico.
 *
 * Idempotente: se puede correr múltiples veces. Sobreescribe la data
 * existente del snapshot.
 *
 * Idealmente correrlo el 18 o 19 may cuando GA4 ya cerró todos los días.
 * Para creatives lo ideal es correrlo antes del 24 may (cuando expira el
 * rolling 7 días).
 *
 * Uso:
 *   npx dotenv-cli -e .env -- npx tsx scripts/snapshot-hot-sale.ts
 */

import { neon } from '@neondatabase/serverless';
const sql = neon(process.env.DATABASE_URL!);

const CLIENT_ID = '1';                              // Andesmar
const HOT_WEEK_START = '2026-05-11';
const HOT_WEEK_END   = '2026-05-17';

console.log(`\n━━━ Snapshot Hot Sale 2026 ━━━`);
console.log(`Rango: ${HOT_WEEK_START} → ${HOT_WEEK_END}\n`);

// 1. HOURLY (Meta + Google combinados)
const hourly = await sql`
  INSERT INTO hot_sale_2026_hourly (snapshot_date, hour, spend, revenue, purchases, frozen_at)
  SELECT snapshot_date, hour,
         SUM(spend)::numeric    AS spend,
         SUM(revenue)::numeric  AS revenue,
         SUM(purchases)::bigint AS purchases,
         NOW() AS frozen_at
  FROM (
    SELECT snapshot_date, hour, spend, revenue, purchases
    FROM meta_ads_hourly
    WHERE client_id = ${CLIENT_ID} AND snapshot_date BETWEEN ${HOT_WEEK_START} AND ${HOT_WEEK_END}
    UNION ALL
    SELECT snapshot_date, hour, spend, conv_value AS revenue, conversions::bigint AS purchases
    FROM google_ads_hourly
    WHERE client_id = ${CLIENT_ID} AND snapshot_date BETWEEN ${HOT_WEEK_START} AND ${HOT_WEEK_END}
  ) AS combined
  GROUP BY snapshot_date, hour
  ON CONFLICT (snapshot_date, hour)
  DO UPDATE SET
    spend = EXCLUDED.spend, revenue = EXCLUDED.revenue,
    purchases = EXCLUDED.purchases, frozen_at = NOW()
  RETURNING snapshot_date
`;
console.log(`✓ hourly:     ${hourly.length} filas (date × hour) congeladas`);

// 2. CREATIVES Meta (ad-level con thumbnails)
const creatives = await sql`
  INSERT INTO hot_sale_2026_creatives
    (snapshot_date, ad_id, ad_name, campaign_id, campaign_name, thumbnail_url,
     effective_status, spend, impressions, clicks, reach, purchases, revenue,
     cpa, roas, ctr, frozen_at)
  SELECT snapshot_date, ad_id, ad_name, campaign_id, campaign_name, thumbnail_url,
         effective_status, spend, impressions, clicks, reach, purchases, revenue,
         cpa, roas, ctr, NOW()
  FROM meta_ads_creatives
  WHERE client_id = ${CLIENT_ID}
    AND snapshot_date BETWEEN ${HOT_WEEK_START} AND ${HOT_WEEK_END}
  ON CONFLICT (snapshot_date, ad_id)
  DO UPDATE SET
    ad_name = EXCLUDED.ad_name, campaign_name = EXCLUDED.campaign_name,
    thumbnail_url = EXCLUDED.thumbnail_url, effective_status = EXCLUDED.effective_status,
    spend = EXCLUDED.spend, impressions = EXCLUDED.impressions, clicks = EXCLUDED.clicks,
    reach = EXCLUDED.reach, purchases = EXCLUDED.purchases, revenue = EXCLUDED.revenue,
    cpa = EXCLUDED.cpa, roas = EXCLUDED.roas, ctr = EXCLUDED.ctr,
    frozen_at = NOW()
  RETURNING snapshot_date, ad_id
`;
console.log(`✓ creatives:  ${creatives.length} filas (date × ad) congeladas`);

// 3. BREAKDOWNS Meta (age/gender/region/placement)
const breakdowns = await sql`
  INSERT INTO hot_sale_2026_breakdowns
    (snapshot_date, dimension_type, dimension_value, spend, impressions,
     clicks, reach, purchases, revenue, cpa, roas, frozen_at)
  SELECT snapshot_date, dimension_type, dimension_value, spend, impressions,
         clicks, reach, purchases, revenue, cpa, roas, NOW()
  FROM meta_ads_breakdowns
  WHERE client_id = ${CLIENT_ID}
    AND snapshot_date BETWEEN ${HOT_WEEK_START} AND ${HOT_WEEK_END}
  ON CONFLICT (snapshot_date, dimension_type, dimension_value)
  DO UPDATE SET
    spend = EXCLUDED.spend, impressions = EXCLUDED.impressions,
    clicks = EXCLUDED.clicks, reach = EXCLUDED.reach,
    purchases = EXCLUDED.purchases, revenue = EXCLUDED.revenue,
    cpa = EXCLUDED.cpa, roas = EXCLUDED.roas,
    frozen_at = NOW()
  RETURNING snapshot_date, dimension_type
`;
console.log(`✓ breakdowns: ${breakdowns.length} filas (date × dimension × value) congeladas`);

// ─── Resumen de cobertura ─────────────────────────────────────────────────
console.log(`\n━━━ Cobertura por día (Hot Week 11-17 may) ━━━\n`);
const summary = await sql`
  SELECT d::date::text AS date,
         (SELECT COUNT(*) FROM hot_sale_2026_hourly     WHERE snapshot_date = d::date)::int AS horas,
         (SELECT COUNT(*) FROM hot_sale_2026_creatives  WHERE snapshot_date = d::date)::int AS ads,
         (SELECT COUNT(*) FROM hot_sale_2026_breakdowns WHERE snapshot_date = d::date)::int AS brks
  FROM generate_series(${HOT_WEEK_START}::date, ${HOT_WEEK_END}::date, '1 day'::interval) AS d
  ORDER BY d
`;
for (const r of summary as any[]) {
  const dateStr = String(r.date).slice(0, 10);
  const horas   = String(r.horas).padStart(2);
  const ads     = String(r.ads).padStart(3);
  const brks    = String(r.brks).padStart(3);
  const horasIcon = r.horas === 24 ? '✓' : r.horas > 0 ? '~' : '✗';
  console.log(`  ${dateStr} · horas: ${horas}/24 ${horasIcon} · ads: ${ads} · breakdowns: ${brks}`);
}

const totalDays = (summary as any[]).filter((r: any) => r.horas > 0).length;
if (totalDays < 7) {
  console.log(`\n⚠ Solo ${totalDays}/7 días tienen data hourly. Re-corré cuando estén los demás.`);
} else if ((summary as any[]).some((r: any) => r.horas < 20)) {
  console.log('\n⚠ Algunos días no tienen las 24 horas. Re-corré después.');
} else {
  console.log('\n✓ Cobertura completa. El informe queda inmune al paso del tiempo.');
}
