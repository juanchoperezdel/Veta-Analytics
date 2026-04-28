import { neon } from '@neondatabase/serverless';
const sql = neon(process.env.DATABASE_URL!);

async function main() {
  const rows = await sql`
    SELECT campaign_id, MAX(segment) AS name,
           MIN(snapshot_date) AS first, MAX(snapshot_date) AS last,
           COUNT(*) AS rows, SUM(purchases)::bigint AS p, SUM(spend)::numeric AS s
    FROM meta_ads_campaigns
    WHERE type = 'Conversión'
    GROUP BY campaign_id
  ` as any[];
  console.log('Campañas con type="Conversión" legacy (objective no actualizado):');
  for (const r of rows) {
    console.log(`  ${r.campaign_id}  rows=${r.rows}  spend=${Number(r.s).toFixed(0)}  p=${r.p}  ${r.first} → ${r.last}`);
    console.log(`     name: ${r.name}`);
  }

  // Intentar recuperar el objective actual consultando directo por campaign_id
  const token = process.env.META_ACCESS_TOKEN!;
  for (const r of rows) {
    const res = await fetch(`https://graph.facebook.com/v21.0/${r.campaign_id}?fields=name,objective,effective_status&access_token=${token}`);
    const body = await res.json() as any;
    if (body.error) {
      console.log(`  → ${r.campaign_id}: ${body.error.message}`);
    } else {
      console.log(`  → ${r.campaign_id}: objective=${body.objective}  status=${body.effective_status}`);
    }
  }
}

main().catch(e => { console.error(e); process.exit(1); });
