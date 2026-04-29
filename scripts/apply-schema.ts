// Aplica el schema.sql a Neon (idempotente: usa CREATE IF NOT EXISTS / ADD IF NOT EXISTS).
import { neon } from '@neondatabase/serverless';
import { readFileSync } from 'fs';

const sql = neon(process.env.DATABASE_URL!);

async function main() {
  const schema = readFileSync('scripts/db/schema.sql', 'utf-8');
  // Strip line comments (-- …) y luego split por `;` que esté seguido de newline.
  const stripped = schema
    .split('\n')
    .map(line => line.replace(/--.*$/, ''))
    .join('\n');
  const stmts = stripped
    .split(/;\s*\n/)
    .map(s => s.trim())
    .filter(s => s.length > 0);

  let ok = 0, fail = 0;
  for (const s of stmts) {
    try {
      await sql.query(s);
      ok++;
    } catch (e: any) {
      fail++;
      console.log(`\n✗ Statement failed:\n${s.slice(0, 150)}...\n  → ${e.message}`);
    }
  }
  console.log(`\n✓ Schema applied: ${ok} statements OK, ${fail} failed.`);
}

main().catch(e => { console.error(e); process.exit(1); });
