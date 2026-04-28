import { neon } from '@neondatabase/serverless';
const sql = neon(process.env.DATABASE_URL!);

async function main() {
  await sql`ALTER TABLE meta_ads_campaigns ADD COLUMN IF NOT EXISTS effective_status TEXT`;
  console.log('✓ meta_ads_campaigns.effective_status asegurado');

  // type ya existe pero lo estábamos llenando con 'Conversión' hardcoded — lo dejamos y el sync ahora mete el objective real.
  const cols = await sql`
    SELECT column_name, data_type FROM information_schema.columns
    WHERE table_name = 'meta_ads_campaigns' ORDER BY ordinal_position
  ` as any[];
  console.log('\nColumnas actuales de meta_ads_campaigns:');
  for (const c of cols) console.log(`  ${c.column_name.padEnd(18)} ${c.data_type}`);
}

main().catch(e => { console.error(e); process.exit(1); });
