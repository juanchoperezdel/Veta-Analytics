import type { Context } from '@netlify/functions';
import { sql, corsHeaders, errorResponse } from './_db';

// Dashboard público de Griba — endpoint SIN auth (gate por oscuridad, como el de Smartway).
// Slug fijo server-side: nunca devuelve data de otro cliente. Revocar = cambiar el path
// de la página en App.tsx y redeployar.
//
// Griba es lead-gen. El dashboard arma el FUNNEL Impresiones → Clicks → Visitas LP → Leads,
// con costo por etapa, y separa la pauta de Meta en dos MOTORES distintos:
//   • FORMULARIOS  → el lead completa un formulario dentro de Meta (Instant Form).
//                     No hay visita a landing → el funnel es Impresiones → Clicks → Leads.
//   • LANDING      → el anuncio lleva al sitio y el lead convierte ahí.
//                     El funnel suma la etapa "Visitas a la landing".
// Además cruza por PRODUCTO/vertical (CRM / ERP / Kit 4.0), inferido del nombre del anuncio.
//
// Calidad de leads (calificado / no calificado / reunión) vive en el CRM de Griba, NO en
// Meta/Google. v1 deja la estructura preparada (`leadQuality: null`) y el cruce listo por
// ad_id; se puebla cuando se conecte la fuente (API del CRM o planilla auxiliar).

const SLUG = 'griba';

// Campañas que viven en la cuenta pero NO las gestiona Veta (terceros). Vacío por ahora;
// si aparecen, agregar el patrón acá para separarlas del funnel/CPL comercial.
const UNMANAGED_RE = /(?!)/; // no matchea nada
function isManaged(name: string): boolean { return !UNMANAGED_RE.test(name || ''); }

// Fechas en JS (string ISO) — evita la aritmética de fechas con parámetros en Neon.
function iso(d: Date) { return d.toISOString().split('T')[0]; }
function todayISO() { return iso(new Date()); }
function daysAgoISO(n: number) { const d = new Date(); d.setDate(d.getDate() - n); return iso(d); }

// El vertical/producto se infiere del nombre del anuncio o campaña.
function classifyVertical(name: string): string {
  const n = (name || '').toLowerCase();
  if (/kit\s*4|kit4|kit\s*industria|4\.0/.test(n)) return 'Kit 4.0';
  if (/\berp\b|distribuidora|mayorista|preventa|reparto/.test(n)) return 'ERP';
  if (/\bcrm\b|concesionaria|plan\s*ahorro|automotriz/.test(n)) return 'CRM';
  return 'General';
}

// Motor de la campaña: Formulario (Instant Form de Meta) vs Landing (lleva al sitio).
// Prioridad: 1) nombre explícito, 2) señal de datos (visitas a landing).
type Channel = 'form' | 'landing';
function classifyChannel(name: string, lpv: number, leads: number): Channel {
  const n = (name || '').toLowerCase();
  if (/formulario|instant|lead\s*form|form(?!ato)|mensaje|whatsapp|\bwsp\b|\bmsg\b/.test(n)) return 'form';
  if (/landing|tr[aá]fico|sitio|web|conversi|link/.test(n)) return 'landing';
  // Sin pista en el nombre: si hubo visitas a la landing es tráfico a sitio; si hubo leads
  // sin ninguna visita, es un formulario nativo de Meta. Default conservador → landing.
  if (lpv > 0) return 'landing';
  if (leads > 0) return 'form';
  return 'landing';
}

type Agg = { spend: number; impressions: number; clicks: number; lpv: number; leads: number; reach: number };
function emptyAgg(): Agg { return { spend: 0, impressions: 0, clicks: 0, lpv: 0, leads: 0, reach: 0 }; }
function addAgg(a: Agg, r: { spend: number; impressions: number; clicks: number; lpv: number; leads: number; reach: number }) {
  a.spend += r.spend; a.impressions += r.impressions; a.clicks += r.clicks; a.lpv += r.lpv; a.leads += r.leads; a.reach += r.reach;
}

