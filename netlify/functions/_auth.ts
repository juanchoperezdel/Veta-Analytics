import { jwtVerify, SignJWT } from 'jose';
import { sql, errorResponse } from './_db';

const secret = new TextEncoder().encode(process.env.JWT_SECRET!);

export async function signToken(userId: number, email: string): Promise<string> {
  return new SignJWT({ sub: String(userId), email })
    .setProtectedHeader({ alg: 'HS256' })
    .setExpirationTime('7d')
    .sign(secret);
}

export async function verifyToken(req: Request): Promise<{ userId: number; email: string } | null> {
  const auth = req.headers.get('Authorization');
  if (!auth?.startsWith('Bearer ')) return null;
  try {
    const { payload } = await jwtVerify(auth.slice(7), secret);
    return { userId: Number(payload.sub), email: payload.email as string };
  } catch {
    return null;
  }
}

// Verifica que el user tenga acceso al cliente (por slug)
export async function authorizeSlug(userId: number, slug: string): Promise<boolean> {
  const rows = await sql`
    SELECT 1 FROM user_clients uc
    JOIN clients c ON c.id = uc.client_id
    WHERE uc.user_id = ${userId} AND c.slug = ${slug}
  `;
  return rows.length > 0;
}

export function unauthorizedResponse() {
  return errorResponse('Unauthorized', 401);
}
