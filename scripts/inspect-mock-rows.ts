import { neon } from '@neondatabase/serverless';
const sql = neon(process.env.DATABASE_URL!);

async function main() {
  // Todos los campaign_ids que NO sean numéricos (Meta usa numéricos largos)
  const all = await sql`
    SELECT campaign_id, MAX(segment) AS name
    FROM meta_ads_campaigns
    WHERE campaign_id !~ '^[0-9]+$'
    GROUP BY campaign_id
  ` as any[];
  console.log('Campaign IDs no-numéricos en meta_ads_campaigns:');
  for (const r of all) console.log(`  ${r.campaign_id}  ${r.name}`);

  // Rango de fechas y suma
  const [summary] = await sql`
    SELECT
      MIN(snapshot_date) AS first,
      MAX(snapshot_date) AS last,
      COUNT(*) AS rows,
      SUM(purchases)::bigint AS purchases,
      SUM(spend)::numeric AS spend,
      SUM(revenue)::numeric AS revenue
    FROM meta_ads_campaigns
    WHERE campaign_id !~ '^[0-9]+$'
  `;
  console.log(`\nTotal filas mock: ${summary.rows}`);
  console.log(`Rango: ${summary.first} → ${summary.last}`);
  console.log(`Compras acumuladas: ${summary.purchases}`);
  console.log(`Spend acumulado:    ${Number(summary.spend).toFixed(2)}`);
  console.log(`Revenue acumulado:  ${Number(summary.revenue).toFixed(2)}`);

  // Mismo check en google_ads y otros por si acaso
  console.log('\n━━━ Cross-check otros tablas ━━━');
  const gads = await sql`
    SELECT campaign_id, MAX(name) AS name
    FROM google_ads_campaigns
    WHERE campaign_id !~ '^[0-9]+$'
    GROUP BY campaign_id
  ` as any[];
  console.log(`Google Ads mock rows: ${gads.length}`);
  for (const r of gads) console.log(`  ${r.campaign_id}  ${r.name}`);

  const ytb = await sql`
    SELECT video_id, MAX(title) AS title FROM youtube_videos
    WHERE video_id !~ '^[a-zA-Z0-9_-]{11}$'
    GROUP BY video_id
  ` as any[];
  console.log(`YouTube mock-ish rows (not 11-char IDs): ${ytb.length}`);
  for (const r of ytb.slice(0, 10)) console.log(`  ${r.video_id}  ${r.title}`);
}

main().catch(e => { console.error(e); process.exit(1); });
