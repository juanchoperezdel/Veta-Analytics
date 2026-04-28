import { neon } from '@neondatabase/serverless';
const sql = neon(process.env.DATABASE_URL!);

const SALES_OBJECTIVES = ['OUTCOME_SALES', 'CONVERSIONS', 'PRODUCT_CATALOG_SALES'];

async function main() {
  const since = '2026-04-01';
  const until = '2026-04-23';

  console.log(`Verificación Meta Ads — Andesmar ${since} → ${until}\n`);

  // Con el fix: solo OUTCOME_SALES
  const [salesOnly] = await sql`
    SELECT SUM(purchases)::bigint AS p, SUM(spend)::numeric AS s, SUM(revenue)::numeric AS r
    FROM meta_ads_campaigns m
    JOIN clients c ON c.id = m.client_id
    WHERE c.slug = 'andesmar'
      AND snapshot_date BETWEEN ${since} AND ${until}
      AND type = ANY(${SALES_OBJECTIVES}::text[])
  `;
  console.log('✓ Con fix (solo objetivos de venta):');
  console.log(`  Compras:  ${salesOnly.p}     (cliente dice: 886)`);
  console.log(`  Spend:    ${Number(salesOnly.s).toFixed(2)}`);
  console.log(`  Revenue:  ${Number(salesOnly.r).toFixed(2)}`);

  // Sin filtro (para comparar el inflado anterior)
  const [all] = await sql`
    SELECT SUM(purchases)::bigint AS p, SUM(spend)::numeric AS s
    FROM meta_ads_campaigns m JOIN clients c ON c.id = m.client_id
    WHERE c.slug = 'andesmar' AND snapshot_date BETWEEN ${since} AND ${until}
  `;
  console.log(`\n  Sin filtro (incluye awareness/traffic/engagement): ${all.p} compras, $${Number(all.s).toFixed(0)} spend`);

  // Desglose por objective
  const byObj = await sql`
    SELECT type, COUNT(DISTINCT campaign_id) AS n, SUM(purchases)::bigint AS p, SUM(spend)::numeric AS s
    FROM meta_ads_campaigns m JOIN clients c ON c.id = m.client_id
    WHERE c.slug = 'andesmar' AND snapshot_date BETWEEN ${since} AND ${until}
    GROUP BY type ORDER BY SUM(spend) DESC
  ` as any[];
  console.log('\n━━━ Por objetivo ━━━');
  console.log('  objective                     n   spend         compras');
  for (const o of byObj) {
    const marker = SALES_OBJECTIVES.includes(o.type) ? '✓' : '·';
    console.log(`  ${marker} ${String(o.type ?? 'null').padEnd(28)}  ${String(o.n).padStart(2)}  ${Number(o.s).toFixed(0).padStart(10)}   ${o.p}`);
  }

  // Sanity check: no queda mock
  console.log('\n━━━ Sanity check mock ━━━');
  const tables: { table: string; col: string }[] = [
    { table: 'meta_ads_campaigns',   col: 'campaign_id' },
    { table: 'google_ads_campaigns', col: 'campaign_id' },
  ];
  for (const t of tables) {
    const r = await sql.query(`SELECT COUNT(*) AS n FROM ${t.table} WHERE ${t.col} !~ '^[0-9]+$'`);
    console.log(`  ${t.table}: ${r[0].n} filas con IDs no-numéricos (esperado: 0)`);
  }
  const prs = await sql`SELECT COUNT(*) AS n FROM product_routes` as any[];
  console.log(`  product_routes: ${prs[0].n} filas (esperado: 0, Andesmar no tiene e-commerce)`);
  const c = await sql`SELECT slug FROM clients` as any[];
  console.log(`  clients: [${c.map((x: any) => x.slug).join(', ')}]`);
}

main().catch(e => { console.error(e); process.exit(1); });