// Construye las etapas del funnel con tasa de paso y costo por etapa.
function buildFunnel(a: Agg) {
  return {
    spend: a.spend, impressions: a.impressions, clicks: a.clicks, visits: a.lpv, leads: a.leads,
    ctr: a.impressions > 0 ? a.clicks / a.impressions : 0,
    cpm: a.impressions > 0 ? (a.spend / a.impressions) * 1000 : 0,
    cpc: a.clicks > 0 ? a.spend / a.clicks : 0,
    costPerVisit: a.lpv > 0 ? a.spend / a.lpv : 0,
    cpl: a.leads > 0 ? a.spend / a.leads : 0,
    // Frecuencia aprox: el reach se suma entre días/ads y se solapa → SUBESTIMA la real.
    // Sirve de termómetro de saturación, no como número exacto.
    frequency: a.reach > 0 ? a.impressions / a.reach : 0,
    clickRate: a.impressions > 0 ? a.clicks / a.impressions : 0,
    visitRate: a.clicks > 0 ? Math.min(1, a.lpv / a.clicks) : 0,
    leadRate: a.lpv > 0 ? a.leads / a.lpv : (a.clicks > 0 ? a.leads / a.clicks : 0),
  };
}

type AdRow = {
  adId: string; adName: string; campaignName: string; vertical: string; channel: Channel;
  thumbnailUrl: string | null; status: string | null; previewLink: string | null;
  spend: number; impressions: number; clicks: number; lpv: number; leads: number; reach: number;
  ctr: number; cpl: number;
};
function adOut(a: AdRow) {
  return { adId: a.adId, adName: a.adName, vertical: a.vertical, channel: a.channel,
           thumbnailUrl: a.thumbnailUrl, previewLink: a.previewLink, spend: a.spend,
           impressions: a.impressions, clicks: a.clicks, lpv: a.lpv, leads: a.leads, ctr: a.ctr, cpl: a.cpl };
}

