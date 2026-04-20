import type { Context } from '@netlify/functions';
import { sql, corsHeaders, errorResponse } from './_db';
import { signToken } from './_auth';

export default async (req: Request, _context: Context) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: corsHeaders() });
  if (req.method !== 'POST') return errorResponse('Method not allowed', 405);

  const { email, password } = await req.json();
  if (!email || !password) return errorResponse('Missing email or password', 400);

  const [user] = await sql`SELECT id, email, password_hash FROM users WHERE email = ${email}`;
  if (!user) return errorResponse('Invalid credentials', 401);

  // Verificar password con bcrypt via Web Crypto (SHA-256 simple, o usar argon2 si se prefiere)
  const valid = await verifyPassword(password, user.password_hash);
  if (!valid) return errorResponse('Invalid credentials', 401);

  // Obtener clientes a los que tiene acceso
  const clients = await sql`
    SELECT c.id, c.slug, c.name, c.logo_initial
    FROM user_clients uc
    JOIN clients c ON c.id = uc.client_id
    WHERE uc.user_id = ${user.id}
  `;

  const token = await signToken(user.id, user.email);

  return new Response(
    JSON.stringify({ token, clients: clients.map(c => ({ id: c.id, slug: c.slug, name: c.name, logoInitial: c.logo_initial })) }),
    { headers: corsHeaders() }
  );
};

async function verifyPassword(plain: string, hash: string): Promise<boolean> {
  // hash formato: "sha256:<hex>" — para crear usuarios usar scripts/create-user.ts
  const [algo, stored] = hash.split(':');
  if (algo !== 'sha256') return false;
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(plain));
  const hex = Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
  return hex === stored;
}
