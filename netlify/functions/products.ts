import type { Context } from '@netlify/functions';
import { sql, corsHeaders, errorResponse } from './_db';
import { verifyToken, authorizeSlug, unauthorizedResponse } from './_auth';

// Devuelve data agregada de rutas combinando 3 fuentes:
//   - product_routes (GA4 e-commerce, vacío para Andesmar hoy)
//   - meta_ads_campaigns + google_ads_campaigns con columna `route` (parser de nombre)
//   - google_ads_search_terms con columna `route` (parser de query)
//
// Para cada ruta:
//   spend (Meta + Google), purchases (Meta + Google), revenue, demand (search clicks),
//   sparkline (serie diaria de spend), delta vs período anterior.

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

  // ─── Período actual: agregado por ruta desde Meta + Google + Search Terms ──
  // Solo consideramos rows con route IS NOT NULL — los nulos van al pool "Sin clasificar"
  const metaRows = await sql`
    SELECT route,
           SUM(spend)::numeric     AS spend,
           SUM(purchases)::bigint  AS purchases,
           SUM(revenue)::numeric   AS revenue
    FROM meta_ads_campaigns
    WHERE client_id = ${client.id}
      AND snapshot_date BETWEEN ${startDate} AND ${endDate}
      AND route IS NOT NULL
    GROUP BY route
  `;
  const googleRows = await sql`
    SELECT route,
           SUM(spend)::numeric     AS spend,
           SUM(carts)::bigint      AS purchases,
           SUM(revenue)::numeric   AS revenue
    FROM google_ads_campaigns
    WHERE client_id = ${client.id}
      AND snapshot_date BETWEEN ${startDate} AND ${endDate}
      AND route IS NOT NULL
    GROUP BY route
  `;
  const demandRows = await sql`
    SELECT route,
           SUM(clicks)::bigint       AS demand,
           SUM(impressions)::bigint  AS impressions
    FROM google_ads_search_terms
    WHERE client_id = ${client.id}
      AND snapshot_date BETWEEN ${startDate} AND ${endDate}
      AND route IS NOT NULL
    GROUP BY route
  `;

  // ─── Período anterior (mismo rango un mes atrás) — para deltas ────────────
  const metaPrev = await sql`
    SELECT route,
           SUM(spend)::numeric     AS spend,
           SUM(purchases)::bigint  AS purchases,
           SUM(revenue)::numeric   AS revenue
    FROM meta_ads_campaigns
    WHERE client_id = ${client.id}
      AND snapshot_date BETWEEN
        (${startDate}::date - INTERVAL '1 month')
        AND (${endDate}::date - INTERVAL '1 month')
      AND route IS NOT NULL
    GROUP BY route
  `;
  const googlePrev = await sql`
    SELECT route,
           SUM(spend)::numeric     AS spend,
           SUM(carts)::bigint      AS purchases,
           SUM(revenue)::numeric   AS revenue
    FROM google_ads_campaigns
    WHERE client_id = ${client.id}
      AND snapshot_date BETWEEN
        (${startDate}::date - INTERVAL '1 month')
        AND (${endDate}::date - INTERVAL '1 month')
      AND route IS NOT NULL
    GROUP BY route
  `;

  // ─── Sparkline: serie diaria de spend (últimos 30 días) ────────────────────
  const sparkRows = await sql`
    SELECT route, snapshot_date::text AS date, SUM(spend)::numeric AS spend
    FROM (
      SELECT route, snapshot_date, spend FROM meta_ads_campaigns
      WHERE client_id = ${client.id}
        AND snapshot_date BETWEEN ${startDate} AND ${endDate}
        AND route IS NOT NULL
      UNION ALL
      SELECT route, snapshot_date, spend FROM google_ads_campaigns
      WHERE client_id = ${client.id}
        AND snapshot_date BETWEEN ${startDate} AND ${endDate}
        AND route IS NOT NULL
    ) AS combined
    GROUP BY route, snapshot_date
    ORDER BY route, snapshot_date
  `;

  // ─── Combinar fuentes en una sola estructura por ruta ──────────────────────
  type Agg = {
    route: string;
    metaSpend: number; metaPurchases: number; metaRevenue: number;
    googleSpend: number; googlePurchases: number; googleRevenue: number;
    demandClicks: number; demandImpressions: number;
    sparkline: { date: string; spend: number }[];
  };
  const map = new Map<string, Agg>();
  function ensure(route: string): Agg {
    let a = map.get(route);
    if (!a) {
      a = { route, metaSpend: 0, metaPurchases: 0, metaRevenue: 0,
            googleSpend: 0, googlePurchases: 0, googleRevenue: 0,
            demandClicks: 0, demandImpressions: 0, sparkline: [] };
      map.set(route, a);
    }
    return a;
  }
  for (const r of metaRows)   { const a = ensure(r.route); a.metaSpend = Number(r.spend); a.metaPurchases = Number(r.purchases); a.metaRevenue = Number(r.revenue); }
  for (const r of googleRows) { const a = ensure(r.route); a.googleSpend = Number(r.spend); a.googlePurchases = Number(r.purchases); a.googleRevenue = Number(r.revenue); }
  for (const r of demandRows) { const a = ensure(r.route); a.demandClicks = Number(r.demand); a.demandImpressions = Number(r.impressions); }
  for (const r of sparkRows)  { const a = ensure(r.route); a.sparkline.push({ date: r.date, spend: Number(r.spend) }); }

  const prevMap = new Map<string, { spend: number; purchases: number; revenue: number }>();
  function ensurePrev(route: string) {
    if (!prevMap.has(route)) prevMap.set(route, { spend: 0, purchases: 0, revenue: 0 });
    return prevMap.get(route)!;
  }
  for (const r of metaPrev)   { const p = ensurePrev(r.route); p.spend += Number(r.spend); p.purchases += Number(r.purchases); p.revenue += Number(r.revenue); }
  for (const r of googlePrev) { const p = ensurePrev(r.route); p.spend += Number(r.spend); p.purchases += Number(r.purchases); p.revenue += Number(r.revenue); }

  function delta(c: number, p: number) { return (!p || p === 0) ? 0 : (c - p) / p; }

  const routes = [...map.values()].map((a, i) => {
    const totalSpend     = a.metaSpend + a.googleSpend;
    const totalPurchases = a.metaPurchases + a.googlePurchases;
    const totalRevenue   = a.metaRevenue + a.googleRevenue;
    const cpa            = totalPurchases > 0 ? totalSpend / totalPurchases : 0;
    const roas           = totalSpend > 0 ? totalRevenue / totalSpend : 0;
    const prev           = prevMap.get(a.route);

    return {
      id: String(i + 1),
      route: a.route,
      spend:           totalSpend,
      spendDelta:      delta(totalSpend, prev?.spend ?? 0),
      purchases:       totalPurchases,
      purchasesDelta:  delta(totalPurchases, prev?.purchases ?? 0),
      revenue:         totalRevenue,
      revenueDelta:    delta(totalRevenue, prev?.revenue ?? 0),
      cpa,
      roas,
      // Mix de canal: % del spend que viene de cada plataforma
      channelMix: {
        meta:   totalSpend > 0 ? a.metaSpend / totalSpend : 0,
        google: totalSpend > 0 ? a.googleSpend / totalSpend : 0,
      },
      // Demanda orgánica/paid search: clicks de queries que mencionan esta ruta
      demand: {
        clicks:      a.demandClicks,
        impressions: a.demandImpressions,
      },
      sparkline: a.sparkline,
    };
  }).sort((x, y) => y.revenue - x.revenue);

  // ─── Top movers: mayores subidas y caídas (% revenue delta) ────────────────
  // Solo rutas con revenue significativo en alguno de los 2 períodos
  const movers = routes
    .filter(r => r.revenue > 0 || (prevMap.get(r.route)?.revenue ?? 0) > 0)
    .filter(r => Math.abs(r.revenueDelta) > 0.01);
  const topGainers = [...movers].sort((a, b) => b.revenueDelta - a.revenueDelta).slice(0, 5);
  const topLosers  = [...movers].sort((a, b) => a.revenueDelta - b.revenueDelta).slice(0, 5);

  // ─── Oportunidades: alta demanda (clicks) pero bajo spend ─────────────────
  // Score = demand normalizada / spend normalizada (rutas baratas con búsquedas).
  const maxDemand = Math.max(...routes.map(r => r.demand.clicks), 1);
  const maxSpend  = Math.max(...routes.map(r => r.spend), 1);
  const opportunities = routes
    .filter(r => r.demand.clicks > 0)
    .map(r => ({
      ...r,
      opportunityScore: (r.demand.clicks / maxDemand) - (r.spend / maxSpend),
    }))
    .filter(r => r.opportunityScore > 0)
    .sort((a, b) => b.opportunityScore - a.opportunityScore)
    .slice(0, 5);

  // ─── Histórico mensual por ruta (últimos 18 meses) ────────────────────────
  // Base para momentum y forecast. Solo meses CERRADOS (excluimos el mes en curso
  // para evitar ruido del mes incompleto).
  const monthlyRows = await sql`
    SELECT route,
           date_trunc('month', snapshot_date)::date AS month,
           SUM(spend)::numeric    AS spend,
           SUM(purchases)::bigint AS purchases,
           SUM(revenue)::numeric  AS revenue
    FROM (
      SELECT route, snapshot_date, spend, purchases, revenue FROM meta_ads_campaigns
      WHERE client_id = ${client.id}
        AND snapshot_date >= (CURRENT_DATE - INTERVAL '18 months')
        AND snapshot_date <  date_trunc('month', CURRENT_DATE)
        AND route IS NOT NULL
      UNION ALL
      SELECT route, snapshot_date, spend, carts AS purchases, revenue FROM google_ads_campaigns
      WHERE client_id = ${client.id}
        AND snapshot_date >= (CURRENT_DATE - INTERVAL '18 months')
        AND snapshot_date <  date_trunc('month', CURRENT_DATE)
        AND route IS NOT NULL
    ) AS combined
    GROUP BY route, date_trunc('month', snapshot_date)
    ORDER BY route, month
  `;

  // YoY apples-to-apples: mes en curso hasta HOY vs mismo período del año anterior.
  // Si hoy es 5/may, comparamos 1-5 may 2026 vs 1-5 may 2025 (NO mes completo vs parcial).
  const partialCurrentRows = await sql`
    SELECT route, SUM(spend)::numeric AS spend, SUM(revenue)::numeric AS revenue, SUM(purchases)::bigint AS purchases
    FROM (
      SELECT route, spend, purchases, revenue FROM meta_ads_campaigns
      WHERE client_id = ${client.id}
        AND snapshot_date >= date_trunc('month', CURRENT_DATE)
        AND snapshot_date <= CURRENT_DATE
        AND route IS NOT NULL
      UNION ALL
      SELECT route, spend, carts AS purchases, revenue FROM google_ads_campaigns
      WHERE client_id = ${client.id}
        AND snapshot_date >= date_trunc('month', CURRENT_DATE)
        AND snapshot_date <= CURRENT_DATE
        AND route IS NOT NULL
    ) AS combined
    GROUP BY route
  `;
  const partialYoyRows = await sql`
    SELECT route, SUM(spend)::numeric AS spend, SUM(revenue)::numeric AS revenue, SUM(purchases)::bigint AS purchases
    FROM (
      SELECT route, spend, purchases, revenue FROM meta_ads_campaigns
      WHERE client_id = ${client.id}
        AND snapshot_date >= (date_trunc('month', CURRENT_DATE) - INTERVAL '1 year')
        AND snapshot_date <= (CURRENT_DATE - INTERVAL '1 year')
        AND route IS NOT NULL
      UNION ALL
      SELECT route, spend, carts AS purchases, revenue FROM google_ads_campaigns
      WHERE client_id = ${client.id}
        AND snapshot_date >= (date_trunc('month', CURRENT_DATE) - INTERVAL '1 year')
        AND snapshot_date <= (CURRENT_DATE - INTERVAL '1 year')
        AND route IS NOT NULL
    ) AS combined
    GROUP BY route
  `;

  // Demanda histórica por mes (search terms) — solo meses cerrados también.
  const demandMonthlyRows = await sql`
    SELECT route,
           date_trunc('month', snapshot_date)::date AS month,
           SUM(clicks)::bigint AS clicks
    FROM google_ads_search_terms
    WHERE client_id = ${client.id}
      AND snapshot_date >= (CURRENT_DATE - INTERVAL '6 months')
      AND snapshot_date <  date_trunc('month', CURRENT_DATE)
      AND route IS NOT NULL
    GROUP BY route, date_trunc('month', snapshot_date)
    ORDER BY route, month
  `;

  const conclusions = buildConclusions(routes, monthlyRows, demandMonthlyRows, partialCurrentRows, partialYoyRows);

  return new Response(JSON.stringify({
    routes,
    topGainers,
    topLosers,
    opportunities,
    conclusions,
  }), { headers: corsHeaders() });
};

