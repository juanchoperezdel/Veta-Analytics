import type { Context } from '@netlify/functions';
import { sql, corsHeaders, errorResponse } from './_db';
import { verifyToken, authorizeSlug, unauthorizedResponse } from './_auth';

// "Pulso" del negocio: semáforos + alertas + oportunidades, todo calculado
// con SQL sobre tablas existentes (no requiere data nueva).
//
// Devuelve:
//   summary:      { spend, revenue, roas, cpa } current vs prev (mes vs mes anterior)
//   health:       [{ label, value, status: 'green'|'amber'|'red', detail }]
//   alerts:       [{ severity, title, detail, metric }] — cosas que requieren atención
//   wins:         [{ title, detail, metric }] — cosas funcionando bien para escalar

export default async (req: Request, _context: Context) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: corsHeaders() });

  const user = await verifyToken(req);
  if (!user) return unauthorizedResponse();

  const slug = new URL(req.url).searchParams.get('slug');
  if (!slug) return errorResponse('Missing slug', 400);
  if (!(await authorizeSlug(user.userId, slug))) return unauthorizedResponse();

  const [client] = await sql`SELECT id FROM clients WHERE slug = ${slug}`;
  if (!client) return errorResponse('Client not found', 404);

  // Período: mes actual hasta hoy
  // Período comparable: mismo rango del mes anterior
  // ─── Resumen del mes (mes actual vs mes anterior) ──────────────────────────
  const [curr] = await sql`
    SELECT
      COALESCE(SUM(spend), 0)::numeric    AS spend,
      COALESCE(SUM(revenue), 0)::numeric  AS revenue,
      COALESCE(SUM(purchases), 0)::bigint AS purchases
    FROM (
      SELECT spend, revenue, purchases FROM meta_ads_campaigns
      WHERE client_id = ${client.id} AND snapshot_date >= DATE_TRUNC('month', CURRENT_DATE)
      UNION ALL
      SELECT spend, revenue, carts AS purchases FROM google_ads_campaigns
      WHERE client_id = ${client.id} AND snapshot_date >= DATE_TRUNC('month', CURRENT_DATE)
    ) AS combined
  `;
  const [prev] = await sql`
    SELECT
      COALESCE(SUM(spend), 0)::numeric    AS spend,
      COALESCE(SUM(revenue), 0)::numeric  AS revenue,
      COALESCE(SUM(purchases), 0)::bigint AS purchases
    FROM (
      SELECT spend, revenue, purchases FROM meta_ads_campaigns
      WHERE client_id = ${client.id}
        AND snapshot_date >= DATE_TRUNC('month', CURRENT_DATE - INTERVAL '1 month')
        AND snapshot_date <= (CURRENT_DATE - INTERVAL '1 month')
      UNION ALL
      SELECT spend, revenue, carts AS purchases FROM google_ads_campaigns
      WHERE client_id = ${client.id}
        AND snapshot_date >= DATE_TRUNC('month', CURRENT_DATE - INTERVAL '1 month')
        AND snapshot_date <= (CURRENT_DATE - INTERVAL '1 month')
    ) AS combined
  `;

  function delta(c: number, p: number) { return (!p || p === 0) ? 0 : (c - p) / p; }

  const cSpend = Number(curr?.spend ?? 0);
  const cRev   = Number(curr?.revenue ?? 0);
  const cPurch = Number(curr?.purchases ?? 0);
  const pSpend = Number(prev?.spend ?? 0);
  const pRev   = Number(prev?.revenue ?? 0);
  const pPurch = Number(prev?.purchases ?? 0);

  const cRoas = cSpend > 0 ? cRev / cSpend : 0;
  const pRoas = pSpend > 0 ? pRev / pSpend : 0;
  const cCpa  = cPurch > 0 ? cSpend / cPurch : 0;
  const pCpa  = pPurch > 0 ? pSpend / pPurch : 0;

  const summary = {
    spend:    { value: cSpend, delta: delta(cSpend, pSpend) },
    revenue:  { value: cRev,   delta: delta(cRev,   pRev)   },
    purchases:{ value: cPurch, delta: delta(cPurch, pPurch) },
    roas:     { value: cRoas,  delta: delta(cRoas,  pRoas)  },
    cpa:      { value: cCpa,   delta: delta(cCpa,   pCpa)   },
  };

  // ─── Health semáforos ──────────────────────────────────────────────────────
  // Reglas: ROAS verde >= 3, ámbar 1.5-3, rojo < 1.5
  //         CPA inverso del delta — si subió >20%, rojo
  //         Tendencia revenue 7d: comparar últimos 7 vs 7 anteriores
  function status(v: number, green: number, amber: number): 'green' | 'amber' | 'red' {
    if (v >= green) return 'green';
    if (v >= amber) return 'amber';
    return 'red';
  }

  const [last7, prev7] = await Promise.all([
    sql`
      SELECT COALESCE(SUM(revenue), 0)::numeric AS revenue
      FROM (
        SELECT revenue FROM meta_ads_campaigns
        WHERE client_id = ${client.id} AND snapshot_date >= CURRENT_DATE - 6
        UNION ALL
        SELECT revenue FROM google_ads_campaigns
        WHERE client_id = ${client.id} AND snapshot_date >= CURRENT_DATE - 6
      ) AS x
    `,
    sql`
      SELECT COALESCE(SUM(revenue), 0)::numeric AS revenue
      FROM (
        SELECT revenue FROM meta_ads_campaigns
        WHERE client_id = ${client.id}
          AND snapshot_date BETWEEN CURRENT_DATE - 13 AND CURRENT_DATE - 7
        UNION ALL
        SELECT revenue FROM google_ads_campaigns
        WHERE client_id = ${client.id}
          AND snapshot_date BETWEEN CURRENT_DATE - 13 AND CURRENT_DATE - 7
      ) AS x
    `,
  ]);
  const last7Rev = Number(last7[0]?.revenue ?? 0);
  const prev7Rev = Number(prev7[0]?.revenue ?? 0);
  const trend7d  = delta(last7Rev, prev7Rev);

  const health = [
    {
      label: 'ROAS del mes',
      value: cRoas.toFixed(2) + 'x',
      status: status(cRoas, 3, 1.5),
      detail: `vs ${pRoas.toFixed(2)}x mes pasado`,
    },
    {
      label: 'CPA del mes',
      value: cCpa.toFixed(0),
      status: cCpa <= pCpa * 1.1 ? 'green' : cCpa <= pCpa * 1.3 ? 'amber' : 'red',
      detail: `vs ${pCpa.toFixed(0)} mes pasado`,
    } as const,
    {
      label: 'Tendencia revenue 7d',
      value: (trend7d >= 0 ? '+' : '') + (trend7d * 100).toFixed(1) + '%',
      status: status(trend7d, 0.05, -0.1),
      detail: 'vs 7 días anteriores',
    },
    {
      label: 'Volumen del mes',
      value: cPurch.toLocaleString('es-AR'),
      status: status(summary.purchases.delta, 0, -0.15),
      detail: `${(summary.purchases.delta * 100).toFixed(0)}% vs mes pasado`,
    },
  ];

  // ─── Alertas: cosas que requieren atención ────────────────────────────────
  type Alert = { severity: 'critical' | 'warning'; title: string; detail: string };
  const alerts: Alert[] = [];

  // 1. CPA spike por canal
  if (cCpa > pCpa * 1.3 && pCpa > 0 && cPurch > 0) {
    alerts.push({
      severity: 'critical',
      title: `CPA subió ${((cCpa / pCpa - 1) * 100).toFixed(0)}% este mes`,
      detail: `Pasó de $${pCpa.toFixed(0)} a $${cCpa.toFixed(0)}. Revisá creatives o públicos.`,
    });
  }

  // 2. Caída de revenue 7d
  if (trend7d < -0.15 && prev7Rev > 0) {
    alerts.push({
      severity: 'critical',
      title: `Revenue cayó ${(Math.abs(trend7d) * 100).toFixed(0)}% en últimos 7 días`,
      detail: `Comparado a la semana anterior. Investigá qué cambió.`,
    });
  }

  // 3. Campañas Meta sin conversiones en últimos 7 días con spend significativo
  const metaSilent = await sql`
    SELECT segment AS name,
           COALESCE(SUM(spend), 0)::numeric AS spend,
           COALESCE(SUM(purchases), 0)::bigint AS purchases
    FROM meta_ads_campaigns
    WHERE client_id = ${client.id}
      AND snapshot_date >= CURRENT_DATE - 7
      AND type IN ('OUTCOME_SALES', 'CONVERSIONS', 'PRODUCT_CATALOG_SALES')
    GROUP BY segment
    HAVING COALESCE(SUM(purchases), 0) = 0
       AND COALESCE(SUM(spend), 0) > 5000
    ORDER BY SUM(spend) DESC
    LIMIT 3
  `;
  for (const c of metaSilent) {
    alerts.push({
      severity: 'warning',
      title: `Meta: "${c.name}" gastó $${Number(c.spend).toFixed(0)} en 7d sin conversiones`,
      detail: 'Pausá o revisá targeting/creatives.',
    });
  }

  // 4. Rutas con caída fuerte (>25%)
  const routeDrops = await sql`
    WITH curr AS (
      SELECT route, SUM(revenue) AS revenue, SUM(spend) AS spend FROM (
        SELECT route, revenue, spend FROM meta_ads_campaigns
        WHERE client_id = ${client.id} AND snapshot_date >= DATE_TRUNC('month', CURRENT_DATE)
          AND route IS NOT NULL
        UNION ALL
        SELECT route, revenue, spend FROM google_ads_campaigns
        WHERE client_id = ${client.id} AND snapshot_date >= DATE_TRUNC('month', CURRENT_DATE)
          AND route IS NOT NULL
      ) x GROUP BY route
    ),
    prev AS (
      SELECT route, SUM(revenue) AS revenue FROM (
        SELECT route, revenue FROM meta_ads_campaigns
        WHERE client_id = ${client.id}
          AND snapshot_date >= DATE_TRUNC('month', CURRENT_DATE - INTERVAL '1 month')
          AND snapshot_date <= (CURRENT_DATE - INTERVAL '1 month')
          AND route IS NOT NULL
        UNION ALL
        SELECT route, revenue FROM google_ads_campaigns
        WHERE client_id = ${client.id}
          AND snapshot_date >= DATE_TRUNC('month', CURRENT_DATE - INTERVAL '1 month')
          AND snapshot_date <= (CURRENT_DATE - INTERVAL '1 month')
          AND route IS NOT NULL
      ) x GROUP BY route
    )
    SELECT c.route, c.revenue::numeric AS curr_rev, p.revenue::numeric AS prev_rev,
           c.spend::numeric AS curr_spend
    FROM curr c JOIN prev p USING (route)
    WHERE p.revenue > 10000
      AND (c.revenue - p.revenue) / p.revenue < -0.25
    ORDER BY (c.revenue - p.revenue) / p.revenue ASC
    LIMIT 3
  `;
  for (const r of routeDrops) {
    const pct = ((Number(r.curr_rev) - Number(r.prev_rev)) / Number(r.prev_rev) * 100).toFixed(0);
    alerts.push({
      severity: 'warning',
      title: `Ruta "${r.route}" cayó ${pct}%`,
      detail: `Revenue $${Number(r.curr_rev).toFixed(0)} (vs $${Number(r.prev_rev).toFixed(0)} mes pasado)`,
    });
  }

  // ─── Wins: cosas funcionando bien ─────────────────────────────────────────
  type Win = { title: string; detail: string };
  const wins: Win[] = [];

  // 1. Top campaña Meta con ROAS > 3
  const metaWinners = await sql`
    SELECT segment AS name,
           SUM(spend)::numeric    AS spend,
           SUM(revenue)::numeric  AS revenue,
           SUM(revenue) / NULLIF(SUM(spend), 0) AS roas
    FROM meta_ads_campaigns
    WHERE client_id = ${client.id}
      AND snapshot_date >= CURRENT_DATE - 14
      AND type IN ('OUTCOME_SALES', 'CONVERSIONS')
    GROUP BY segment
    HAVING SUM(spend) > 10000
       AND SUM(revenue) / NULLIF(SUM(spend), 0) > 3
    ORDER BY SUM(revenue) / NULLIF(SUM(spend), 0) DESC
    LIMIT 3
  `;
  for (const w of metaWinners) {
    wins.push({
      title: `Meta: "${w.name}" ROAS ${Number(w.roas).toFixed(1)}x`,
      detail: `Gasto $${Number(w.spend).toFixed(0)} → Revenue $${Number(w.revenue).toFixed(0)} en últimos 14 días. Considerá escalar budget.`,
    });
  }

  // 2. Top campaña Google con ROAS > 4
  const googleWinners = await sql`
    SELECT name,
           SUM(spend)::numeric    AS spend,
           SUM(revenue)::numeric  AS revenue,
           SUM(revenue) / NULLIF(SUM(spend), 0) AS roas
    FROM google_ads_campaigns
    WHERE client_id = ${client.id}
      AND snapshot_date >= CURRENT_DATE - 14
    GROUP BY name
    HAVING SUM(spend) > 10000
       AND SUM(revenue) / NULLIF(SUM(spend), 0) > 4
    ORDER BY SUM(revenue) / NULLIF(SUM(spend), 0) DESC
    LIMIT 3
  `;
  for (const w of googleWinners) {
    wins.push({
      title: `Google: "${w.name}" ROAS ${Number(w.roas).toFixed(1)}x`,
      detail: `Gasto $${Number(w.spend).toFixed(0)} → Revenue $${Number(w.revenue).toFixed(0)} en últimos 14 días.`,
    });
  }

  // 3. Rutas en crecimiento fuerte
  const routeGains = await sql`
    WITH curr AS (
      SELECT route, SUM(revenue) AS revenue FROM (
        SELECT route, revenue FROM meta_ads_campaigns
        WHERE client_id = ${client.id} AND snapshot_date >= DATE_TRUNC('month', CURRENT_DATE)
          AND route IS NOT NULL
        UNION ALL
        SELECT route, revenue FROM google_ads_campaigns
        WHERE client_id = ${client.id} AND snapshot_date >= DATE_TRUNC('month', CURRENT_DATE)
          AND route IS NOT NULL
      ) x GROUP BY route
    ),
    prev AS (
      SELECT route, SUM(revenue) AS revenue FROM (
        SELECT route, revenue FROM meta_ads_campaigns
        WHERE client_id = ${client.id}
          AND snapshot_date >= DATE_TRUNC('month', CURRENT_DATE - INTERVAL '1 month')
          AND snapshot_date <= (CURRENT_DATE - INTERVAL '1 month')
          AND route IS NOT NULL
        UNION ALL
        SELECT route, revenue FROM google_ads_campaigns
        WHERE client_id = ${client.id}
          AND snapshot_date >= DATE_TRUNC('month', CURRENT_DATE - INTERVAL '1 month')
          AND snapshot_date <= (CURRENT_DATE - INTERVAL '1 month')
          AND route IS NOT NULL
      ) x GROUP BY route
    )
    SELECT c.route, c.revenue::numeric AS curr_rev, p.revenue::numeric AS prev_rev
    FROM curr c JOIN prev p USING (route)
    WHERE p.revenue > 10000
      AND (c.revenue - p.revenue) / p.revenue > 0.30
    ORDER BY (c.revenue - p.revenue) / p.revenue DESC
    LIMIT 2
  `;
  for (const r of routeGains) {
    const pct = ((Number(r.curr_rev) - Number(r.prev_rev)) / Number(r.prev_rev) * 100).toFixed(0);
    wins.push({
      title: `Ruta "${r.route}" creció +${pct}%`,
      detail: `Revenue $${Number(r.curr_rev).toFixed(0)} este mes. Considerá invertir más.`,
    });
  }

  // ─── Detección de anomalías ───────────────────────────────────────────────
  // Comparamos KPIs de hoy vs banda histórica de los últimos 30 días.
  // Si hoy > +2σ o < -2σ, lo flageamos como anomalía.
  const dailyHistory = await sql`
    SELECT snapshot_date::text AS date,
           COALESCE(SUM(spend), 0)::numeric    AS spend,
           COALESCE(SUM(revenue), 0)::numeric  AS revenue,
           COALESCE(SUM(purchases), 0)::bigint AS purchases
    FROM (
      SELECT snapshot_date, spend, revenue, purchases FROM meta_ads_campaigns
      WHERE client_id = ${client.id} AND snapshot_date >= CURRENT_DATE - 30
      UNION ALL
      SELECT snapshot_date, spend, revenue, carts AS purchases FROM google_ads_campaigns
      WHERE client_id = ${client.id} AND snapshot_date >= CURRENT_DATE - 30
    ) AS x
    GROUP BY snapshot_date
    ORDER BY snapshot_date
  `;

  function zScoreAnomaly(values: number[], current: number, label: string, unit: string): { metric: string; today: number; mean: number; sigma: number; z: number } | null {
    if (values.length < 7) return null;  // necesitamos al menos 1 semana
    const mean  = values.reduce((a, b) => a + b, 0) / values.length;
    const variance = values.reduce((a, b) => a + (b - mean) ** 2, 0) / values.length;
    const sigma = Math.sqrt(variance);
    if (sigma < 0.01) return null;  // sin variabilidad, no aplicamos z-score
    const z = (current - mean) / sigma;
    if (Math.abs(z) < 2) return null;
    return { metric: label + (unit ? ` (${unit})` : ''), today: current, mean, sigma, z };
  }

  const histRows = dailyHistory.slice(0, -1);  // excluimos hoy de la banda
  const todayRow = dailyHistory[dailyHistory.length - 1];
  const anomalies: any[] = [];
  if (todayRow && histRows.length > 7) {
    const histSpend     = histRows.map((r: any) => Number(r.spend));
    const histRev       = histRows.map((r: any) => Number(r.revenue));
    const histPurch     = histRows.map((r: any) => Number(r.purchases));
    const todaySpend    = Number(todayRow.spend);
    const todayRev      = Number(todayRow.revenue);
    const todayPurch    = Number(todayRow.purchases);

    const checks = [
      zScoreAnomaly(histSpend, todaySpend, 'Inversión hoy', 'ARS'),
      zScoreAnomaly(histRev,   todayRev,   'Revenue hoy', 'ARS'),
      zScoreAnomaly(histPurch, todayPurch, 'Compras hoy', ''),
    ].filter(x => x !== null);

    for (const a of checks as any[]) {
      const direction = a.z > 0 ? 'ALTA' : 'BAJA';
      const severity: 'critical' | 'warning' = Math.abs(a.z) > 3 ? 'critical' : 'warning';
      anomalies.push({
        severity,
        title: `Anomalía ${direction}: ${a.metric}`,
        detail: `Hoy ${a.today.toLocaleString('es-AR', { maximumFractionDigits: 0 })}, promedio últimos 30d ${a.mean.toLocaleString('es-AR', { maximumFractionDigits: 0 })} (z=${a.z.toFixed(1)}σ).`,
      });
    }
  }
  // Sumamos las anomalías a la lista de alerts (al principio, son más urgentes)
  alerts.unshift(...anomalies);

  // ─── Forecast del mes ─────────────────────────────────────────────────────
  // Proyección lineal: si llevamos X días del mes con $Y gastado/revenue,
  // proyectamos el total a fin de mes asumiendo el mismo pace diario.
  const today = new Date();
  const dayOfMonth = today.getDate();
  const lastDayOfMonth = new Date(today.getFullYear(), today.getMonth() + 1, 0).getDate();

  const projectedSpend   = dayOfMonth > 0 ? (cSpend   / dayOfMonth) * lastDayOfMonth : cSpend;
  const projectedRevenue = dayOfMonth > 0 ? (cRev     / dayOfMonth) * lastDayOfMonth : cRev;
  const projectedPurch   = dayOfMonth > 0 ? (cPurch   / dayOfMonth) * lastDayOfMonth : cPurch;

  // Mes anterior completo (para comparación de la proyección)
  const [prevMonthFull] = await sql`
    SELECT
      COALESCE(SUM(spend), 0)::numeric    AS spend,
      COALESCE(SUM(revenue), 0)::numeric  AS revenue,
      COALESCE(SUM(purchases), 0)::bigint AS purchases
    FROM (
      SELECT spend, revenue, purchases FROM meta_ads_campaigns
      WHERE client_id = ${client.id}
        AND snapshot_date >= DATE_TRUNC('month', CURRENT_DATE - INTERVAL '1 month')
        AND snapshot_date <  DATE_TRUNC('month', CURRENT_DATE)
      UNION ALL
      SELECT spend, revenue, carts AS purchases FROM google_ads_campaigns
      WHERE client_id = ${client.id}
        AND snapshot_date >= DATE_TRUNC('month', CURRENT_DATE - INTERVAL '1 month')
        AND snapshot_date <  DATE_TRUNC('month', CURRENT_DATE)
    ) AS combined
  `;
  const pmRev   = Number(prevMonthFull?.revenue ?? 0);
  const pmSpend = Number(prevMonthFull?.spend ?? 0);
  const pmPurch = Number(prevMonthFull?.purchases ?? 0);

  const forecast = {
    daysIn: dayOfMonth,
    daysTotal: lastDayOfMonth,
    progress: dayOfMonth / lastDayOfMonth,
    spend:     { projected: projectedSpend,   prevMonth: pmSpend, delta: delta(projectedSpend, pmSpend) },
    revenue:   { projected: projectedRevenue, prevMonth: pmRev,   delta: delta(projectedRevenue, pmRev) },
    purchases: { projected: Math.round(projectedPurch), prevMonth: pmPurch, delta: delta(projectedPurch, pmPurch) },
  };

  // ─── Pacing presupuestario ────────────────────────────────────────────────
  // Si hay un budget cargado para el mes en curso, devolvemos el pacing.
  const [budgetRow] = await sql`
    SELECT planned_spend::numeric AS planned_spend
    FROM client_budgets
    WHERE client_id = ${client.id}
      AND month = DATE_TRUNC('month', CURRENT_DATE)::date
  `;
  let pacing: any = null;
  if (budgetRow) {
    const planned = Number(budgetRow.planned_spend);
    const monthProgress = dayOfMonth / lastDayOfMonth;     // % del mes transcurrido
    const spendProgress = planned > 0 ? cSpend / planned : 0;  // % del budget gastado
    const onTrackBand = 0.05;                              // ±5% considerado "on track"
    let status: 'on_track' | 'over' | 'under';
    if (spendProgress > monthProgress + onTrackBand) status = 'over';
    else if (spendProgress < monthProgress - onTrackBand) status = 'under';
    else status = 'on_track';

    pacing = {
      planned,
      spent: cSpend,
      monthProgress,
      spendProgress,
      status,
      // Proyección: a este pace, cuánto va a gastar a fin de mes
      projectedSpend: dayOfMonth > 0 ? (cSpend / dayOfMonth) * lastDayOfMonth : 0,
      projectedDelta: planned > 0 && dayOfMonth > 0 ? ((cSpend / dayOfMonth) * lastDayOfMonth - planned) / planned : 0,
    };
  }

  return new Response(JSON.stringify({ summary, health, alerts, wins, forecast, pacing }), { headers: corsHeaders() });
};
