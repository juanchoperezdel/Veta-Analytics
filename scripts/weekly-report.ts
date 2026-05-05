// Resumen ejecutivo semanal por email — corre cada lunes 9am AR (12pm UTC)
// vía GitHub Actions cron. Manda un email por cliente a los users autorizados.
//
// Requiere variables de entorno:
//   RESEND_API_KEY    — API key de resend.com
//   REPORT_FROM_EMAIL — remitente (ej: "Veta Analytics <reports@tu-dominio.com>")

import { neon } from '@neondatabase/serverless';
import { buildRouteConclusions, type Conclusion } from '../netlify/functions/_conclusions';
const sql = neon(process.env.DATABASE_URL!);

const RESEND_API_KEY    = process.env.RESEND_API_KEY;
const REPORT_FROM_EMAIL = process.env.REPORT_FROM_EMAIL ?? 'Veta Analytics <onboarding@resend.dev>';

if (!RESEND_API_KEY) {
  console.error('✗ RESEND_API_KEY no configurada — saltando weekly report.');
  process.exit(0);  // exit 0 para que el GH Action no quede en rojo si simplemente no hay key
}

type Summary = {
  spend: number; revenue: number; purchases: number; roas: number; cpa: number;
  prevSpend: number; prevRevenue: number; prevPurchases: number;
};

async function buildSummary(clientId: string): Promise<Summary> {
  const [curr] = await sql`
    SELECT COALESCE(SUM(spend), 0)::numeric AS spend,
           COALESCE(SUM(revenue), 0)::numeric AS revenue,
           COALESCE(SUM(purchases), 0)::bigint AS purchases
    FROM (
      SELECT spend, revenue, purchases FROM meta_ads_campaigns
      WHERE client_id = ${clientId} AND snapshot_date >= CURRENT_DATE - 7
      UNION ALL
      SELECT spend, revenue, carts AS purchases FROM google_ads_campaigns
      WHERE client_id = ${clientId} AND snapshot_date >= CURRENT_DATE - 7
    ) AS x
  `;
  const [prev] = await sql`
    SELECT COALESCE(SUM(spend), 0)::numeric AS spend,
           COALESCE(SUM(revenue), 0)::numeric AS revenue,
           COALESCE(SUM(purchases), 0)::bigint AS purchases
    FROM (
      SELECT spend, revenue, purchases FROM meta_ads_campaigns
      WHERE client_id = ${clientId}
        AND snapshot_date BETWEEN CURRENT_DATE - 14 AND CURRENT_DATE - 8
      UNION ALL
      SELECT spend, revenue, carts AS purchases FROM google_ads_campaigns
      WHERE client_id = ${clientId}
        AND snapshot_date BETWEEN CURRENT_DATE - 14 AND CURRENT_DATE - 8
    ) AS x
  `;
  const spend = Number(curr?.spend ?? 0);
  const revenue = Number(curr?.revenue ?? 0);
  const purchases = Number(curr?.purchases ?? 0);
  return {
    spend, revenue, purchases,
    roas: spend > 0 ? revenue / spend : 0,
    cpa: purchases > 0 ? spend / purchases : 0,
    prevSpend: Number(prev?.spend ?? 0),
    prevRevenue: Number(prev?.revenue ?? 0),
    prevPurchases: Number(prev?.purchases ?? 0),
  };
}

async function topGainers(clientId: string): Promise<{ route: string; growth: number; revenue: number }[]> {
  const rows = await sql`
    WITH curr AS (
      SELECT route, SUM(revenue)::numeric AS revenue
      FROM (
        SELECT route, revenue FROM meta_ads_campaigns
        WHERE client_id = ${clientId} AND snapshot_date >= CURRENT_DATE - 7 AND route IS NOT NULL
        UNION ALL
        SELECT route, revenue FROM google_ads_campaigns
        WHERE client_id = ${clientId} AND snapshot_date >= CURRENT_DATE - 7 AND route IS NOT NULL
      ) x GROUP BY route
    ),
    prev AS (
      SELECT route, SUM(revenue)::numeric AS revenue
      FROM (
        SELECT route, revenue FROM meta_ads_campaigns
        WHERE client_id = ${clientId}
          AND snapshot_date BETWEEN CURRENT_DATE - 14 AND CURRENT_DATE - 8 AND route IS NOT NULL
        UNION ALL
        SELECT route, revenue FROM google_ads_campaigns
        WHERE client_id = ${clientId}
          AND snapshot_date BETWEEN CURRENT_DATE - 14 AND CURRENT_DATE - 8 AND route IS NOT NULL
      ) x GROUP BY route
    )
    SELECT c.route, c.revenue::numeric AS curr_rev, p.revenue::numeric AS prev_rev
    FROM curr c JOIN prev p USING (route)
    WHERE p.revenue > 5000
    ORDER BY (c.revenue - p.revenue) / NULLIF(p.revenue, 0) DESC
    LIMIT 3
  `;
  return rows.map((r: any) => ({
    route: r.route,
    revenue: Number(r.curr_rev),
    growth: (Number(r.curr_rev) - Number(r.prev_rev)) / Number(r.prev_rev),
  }));
}