// ─── Generación de conclusiones estratégicas ────────────────────────────────
// Toma el agregado actual de rutas + histórico mensual y aplica reglas para
// generar narrativas accionables tipo "Mendoza está volando: +47% YoY".

type Conclusion = {
  id: string;
  category: 'yoy' | 'mom' | 'momentum' | 'forecast' | 'efficiency' | 'demand';
  severity: 'success' | 'warning' | 'info' | 'critical';
  route: string;
  headline: string;
  detail: string;
  recommendation: string;
  confidence: 'alta' | 'media' | 'baja';
  metric?: { label: string; value: string };
};

const MONTH_LABELS = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio',
                      'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];

function fmtCurrency(v: number): string {
  return '$' + Math.round(v).toLocaleString('es-AR');
}
function fmtPctSigned(v: number): string {
  return (v >= 0 ? '+' : '') + (v * 100).toFixed(0) + '%';
}
function fmtPctAbs(v: number): string {
  return Math.abs(v * 100).toFixed(0) + '%';
}

function buildConclusions(
  routes: any[],
  monthlyRows: any[],
  demandMonthlyRows: any[],
  partialCurrentRows: any[],
  partialYoyRows: any[],
): Conclusion[] {
  // Indexar el histórico mensual (solo meses CERRADOS)
  type MonthRow = { month: Date; spend: number; revenue: number; purchases: number; roas: number };
  const history = new Map<string, MonthRow[]>();
  for (const r of monthlyRows) {
    const route = r.route as string;
    const month = new Date(r.month);
    const spend = Number(r.spend);
    const revenue = Number(r.revenue);
    const purchases = Number(r.purchases);
    if (!history.has(route)) history.set(route, []);
    history.get(route)!.push({
      month, spend, revenue, purchases,
      roas: spend > 0 ? revenue / spend : 0,
    });
  }
  // YoY apples-to-apples: mismo número de días del mes actual vs año pasado
  const partialCurrent = new Map<string, { spend: number; revenue: number; purchases: number }>();
  const partialYoy = new Map<string, { spend: number; revenue: number; purchases: number }>();
  for (const r of partialCurrentRows) {
    partialCurrent.set(r.route, { spend: Number(r.spend), revenue: Number(r.revenue), purchases: Number(r.purchases) });
  }
  for (const r of partialYoyRows) {
    partialYoy.set(r.route, { spend: Number(r.spend), revenue: Number(r.revenue), purchases: Number(r.purchases) });
  }
  const demandHistory = new Map<string, { month: Date; clicks: number }[]>();
  for (const r of demandMonthlyRows) {
    const route = r.route as string;
    if (!demandHistory.has(route)) demandHistory.set(route, []);
    demandHistory.get(route)!.push({ month: new Date(r.month), clicks: Number(r.clicks) });
  }

  // Solo generamos conclusiones para rutas con relevancia económica:
  // spend > $5K en el período actual.
  const relevantRoutes = routes.filter(r => r.spend > 5000);

  const out: Conclusion[] = [];
  const today = new Date();
  const currentMonthStart = new Date(today.getFullYear(), today.getMonth(), 1);
  const dayOfMonth = today.getDate();
  const monthLabel = MONTH_LABELS[currentMonthStart.getMonth()];
  const prevYear = currentMonthStart.getFullYear() - 1;

  for (const route of relevantRoutes) {
    const hist = history.get(route.route) ?? [];

    // ─── 1. YoY apples-to-apples: 1-N del mes actual vs 1-N del mismo mes año pasado
    const cur = partialCurrent.get(route.route);
    const yoy = partialYoy.get(route.route);
    if (cur && yoy && yoy.revenue > 1000 && cur.spend > 0) {
      const revPct = (cur.revenue - yoy.revenue) / yoy.revenue;
      const spendPct = yoy.spend > 0 ? (cur.spend - yoy.spend) / yoy.spend : 0;
      if (Math.abs(revPct) >= 0.15) {
        const isGrowing = revPct > 0;
        const efficient = isGrowing && spendPct < revPct;
        out.push({
          id: `yoy-${route.route}`,
          category: 'yoy',
          severity: isGrowing ? 'success' : 'warning',
          route: route.route,
          headline: isGrowing
            ? `${route.route}: ${fmtPctSigned(revPct)} de revenue vs ${monthLabel} ${prevYear}`
            : `${route.route}: cae ${fmtPctAbs(revPct)} vs ${monthLabel} ${prevYear}`,
          detail: `En los primeros ${dayOfMonth} días de ${monthLabel} generó ${fmtCurrency(cur.revenue)}, contra ${fmtCurrency(yoy.revenue)} en el mismo período de ${prevYear}. La inversión fue ${fmtPctSigned(spendPct)}.`,
          recommendation: isGrowing
            ? (efficient
              ? `Vendés más con menos plata: vale la pena replicar lo que estás haciendo y considerar ampliar el budget.`
              : `Considerá mantener el presupuesto en ${route.route} mientras siga el crecimiento.`)
            : `Vale la pena revisar qué cambió respecto al año pasado: estacionalidad, competencia o creatives.`,
          confidence: 'alta',
          metric: { label: 'Revenue MTD', value: fmtCurrency(cur.revenue) },
        });
      }
    }

    // ─── 2. Momentum: 3+ meses CERRADOS consecutivos ────────────────────
    // hist solo tiene meses cerrados, así que tomar últimos 4 ya excluye el actual.
    if (hist.length >= 4) {
      const last4 = hist.slice(-4);
      let consecutiveUp = 0;
      let consecutiveDown = 0;
      for (let i = 1; i < last4.length; i++) {
        if (last4[i].revenue > last4[i - 1].revenue * 1.02) consecutiveUp++;
        else if (last4[i].revenue < last4[i - 1].revenue * 0.98) consecutiveDown++;
      }
      if (consecutiveUp >= 3) {
        const first = last4[0];
        const last = last4[last4.length - 1];
        const totalGrowth = (last.revenue - first.revenue) / first.revenue;
        out.push({
          id: `momentum-up-${route.route}`,
          category: 'momentum',
          severity: 'success',
          route: route.route,
          headline: `${route.route} crece 3 meses seguidos`,
          detail: `Revenue pasó de ${fmtCurrency(first.revenue)} a ${fmtCurrency(last.revenue)} (${fmtPctSigned(totalGrowth)}). ROAS evolucionó de ${first.roas.toFixed(1)}x a ${last.roas.toFixed(1)}x.`,
          recommendation: `Vale la pena considerar escalar budget en ${route.route} mientras el momentum se sostiene.`,
          confidence: 'alta',
        });
      } else if (consecutiveDown >= 3) {
        const first = last4[0];
        const last = last4[last4.length - 1];
        const totalDrop = (last.revenue - first.revenue) / first.revenue;
        out.push({
          id: `momentum-down-${route.route}`,
          category: 'momentum',
          severity: 'critical',
          route: route.route,
          headline: `${route.route} cae 3 meses seguidos`,
          detail: `Revenue pasó de ${fmtCurrency(first.revenue)} a ${fmtCurrency(last.revenue)} (${fmtPctSigned(totalDrop)}). ROAS bajó de ${first.roas.toFixed(1)}x a ${last.roas.toFixed(1)}x.`,
          recommendation: `Vale la pena revisar creatives, audiencia o pricing antes de seguir invirtiendo en ${route.route}.`,
          confidence: 'alta',
        });
      }
    }

    // ─── 3. Forecast: cómo se compara el mes que viene vs el actual ─────
    // Usamos el último mes CERRADO como base (no el actual incompleto que daría 0 o subestimaría).
    const lastClosedMonth = hist[hist.length - 1];
    if (lastClosedMonth && lastClosedMonth.revenue > 1000) {
      const nextMonthStart = addMonths(currentMonthStart, 1);
      const nextMonthLabel = MONTH_LABELS[nextMonthStart.getMonth()];
      const lastClosedLabel = MONTH_LABELS[lastClosedMonth.month.getMonth()];
      // Buscamos el mismo mes próximo del año pasado y el mismo mes cerrado del año pasado
      const nextYoy = hist.find(h => sameMonth(h.month, addMonths(nextMonthStart, -12)));
      const lastYoy = hist.find(h => sameMonth(h.month, addMonths(lastClosedMonth.month, -12)));
      if (nextYoy && lastYoy && lastYoy.revenue > 1000) {
        const yoyRatio = (nextYoy.revenue - lastYoy.revenue) / lastYoy.revenue;
        if (Math.abs(yoyRatio) >= 0.10) {
          const projection = lastClosedMonth.revenue * (1 + yoyRatio);
          const better = yoyRatio > 0;
          const nextMonthCap = nextMonthLabel.charAt(0).toUpperCase() + nextMonthLabel.slice(1);
          out.push({
            id: `forecast-${route.route}`,
            category: 'forecast',
            severity: 'info',
            route: route.route,
            headline: `${nextMonthCap} suele ser ${better ? 'mejor' : 'peor'} para ${route.route}`,
            detail: `El año pasado ${nextMonthLabel} generó ${fmtPctAbs(yoyRatio)} ${better ? 'más' : 'menos'} que ${lastClosedLabel}. Si el patrón se repite, esperate cerca de ${fmtCurrency(projection)} de revenue.`,
            recommendation: better
              ? `Vale la pena tener creatives listos y considerar anticipar parte del budget para no perder el upside.`
              : `Considerá mantener inversión moderada en ${route.route} y reasignar a rutas con mejor ratio en ${nextMonthLabel}.`,
            confidence: 'media',  // 1 año de muestra
          });
        }
      }
    }
  }

  // ─── 4. Eficiencia comparativa: solo si la peor está significativamente abajo del promedio ─
  // En Andesmar muchas rutas tienen ROAS 20x+, no tiene sentido pelear entre 67x y 22x.
  // Solo flageamos cuando hay rutas claramente subóptimas vs el promedio del top.
  const topByRevenue = [...relevantRoutes].sort((a, b) => b.revenue - a.revenue).slice(0, 5);
  if (topByRevenue.length >= 3) {
    const sortedByRoas = [...topByRevenue].sort((a, b) => b.roas - a.roas);
    const best = sortedByRoas[0];
    const worst = sortedByRoas[sortedByRoas.length - 1];
    const avgRoas = sortedByRoas.reduce((s, r) => s + r.roas, 0) / sortedByRoas.length;
    // Reportar solo si el peor está al menos 40% debajo del promedio del top
    if (best.roas > 0 && worst.roas > 0 && worst.roas < avgRoas * 0.6) {
      const gap = (best.roas - worst.roas) / worst.roas;
      out.push({
        id: `efficiency-${best.route}-vs-${worst.route}`,
        category: 'efficiency',
        severity: 'info',
        route: best.route,
        headline: `${worst.route} rinde menos que el promedio del top`,
        detail: `Entre las rutas top, ${best.route} devuelve $${best.roas.toFixed(2)} por cada $1, mientras ${worst.route} solo devuelve $${worst.roas.toFixed(2)}. Diferencia de ${fmtPctAbs(gap)}.`,
        recommendation: `Vale la pena evaluar si conviene reasignar parte del budget de ${worst.route} hacia ${best.route}, o revisar qué está limitando la performance de ${worst.route}.`,
        confidence: 'alta',
      });
    }
  }

  // ─── 5. Oportunidades de demanda: clicks subiendo + spend bajando ──────
  const currentMonthDate = currentMonthStart;
  const prevMonthDate = addMonths(currentMonthStart, -1);
  for (const route of relevantRoutes) {
    const dh = demandHistory.get(route.route) ?? [];
    const cur = dh.find(d => sameMonth(d.month, currentMonthDate));
    const prev = dh.find(d => sameMonth(d.month, prevMonthDate));
    if (cur && prev && prev.clicks > 50) {
      const clicksDelta = (cur.clicks - prev.clicks) / prev.clicks;
      if (clicksDelta >= 0.30 && route.spendDelta <= 0.05) {
        // Demanda crece +30% pero spend se mantiene/baja → oportunidad
        out.push({
          id: `demand-${route.route}`,
          category: 'demand',
          severity: 'info',
          route: route.route,
          headline: `Crece la demanda de ${route.route} pero la inversión no acompaña`,
          detail: `La gente busca ${route.route} ${fmtPctSigned(clicksDelta)} más este mes (${cur.clicks} clicks vs ${prev.clicks} el anterior), pero la inversión se mantuvo casi igual.`,
          recommendation: `Vale la pena considerar subir budget en ${route.route} para capturar la demanda creciente antes que la competencia.`,
          confidence: 'media',
        });
      }
    }
  }

  // Orden final: críticas/warnings primero, después success, después info
  const severityRank: Record<Conclusion['severity'], number> = {
    critical: 0, warning: 1, success: 2, info: 3,
  };
  out.sort((a, b) => severityRank[a.severity] - severityRank[b.severity]);

  // Cap a 8 conclusiones para no saturar
  return out.slice(0, 8);
}

function sameMonth(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth();
}
function addMonths(d: Date, months: number): Date {
  const r = new Date(d);
  r.setMonth(r.getMonth() + months);
  return r;
}
