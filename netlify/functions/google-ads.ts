import type { Context } from '@netlify/functions';
import { sql, corsHeaders, errorResponse } from './_db';
import { verifyToken, authorizeSlug, unauthorizedResponse } from './_auth';

export default async (req: Request, context: Context) => {
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

  // KPIs agregados del período
  const [curr] = await sql`
    SELECT
      SUM(spend)::numeric   AS spend,
      SUM(carts)::bigint    AS carts,
      SUM(revenue)::numeric AS revenue
    FROM google_ads_campaigns
    WHERE client_id = ${client.id}
      AND snapshot_date BETWEEN ${startDate} AND ${endDate}
  `;

  const [prev] = await sql`
    SELECT SUM(spend)::numeric AS spend, SUM(carts)::bigint AS carts, SUM(revenue)::numeric AS revenue
    FROM google_ads_campaigns
    WHERE client_id = ${client.id}
      AND snapshot_date BETWEEN
        (${startDate}::date - INTERVAL '1 month')
        AND (${endDate}::date - INTERVAL '1 month')
  `;

  function delta(c: number, p: number) { return (!p || p === 0) ? 0 : (c - p) / p; }

  const spend   = Number(curr?.spend ?? 0);
  const carts   = Number(curr?.carts ?? 0);
  const revenue = Number(curr?.revenue ?? 0);
  const roas    = spend > 0 ? revenue / spend : 0;
  const cpa     = carts > 0 ? spend / carts : 0;
  const aov     = carts > 0 ? revenue / carts : 0;

  const prevSpend   = Number(prev?.spend ?? 0);
  const prevCarts   = Number(prev?.carts ?? 0);
  const prevRevenue = Number(prev?.revenue ?? 0);
  const prevRoas    = prevSpend > 0 ? prevRevenue / prevSpend : 0;
  const prevCpa     = prevCarts > 0 ? prevSpend / prevCarts : 0;
  const prevAov     = prevCarts > 0 ? prevRevenue / prevCarts : 0;

  const kpis = {
    spend:   { value: spend,   delta: delta(spend,   prevSpend) },
    carts:   { value: carts,   delta: delta(carts,   prevCarts) },
    revenue: { value: revenue, delta: delta(revenue, prevRevenue) },
    cpa:     { value: cpa,     delta: delta(cpa,     prevCpa) },
    roas:    { value: roas,    delta: delta(roas,    prevRoas) },
    aov:     { value: aov,     delta: delta(aov,     prevAov) },
  };

  // Campañas agregadas del período
  const rows = await sql`
    SELECT
      campaign_id,
      MAX(name) AS name,
      SUM(spend)::numeric       AS spend,
      SUM(impressions)::bigint  AS impressions,
      SUM(clicks)::bigint       AS clicks,
      SUM(clicks)::numeric / NULLIF(SUM(impressions)::numeric, 0) AS ctr,
      SUM(spend)::numeric  / NULLIF(SUM(clicks)::numeric, 0)      AS cpc,
      SUM(carts)::bigint        AS carts,
      SUM(revenue)::numeric     AS revenue
    FROM google_ads_campaigns
    WHERE client_id = ${client.id}
      AND snapshot_date BETWEEN ${startDate} AND ${endDate}
    GROUP BY campaign_id
    ORDER BY SUM(spend) DESC
  `;

  // Health score: query adicional de últimos 7 y 14 días por campaña
  const last7 = await sql`
    SELECT campaign_id,
           SUM(spend)::numeric AS spend,
           SUM(carts)::bigint AS carts,
           SUM(revenue)::numeric AS revenue
    FROM google_ads_campaigns
    WHERE client_id = ${client.id} AND snapshot_date >= CURRENT_DATE - 6
    GROUP BY campaign_id
  `;
  const prev7 = await sql`
    SELECT campaign_id,
           SUM(spend)::numeric AS spend,
           SUM(revenue)::numeric AS revenue
    FROM google_ads_campaigns
    WHERE client_id = ${client.id}
      AND snapshot_date BETWEEN CURRENT_DATE - 13 AND CURRENT_DATE - 7
    GROUP BY campaign_id
  `;
  const last7Map = new Map(last7.map((r: any) => [r.campaign_id, r]));
  const prev7Map = new Map(prev7.map((r: any) => [r.campaign_id, r]));

  const campaigns = rows.map((c: any) => {
    const s = Number(c.spend), r = Number(c.revenue);
    const l7 = last7Map.get(c.campaign_id) as any;
    const p7 = prev7Map.get(c.campaign_id) as any;
    const last7Spend = Number(l7?.spend ?? 0);
    const last7Carts = Number(l7?.carts ?? 0);
    const last7Rev   = Number(l7?.revenue ?? 0);
    const prev7Rev   = Number(p7?.revenue ?? 0);
    const trend7d    = prev7Rev > 0 ? (last7Rev - prev7Rev) / prev7Rev : 0;
    const last7Roas  = last7Spend > 0 ? last7Rev / last7Spend : 0;
    const health     = scoreHealth({ last7Spend, last7Conversions: last7Carts, last7Roas, trend7d });

    return {
      id: c.campaign_id, name: c.name,
      spend: s, impressions: Number(c.impressions), clicks: Number(c.clicks),
      ctr: Number(c.ctr), cpc: Number(c.cpc),
      users: 0, retention: 0,
      carts: Number(c.carts), revenue: r,
      roas: s > 0 ? r / s : 0,
      health,
      last7d: { spend: last7Spend, carts: last7Carts, revenue: last7Rev, roas: last7Roas, trendVsPrev7: trend7d },
    };
  });

  return new Response(JSON.stringify({ kpis, campaigns }), { headers: corsHeaders() });
};

// Score: 'scale' / 'ok' / 'optimize' / 'pause' basado en reglas simples sobre 7 días.
type HealthInput = { last7Spend: number; last7Conversions: number; last7Roas: number; trend7d: number };
function scoreHealth(x: HealthInput): { status: 'scale' | 'ok' | 'optimize' | 'pause'; reason: string } {
  if (x.last7Spend < 1000) {
    return { status: 'ok', reason: 'Bajo gasto en 7d, no es prioritaria.' };
  }
  if (x.last7Conversions === 0 && x.last7Spend > 5000) {
    return { status: 'pause', reason: `0 conversiones con $${x.last7Spend.toFixed(0)} gastado en 7d. Pausar o revisar urgente.` };
  }
  if (x.last7Roas >= 3 && x.trend7d >= 0) {
    return { status: 'scale', reason: `ROAS ${x.last7Roas.toFixed(1)}x en 7d con tendencia positiva. Considerá subir budget.` };
  }
  if (x.last7Roas < 1.5) {
    return { status: 'optimize', reason: `ROAS ${x.last7Roas.toFixed(1)}x en 7d. Revisar copy o keywords.` };
  }
  if (x.trend7d < -0.2) {
    return { status: 'optimize', reason: `Revenue cayó ${(Math.abs(x.trend7d) * 100).toFixed(0)}% vs semana anterior.` };
  }
  return { status: 'ok', reason: `ROAS ${x.last7Roas.toFixed(1)}x estable.` };
}
