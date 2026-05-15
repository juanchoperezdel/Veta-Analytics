/**
 * Congela los datos hourly de la Hot Week 2026 (11-17 may) en la tabla
 * hot_sale_2026_hourly. Las tablas live (meta_ads_hourly + google_ads_hourly)
 * son rolling 14 días — sin este snapshot, el heat-map del informe se rompe
 * después del 31 may.
 *
 * Idempotente: se puede correr múltiples veces. Sobreescribe la data del
 * snapshot con la última versión de las tablas live.
 *
 * Idealmente correrlo el 18 o 19 may cuando GA4 ya cerró todos los días.
 *
 * Uso:
 *   npx dotenv-cli -e .env -- npx tsx scripts/snapshot-hot-sale-hourly.ts
 */

import { neon } from '@neondatabase/serverless';
const sql = neon(process.env.DATABASE_URL!);

const CLIENT_ID = '1';                              // Andesmar
const HOT_WEEK_START = '2026-05-11';
const HOT_WEEK_END   = '2026-05-17';

console.log(`\n━━━ Snapshot Hot Sale 2026 hourly ━━━\n`);
console.log(`Rango: ${HOT_WEEK_START} → ${HOT_WEEK_END}\n`);

// Combinamos Meta + Google hourly y agrupamos por (date, hour)
const result = await sql`
  INSERT INTO hot_sale_2026_hourly (snapshot_date, hour, spend, revenue, purchases, frozen_at)
  SELECT snapshot_date,
         hour,
         SUM(spend)::numeric    AS spend,
         SUM(revenue)::numeric  AS revenue,
         SUM(purchases)::bigint AS purchases,
         NOW() AS frozen_at
  FROM (
    SELECT snapshot_date, hour, spend, revenue, purchases
    FROM meta_ads_hourly
    WHERE client_id = ${CLIENT_ID}
      AND snapshot_date BETWEEN ${HOT_WEEK_START} AND ${HOT_WEEK_END}
    UNION ALL
    SELECT snapshot_date, hour, spend, conv_value AS revenue, conversions::bigint AS purchases
    FROM google_ads_hourly
    WHERE client_id = ${CLIENT_ID}
      AND snapshot_date BETWEEN ${HOT_WEEK_START} AND ${HOT_WEEK_END}
  ) AS combined
  GROUP BY snapshot_date, hour
  ON CONFLICT (snapshot_date, hour)
  DO UPDATE SET
    spend     = EXCLUDED.spend,
    revenue   = EXCLUDED.revenue,
    purchases = EXCLUDED.purchases,
    frozen_at = NOW()
  RETURNING snapshot_date, hour
`;

console.log(`✓ ${result.length} filas (date × hour) congeladas en hot_sale_2026_hourly.\n`);

// Verificación: cuántos días tenemos cubiertos, cuántas horas por día
const summary = await sql`
  SELECT snapshot_date::text AS date,
         COUNT(*)::int AS horas,
         SUM(spend)::numeric AS spend,
         SUM(revenue)::numeric AS revenue,
         SUM(purchases)::bigint AS purchases
  FROM hot_sale_2026_hourly
  GROUP BY snapshot_date
  ORDER BY snapshot_date
`;
console.log('Cobertura por día:');
for (const r of summary as any[]) {
  const spend = Math.round(Number(r.spend)).toLocaleString('es-AR');
  const revenue = Math.round(Number(r.revenue)).toLocaleString('es-AR');
  console.log(`  ${r.date.slice(0, 10)} | ${r.horas}/24 horas | spend: $${spend.padStart(10)} | revenue: $${revenue.padStart(12)} | compras: ${r.purchases}`);
}

const days = (summary as any[]).length;
const missingDays = 7 - days;
if (missingDays > 0) {
  console.log(`\n⚠ Faltan ${missingDays} día(s) del rango. Re-corré este script cuando estén disponibles.`);
} else if ((summary as any[]).some((r: any) => r.horas < 20)) {
  console.log('\n⚠ Algunos días no tienen las 24 horas cubiertas — pueden estar parcial. Re-corré después.');
} else {
  console.log('\n✓ Cobertura completa. El heat-map va a seguir funcionando para siempre.');
}
