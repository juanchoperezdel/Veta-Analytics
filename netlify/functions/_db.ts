import { neon } from '@neondatabase/serverless';

export const sql = neon(process.env.DATABASE_URL!);

export function corsHeaders() {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Content-Type': 'application/json',
  };
}

export function errorResponse(msg: string, status = 500) {
  return new Response(JSON.stringify({ error: msg }), { status, headers: corsHeaders() });
}