async function fetchRouteConclusions(clientId: string): Promise<Conclusion[]> {
  // Replicamos las queries de products.ts pero las llamamos desde el script.
  // Reusamos buildRouteConclusions para que la narrativa sea idéntica al dashboard.
  const startDate = '__start__';  // no se usa, las queries usan CURRENT_DATE
  // Routes agregadas últimos 30 días (similar a /products con default range)
  const metaRows = await sql`
    SELECT route, SUM(spend)::numeric AS spend, SUM(purchases)::bigint AS purchases, SUM(revenue)::numeric AS revenue
    FROM meta_ads_campaigns
    WHERE client_id = ${clientId}
      AND snapshot_date >= CURRENT_DATE - 29 AND route IS NOT NULL
    GROUP BY route
  `;
  const googleRows = await sql`
    SELECT route, SUM(spend)::numeric AS spend, SUM(carts)::bigint AS purchases, SUM(revenue)::numeric AS revenue
    FROM google_ads_campaigns
    WHERE client_id = ${clientId}
      AND snapshot_date >= CURRENT_DATE - 29 AND route IS NOT NULL
    GROUP BY route
  `;
  // Combinar
  const routesMap = new Map<string, any>();
  for (const r of metaRows)   { const e = routesMap.get(r.route) ?? { route: r.route, spend: 0, revenue: 0, purchases: 0, spendDelta: 0 }; e.spend += Number(r.spend); e.revenue += Number(r.revenue); e.purchases += Number(r.purchases); routesMap.set(r.route, e); }
  for (const r of googleRows) { const e = routesMap.get(r.route) ?? { route: r.route, spend: 0, revenue: 0, purchases: 0, spendDelta: 0 }; e.spend += Number(r.spend); e.revenue += Number(r.revenue); e.purchases += Number(r.purchases); routesMap.set(r.route, e); }
  const routes = [...routesMap.values()].map(r => ({ ...r, roas: r.spend > 0 ? r.revenue / r.spend : 0 }));

  const monthlyRows = await sql`
    SELECT route, date_trunc('month', snapshot_date)::date AS month,
           SUM(spend)::numeric AS spend, SUM(purchases)::bigint AS purchases, SUM(revenue)::numeric AS revenue
    FROM (
      SELECT route, snapshot_date, spend, purchases, revenue FROM meta_ads_campaigns
      WHERE client_id = ${clientId} AND snapshot_date >= (CURRENT_DATE - INTERVAL '18 months')
        AND snapshot_date < date_trunc('month', CURRENT_DATE) AND route IS NOT NULL
      UNION ALL
      SELECT route, snapshot_date, spend, carts AS purchases, revenue FROM google_ads_campaigns
      WHERE client_id = ${clientId} AND snapshot_date >= (CURRENT_DATE - INTERVAL '18 months')
        AND snapshot_date < date_trunc('month', CURRENT_DATE) AND route IS NOT NULL
    ) AS combined GROUP BY route, date_trunc('month', snapshot_date) ORDER BY route, month
  `;
  const partialCurrentRows = await sql`
    SELECT route, SUM(spend)::numeric AS spend, SUM(revenue)::numeric AS revenue, SUM(purchases)::bigint AS purchases
    FROM (
      SELECT route, spend, purchases, revenue FROM meta_ads_campaigns
      WHERE client_id = ${clientId} AND snapshot_date >= date_trunc('month', CURRENT_DATE)
        AND snapshot_date <= CURRENT_DATE AND route IS NOT NULL
      UNION ALL
      SELECT route, spend, carts AS purchases, revenue FROM google_ads_campaigns
      WHERE client_id = ${clientId} AND snapshot_date >= date_trunc('month', CURRENT_DATE)
        AND snapshot_date <= CURRENT_DATE AND route IS NOT NULL
    ) AS combined GROUP BY route
  `;
  const partialYoyRows = await sql`
    SELECT route, SUM(spend)::numeric AS spend, SUM(revenue)::numeric AS revenue, SUM(purchases)::bigint AS purchases
    FROM (
      SELECT route, spend, purchases, revenue FROM meta_ads_campaigns
      WHERE client_id = ${clientId}
        AND snapshot_date >= (date_trunc('month', CURRENT_DATE) - INTERVAL '1 year')
        AND snapshot_date <= (CURRENT_DATE - INTERVAL '1 year') AND route IS NOT NULL
      UNION ALL
      SELECT route, spend, carts AS purchases, revenue FROM google_ads_campaigns
      WHERE client_id = ${clientId}
        AND snapshot_date >= (date_trunc('month', CURRENT_DATE) - INTERVAL '1 year')
        AND snapshot_date <= (CURRENT_DATE - INTERVAL '1 year') AND route IS NOT NULL
    ) AS combined GROUP BY route
  `;
  const demandMonthlyRows = await sql`
    SELECT route, date_trunc('month', snapshot_date)::date AS month, SUM(clicks)::bigint AS clicks
    FROM google_ads_search_terms
    WHERE client_id = ${clientId}
      AND snapshot_date >= (CURRENT_DATE - INTERVAL '6 months')
      AND snapshot_date < date_trunc('month', CURRENT_DATE) AND route IS NOT NULL
    GROUP BY route, date_trunc('month', snapshot_date) ORDER BY route, month
  `;

  return buildRouteConclusions(routes as any[], monthlyRows as any[], demandMonthlyRows as any[], partialCurrentRows as any[], partialYoyRows as any[]);
}

