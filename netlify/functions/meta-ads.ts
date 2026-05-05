import type { Context } from '@netlify/functions';
import { sql, corsHeaders, errorResponse } from './_db';
import { verifyToken, authorizeSlug, unauthorizedResponse } from './_auth';
import { buildMetaAdsConclusions } from './_conclusions';

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

  // Sumamos spend/reach/clicks de TODAS las campañas activas en el rango, pero las ventas
  // solo de las campañas de objetivo de conversión (OUTCOME_SALES / CONVERSIONS). Las de
  // awareness, traffic, engagement igual reportan "purchases" por view-through, pero no
  // son su objetivo y sobrecuentan las ventas atribuidas a otras campañas.
  const SALES_OBJECTIVES = ['OUTCOME_SALES', 'CONVERSIONS', 'PRODUCT_CATALOG_SALES'];

  const [curr] = await sql`
    SELECT
      SUM(spend)::numeric AS spend,
      SUM(CASE WHEN type = ANY(${SALES_OBJECTIVES}::text[]) THEN purchases ELSE 0 END)::bigint AS purchases,
      SUM(CASE WHEN type = ANY(${SALES_OBJECTIVES}::text[]) THEN revenue   ELSE 0 END)::numeric AS revenue
    FROM meta_ads_campaigns
    WHERE client_id = ${client.id} AND snapshot_date BETWEEN ${startDate} AND ${endDate}
  `;

  const [prev] = await sql`
    SELECT
      SUM(spend)::numeric AS spend,
      SUM(CASE WHEN type = ANY(${SALES_OBJECTIVES}::text[]) THEN purchases ELSE 0 END)::bigint AS purchases,
      SUM(CASE WHEN type = ANY(${SALES_OBJECTIVES}::text[]) THEN revenue   ELSE 0 END)::numeric AS revenue
    FROM meta_ads_campaigns
    WHERE client_id = ${client.id}
      AND snapshot_date BETWEEN
        (${startDate}::date - INTERVAL '1 month')
        AND (${endDate}::date - INTERVAL '1 month')
  `;

  function delta(c: number, p: number) { return (!p || p === 0) ? 0 : (c - p) / p; }

  const spend     = Number(curr?.spend ?? 0);
  const purchases = Number(curr?.purchases ?? 0);
  const revenue   = Number(curr?.revenue ?? 0);
  const roas      = spend > 0 ? revenue / spend : 0;
  const cpa       = purchases > 0 ? spend / purchases : 0;
  const aov       = purchases > 0 ? revenue / purchases : 0;

  const prevSpend     = Number(prev?.spend ?? 0);
  const prevPurchases = Number(prev?.purchases ?? 0);
  const prevRevenue   = Number(prev?.revenue ?? 0);
  const prevRoas      = prevSpend > 0 ? prevRevenue / prevSpend : 0;
  const prevCpa       = prevPurchases > 0 ? prevSpend / prevPurchases : 0;
  const prevAov       = prevPurchases > 0 ? prevRevenue / prevPurchases : 0;

  const kpis = {
    spend:     { value: spend,     delta: delta(spend,     prevSpend) },
    purchases: { value: purchases, delta: delta(purchases, prevPurchases) },
    revenue:   { value: revenue,   delta: delta(revenue,   prevRevenue) },
    cpa:       { value: cpa,       delta: delta(cpa,       prevCpa) },
    roas:      { value: roas,      delta: delta(roas,      prevRoas) },
    aov:       { value: aov,       delta: delta(aov,       prevAov) },
  };

  const rows = await sql`
    SELECT
      campaign_id,
      MAX(type) AS type, MAX(segment) AS segment,
      SUM(spend)::numeric     AS spend,
      SUM(reach)::bigint      AS reach,
      SUM(purchases)::bigint  AS purchases,
      SUM(revenue)::numeric   AS revenue
    FROM meta_ads_campaigns
    WHERE client_id = ${client.id} AND snapshot_date BETWEEN ${startDate} AND ${endDate}
    GROUP BY campaign_id
    ORDER BY SUM(spend) DESC
  `;

  // Health score: necesitamos el spend/conv de últimos 7 y 14 días por campaña
  // para calcular tendencia y "días sin conversión".
  const last7 = await sql`
    SELECT campaign_id,
           SUM(spend)::numeric AS spend,
           SUM(purchases)::bigint AS purchases,
           SUM(revenue)::numeric AS revenue
    FROM meta_ads_campaigns
    WHERE client_id = ${client.id} AND snapshot_date >= CURRENT_DATE - 6
    GROUP BY campaign_id
  `;
  const prev7 = await sql`
    SELECT campaign_id,
           SUM(spend)::numeric AS spend,
           SUM(purchases)::bigint AS purchases,
           SUM(revenue)::numeric AS revenue
    FROM meta_ads_campaigns
    WHERE client_id = ${client.id}
      AND snapshot_date BETWEEN CURRENT_DATE - 13 AND CURRENT_DATE - 7
    GROUP BY campaign_id
  `;
  const last7Map = new Map(last7.map((r: any) => [r.campaign_id, r]));
  const prev7Map = new Map(prev7.map((r: any) => [r.campaign_id, r]));

  const campaigns = rows.map((c: any) => {
    const s = Number(c.spend), r = Number(c.revenue), p = Number(c.purchases);
    const isSalesObjective = SALES_OBJECTIVES.includes(c.type);
    const l7 = last7Map.get(c.campaign_id) as any;
    const p7 = prev7Map.get(c.campaign_id) as any;
    const last7Spend = Number(l7?.spend ?? 0);
    const last7Purch = Number(l7?.purchases ?? 0);
    const last7Rev   = Number(l7?.revenue ?? 0);
    const prev7Rev   = Number(p7?.revenue ?? 0);
    const trend7d    = prev7Rev > 0 ? (last7Rev - prev7Rev) / prev7Rev : 0;
    const last7Roas  = last7Spend > 0 ? last7Rev / last7Spend : 0;

    const health = scoreHealth({
      isSalesObjective,
      last7Spend,
      last7Purch,
      last7Roas,
      trend7d,
    });

    return {
      id: c.campaign_id, type: c.type, segment: c.segment,
      spend: s, reach: Number(c.reach), purchases: p, revenue: r,
      cpa: p > 0 ? s / p : 0,
      roas: s > 0 ? r / s : 0,
      ctr: 0, cpc: 0,
      health,
      last7d: { spend: last7Spend, purchases: last7Purch, revenue: last7Rev, roas: last7Roas, trendVsPrev7: trend7d },
    };
  });

  // ─── Datos auxiliares para conclusiones ───────────────────────────────
  // Top creatives del rango
  const creativeRows = await sql`
    SELECT ad_id, MAX(ad_name) AS ad_name,
           SUM(spend)::numeric AS spend, SUM(impressions)::bigint AS impressions,
           SUM(clicks)::bigint AS clicks, SUM(reach)::bigint AS reach,
           SUM(purchases)::bigint AS purchases, SUM(revenue)::numeric AS revenue
    FROM meta_ads_creatives
    WHERE client_id = ${client.id}
      AND snapshot_date BETWEEN ${startDate} AND ${endDate}
    GROUP BY ad_id
    HAVING SUM(spend) > 0
    ORDER BY SUM(spend) DESC
    LIMIT 30
  `;
  const creatives = creativeRows.map((c: any) => {
    const sp = Number(c.spend);
    const re = Number(c.revenue);
    return {
      adId: c.ad_id,
      adName: c.ad_name,
      spend: sp,
      revenue: re,
      purchases: Number(c.purchases),
      roas: sp > 0 ? re / sp : 0,
    };
  });

  // Demographic mismatches (replicamos lógica liviana de demographics.ts)
  const breakdownRows = await sql`
    SELECT dimension_type, dimension_value,
           SUM(spend)::numeric AS spend, SUM(purchases)::bigint AS purchases, SUM(revenue)::numeric AS revenue
    FROM meta_ads_breakdowns
    WHERE client_id = ${client.id}
      AND snapshot_date BETWEEN ${startDate} AND ${endDate}
    GROUP BY dimension_type, dimension_value
    HAVING SUM(spend) > 0
  `;
  const byDim: Record<string, any[]> = { age: [], gender: [], region: [], publisher_platform: [] };
  for (const r of breakdownRows) {
    const sp = Number(r.spend), pu = Number(r.purchases), re = Number(r.revenue);
    if (!byDim[r.dimension_type]) byDim[r.dimension_type] = [];
    byDim[r.dimension_type].push({
      value: r.dimension_value, spend: sp, purchases: pu, revenue: re,
      roas: sp > 0 ? re / sp : 0,
    });
  }
  function findMismatch(items: any[], dimName: string) {
    if (!items?.length) return null;
    const totalSpend = items.reduce((s, i) => s + i.spend, 0);
    const totalPurch = items.reduce((s, i) => s + i.purchases, 0);
    if (totalSpend === 0 || totalPurch === 0) return null;
    const enriched = items.map(i => ({
      value: i.value, spendShare: i.spend / totalSpend, purchShare: i.purchases / totalPurch,
      gap: (i.purchases / totalPurch) - (i.spend / totalSpend), roas: i.roas, spend: i.spend, purchases: i.purchases,
    }));
    const overspent = [...enriched].sort((a, b) => a.gap - b.gap).filter(x => x.gap < -0.05).slice(0, 3);
    const underspent = [...enriched].sort((a, b) => b.gap - a.gap).filter(x => x.gap > 0.05 && x.purchases >= 5).slice(0, 3);
    return { dimension: dimName, overspent, underspent };
  }
  const mismatches = [
    findMismatch(byDim.age, 'Edad'),
    findMismatch(byDim.gender, 'Género'),
    findMismatch(byDim.region, 'Región'),
    findMismatch(byDim.publisher_platform, 'Placement'),
  ].filter(m => m !== null);

  const demographics = { mismatches };
  const conclusions = buildMetaAdsConclusions({ campaigns, creatives, demographics, kpis });

  return new Response(JSON.stringify({ kpis, campaigns, conclusions }), { headers: corsHeaders() });
};

