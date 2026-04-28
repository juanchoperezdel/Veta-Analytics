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

async function main() {
  console.log('Eliminando filas mock de la DB...\n');

  const m = await sql`DELETE FROM meta_ads_campaigns   WHERE campaign_id = ANY(${MOCK_META_IDS}::text[])   RETURNING campaign_id` as any[];
  console.log(`  meta_ads_campaigns:   -${m.length} filas  (${m.map(r => r.campaign_id).join(', ')})`);

  const g = await sql`DELETE FROM google_ads_campaigns WHERE campaign_id = ANY(${MOCK_GOOGLE_IDS}::text[]) RETURNING campaign_id` as any[];
  console.log(`  google_ads_campaigns: -${g.length} filas  (${g.map(r => r.campaign_id).join(', ')})`);

  const y = await sql`DELETE FROM youtube_videos       WHERE video_id    = ANY(${MOCK_YT_IDS}::text[])     RETURNING video_id` as any[];
  console.log(`  youtube_videos:       -${y.length} filas  (${y.map(r => r.video_id).join(', ')})`);

  const r = await sql`DELETE FROM product_routes       WHERE route       = ANY(${MOCK_ROUTE_NAMES}::text[]) RETURNING route`    as any[];
  console.log(`  product_routes:       -${r.length} filas  (${r.map(x => x.route).join(' | ')})`);

  // Conteos finales
  console.log('\n━━━ Conteos post-cleanup ━━━');
  const tables = ['clients','users','user_clients','business_kpis','meta_ads_campaigns','google_ads_campaigns','product_routes','youtube_videos'];
  for (const t of tables) {
    const r = await sql.query(`SELECT COUNT(*) AS n FROM ${t}`);
    console.log(`  ${t.padEnd(22)} ${r[0].n}`);
  }
}

main().catch(e => { console.error(e); process.exit(1); });
