import type { Context } from '@netlify/functions';
import { sql, corsHeaders, errorResponse } from './_db';

// Dashboard público de Smartway — endpoint SIN auth (gate por oscuridad, como hot-sale).
// Slug fijo server-side: nunca devuelve data de otro cliente. Revocar = cambiar el path
// de la página en App.tsx y redeployar.
//
// Smartway es lead-gen: la conversión primaria son LEADS (no ventas). El dashboard arma
// el FUNNEL Impresiones → Clicks → Visitas LP → Leads, con costo por etapa, segmentado por
// VERTICAL (el vertical va en el ad_name: Kit 4.0 / Orbatix / Smartway) y por tipo de campaña.

const SLUG = 'smartway';

// Fechas en JS (string ISO) — evita la aritmética de fechas con parámetros en Neon,
// que rompe ("operator does not exist: date >= integer"). Los strings de fecha sí
// se comparan bien contra la columna date.
function iso(d: Date) { return d.toISOString().split('T')[0]; }
function todayISO() { return iso(new Date()); }
function daysAgoISO(n: number) { const d = new Date(); d.setDate(d.getDate() - n); return iso(d); }
function shiftMonthISO(dateStr: string, months: number) {
  const d = new Date(dateStr + 'T00:00:00Z'); d.setUTCMonth(d.getUTCMonth() + months); return iso(d);
}

// El vertical se infiere del nombre del anuncio (ej: "Ad1_Kit4", "Ad2_Orbatix").
function classifyVertical(adName: string): string {
  const n = (adName || '').toLowerCase();
  if (/kit\s*4|kit4/.test(n)) return 'Kit 4.0';
  if (/orbatix/.test(n)) return 'Orbatix';
  return 'Smartway';
}

function delta(c: number, p: number) { return (!p || p === 0) ? 0 : (c - p) / p; }

type Agg = { spend: number; impressions: number; clicks: number; lpv: number; leads: number };
function emptyAgg(): Agg { return { spend: 0, impressions: 0, clicks: 0, lpv: 0, leads: 0 }; }
function addAgg(a: Agg, r: { spend: number; impressions: number; clicks: number; lpv: number; leads: number }) {
  a.spend += r.spend; a.impressions += r.impressions; a.clicks += r.clicks; a.lpv += r.lpv; a.leads += r.leads;
}

// Construye las 4 etapas del funnel con tasa de paso y costo por etapa.
function buildFunnel(a: Agg) {
  const cpm = a.impressions > 0 ? (a.spend / a.impressions) * 1000 : 0;
  return {
    spend: a.spend,
    impressions: a.impressions,
    clicks: a.clicks,
    visits: a.lpv,
    leads: a.leads,
    ctr: a.impressions > 0 ? a.clicks / a.impressions : 0,
    cpm,
    cpc: a.clicks > 0 ? a.spend / a.clicks : 0,
    costPerVisit: a.lpv > 0 ? a.spend / a.lpv : 0,
    cpl: a.leads > 0 ? a.spend / a.leads : 0,
    // tasas de paso entre etapas
    clickRate: a.impressions > 0 ? a.clicks / a.impressions : 0,
    visitRate: a.clicks > 0 ? Math.min(1, a.lpv / a.clicks) : 0,
    leadRate: a.lpv > 0 ? a.leads / a.lpv : (a.clicks > 0 ? a.leads / a.clicks : 0),
  };
}

