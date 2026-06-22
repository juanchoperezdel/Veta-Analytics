import type { Context } from '@netlify/functions';
import { sql, corsHeaders, errorResponse } from './_db';

// Dashboard público de Smartway — endpoint SIN auth (gate por oscuridad, como hot-sale).
// Slug fijo server-side: nunca devuelve data de otro cliente. Revocar = cambiar el path
// de la página en App.tsx y redeployar.
//
// Smartway es lead-gen: la conversión primaria son LEADS. El dashboard arma el FUNNEL
// Impresiones → Clicks → Visitas LP → Leads, con costo por etapa, segmentado por VERTICAL
// (el vertical va en el ad_name: Kit 4.0 / Orbatix / Smartway) y por tipo de campaña.
//
// IMPORTANTE: Orbatix es una campaña de WEBINAR (registros masivos, leads "fáciles"). Sus
// leads NO se mezclan con los leads comerciales (romperían el CPL). Van en un bucket aparte.

const SLUG = 'smartway';
const WEBINAR_VERTICAL = 'Orbatix';

// Fechas en JS (string ISO) — evita la aritmética de fechas con parámetros en Neon.
function iso(d: Date) { return d.toISOString().split('T')[0]; }
function todayISO() { return iso(new Date()); }
function daysAgoISO(n: number) { const d = new Date(); d.setDate(d.getDate() - n); return iso(d); }

// El vertical se infiere del nombre del anuncio / campaña (ej: "Ad1_Kit4", "Search Kit 4.0").
function classifyVertical(name: string): string {
  const n = (name || '').toLowerCase();
  if (/kit\s*4|kit4/.test(n)) return 'Kit 4.0';
  if (/orbatix/.test(n)) return 'Orbatix';
  return 'Smartway';
}

type Agg = { spend: number; impressions: number; clicks: number; lpv: number; leads: number };
function emptyAgg(): Agg { return { spend: 0, impressions: 0, clicks: 0, lpv: 0, leads: 0 }; }
function addAgg(a: Agg, r: { spend: number; impressions: number; clicks: number; lpv: number; leads: number }) {
  a.spend += r.spend; a.impressions += r.impressions; a.clicks += r.clicks; a.lpv += r.lpv; a.leads += r.leads;
}

// Construye las 4 etapas del funnel con tasa de paso y costo por etapa.
function buildFunnel(a: Agg) {
  return {
    spend: a.spend, impressions: a.impressions, clicks: a.clicks, visits: a.lpv, leads: a.leads,
    ctr: a.impressions > 0 ? a.clicks / a.impressions : 0,
    cpm: a.impressions > 0 ? (a.spend / a.impressions) * 1000 : 0,
    cpc: a.clicks > 0 ? a.spend / a.clicks : 0,
    costPerVisit: a.lpv > 0 ? a.spend / a.lpv : 0,
    cpl: a.leads > 0 ? a.spend / a.leads : 0,
    clickRate: a.impressions > 0 ? a.clicks / a.impressions : 0,
    visitRate: a.clicks > 0 ? Math.min(1, a.lpv / a.clicks) : 0,
    leadRate: a.lpv > 0 ? a.leads / a.lpv : (a.clicks > 0 ? a.leads / a.clicks : 0),
  };
}

