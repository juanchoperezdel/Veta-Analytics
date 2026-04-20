import { neon } from '@neondatabase/serverless';
const sql = neon(process.env.DATABASE_URL!);

const [meta]   = await sql`SELECT MIN(snapshot_date) AS min, MAX(snapshot_date) AS max, COUNT(*) AS rows, COUNT(DISTINCT snapshot_date) AS days FROM meta_ads_campaigns`;
const [google] = await sql`SELECT MIN(snapshot_date) AS min, MAX(snapshot_date) AS max, COUNT(*) AS rows, COUNT(DISTINCT snapshot_date) AS days FROM google_ads_campaigns`;
const [ga4]    = await sql`SELECT MIN(snapshot_date) AS min, MAX(snapshot_date) AS max, COUNT(*) AS rows FROM business_kpis`;
const [yt]     = await sql`SELECT COUNT(*) AS rows FROM youtube_videos`;

console.log('\n━━━ Meta Ads ━━━');
console.log(`  ${meta.min} → ${meta.max}`);
console.log(`  ${meta.rows} filas / ${meta.days} días`);

console.log('\n━━━ Google Ads ━━━');
console.log(`  ${google.min} → ${google.max}`);
console.log(`  ${google.rows} filas / ${google.days} días`);

console.log('\n━━━ GA4 KPIs ━━━');
console.log(`  ${ga4.min} → ${ga4.max}`);
console.log(`  ${ga4.rows} días`);

console.log('\n━━━ YouTube ━━━');
console.log(`  ${yt.rows} filas`);
