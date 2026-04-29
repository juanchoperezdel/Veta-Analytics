// Backfill: aplica parseRoute a todas las filas existentes en meta_ads_campaigns y
// google_ads_campaigns que aún tienen route = NULL, y a search terms.
//
// One-off — corré una sola vez después de agregar la columna `route`. El sync
// regular llenará las nuevas filas automáticamente.

import { neon } from '@neondatabase/serverless';
import { parseRoute } from './sync/parse-routes';

const sql = neon(process.env.DATABASE_URL!);

async function main() {
  console.log('Backfilling routes...\n');

  // Meta: agrupa por nombre, parsea, update
  const metaNames = await sql`
    SELECT DISTINCT segment AS name FROM meta_ads_campaigns WHERE route IS NULL AND segment IS NOT NULL
  `;
  let metaUpdated = 0;
  for (const r of metaNames) {
    const route = parseRoute(r.name);
    if (route) {
      const result = await sql`
        UPDATE meta_ads_campaigns SET route = ${route} WHERE segment = ${r.name} AND route IS NULL
      `;
      metaUpdated += (result as any).length || 0;
    }
  }
  console.log(`✓ Meta: ${metaNames.length} unique names, parsed routes for ${metaUpdated} rows`);

  // Google: agrupa por nombre, parsea, update
  const googleNames = await sql`
    SELECT DISTINCT name FROM google_ads_campaigns WHERE route IS NULL AND name IS NOT NULL
  `;
  let googleUpdated = 0;
  for (const r of googleNames) {
    const route = parseRoute(r.name);
    if (route) {
      const result = await sql`
        UPDATE google_ads_campaigns SET route = ${route} WHERE name = ${r.name} AND route IS NULL
      `;
      googleUpdated += (result as any).length || 0;
    }
  }
  console.log(`✓ Google: ${googleNames.length} unique names, parsed routes for ${googleUpdated} rows`);

  // Search terms: parsea término por término (en chunks paralelos)
  const stTerms = await sql`
    SELECT DISTINCT search_term FROM google_ads_search_terms WHERE route IS NULL
  `;
  let stUpdated = 0;
  const concurrency = 30;
  for (let i = 0; i < stTerms.length; i += concurrency) {
    const chunk = stTerms.slice(i, i + concurrency);
    const updates = await Promise.all(chunk.map(async (r: any) => {
      const route = parseRoute(r.search_term);
      if (!route) return 0;
      const result = await sql`
        UPDATE google_ads_search_terms SET route = ${route} WHERE search_term = ${r.search_term} AND route IS NULL
      `;
      return (result as any).length || 0;
    }));
    stUpdated += updates.reduce((a, b) => a + b, 0);
  }
  console.log(`✓ Search terms: ${stTerms.length} unique queries, parsed routes for ${stUpdated} rows`);

  console.log('\nDone.');
}

main().catch(e => { console.error(e); process.exit(1); });