export default async (req: Request, _context: Context) => {
  const headers = { ...corsHeaders(), 'Cache-Control': 'no-store, max-age=0' };
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers });

  const [client] = await sql`SELECT id, name FROM clients WHERE slug = ${SLUG}`;
  if (!client) return errorResponse('Client not found', 404);
  const cid = client.id;

  const url = new URL(req.url);
  const end = url.searchParams.get('end') || todayISO();
  const start = url.searchParams.get('start') || daysAgoISO(29);

  // ─── Ad-level Meta (30d sincronizados) — fuente del funnel + verticales ──────
  const adRows = await sql`
    SELECT ad_id, MAX(ad_name) ad_name, MAX(campaign_name) campaign_name,
           MAX(thumbnail_url) thumbnail_url, MAX(effective_status) status, MAX(preview_link) preview_link,
           SUM(spend)::numeric spend, SUM(impressions)::bigint impressions,
           SUM(clicks)::bigint clicks, COALESCE(SUM(landing_page_view),0)::bigint lpv,
           SUM(purchases)::bigint leads
    FROM meta_ads_creatives
    WHERE client_id = ${cid} AND snapshot_date BETWEEN ${start} AND ${end}
    GROUP BY ad_id`;

  const allAds = adRows.map((a: any) => {
    const spend = Number(a.spend), impressions = Number(a.impressions), clicks = Number(a.clicks);
    const lpv = Number(a.lpv), leads = Number(a.leads);
    return {
      adId: a.ad_id, adName: a.ad_name ?? '(sin nombre)', campaignName: a.campaign_name ?? '',
      vertical: classifyVertical(a.ad_name), thumbnailUrl: a.thumbnail_url ?? null, status: a.status,
      previewLink: a.preview_link ?? null,
      spend, impressions, clicks, lpv, leads,
      ctr: impressions > 0 ? clicks / impressions : 0,
      cpl: leads > 0 ? spend / leads : 0,
    };
  });

  // Separar leads comerciales (Smartway + Kit 4.0) del webinar (Orbatix)
  const leadgenAds = allAds.filter(a => a.vertical !== WEBINAR_VERTICAL);
  const webinarAds = allAds.filter(a => a.vertical === WEBINAR_VERTICAL);

  // Funnel general = SOLO lead-gen comercial (sin webinar)
  const overallAgg = emptyAgg();
  const vertAggs: Record<string, Agg> = {};
  for (const a of leadgenAds) {
    addAgg(overallAgg, a);
    (vertAggs[a.vertical] ??= emptyAgg());
    addAgg(vertAggs[a.vertical], a);
  }
  const overall = buildFunnel(overallAgg);

  const VERT_ORDER = ['Smartway', 'Kit 4.0'];
  const verticals = Object.keys(vertAggs)
    .sort((x, y) => (VERT_ORDER.indexOf(x) + 99) - (VERT_ORDER.indexOf(y) + 99) || vertAggs[y].spend - vertAggs[x].spend)
    .map(name => ({
      name, ...buildFunnel(vertAggs[name]),
      ads: leadgenAds.filter(a => a.vertical === name).sort((p, q) => q.spend - p.spend)
        .map(a => ({ adId: a.adId, adName: a.adName, thumbnailUrl: a.thumbnailUrl, previewLink: a.previewLink, spend: a.spend,
                     impressions: a.impressions, clicks: a.clicks, lpv: a.lpv, leads: a.leads, ctr: a.ctr, cpl: a.cpl })),
    }));

  // Webinar (Orbatix) — bucket aparte
  const webinarAgg = emptyAgg();
  for (const a of webinarAds) addAgg(webinarAgg, a);
  const webinar = webinarAds.length ? {
    name: 'Orbatix (webinar)',
    ...buildFunnel(webinarAgg),
    ads: webinarAds.sort((p, q) => q.spend - p.spend)
      .map(a => ({ adId: a.adId, adName: a.adName, thumbnailUrl: a.thumbnailUrl, previewLink: a.previewLink, spend: a.spend, leads: a.leads, ctr: a.ctr, cpl: a.cpl })),
  } : null;

  // Por tipo de campaña (estructura) — recomputado de ad-level lead-gen (excluye Orbatix)
  const byCamp: Record<string, { spend: number; leads: number }> = {};
  for (const a of leadgenAds) {
    const k = a.campaignName || '(sin nombre)';
    (byCamp[k] ??= { spend: 0, leads: 0 });
    byCamp[k].spend += a.spend; byCamp[k].leads += a.leads;
  }
  const campaignTypes = Object.entries(byCamp)
    .map(([name, v]) => ({ name, spend: v.spend, leads: v.leads, cpl: v.leads > 0 ? v.spend / v.leads : 0 }))
    .sort((a, b) => b.spend - a.spend);

  // Mejores / peores anuncios (lead-gen, no webinar)
  const SPEND_FLOOR = 3000;
  const withLeads = leadgenAds.filter(a => a.leads > 0).sort((a, b) => a.cpl - b.cpl);
  const noLeads = leadgenAds.filter(a => a.leads === 0 && a.spend >= SPEND_FLOOR).sort((a, b) => b.spend - a.spend);
  const best = (withLeads.length ? withLeads : [...leadgenAds].sort((a, b) => b.ctr - a.ctr)).slice(0, 6)
    .map(a => ({ adId: a.adId, adName: a.adName, vertical: a.vertical, thumbnailUrl: a.thumbnailUrl, previewLink: a.previewLink, spend: a.spend, leads: a.leads, ctr: a.ctr, cpl: a.cpl }));
  const worst = noLeads.slice(0, 6)
    .map(a => ({ adId: a.adId, adName: a.adName, vertical: a.vertical, thumbnailUrl: a.thumbnailUrl, previewLink: a.previewLink, spend: a.spend, leads: a.leads, ctr: a.ctr, cpl: a.cpl }));

  // ─── Google (campaign-level) ─────────────────────────────────────────────────
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
      return { name: r.name, vertical: classifyVertical(r.name), spend, clicks: Number(r.clicks), impressions: Number(r.impressions), leads, cpl: leads > 0 ? spend / leads : 0 };
    }),
  };

  // ─── Demografía (Meta, top por gasto) ────────────────────────────────────────
  const demoRows = await sql`
    SELECT dimension_type, dimension_value, SUM(spend)::numeric spend, SUM(purchases)::bigint leads
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

  // ─── Última actualización REAL de los datos (no la hora del request) ─────────
  const [upd] = await sql`
    SELECT MAX(s) AS last FROM (
      SELECT MAX(synced_at) s FROM meta_ads_campaigns WHERE client_id = ${cid}
      UNION ALL SELECT MAX(synced_at) FROM meta_ads_creatives WHERE client_id = ${cid}
      UNION ALL SELECT MAX(synced_at) FROM google_ads_campaigns WHERE client_id = ${cid}
    ) t`;
  const [metaUpd] = await sql`SELECT MAX(synced_at) s FROM meta_ads_campaigns WHERE client_id = ${cid}`;
  const [gUpd] = await sql`SELECT MAX(synced_at) s FROM google_ads_campaigns WHERE client_id = ${cid}`;

  const body = {
    config: {
      name: client.name, currency: 'ARS', period: { start, end },
      generatedAt: new Date().toISOString(),
      dataUpdatedAt: upd?.last ?? null,
      metaUpdatedAt: metaUpd?.s ?? null,
      googleUpdatedAt: gUpd?.s ?? null,
    },
    overall, verticals, webinar, campaignTypes,
    ads: { best, worst },
    google, demographics,
  };

  return new Response(JSON.stringify(body), { headers });
};