async function alerts(clientId: string): Promise<{ title: string; detail: string }[]> {
  // Campañas Meta sin conversiones
  const silent = await sql`
    SELECT segment AS name, SUM(spend)::numeric AS spend
    FROM meta_ads_campaigns
    WHERE client_id = ${clientId}
      AND snapshot_date >= CURRENT_DATE - 7
      AND type IN ('OUTCOME_SALES', 'CONVERSIONS', 'PRODUCT_CATALOG_SALES')
    GROUP BY segment
    HAVING COALESCE(SUM(purchases), 0) = 0
       AND COALESCE(SUM(spend), 0) > 5000
    ORDER BY SUM(spend) DESC
    LIMIT 3
  `;
  return silent.map((c: any) => ({
    title: `Meta: "${c.name}" sin conversiones`,
    detail: `$${Number(c.spend).toFixed(0)} gastados en 7d sin generar ventas`,
  }));
}

function fmtMoney(v: number): string { return '$' + v.toLocaleString('es-AR', { maximumFractionDigits: 0 }); }
function fmtPct(v: number): string {
  const sign = v > 0 ? '+' : '';
  return `${sign}${(v * 100).toFixed(1)}%`;
}

function buildHtml(clientName: string, sm: Summary, gainers: any[], alerts: any[], conclusions: Conclusion[]): string {
  const deltaColor = (v: number) => v >= 0 ? '#10b981' : '#ef4444';
  const spendDelta   = sm.prevSpend > 0     ? (sm.spend     - sm.prevSpend)     / sm.prevSpend     : 0;
  const revDelta     = sm.prevRevenue > 0   ? (sm.revenue   - sm.prevRevenue)   / sm.prevRevenue   : 0;
  const purchDelta   = sm.prevPurchases > 0 ? (sm.purchases - sm.prevPurchases) / sm.prevPurchases : 0;

  return `<!DOCTYPE html><html><body style="font-family: -apple-system, BlinkMacSystemFont, sans-serif; max-width: 600px; margin: 0 auto; padding: 32px; color: #0f172a;">
    <div style="border-bottom: 1px solid #e2e8f0; padding-bottom: 16px; margin-bottom: 24px;">
      <h1 style="margin: 0; font-size: 24px;">Resumen semanal — ${clientName}</h1>
      <p style="color: #64748b; margin: 4px 0 0 0;">${new Date().toLocaleDateString('es-AR', { weekday: 'long', day: 'numeric', month: 'long' })}</p>
    </div>

    <h2 style="font-size: 16px; margin: 24px 0 12px 0;">Últimos 7 días</h2>
    <table style="width: 100%; border-collapse: collapse;">
      <tr>
        <td style="padding: 8px 0;"><strong>Inversión</strong></td>
        <td style="text-align: right; padding: 8px 0;">${fmtMoney(sm.spend)} <span style="color: ${deltaColor(-spendDelta)}; font-size: 12px;">(${fmtPct(spendDelta)})</span></td>
      </tr>
      <tr>
        <td style="padding: 8px 0;"><strong>Revenue</strong></td>
        <td style="text-align: right; padding: 8px 0;">${fmtMoney(sm.revenue)} <span style="color: ${deltaColor(revDelta)}; font-size: 12px;">(${fmtPct(revDelta)})</span></td>
      </tr>
      <tr>
        <td style="padding: 8px 0;"><strong>Compras</strong></td>
        <td style="text-align: right; padding: 8px 0;">${sm.purchases.toLocaleString('es-AR')} <span style="color: ${deltaColor(purchDelta)}; font-size: 12px;">(${fmtPct(purchDelta)})</span></td>
      </tr>
      <tr>
        <td style="padding: 8px 0;"><strong>ROAS</strong></td>
        <td style="text-align: right; padding: 8px 0;">${sm.roas.toFixed(2)}x</td>
      </tr>
      <tr>
        <td style="padding: 8px 0;"><strong>CPA</strong></td>
        <td style="text-align: right; padding: 8px 0;">${fmtMoney(sm.cpa)}</td>
      </tr>
    </table>

    ${conclusions.length > 0 ? `
    <h2 style="font-size: 16px; margin: 32px 0 12px 0;">🧠 Conclusiones estratégicas</h2>
    ${conclusions.slice(0, 3).map(c => {
      const color = c.severity === 'critical' ? '#dc2626' : c.severity === 'warning' ? '#d97706' : c.severity === 'success' ? '#059669' : '#2563eb';
      const bg    = c.severity === 'critical' ? '#fef2f2' : c.severity === 'warning' ? '#fffbeb' : c.severity === 'success' ? '#ecfdf5' : '#eff6ff';
      return `
      <div style="border-left: 3px solid ${color}; background: ${bg}; padding: 12px 16px; margin-bottom: 12px; border-radius: 4px;">
        <div style="font-weight: 600; color: #0f172a; font-size: 14px;">${c.headline}</div>
        <div style="font-size: 13px; color: #475569; margin-top: 4px;">${c.detail}</div>
        <div style="font-size: 12px; color: #64748b; margin-top: 8px; font-style: italic;">💡 ${c.recommendation}</div>
      </div>`;
    }).join('')}
    ` : ''}

    ${alerts.length > 0 ? `
    <h2 style="font-size: 16px; margin: 32px 0 12px 0;">Atención requerida</h2>
    <ul style="padding-left: 20px;">
      ${alerts.map(a => `<li style="margin-bottom: 12px;"><strong>${a.title}</strong><br><span style="color: #64748b; font-size: 14px;">${a.detail}</span></li>`).join('')}
    </ul>
    ` : ''}

    ${gainers.length > 0 ? `
    <h2 style="font-size: 16px; margin: 32px 0 12px 0;">Rutas en crecimiento</h2>
    <ul style="padding-left: 20px;">
      ${gainers.map(g => `<li style="margin-bottom: 8px;"><strong>${g.route}</strong> creció <span style="color: #10b981;">${fmtPct(g.growth)}</span> — ${fmtMoney(g.revenue)} esta semana</li>`).join('')}
    </ul>
    ` : ''}

    <hr style="margin: 32px 0; border: none; border-top: 1px solid #e2e8f0;">
    <p style="color: #94a3b8; font-size: 12px;">Auto-generado por <strong>Veta Analytics</strong>. Detalle completo en el dashboard.</p>
  </body></html>`;
}

