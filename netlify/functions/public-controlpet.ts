import type { Context } from '@netlify/functions';
import { sql, corsHeaders, errorResponse } from './_db';

// Dashboard público de ControlPet — endpoint SIN auth, mismo patrón que public-griba.
// Slug fijo server-side: nunca devuelve data de otro cliente.
//
// Diferencias con Griba, por cómo está armada esta cuenta:
//   • TODA la pauta de Meta es Instant Form (Forms_Meta_ControlPet_*) → no hay tráfico a
//     landing propia, así que el funnel es Impresiones → Clicks → Leads (sin etapa de
//     visitas) y no existe el split form/landing.
//   • El corte que importa es GEOGRÁFICO (Córdoba / Mendoza / Remarketing), no por
//     producto: es el mismo producto en distintas plazas.
//   • Google es una sola campaña PMax. PMax mezcla tipos de conversión, así que sus
//     "conversiones" NO son comparables con los leads de Meta → el front lo advierte.

const SLUG = 'controlpet';

// Campañas que viven en la cuenta pero NO las gestiona Veta. Vacío por ahora.
const UNMANAGED_RE = /(?!)/; // no matchea nada
function isManaged(name: string): boolean { return !UNMANAGED_RE.test(name || ''); }

// Fechas en JS (string ISO) — evita la aritmética de fechas con parámetros en Neon.
function iso(d: Date) { return d.toISOString().split('T')[0]; }
function todayISO() { return iso(new Date()); }
function daysAgoISO(n: number) { const d = new Date(); d.setDate(d.getDate() - n); return iso(d); }

// La zona sale del nombre de la campaña (Forms_Meta_ControlPet_Cordoba / _Mendoza / _RMKT).
// Remarketing se chequea PRIMERO: una campaña de RMKT de Córdoba es, ante todo, remarketing.
function classifyZone(name: string): string {
  const n = (name || '').toLowerCase();
  if (/rmkt|remarket|retarget/.test(n)) return 'Remarketing';
  if (/c[oó]rdoba|\bcba\b/.test(n)) return 'Córdoba';
  if (/mendoza|\bmza\b/.test(n)) return 'Mendoza';
  return 'General';
}

type Agg = { spend: number; impressions: number; clicks: number; leads: number; reach: number };
function emptyAgg(): Agg { return { spend: 0, impressions: 0, clicks: 0, leads: 0, reach: 0 }; }
function addAgg(a: Agg, r: Agg) {
  a.spend += r.spend; a.impressions += r.impressions; a.clicks += r.clicks; a.leads += r.leads; a.reach += r.reach;
}

// Etapas del funnel con tasa de paso y costo por etapa. Sin "visitas": es Instant Form.
function buildFunnel(a: Agg) {
  return {
    spend: a.spend, impressions: a.impressions, clicks: a.clicks, leads: a.leads,
    ctr: a.impressions > 0 ? a.clicks / a.impressions : 0,
    cpm: a.impressions > 0 ? (a.spend / a.impressions) * 1000 : 0,
    cpc: a.clicks > 0 ? a.spend / a.clicks : 0,
    cpl: a.leads > 0 ? a.spend / a.leads : 0,
    // Frecuencia aprox: el reach se suma entre días/ads y se solapa → SUBESTIMA la real.
    // Sirve de termómetro de saturación, no como número exacto.
    frequency: a.reach > 0 ? a.impressions / a.reach : 0,
    clickRate: a.impressions > 0 ? a.clicks / a.impressions : 0,
    leadRate: a.clicks > 0 ? a.leads / a.clicks : 0,
  };
}