export default async (req: Request, _context: Context) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: corsHeaders() });

  const [client] = await sql`SELECT id, name FROM clients WHERE slug = ${SLUG}`;
  if (!client) return errorResponse('Client not found', 404);
  const cid = client.id;

  // Rango de fechas (default últimos 30 días). Delta vs el mismo rango un mes atrás.
  const url = new URL(req.url);
  const end = url.searchParams.get('end') || todayISO();
  const start = url.searchParams.get('start') || daysAgoISO(29);
  const prevStart = shiftMonthISO(start, -1);
  const prevEnd = shiftMonthISO(end, -1);

  // ─── Datos ad-level (30d) — fuente del funnel + verticales + por anuncio ─────
  const adRows = await sql`
    SELECT ad_id, MAX(ad_name) ad_name, MAX(campaign_name) campaign_name,
           MAX(thumbnail_url) thumbnail_url, MAX(effective_status) status,
           SUM(spend)::numeric spend, SUM(impressions)::bigint impressions,
           SUM(clicks)::bigint clicks, COALESCE(SUM(landing_page_view),0)::bigint lpv,
           SUM(purchases)::bigint leads
    FROM meta_ads_creatives
    WHERE client_id = ${cid} AND snapshot_date BETWEEN ${start} AND ${end}
    GROUP BY ad_id`;

  const ads = adRows.map((a: any) => {
    const spend = Number(a.spend), impressions = Number(a.impressions), clicks = Number(a.clicks);
    const lpv = Number(a.lpv), leads = Number(a.leads);
    return {
      adId: a.ad_id, adName: a.ad_name ?? '(sin nombre)', campaignName: a.campaign_name ?? '',
      vertical: classifyVertical(a.ad_name), thumbnailUrl: a.thumbnail_url ?? null, status: a.status,
      spend, impressions, clicks, lpv, leads,
      ctr: impressions > 0 ? clicks / impressions : 0,
      cpl: leads > 0 ? spend / leads : 0,
    };
  });

  // Agregados: overall + por vertical
  const overallAgg = emptyAgg();
  const vertAggs: Record<string, Agg> = {};
  for (const a of ads) {
    addAgg(overallAgg, a);
    (vertAggs[a.vertical] ??= emptyAgg());
    addAgg(vertAggs[a.vertical], a);
  }

  const overall = buildFunnel(overallAgg);

  const VERT_ORDER = ['Orbatix', 'Smartway', 'Kit 4.0'];
  const verticals = Object.keys(vertAggs)
    .sort((x, y) => (VERT_ORDER.indexOf(x) + 99) - (VERT_ORDER.indexOf(y) + 99) || vertAggs[y].spend - vertAggs[x].spend)
    .map(name => ({
      name,
      ...buildFunnel(vertAggs[name]),
      ads: ads.filter(a => a.vertical === name).sort((p, q) => q.spend - p.spend)
        .map(a => ({ adId: a.adId, adName: a.adName, thumbnailUrl: a.thumbnailUrl, spend: a.spend,
                     impressions: a.impressions, clicks: a.clicks, lpv: a.lpv, leads: a.leads,
                     ctr: a.ctr, cpl: a.cpl })),
    }));

  // ─── Por tipo de campaña (estructura: Leads / Advantage / Remarketing / ...) ──
  const campRows = await sql`
    SELECT segment, SUM(spend)::numeric spend, SUM(purchases)::bigint leads
    FROM meta_ads_campaigns
    WHERE client_id = ${cid} AND snapshot_date BETWEEN ${start} AND ${end}
    GROUP BY segment ORDER BY SUM(spend) DESC`;
  const campaignTypes = campRows.map((c: any) => {
    const spend = Number(c.spend), leads = Number(c.leads);
    return { name: c.segment ?? '(sin nombre)', spend, leads, cpl: leads > 0 ? spend / leads : 0 };
  });

  // Delta de leads/inversión vs mismo rango mes anterior (de la tabla de campañas)
  const [curr] = await sql`
    SELECT COALESCE(SUM(spend),0)::numeric spend, COALESCE(SUM(purchases),0)::bigint leads
    FROM meta_ads_campaigns WHERE client_id = ${cid} AND snapshot_date BETWEEN ${start} AND ${end}`;
  const [prev] = await sql`
    SELECT COALESCE(SUM(spend),0)::numeric spend, COALESCE(SUM(purchases),0)::bigint leads
    FROM meta_ads_campaigns WHERE client_id = ${cid}
      AND snapshot_date BETWEEN ${prevStart} AND ${prevEnd}`;
  const deltas = { spend: delta(Number(curr.spend), Number(prev.spend)), leads: delta(Number(curr.leads), Number(prev.leads)) };

  // ─── Mejores / peores anuncios (global, 30d) ─────────────────────────────────
  const SPEND_FLOOR = 3000;
  const withLeads = ads.filter(a => a.leads > 0).sort((a, b) => a.cpl - b.cpl);
  const noLeads = ads.filter(a => a.leads === 0 && a.spend >= SPEND_FLOOR).sort((a, b) => b.spend - a.spend);
  const best = (withLeads.length ? withLeads : [...ads].sort((a, b) => b.ctr - a.ctr)).slice(0, 6)
    .map(a => ({ adId: a.adId, adName: a.adName, vertical: a.vertical, thumbnailUrl: a.thumbnailUrl,
                 spend: a.spend, leads: a.leads, ctr: a.ctr, cpl: a.cpl }));
  const worst = noLeads.slice(0, 6)
    .map(a => ({ adId: a.adId, adName: a.adName, vertical: a.vertical, thumbnailUrl: a.thumbnailUrl,
                 spend: a.spend, leads: a.leads, ctr: a.ctr, cpl: a.cpl }));

  // ─── Google (campaign-level; vacío hasta el primer sync en la nube) ──────────
  const gRows = await sql`
    SELECT name, SUM(spend)::numeric spend, SUM(impressions)::bigint impressions,
           SUM(clicks)::bigint clicks, SUM(carts)::bigint leads
    FROM google_ads_campaigns
    WHERE client_id = ${cid} AND snapshot_date BETWEEN ${start} AND ${end}
    GROUP BY name ORDER BY SUM(spend) DESC`;
  const gAgg = emptyAgg();
  for (const r of gRows) addAgg(gAgg, { spend: Number(r.spend), impressions: Number(r.impressions), clicks: Number(r.clicks), lpv: 0, leads: Number(r.leads) });
  const google = {
    hasData: gAgg.spend > 0,
    ...buildFunnel(gAgg),
    campaigns: gRows.map((r: any) => {
      const spend = Number(r.spend), leads = Number(r.leads);
      return { name: r.name, vertical: classifyVertical(r.name), spend, clicks: Number(r.clicks),
               impressions: Number(r.impressions), leads, cpl: leads > 0 ? spend / leads : 0 };
    }),
  };

  // ─── Demografía (Meta, top por gasto) ────────────────────────────────────────
  const demoRows = await sql`
    SELECT dimension_type, dimension_value,
           SUM(spend)::numeric spend, SUM(purchases)::bigint leads
    FROM meta_ads_breakdowns
    WHERE client_id = ${cid} AND snapshot_date BETWEEN ${start} AND ${end}
    GROUP BY dimension_type, dimension_value HAVING SUM(spend) > 0`;
  const demographics: Record<string, any[]> = { age: [], gender: [], region: [], publisher_platform: [] };
  for (const r of demoRows) {
    const t = r.dimension_type;
    (demographics[t] ??= []);
    const spend = Number(r.spend), leads = Number(r.leads);
    demographics[t].push({ value: r.dimension_value, spend, leads, cpl: leads > 0 ? spend / leads : 0 });
  }
  for (const k of Object.keys(demographics)) {
    demographics[k].sort((a, b) => b.spend - a.spend);
    demographics[k] = demographics[k].slice(0, 8);
  }

  const body = {
    config: { name: client.name, currency: 'ARS', period: { start, end }, generatedAt: new Date().toISOString() },
    overall, deltas,
    verticals,
    campaignTypes,
    ads: { best, worst },
    google,
    demographics,
  };

  return new Response(JSON.stringify(body), { headers: corsHeaders() });
};