// Score: 'scale' / 'ok' / 'optimize' / 'pause' basado en reglas simples.
type HealthInput = {
  isSalesObjective: boolean;
  last7Spend: number;
  last7Purch: number;
  last7Roas: number;
  trend7d: number;
};
function scoreHealth(x: HealthInput): { status: 'scale' | 'ok' | 'optimize' | 'pause'; reason: string } {
  // Si no es objetivo de venta, no aplicamos las reglas de ROAS — solo trafficking.
  if (!x.isSalesObjective) {
    if (x.last7Spend < 100) return { status: 'ok', reason: 'Bajo gasto, no requiere acción.' };
    return { status: 'ok', reason: 'Campaña no-conversión, ROAS no aplica.' };
  }
  // Reglas para campañas de conversión
  if (x.last7Spend < 1000) {
    return { status: 'ok', reason: 'Bajo gasto en 7d, no es prioritaria.' };
  }
  if (x.last7Purch === 0 && x.last7Spend > 5000) {
    return { status: 'pause', reason: `0 conversiones con $${x.last7Spend.toFixed(0)} gastado en 7d. Pausar o revisar urgente.` };
  }
  if (x.last7Roas >= 3 && x.trend7d >= 0) {
    return { status: 'scale', reason: `ROAS ${x.last7Roas.toFixed(1)}x en 7d con tendencia positiva. Considerá subir budget.` };
  }
  if (x.last7Roas < 1.5) {
    return { status: 'optimize', reason: `ROAS ${x.last7Roas.toFixed(1)}x en 7d. Revisar creatives o targeting.` };
  }
  if (x.trend7d < -0.2) {
    return { status: 'optimize', reason: `Revenue cayó ${(Math.abs(x.trend7d) * 100).toFixed(0)}% vs semana anterior.` };
  }
  return { status: 'ok', reason: `ROAS ${x.last7Roas.toFixed(1)}x estable.` };
}