type AdRow = {
  adId: string; adName: string; campaignName: string; zone: string;
  thumbnailUrl: string | null; status: string | null; previewLink: string | null;
  spend: number; impressions: number; clicks: number; leads: number; reach: number;
  ctr: number; cpl: number;
};
function adOut(a: AdRow) {
  return { adId: a.adId, adName: a.adName, campaignName: a.campaignName, zone: a.zone,
           thumbnailUrl: a.thumbnailUrl, previewLink: a.previewLink, spend: a.spend,
           impressions: a.impressions, clicks: a.clicks, leads: a.leads, ctr: a.ctr, cpl: a.cpl };
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

  // ─── Ad-level Meta (30d sincronizados) — fuente del funnel y del corte por zona ──────
  const adRows = await sql`
    SELECT ad_id, MAX(ad_name) ad_name, MAX(campaign_name) campaign_name,
           MAX(thumbnail_url) thumbnail_url, MAX(effective_status) status, MAX(preview_link) preview_link,
           SUM(spend)::numeric spend, SUM(impressions)::bigint impressions,
           SUM(clicks)::bigint clicks, SUM(purchases)::bigint leads,
           COALESCE(SUM(reach),0)::bigint reach
    FROM meta_ads_creatives
    WHERE client_id = ${cid} AND snapshot_date BETWEEN ${start} AND ${end}
    GROUP BY ad_id`;

  const allAds: AdRow[] = adRows.map((a: any) => {
    const spend = Number(a.spend), impressions = Number(a.impressions), clicks = Number(a.clicks);
    const leads = Number(a.leads), reach = Number(a.reach);
    const campaignName = a.campaign_name ?? '';
    const adName = a.ad_name ?? '(sin nombre)';
    return {
      adId: a.ad_id, adName, campaignName,
      zone: classifyZone(campaignName),
      thumbnailUrl: a.thumbnail_url ?? null, status: a.status, previewLink: a.preview_link ?? null,
      spend, impressions, clicks, leads, reach,
      ctr: impressions > 0 ? clicks / impressions : 0,
      cpl: leads > 0 ? spend / leads : 0,
    };
  });

  const leadgenAds = allAds.filter(a => isManaged(a.campaignName));

  // Funnel general = toda la pauta de Meta
  const overallAgg = emptyAgg();
  for (const a of leadgenAds) addAgg(overallAgg, a);
  const overall = buildFunnel(overallAgg);

  // ─── Por ZONA (Córdoba / Mendoza / Remarketing) ──────────────────────────────
  const zoneAggs: Record<string, Agg> = {};
  for (const a of leadgenAds) { (zoneAggs[a.zone] ??= emptyAgg()); addAgg(zoneAggs[a.zone], a); }
  const ZONE_ORDER = ['Córdoba', 'Mendoza', 'Remarketing', 'General'];
  const zones = Object.keys(zoneAggs)
    .sort((x, y) => (ZONE_ORDER.indexOf(x) + 99) - (ZONE_ORDER.indexOf(y) + 99) || zoneAggs[y].spend - zoneAggs[x].spend)
    .map(name => ({
      name, ...buildFunnel(zoneAggs[name]),
      adCount: leadgenAds.filter(a => a.zone === name).length,
      ads: leadgenAds.filter(a => a.zone === name).sort((p, q) => q.spend - p.spend).map(adOut),
    }));

  // ─── Mejores / peores anuncios ───────────────────────────────────────────────
  // Piso de gasto para "peores": sin él, un ad con $200 y 0 leads aparece como problema.
  const SPEND_FLOOR = 1500;
  // Orden: primero los que MÁS leads trajeron, y a igual volumen el de menor costo.
  // Ordenar por CPL puro dejaba arriba un ad con 1 lead barato por azar y hundía al que
  // trajo 17 — para el cliente eso es engañoso.
  const withLeads = leadgenAds.filter(a => a.leads > 0).sort((a, b) => b.leads - a.leads || a.cpl - b.cpl);
  const noLeads = leadgenAds.filter(a => a.leads === 0 && a.spend >= SPEND_FLOOR).sort((a, b) => b.spend - a.spend);
  const best = (withLeads.length ? withLeads : [...leadgenAds].sort((a, b) => b.ctr - a.ctr)).slice(0, 8).map(adOut);
  const worst = noLeads.slice(0, 8).map(adOut);

  // ─── Serie diaria (evolución) ────────────────────────────────────────────────
  // Responde "¿esto viene mejorando?", que es lo que el reporte no contestaba.
  // El día de hoy está EN CURSO: se marca `partial` para que el front no lo muestre
  // como una caída (a media mañana siempre parece que se desplomó).
  const dailyRows = await sql`
    SELECT snapshot_date::text d, SUM(spend)::numeric spend,
           SUM(impressions)::bigint impressions, SUM(clicks)::bigint clicks,
           SUM(purchases)::bigint leads
    FROM meta_ads_creatives
    WHERE client_id = ${cid} AND snapshot_date BETWEEN ${start} AND ${end}
    GROUP BY snapshot_date ORDER BY snapshot_date`;
  const today = todayISO();
  const daily = dailyRows.map((r: any) => {
    const spend = Number(r.spend), leads = Number(r.leads);
    return { date: r.d, spend, impressions: Number(r.impressions), clicks: Number(r.clicks),
             leads, cpl: leads > 0 ? spend / leads : 0, partial: r.d === today };
  });

  // ─── Campañas de Meta (tabla simple) ─────────────────────────────────────────
  const byCamp: Record<string, Agg> = {};
  for (const a of leadgenAds) { (byCamp[a.campaignName || '(sin nombre)'] ??= emptyAgg()); addAgg(byCamp[a.campaignName || '(sin nombre)'], a); }
  const campaigns = Object.entries(byCamp)
    .map(([name, v]) => ({ name, zone: classifyZone(name), spend: v.spend, clicks: v.clicks,
                           impressions: v.impressions, leads: v.leads, cpl: v.leads > 0 ? v.spend / v.leads : 0 }))
    .sort((a, b) => b.spend - a.spend);

  // ─── Google (campaign-level) ─────────────────────────────────────────────────
  const gRows = await sql`
    SELECT name, SUM(spend)::numeric spend, SUM(impressions)::bigint impressions,
           SUM(clicks)::bigint clicks, SUM(carts)::bigint leads
    FROM google_ads_campaigns
    WHERE client_id = ${cid} AND snapshot_date BETWEEN ${start} AND ${end}
    GROUP BY name ORDER BY SUM(spend) DESC`;
  const gAgg = emptyAgg();
  for (const r of gRows) addAgg(gAgg, { spend: Number(r.spend), impressions: Number(r.impressions), clicks: Number(r.clicks), leads: Number(r.leads), reach: 0 });
  // isPmax: PMax mezcla tipos de conversión (formulario, llamada, visita, etc.) en un solo
  // número. El front lo usa para avisar que NO es comparable con los leads de Meta.
  const isPmax = gRows.some((r: any) => /pmax|performance\s*max/i.test(r.name ?? ''));
  const google = {
    hasData: gAgg.spend > 0,
    isPmax,
    ...buildFunnel(gAgg),
    campaigns: gRows.map((r: any) => {
      const spend = Number(r.spend), leads = Number(r.leads);
      return { name: r.name, spend, clicks: Number(r.clicks), impressions: Number(r.impressions), leads, cpl: leads > 0 ? spend / leads : 0 };
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

  // Primer día con datos: la cuenta arrancó hace poco, así que el rango pedido puede ser
  // más ancho que la vida de la cuenta. El front lo aclara para no mostrar "30 días" de mentira.
  const [firstDay] = await sql`SELECT MIN(snapshot_date)::text d FROM meta_ads_creatives WHERE client_id = ${cid}`;

  const body = {
    config: {
      name: client.name, currency: 'ARS', period: { start, end },
      firstDataDate: firstDay?.d ?? null,
      generatedAt: new Date().toISOString(),
      dataUpdatedAt: upd?.last ?? null,
      metaUpdatedAt: metaUpd?.s ?? null,
      googleUpdatedAt: gUpd?.s ?? null,
    },
    overall,
    daily,
    zones,
    campaigns,
    ads: { best, worst },
    google, demographics,
    // Calidad de lead (calificado / reunión) vive en el CRM, que todavía no está conectado.
    // Estructura preparada y cruce por ad_id listo, igual que en Griba.
    leadQuality: null,
  };

  return new Response(JSON.stringify(body), { headers });
};
