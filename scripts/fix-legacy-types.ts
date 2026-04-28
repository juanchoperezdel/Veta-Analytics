import { neon } from '@neondatabase/serverless';
const sql = neon(process.env.DATABASE_URL!);

async function main() {
  const token = process.env.META_ACCESS_TOKEN!;

  // Todas las campañas cuyo type no es un objective válido de Meta — las que quedaron legacy
  // o NULL después del resync.
  const legacy = await sql`
    SELECT DISTINCT campaign_id
    FROM meta_ads_campaigns
    WHERE type IS NULL OR type = 'Conversión'
  ` as any[];
  console.log(`Campañas con type legacy/null a actualizar: ${legacy.length}`);

  let fixed = 0;
  for (const { campaign_id } of legacy) {
    const res = await fetch(`https://graph.facebook.com/v21.0/${campaign_id}?fields=objective,effective_status&access_token=${token}`);
    if (!res.ok) { console.log(`  ✗ ${campaign_id}: ${res.status}`); continue; }
    const body = await res.json() as any;
    if (body.error || !body.objective) { console.log(`  ✗ ${campaign_id}: sin objective (${body.error?.message ?? 'unknown'})`); continue; }

    const r = await sql`
      UPDATE meta_ads_campaigns
      SET type = ${body.objective}, effective_status = ${body.effective_status}
      WHERE campaign_id = ${campaign_id} AND (type IS NULL OR type = 'Conversión')
      RETURNING id
    ` as any[];
    console.log(`  ✓ ${campaign_id}: → ${body.objective}/${body.effective_status}  (${r.length} filas)`);
    fixed += r.length;
  }
  console.log(`\nTotal filas actualizadas: ${fixed}`);
}

main().catch(e => { console.error(e); process.exit(1); });
