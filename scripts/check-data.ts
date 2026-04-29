import { neon } from '@neondatabase/serverless';
const sql = neon(process.env.DATABASE_URL!);

const [meta]   = await sql`SELECT MIN(snapshot_date) AS min, MAX(snapshot_date) AS max, COUNT(*) AS rows, COUNT(DISTINCT snapshot_date) AS days, COUNT(*) FILTER (WHERE route IS NOT NULL) AS with_route FROM meta_ads_campaigns`;
const [google] = await sql`SELECT MIN(snapshot_date) AS min, MAX(snapshot_date) AS max, COUNT(*) AS rows, COUNT(DISTINCT snapshot_date) AS days, COUNT(*) FILTER (WHERE route IS NOT NULL) AS with_route FROM google_ads_campaigns`;
const [ga4]    = await sql`SELECT MIN(snapshot_date) AS min, MAX(snapshot_date) AS max, COUNT(*) AS rows FROM business_kpis`;
const [yt]     = await sql`SELECT COUNT(*) AS rows FROM youtube_videos`;
const [terms]  = await sql`SELECT COUNT(*) AS rows, COUNT(DISTINCT search_term) AS unique_terms, COUNT(*) FILTER (WHERE route IS NOT NULL) AS with_route FROM google_ads_search_terms`;
const [creat]  = await sql`SELECT COUNT(*) AS rows, COUNT(DISTINCT ad_id) AS unique_ads, COUNT(*) FILTER (WHERE thumbnail_url IS NOT NULL) AS with_thumb FROM meta_ads_creatives`;
const [breakd] = await sql`SELECT COUNT(*) AS rows, COUNT(DISTINCT dimension_type) AS dim_types FROM meta_ads_breakdowns`;
const [routes] = await sql`SELECT COUNT(*) AS rows FROM product_routes`;

console.log('\n━━━ Meta Ads ━━━');
console.log(`  ${meta.min} → ${meta.max}`);
console.log(`  ${meta.rows} filas / ${meta.days} días / ${meta.with_route} con ruta parseada`);

console.log('\n━━━ Google Ads ━━━');
console.log(`  ${google.min} → ${google.max}`);
console.log(`  ${google.rows} filas / ${google.days} días / ${google.with_route} con ruta parseada`);

console.log('\n━━━ Google Ads Search Terms ━━━');
console.log(`  ${terms.rows} filas / ${terms.unique_terms} queries únicas / ${terms.with_route} con ruta parseada`);

console.log('\n━━━ Meta Creatives ━━━');
console.log(`  ${creat.rows} filas / ${creat.unique_ads} ads únicos / ${creat.with_thumb} con thumbnail`);

console.log('\n━━━ Meta Breakdowns ━━━');
console.log(`  ${breakd.rows} filas / ${breakd.dim_types} dimensiones (age, gender, region, placement)`);

console.log('\n━━━ GA4 KPIs ━━━');
console.log(`  ${ga4.min} → ${ga4.max}`);
console.log(`  ${ga4.rows} días`);

console.log('\n━━━ Product Routes (GA4 e-commerce) ━━━');
console.log(`  ${routes.rows} filas (esperado: 0 — Andesmar no trackea items)`);

console.log('\n━━━ YouTube ━━━');
console.log(`  ${yt.rows} filas`);

// Top rutas parseadas
console.log('\n━━━ Top rutas detectadas en Meta + Google (últimos 30d) ━━━');
const topRoutes = await sql`
  SELECT route, ROUND(SUM(spend)::numeric, 0) AS spend FROM (
    SELECT route, spend FROM meta_ads_campaigns
    WHERE snapshot_date >= CURRENT_DATE - 30 AND route IS NOT NULL
    UNION ALL
    SELECT route, spend FROM google_ads_campaigns
    WHERE snapshot_date >= CURRENT_DATE - 30 AND route IS NOT NULL
  ) x GROUP BY route ORDER BY SUM(spend) DESC LIMIT 10
`;
for (const r of topRoutes) console.log(`  ${String(r.route).padEnd(30)} $${r.spend}`);