// Bloque de un motor (Formularios / Landing): funnel + mejores/peores anuncios + campañas.
function buildChannelBlock(ads: AdRow[], kind: Channel) {
  const agg = emptyAgg();
  for (const a of ads) addAgg(agg, a);
  const SPEND_FLOOR = 3000;
  const withLeads = ads.filter(a => a.leads > 0).sort((a, b) => a.cpl - b.cpl);
  const noLeads = ads.filter(a => a.leads === 0 && a.spend >= SPEND_FLOOR).sort((a, b) => b.spend - a.spend);
  const best = (withLeads.length ? withLeads : [...ads].sort((a, b) => b.ctr - a.ctr)).slice(0, 6).map(adOut);
  const worst = noLeads.slice(0, 6).map(adOut);
  // Campañas del motor
  const byCamp: Record<string, { spend: number; leads: number; clicks: number }> = {};
  for (const a of ads) {
    const k = a.campaignName || '(sin nombre)';
    (byCamp[k] ??= { spend: 0, leads: 0, clicks: 0 });
    byCamp[k].spend += a.spend; byCamp[k].leads += a.leads; byCamp[k].clicks += a.clicks;
  }
  const campaigns = Object.entries(byCamp)
    .map(([name, v]) => ({ name, spend: v.spend, clicks: v.clicks, leads: v.leads, cpl: v.leads > 0 ? v.spend / v.leads : 0 }))
    .sort((a, b) => b.spend - a.spend);
  return { kind, ...buildFunnel(agg), adCount: ads.length, ads: [...ads].sort((a, b) => b.spend - a.spend).map(adOut), best, worst, campaigns };
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

  // ─── Ad-level Meta (30d sincronizados) — fuente del funnel + verticales + motores ──────
  const adRows = await sql`
    SELECT ad_id, MAX(ad_name) ad_name, MAX(campaign_name) campaign_name,
           MAX(thumbnail_url) thumbnail_url, MAX(effective_status) status, MAX(preview_link) preview_link,
           SUM(spend)::numeric spend, SUM(impressions)::bigint impressions,
           SUM(clicks)::bigint clicks, COALESCE(SUM(landing_page_view),0)::bigint lpv,
           SUM(purchases)::bigint leads, COALESCE(SUM(reach),0)::bigint reach
    FROM meta_ads_creatives
    WHERE client_id = ${cid} AND snapshot_date BETWEEN ${start} AND ${end}
    GROUP BY ad_id`;

  const allAds: AdRow[] = adRows.map((a: any) => {
    const spend = Number(a.spend), impressions = Number(a.impressions), clicks = Number(a.clicks);
    const lpv = Number(a.lpv), leads = Number(a.leads), reach = Number(a.reach);
    const campaignName = a.campaign_name ?? '';
    const adName = a.ad_name ?? '(sin nombre)';
    return {
      adId: a.ad_id, adName, campaignName,
      vertical: classifyVertical(`${adName} ${campaignName}`),
      channel: classifyChannel(campaignName || adName, lpv, leads),
      thumbnailUrl: a.thumbnail_url ?? null, status: a.status, previewLink: a.preview_link ?? null,
      spend, impressions, clicks, lpv, leads, reach,
      ctr: impressions > 0 ? clicks / impressions : 0,
      cpl: leads > 0 ? spend / leads : 0,
    };
  });

  const leadgenAds = allAds.filter(a => isManaged(a.campaignName));

  // Funnel general = toda la pauta comercial de Meta (form + landing)
  const overallAgg = emptyAgg();
  for (const a of leadgenAds) addAgg(overallAgg, a);
  const overall = buildFunnel(overallAgg);

  // ─── Split por MOTOR: Formularios vs Landing (el corazón del pedido) ──────────
  const formAds = leadgenAds.filter(a => a.channel === 'form');
  const landingAds = leadgenAds.filter(a => a.channel === 'landing');
  const channels = {
    form: buildChannelBlock(formAds, 'form'),
    landing: buildChannelBlock(landingAds, 'landing'),
  };

  // ─── Por vertical/producto (CRM / ERP / Kit 4.0 / General) ────────────────────
  const vertAggs: Record<string, Agg> = {};
  for (const a of leadgenAds) { (vertAggs[a.vertical] ??= emptyAgg()); addAgg(vertAggs[a.vertical], a); }
  const VERT_ORDER = ['CRM', 'ERP', 'Kit 4.0', 'General'];
  const verticals = Object.keys(vertAggs)
    .sort((x, y) => (VERT_ORDER.indexOf(x) + 99) - (VERT_ORDER.indexOf(y) + 99) || vertAggs[y].spend - vertAggs[x].spend)
    .map(name => ({
      name, ...buildFunnel(vertAggs[name]),
      ads: leadgenAds.filter(a => a.vertical === name).sort((p, q) => q.spend - p.spend).map(adOut),
    }));

  // ─── Mejores / peores anuncios (total Meta) ───────────────────────────────────
  const SPEND_FLOOR = 3000;
  const withLeads = leadgenAds.filter(a => a.leads > 0).sort((a, b) => a.cpl - b.cpl);
  const noLeads = leadgenAds.filter(a => a.leads === 0 && a.spend >= SPEND_FLOOR).sort((a, b) => b.spend - a.spend);
  const best = (withLeads.length ? withLeads : [...leadgenAds].sort((a, b) => b.ctr - a.ctr)).slice(0, 8).map(adOut);
  const worst = noLeads.slice(0, 8).map(adOut);

  // ─── Google (campaign-level) ─────────────────────────────────────────────────
  const gRows = await sql`
    SELECT name, SUM(spend)::numeric spend, SUM(impressions)::bigint impressions,
           SUM(clicks)::bigint clicks, SUM(carts)::bigint leads
    FROM google_ads_campaigns
    WHERE client_id = ${cid} AND snapshot_date BETWEEN ${start} AND ${end}
    GROUP BY name ORDER BY SUM(spend) DESC`;
  const gAgg = emptyAgg();
  for (const r of gRows) addAgg(gAgg, { spend: Number(r.spend), impressions: Number(r.impressions), clicks: Number(r.clicks), lpv: 0, leads: Number(r.leads), reach: 0 });
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
    SELECT dimension_type, dimension_value, SUM(spend)::numeric spend, SUM(purchases)::bigint leads,
           SUM(impressions)::bigint impressions, SUM(clicks)::bigint clicks
    FROM meta_ads_breakdowns
    WHERE client_id = ${cid} AND snapshot_date BETWEEN ${start} AND ${end}
    GROUP BY dimension_type, dimension_value HAVING SUM(spend) > 0`;
  const demographics: Record<string, any[]> = { age: [], gender: [], region: [], publisher_platform: [] };
  for (const r of demoRows) {
    const t = r.dimension_type;
    (demographics[t] ??= []);
    const spend = Number(r.spend), leads = Number(r.leads);
    const impressions = Number(r.impressions), clicks = Number(r.clicks);
    demographics[t].push({ value: r.dimension_value, spend, leads, cpl: leads > 0 ? spend / leads : 0,
                           ctr: impressions > 0 ? clicks / impressions : 0 });
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
  const [metaUpd] = await sql`SELECT MAX(synced_at) s FROM meta_ads_creatives WHERE client_id = ${cid}`;
  const [gUpd] = await sql`SELECT MAX(synced_at) s FROM google_ads_campaigns WHERE client_id = ${cid}`;

  // ─── Calidad de leads (CRM GoHighLevel) ──────────────────────────────────────
  // Cruza cada lead del CRM (con su estado calificado/reunión/etc.) contra el
  // anuncio que lo trajo (ad_id). null = todavía no hay datos de CRM.
  const crmRows = await sql`SELECT ad_id, quality FROM crm_leads WHERE client_id = ${cid}`;
  const [crmUpd] = await sql`SELECT MAX(synced_at) s FROM crm_leads WHERE client_id = ${cid}`;
  let leadQuality: any = null;
  if (crmRows.length > 0) {
    const adById: Record<string, any> = {};
    for (const a of allAds) adById[a.adId] = a;
    const bump = (o: any, q: string) => {
      o.total++;
      if (q === 'qualified') o.qualified++;
      else if (q === 'unqualified') o.unqualified++;
      else if (q === 'meeting') o.meetings++;
      else if (q === 'no_response') o.noResponse++;
      else o.unclassified++;
    };
    const totals = { total: 0, qualified: 0, unqualified: 0, meetings: 0, noResponse: 0, unclassified: 0 };
    const byAdMap: Record<string, any> = {};
    for (const r of crmRows) {
      bump(totals, r.quality);
      if (r.ad_id) {
        const m = (byAdMap[r.ad_id] ??= { adId: r.ad_id, total: 0, qualified: 0, unqualified: 0, meetings: 0, noResponse: 0, unclassified: 0 });
        bump(m, r.quality);
      }
    }
    const byAd = Object.values(byAdMap).map((m: any) => {
      const ad = adById[m.adId];
      return { ...m, adName: ad?.adName ?? '(anuncio)', thumbnailUrl: ad?.thumbnailUrl ?? null,
               previewLink: ad?.previewLink ?? null, channel: ad?.channel ?? null, vertical: ad?.vertical ?? null };
    }).sort((a: any, b: any) => (b.qualified + b.meetings) - (a.qualified + a.meetings) || b.total - a.total);
    // % de leads ya clasificados (para avisar cobertura del CRM)
    const classified = totals.qualified + totals.unqualified + totals.meetings + totals.noResponse;
    leadQuality = { ...totals, classified, updatedAt: crmUpd?.s ?? null, byAd };
  }

  const body = {
    config: {
      name: client.name, currency: 'ARS', period: { start, end },
      generatedAt: new Date().toISOString(),
      dataUpdatedAt: upd?.last ?? null,
      metaUpdatedAt: metaUpd?.s ?? null,
      googleUpdatedAt: gUpd?.s ?? null,
    },
    overall,
    channels,          // { form, landing } — cada uno con funnel + ads + best/worst + campaigns
    verticals,
    ads: { best, worst },
    google, demographics,
    // Calidad de leads cruzada con el CRM (GoHighLevel). null = sin datos de CRM aún.
    leadQuality,
  };

  return new Response(JSON.stringify(body), { headers });
};
