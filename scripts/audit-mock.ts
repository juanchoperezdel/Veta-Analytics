import { neon } from '@neondatabase/serverless';
const sql = neon(process.env.DATABASE_URL!);

const MOCK_META_IDS   = ['m1','m2','m3','m4'];
const MOCK_GOOGLE_IDS = ['g1','g2','g3','g4','g5'];
const MOCK_YT_IDS     = ['y1','y2','y3'];
const MOCK_ROUTE_NAMES = [
  'Mendoza → Santiago',
  'Santiago → Mendoza',
  'Mendoza → CORDOBA',
  'CORDOBA → Mendoza',
  'Bariloche → Osorno',
  'Retiro Buenos Aires → Mendoza',
];
const MOCK_SLUGS = ['saas-b2b'];

async function main() {
  // ─── Clients tabla ───
  console.log('━━━ clients ━━━');
  const clients = await sql`SELECT id, slug, name FROM clients ORDER BY slug` as any[];
  for (const c of clients) {
    const mock = MOCK_SLUGS.includes(c.slug);
    console.log(`  ${mock ? '✗ MOCK' : '     '}  slug=${c.slug}  name=${c.name}  id=${c.id}`);
  }

  // ─── Meta Ads ───
  const metaRows = await sql`
    SELECT campaign_id, MAX(segment) AS name, COUNT(*) AS rows, SUM(purchases)::bigint AS p
    FROM meta_ads_campaigns
    WHERE campaign_id = ANY(${MOCK_META_IDS}::text[])
    GROUP BY campaign_id
  ` as any[];
  console.log(`\n━━━ meta_ads_campaigns mock (${metaRows.length} campaigns) ━━━`);
  for (const r of metaRows) console.log(`  ${r.campaign_id}  rows=${r.rows}  p=${r.p}  ${r.name}`);

  // ─── Google Ads ───
  const gadsRows = await sql`
    SELECT campaign_id, MAX(name) AS name, COUNT(*) AS rows, SUM(carts)::bigint AS p
    FROM google_ads_campaigns
    WHERE campaign_id = ANY(${MOCK_GOOGLE_IDS}::text[])
    GROUP BY campaign_id
  ` as any[];
  console.log(`\n━━━ google_ads_campaigns mock (${gadsRows.length} campaigns) ━━━`);
  for (const r of gadsRows) console.log(`  ${r.campaign_id}  rows=${r.rows}  p=${r.p}  ${r.name}`);

  // ─── YouTube ───
  const ytRows = await sql`
    SELECT video_id, MAX(title) AS title, COUNT(*) AS rows
    FROM youtube_videos
    WHERE video_id = ANY(${MOCK_YT_IDS}::text[])
    GROUP BY video_id
  ` as any[];
  console.log(`\n━━━ youtube_videos mock (${ytRows.length} videos) ━━━`);
  for (const r of ytRows) console.log(`  ${r.video_id}  rows=${r.rows}  ${r.title}`);

  // Otros video_id que no parecen reales (YouTube usa IDs de 11 caracteres alfanuméricos)
  const ytWeird = await sql`
    SELECT video_id, MAX(title) AS title, COUNT(*) AS rows
    FROM youtube_videos
    WHERE video_id !~ '^[a-zA-Z0-9_-]{11}$' AND NOT (video_id = ANY(${MOCK_YT_IDS}::text[]))
    GROUP BY video_id
  ` as any[];
  console.log(`\n━━━ youtube_videos con video_id no-estándar (${ytWeird.length}) ━━━`);
  for (const r of ytWeird) console.log(`  ${r.video_id}  rows=${r.rows}  ${r.title}`);

  // ─── product_routes ───
  const routesRows = await sql`
    SELECT route, COUNT(*) AS rows, SUM(purchases)::bigint AS p, MIN(snapshot_date) AS first, MAX(snapshot_date) AS last
    FROM product_routes
    WHERE route = ANY(${MOCK_ROUTE_NAMES}::text[])
    GROUP BY route
  ` as any[];
  console.log(`\n━━━ product_routes con nombres de mock (${routesRows.length}) ━━━`);
  for (const r of routesRows) console.log(`  rows=${r.rows}  p=${r.p}  ${r.first} → ${r.last}  ${r.route}`);

  const routesAll = await sql`SELECT COUNT(*) AS n FROM product_routes` as any[];
  console.log(`  total filas en product_routes: ${routesAll[0].n}`);

  // ─── business_kpis ───
  // Los números exactos del mock: users=108035, sessions=176636, carts=6683, tickets=10235, revenue=656653893, aov=98257
  // Son suspicious si aparecen con esos valores exactos
  const bkMock = await sql`
    SELECT COUNT(*) AS n, MIN(snapshot_date) AS first, MAX(snapshot_date) AS last
    FROM business_kpis
    WHERE users = 108035 OR sessions = 176636 OR tickets = 10235 OR revenue = 656653893
  ` as any[];
  console.log(`\n━━━ business_kpis con valores sospechosos de mock (${bkMock[0].n}) ━━━`);
  if (bkMock[0].n > 0) console.log(`  rango: ${bkMock[0].first} → ${bkMock[0].last}`);

  // Resumen de totales DB actuales
  console.log('\n━━━ Conteos actuales por tabla ━━━');
  const tables = ['clients','users','user_clients','business_kpis','meta_ads_campaigns','google_ads_campaigns','product_routes','youtube_videos'];
  for (const t of tables) {
    const r = await sql.query(`SELECT COUNT(*) AS n FROM ${t}`);
    console.log(`  ${t.padEnd(22)} ${r[0].n}`);
  }
}

main().catch(e => { console.error(e); process.exit(1); });
