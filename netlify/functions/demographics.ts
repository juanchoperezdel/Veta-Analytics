import type { Context } from '@netlify/functions';
import { sql, corsHeaders, errorResponse } from './_db';
import { verifyToken, authorizeSlug, unauthorizedResponse } from './_auth';

// Breakdowns demográficos de Meta. Devuelve agregados por dimension_type
// (age, gender, region, publisher_platform).

export default async (req: Request, _context: Context) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: corsHeaders() });

  const user = await verifyToken(req);
  if (!user) return unauthorizedResponse();

  const params = new URL(req.url).searchParams;
  const slug  = params.get('slug');
  const start = params.get('start');
  const end   = params.get('end');
  if (!slug) return errorResponse('Missing slug', 400);
  if (!(await authorizeSlug(user.userId, slug))) return unauthorizedResponse();

  const [client] = await sql`SELECT id FROM clients WHERE slug = ${slug}`;
  if (!client) return errorResponse('Client not found', 404);

  const startDate = start ?? sql`CURRENT_DATE - 29`;
  const endDate   = end   ?? sql`CURRENT_DATE`;

  const rows = await sql`
    SELECT
      dimension_type,
      dimension_value,
      SUM(spend)::numeric       AS spend,
      SUM(impressions)::bigint  AS impressions,
      SUM(clicks)::bigint       AS clicks,
      SUM(reach)::bigint        AS reach,
      SUM(purchases)::bigint    AS purchases,
      SUM(revenue)::numeric     AS revenue
    FROM meta_ads_breakdowns
    WHERE client_id = ${client.id}
      AND snapshot_date BETWEEN ${startDate} AND ${endDate}
    GROUP BY dimension_type, dimension_value
    HAVING SUM(spend) > 0
    ORDER BY dimension_type, SUM(spend) DESC
  `;

  // Agrupar por dimension_type
  const byDim: Record<string, any[]> = { age: [], gender: [], region: [], publisher_platform: [] };
  for (const r of rows) {
    const spend = Number(r.spend);
    const purchases = Number(r.purchases);
    const revenue = Number(r.revenue);
    const item = {
      value:       r.dimension_value,
      spend,
      impressions: Number(r.impressions),
      clicks:      Number(r.clicks),
      reach:       Number(r.reach),
      purchases,
      revenue,
      cpa:         purchases > 0 ? spend / purchases : 0,
      roas:        spend > 0 ? revenue / spend : 0,
    };
    if (!byDim[r.dimension_type]) byDim[r.dimension_type] = [];
    byDim[r.dimension_type].push(item);
  }

  // Top regiones limitado a 15 (puede haber muchísimas)
  if (byDim.region.length > 15) byDim.region = byDim.region.slice(0, 15);

  // Mismatch: spend share vs conversion share por dimension
  // "Gastás X% del budget en grupo Y, pero ese grupo solo trae Z% de las compras"
  function findMismatch(items: any[], dimName: string) {
    if (!items?.length) return null;
    const totalSpend = items.reduce((s, i) => s + i.spend, 0);
    const totalPurch = items.reduce((s, i) => s + i.purchases, 0);
    if (totalSpend === 0 || totalPurch === 0) return null;

    const enriched = items.map(i => ({
      value: i.value,
      spendShare: i.spend / totalSpend,
      purchShare: i.purchases / totalPurch,
      gap: (i.purchases / totalPurch) - (i.spend / totalSpend),  // positivo = subgastado, negativo = sobregastado
      roas: i.roas,
      spend: i.spend,
      purchases: i.purchases,
    }));

    // Sobregastados: spend share alto, purchase share bajo (gap muy negativo)
    const overspent = [...enriched].sort((a, b) => a.gap - b.gap).filter(x => x.gap < -0.05).slice(0, 3);
    // Subgastados: purchase share alto vs spend share bajo (gap muy positivo)
    const underspent = [...enriched].sort((a, b) => b.gap - a.gap).filter(x => x.gap > 0.05 && x.purchases >= 5).slice(0, 3);

    return { dimension: dimName, overspent, underspent };
  }

  const mismatches = [
    findMismatch(byDim.age,                'Edad'),
    findMismatch(byDim.gender,             'Género'),
    findMismatch(byDim.region,             'Región'),
    findMismatch(byDim.publisher_platform, 'Placement'),
  ].filter(m => m !== null);

  return new Response(JSON.stringify({
    age:       byDim.age,
    gender:    byDim.gender,
    region:    byDim.region,
    placement: byDim.publisher_platform,
    mismatches,
  }), { headers: corsHeaders() });
};