async function sendEmail(to: string, subject: string, html: string) {
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${RESEND_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ from: REPORT_FROM_EMAIL, to, subject, html }),
  });
  if (!res.ok) {
    const txt = await res.text();
    throw new Error(`Resend error ${res.status}: ${txt}`);
  }
}

async function main() {
  console.log(`Weekly report — ${new Date().toISOString()}`);

  // Por cada cliente: armar resumen + traer emails de users autorizados → mandar
  const clients = await sql`SELECT id, slug, name FROM clients`;
  for (const client of clients) {
    console.log(`\n→ ${client.slug}`);
    const sm          = await buildSummary(client.id);
    const gainers     = await topGainers(client.id);
    const issues      = await alerts(client.id);
    const conclusions = await fetchRouteConclusions(client.id).catch(e => { console.error(`  ✗ conclusiones:`, e.message); return []; });
    const html        = buildHtml(client.name, sm, gainers, issues, conclusions);
    const subject  = `${client.name} — Resumen semanal · ${fmtMoney(sm.revenue)} revenue (${fmtPct(sm.prevRevenue > 0 ? (sm.revenue - sm.prevRevenue) / sm.prevRevenue : 0)})`;

    const recipients = await sql`
      SELECT u.email FROM users u
      JOIN user_clients uc ON uc.user_id = u.id
      WHERE uc.client_id = ${client.id}
    `;
    if (recipients.length === 0) {
      console.log('  ⊘ Sin destinatarios autorizados');
      continue;
    }
    for (const r of recipients) {
      try {
        await sendEmail(r.email, subject, html);
        console.log(`  ✓ Sent to ${r.email}`);
      } catch (e: any) {
        console.error(`  ✗ Failed to send to ${r.email}: ${e.message}`);
      }
    }
  }
}

main().catch(e => { console.error(e); process.exit(1); });
