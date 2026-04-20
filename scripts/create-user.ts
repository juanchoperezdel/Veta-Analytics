// Uso: npx tsx scripts/create-user.ts email@ejemplo.com contraseña andesmar,saas-b2b
import { neon } from '@neondatabase/serverless';

const sql = neon(process.env.DATABASE_URL!);

const [,, email, password, clientSlugs] = process.argv;
if (!email || !password) {
  console.error('Uso: npx tsx scripts/create-user.ts <email> <password> [slug1,slug2]');
  process.exit(1);
}

const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(password));
const hash = 'sha256:' + Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');

const [user] = await sql`
  INSERT INTO users (email, password_hash) VALUES (${email}, ${hash})
  ON CONFLICT (email) DO UPDATE SET password_hash = EXCLUDED.password_hash
  RETURNING id
`;

if (clientSlugs) {
  for (const slug of clientSlugs.split(',')) {
    const [client] = await sql`SELECT id FROM clients WHERE slug = ${slug.trim()}`;
    if (!client) { console.warn(`  ⚠ Cliente no encontrado: ${slug}`); continue; }
    await sql`
      INSERT INTO user_clients (user_id, client_id) VALUES (${user.id}, ${client.id})
      ON CONFLICT DO NOTHING
    `;
    console.log(`  ✓ Acceso a: ${slug}`);
  }
}

console.log(`✓ Usuario creado: ${email} (id: ${user.id})`);
