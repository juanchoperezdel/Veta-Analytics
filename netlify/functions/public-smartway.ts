import type { Context } from '@netlify/functions';
import { sql, corsHeaders, errorResponse } from './_db';

// Dashboard público de Smartway — endpoint SIN auth (gate por oscuridad, como hot-sale).
// Slug fijo server-side: nunca devuelve data de otro cliente. Revocar = cambiar el path
// de la página en App.tsx y redeployar.
//
// Smartway es lead-gen B2B. La cuenta corre a la vez cuatro cosas MUY distintas, y
// mezclarlas es lo que rompía la lectura del reporte:
//   1. Instant Form (VETA_Forms_*): el lead se carga en un formulario nativo de Meta,
//      NO hay landing → la etapa "visitas a la landing" es estructuralmente 0.
//   2. Landing (VETA_Web_*): sí lleva al sitio, ahí sí hay visitas.
//   3. Remarketing (VETA_Leads_RMKT_*): audiencia tibia, no compite con prospecting.
//   4. Tráfico (objetivo LINK_CLICKS): NO busca leads. Aportaba el 58% de las
//      impresiones y el 65% de los clicks del "funnel comercial" con 0 leads, y con eso
//      falseaba el CTR y el CPM de toda la cuenta. Va a un bucket aparte.
// Más el webinar Orbatix, que son registros masivos y baratos: si entran al promedio,
// el CPL comercial miente.

const SLUG = 'smartway';

// Campañas que viven en la cuenta pero NO las gestiona Veta (las maneja el cliente o un
// tercero). Se excluyen de todo el reporte para no mezclar responsabilidades.
const UNMANAGED_RE = /novaz/i;
function isManaged(name: string): boolean { return !UNMANAGED_RE.test(name || ''); }

// ─── Que se muestra en "Que esta pasando" ────────────────────────────────────
// El panel de lectura es lo primero que lee el cliente, asi que cada linea que entra
// pesa. Reglas que aplicamos:
//   · Va lo que el cliente puede ACCIONAR o necesita para decidir sobre su presupuesto.
//   · NO va la metodologia interna (por que separamos el trafico del CPM, por que el
//     webinar no entra al promedio): eso ya esta rotulado en cada seccion.
//   · NO va nada que sea un tema NUESTRO en curso (el seguimiento de Google): eso vive
//     en la seccion de Google, dicho como lo que estamos haciendo, no como una alarma.
//   · El ambar se reserva para lo que exige una decision del cliente. Que un rubro
//     todavia este testeando NO es ambar.
// Poner en false para dejar de emitir esa familia de senales.
const SHOW_NOTES = {
  resultado: true,   // leads del periodo y su costo
  rubros:    true,   // que rubro rinde mejor / cual sigue en ajuste
  caminos:   true,   // formulario vs sitio
  webinar:   true,   // registros de Orbatix
  cobertura: true,   // aviso si una seccion no cubre todo el periodo
};

function originLabel(source: string | null): string {
  const s = (source || '').toLowerCase();
  if (/asesor|aseor|derivad|referid/.test(s)) return 'derivación';
  if (/instagram/.test(s)) return 'Instagram';
  if (/facebook/.test(s)) return 'Facebook';
  if (/whats|wsp/.test(s)) return 'WhatsApp';
  if (/web|sitio|landing|google/.test(s)) return 'Sitio web';
  return 'Otro canal';
}

// Fechas en JS (string ISO) — evita la aritmética de fechas con parámetros en Neon.
function iso(d: Date) { return d.toISOString().split('T')[0]; }
function todayISO() { return iso(new Date()); }
function daysAgoISO(n: number) { const d = new Date(); d.setDate(d.getDate() - n); return iso(d); }

// ─── Clasificadores ──────────────────────────────────────────────────────────
// El RUBRO al que le habla la campaña. Desde agosto-2026 la cuenta está verticalizada
// por industria (antes era "Kit 4.0 / Orbatix", nomenclatura muerta que dejaba todo en
// un solo balde llamado "Smartway").
type Vert = string;
function classifyVertical(name: string): Vert {
  const n = (name || '').toLowerCase();
  if (/distribuc|mayorista|distribuidora/.test(n)) return 'Distribución y mayoristas';
  if (/energia|energía|mineria|minería/.test(n))   return 'Energía y minería';
  if (/retail/.test(n))                             return 'Retail';
  if (/kit\s*4|kit4/.test(n))                       return 'Kit 4.0';
  return 'Campañas generales';
}

// El MOTOR de la campaña. Se decide por el objetivo real de Meta cuando está disponible
// (`meta_ads_campaigns.type`), y solo si falta se cae al nombre. El objetivo es el dato
// duro: "Tráfico IG" se detecta como LINK_CLICKS, no adivinando la palabra "tráfico".
type Channel = 'form' | 'landing' | 'remarketing' | 'traffic' | 'webinar';
function classifyChannel(campaign: string, objective: string | null, lpv: number, leads: number): Channel {
  const n = (campaign || '').toLowerCase();
  if (/orbatix/.test(n)) return 'webinar';
  const obj = (objective || '').toUpperCase();
  if (obj === 'LINK_CLICKS' || obj === 'OUTCOME_TRAFFIC' || obj === 'POST_ENGAGEMENT' || obj === 'OUTCOME_ENGAGEMENT') return 'traffic';
  if (/rmkt|remarketing|retarget/.test(n)) return 'remarketing';
  if (/_web|\bweb\b|landing|sitio/.test(n)) return 'landing';
  if (/forms?|instant/.test(n)) return 'form';
  // Sin pista: si hubo visitas a la landing es tráfico a sitio; si hubo leads sin
  // ninguna visita, es formulario nativo de Meta.
  if (lpv > 0) return 'landing';
  if (leads > 0) return 'form';
  return 'form';
}
const CHANNEL_LABEL: Record<Channel, string> = {
  form: 'Formulario en Meta', landing: 'Landing del sitio', remarketing: 'Remarketing',
  traffic: 'Tráfico y alcance', webinar: 'Webinar Orbatix',
};

type Agg = { spend: number; impressions: number; clicks: number; linkClicks: number; lpv: number; leads: number; reach: number };
function emptyAgg(): Agg { return { spend: 0, impressions: 0, clicks: 0, linkClicks: 0, lpv: 0, leads: 0, reach: 0 }; }
function addAgg(a: Agg, r: Agg) {
  a.spend += r.spend; a.impressions += r.impressions; a.clicks += r.clicks;
  a.linkClicks += r.linkClicks; a.lpv += r.lpv; a.leads += r.leads; a.reach += r.reach;
}

// Etapas del funnel con tasa de paso y costo por etapa.
// `hasVisits` decide si la etapa "visitas a la landing" tiene sentido para este bloque:
// en Instant Form NO existe, y mostrarla en 0 hacía leer una caída del 95% que no ocurrió.
function buildFunnel(a: Agg, opts?: { forceNoVisits?: boolean }) {
  // El numerador honesto del funnel es el click AL LINK. `clicks` de Meta incluye
  // reacciones, comentarios y expandir imagen. Si el sync todavía no pobló link_clicks
  // (histórico previo al fix), se cae a `clicks`.
  const linkClicks = a.linkClicks > 0 ? a.linkClicks : a.clicks;
  const hasVisits = a.lpv > 0 && !opts?.forceNoVisits;
  const denom = hasVisits ? a.lpv : linkClicks;
  return {
    spend: a.spend, impressions: a.impressions, clicks: a.clicks, linkClicks, visits: a.lpv, leads: a.leads,
    hasVisits,
    ctr: a.impressions > 0 ? linkClicks / a.impressions : 0,
    ctrAll: a.impressions > 0 ? a.clicks / a.impressions : 0,
    cpm: a.impressions > 0 ? (a.spend / a.impressions) * 1000 : 0,
    cpc: linkClicks > 0 ? a.spend / linkClicks : 0,
    costPerVisit: a.lpv > 0 ? a.spend / a.lpv : 0,
    cpl: a.leads > 0 ? a.spend / a.leads : 0,
    clickRate: a.impressions > 0 ? linkClicks / a.impressions : 0,
    visitRate: linkClicks > 0 ? Math.min(1, a.lpv / linkClicks) : 0,
    // Clampeado a 1: sin el clamp, un lead de Instant Form dividido por 0 visitas daba
    // "340 % pasa de la etapa anterior" impreso literal en la página del cliente.
    leadRate: denom > 0 ? Math.min(1, a.leads / denom) : 0,
  };
}

type AdRow = Agg & {
  adId: string; adName: string; campaignName: string; vertical: Vert; channel: Channel;
  thumbnailUrl: string | null; status: string | null; previewLink: string | null;
  ctr: number; cpl: number;
};

function adOut(a: AdRow) {
  return { adId: a.adId, adName: a.adName, campaignName: a.campaignName, vertical: a.vertical,
           channel: a.channel, channelLabel: CHANNEL_LABEL[a.channel],
           thumbnailUrl: a.thumbnailUrl, previewLink: a.previewLink, spend: a.spend,
           impressions: a.impressions, clicks: a.clicks, linkClicks: a.linkClicks,
           lpv: a.lpv, leads: a.leads, ctr: a.ctr, cpl: a.cpl };
}

function campaignsOf(ads: AdRow[]) {
  const by: Record<string, { spend: number; leads: number; clicks: number; impressions: number; vertical: Vert; channel: Channel }> = {};
  for (const a of ads) {
    const k = a.campaignName || '(sin nombre)';
    (by[k] ??= { spend: 0, leads: 0, clicks: 0, impressions: 0, vertical: a.vertical, channel: a.channel });
    by[k].spend += a.spend; by[k].leads += a.leads;
    by[k].clicks += (a.linkClicks || a.clicks); by[k].impressions += a.impressions;
  }
  return Object.entries(by)
    .map(([name, v]) => ({ name, ...v, channelLabel: CHANNEL_LABEL[v.channel],
                           cpl: v.leads > 0 ? v.spend / v.leads : 0 }))
    .sort((a, b) => b.spend - a.spend);
}

// Bloque de un motor: funnel + campañas + anuncios ordenados por gasto.
function buildBlock(ads: AdRow[], kind: Channel) {
  const agg = emptyAgg();
  for (const a of ads) addAgg(agg, a);
  return {
    kind, label: CHANNEL_LABEL[kind], ...buildFunnel(agg), adCount: ads.length,
    campaigns: campaignsOf(ads),
    ads: [...ads].sort((a, b) => b.spend - a.spend).slice(0, 12).map(adOut),
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

  // Objetivo real por campaña (LINK_CLICKS vs OUTCOME_LEADS): el dato duro para separar
  // el tráfico del lead-gen sin depender del nombre que le puso quien armó la campaña.
  const objRows = await sql`
    SELECT campaign_id, MAX(type) objective
    FROM meta_ads_campaigns
    WHERE client_id = ${cid} AND snapshot_date BETWEEN ${start} AND ${end}
    GROUP BY campaign_id`;
  const objectiveById = new Map<string, string | null>();
  for (const r of objRows) objectiveById.set(String(r.campaign_id), r.objective ?? null);

  // ─── Ad-level Meta — fuente del funnel, verticales y creativos ──────────────
  const adRows = await sql`
    SELECT ad_id, MAX(ad_name) ad_name, MAX(campaign_id) campaign_id, MAX(campaign_name) campaign_name,
           MAX(thumbnail_url) thumbnail_url, MAX(effective_status) status, MAX(preview_link) preview_link,
           SUM(spend)::numeric spend, SUM(impressions)::bigint impressions,
           SUM(clicks)::bigint clicks, COALESCE(SUM(link_clicks),0)::bigint link_clicks,
           COALESCE(SUM(landing_page_view),0)::bigint lpv,
           SUM(purchases)::bigint leads, COALESCE(SUM(reach),0)::bigint reach
    FROM meta_ads_creatives
    WHERE client_id = ${cid} AND snapshot_date BETWEEN ${start} AND ${end}
    GROUP BY ad_id`;

  const allAds: AdRow[] = adRows.map((a: any) => {
    const spend = Number(a.spend), impressions = Number(a.impressions), clicks = Number(a.clicks);
    const linkClicks = Number(a.link_clicks), lpv = Number(a.lpv), leads = Number(a.leads), reach = Number(a.reach);
    const campaignName = a.campaign_name ?? '';
    const objective = objectiveById.get(String(a.campaign_id)) ?? null;
    const effClicks = linkClicks > 0 ? linkClicks : clicks;
    return {
      adId: a.ad_id, adName: a.ad_name ?? '(sin nombre)', campaignName,
      vertical: classifyVertical(`${campaignName} ${a.ad_name ?? ''}`),
      channel: classifyChannel(campaignName, objective, lpv, leads),
      thumbnailUrl: a.thumbnail_url ?? null, status: a.status, previewLink: a.preview_link ?? null,
      spend, impressions, clicks, linkClicks, lpv, leads, reach,
      ctr: impressions > 0 ? effClicks / impressions : 0,
      cpl: leads > 0 ? spend / leads : 0,
    };
  }).filter((a: AdRow) => isManaged(a.campaignName));

  // Lead-gen comercial = todo lo que persigue un lead de negocio. Excluye el webinar
  // (registros masivos que romperían el CPL) y el tráfico (no busca leads).
  const commercialAds = allAds.filter(a => a.channel !== 'webinar' && a.channel !== 'traffic');
  const trafficAds    = allAds.filter(a => a.channel === 'traffic');
  const webinarAds    = allAds.filter(a => a.channel === 'webinar');

  const overallAgg = emptyAgg();
  for (const a of commercialAds) addAgg(overallAgg, a);
  // forceNoVisits: el agregado mezcla campanas de formulario (sin landing) con las de
  // sitio, asi que la etapa de visitas no representa un paso por el que pasen todos.
  const overall = buildFunnel(overallAgg, { forceNoVisits: true });

  // ─── Bloques por motor ──────────────────────────────────────────────────────
  const channels = {
    form:        buildBlock(commercialAds.filter(a => a.channel === 'form'), 'form'),
    landing:     buildBlock(commercialAds.filter(a => a.channel === 'landing'), 'landing'),
    remarketing: buildBlock(commercialAds.filter(a => a.channel === 'remarketing'), 'remarketing'),
  };
  const traffic = trafficAds.length ? buildBlock(trafficAds, 'traffic') : null;
  const webinar = webinarAds.length ? buildBlock(webinarAds, 'webinar') : null;

  // ─── Verticales (rubro) — solo lead-gen comercial ───────────────────────────
  const vertAggs: Record<string, Agg> = {};
  for (const a of commercialAds) { (vertAggs[a.vertical] ??= emptyAgg()); addAgg(vertAggs[a.vertical], a); }
  const verticals = Object.keys(vertAggs)
    .sort((x, y) => vertAggs[y].spend - vertAggs[x].spend)
    .map(name => {
      const own = commercialAds.filter(a => a.vertical === name);
      return {
        name, ...buildFunnel(vertAggs[name]), adCount: own.length,
        campaigns: campaignsOf(own),
        ads: [...own].sort((p, q) => q.spend - p.spend).slice(0, 8).map(adOut),
      };
    });

  const campaignTypes = campaignsOf(commercialAds);

  // ─── Mejores / peores anuncios (lead-gen comercial) ─────────────────────────
  // El piso de gasto escala con el largo del rango: con 7 días, $3.000 fijos marcaban
  // como "a revisar" a cualquier aviso que apenas arrancó.
  const days = Math.max(1, Math.round((new Date(end).getTime() - new Date(start).getTime()) / 86400000) + 1);
  const SPEND_FLOOR = Math.max(1500, 100 * days);
  const withLeads = commercialAds.filter(a => a.leads > 0).sort((a, b) => a.cpl - b.cpl);
  const noLeads = commercialAds.filter(a => a.leads === 0 && a.spend >= SPEND_FLOOR).sort((a, b) => b.spend - a.spend);
  // Si ningún aviso trajo leads, el ranking pasa a ser por CTR — y el front lo dice,
  // en vez de titular "menor costo por lead" sobre una lista ordenada por otra cosa.
  const bestBy: 'cpl' | 'ctr' = withLeads.length ? 'cpl' : 'ctr';
  const best = (withLeads.length ? withLeads : [...commercialAds].sort((a, b) => b.ctr - a.ctr)).slice(0, 6).map(adOut);
  const worst = noLeads.slice(0, 6).map(adOut);

  // ─── Evolución diaria ───────────────────────────────────────────────────────
  // Dos series: la inversión total de Meta (lo que se facturó) y el lead-gen comercial
  // con sus leads. Así el gráfico de barras no promete leads sobre gasto de tráfico.
  const commercialCampaigns = [...new Set(commercialAds.map(a => a.campaignName))];
  const dailyRows = await sql`
    SELECT snapshot_date::text d, SUM(spend)::numeric spend
    FROM meta_ads_creatives
    WHERE client_id = ${cid} AND snapshot_date BETWEEN ${start} AND ${end}
    GROUP BY 1 ORDER BY 1`;
  const dailyCommercial = commercialCampaigns.length ? await sql`
    SELECT snapshot_date::text d, SUM(spend)::numeric spend, SUM(purchases)::bigint leads
    FROM meta_ads_creatives
    WHERE client_id = ${cid} AND snapshot_date BETWEEN ${start} AND ${end}
      AND campaign_name = ANY(${commercialCampaigns})
    GROUP BY 1 ORDER BY 1` : [];
  const dailyMap = new Map(dailyCommercial.map((r: any) => [r.d, r]));
  const daily = dailyRows.map((r: any) => {
    const c: any = dailyMap.get(r.d);
    return { date: r.d, spend: Number(c?.spend ?? 0), leads: Number(c?.leads ?? 0), spendAll: Number(r.spend) };
  });

  // ─── Google (campaign-level) ────────────────────────────────────────────────
  const gRows = await sql`
    SELECT name, SUM(spend)::numeric spend, SUM(impressions)::bigint impressions,
           SUM(clicks)::bigint clicks, COALESCE(SUM(conversions),0)::numeric conversions,
           COALESCE(SUM(all_conversions),0)::numeric all_conversions,
           MAX(snapshot_date)::text last_day
    FROM google_ads_campaigns
    WHERE client_id = ${cid} AND snapshot_date BETWEEN ${start} AND ${end}
    GROUP BY name ORDER BY SUM(spend) DESC`;
  const gAgg = emptyAgg();
  let gConv = 0, gAllConv = 0, gLastDay: string | null = null;
  for (const r of gRows) {
    addAgg(gAgg, { spend: Number(r.spend), impressions: Number(r.impressions), clicks: Number(r.clicks),
                   linkClicks: Number(r.clicks), lpv: 0, leads: 0, reach: 0 });
    gConv += Number(r.conversions); gAllConv += Number(r.all_conversions);
    if (!gLastDay || (r.last_day && r.last_day > gLastDay)) gLastDay = r.last_day;
  }
  const daysSinceGoogle = gLastDay ? Math.round((new Date(end).getTime() - new Date(gLastDay).getTime()) / 86400000) : null;
  const google = {
    hasData: gAgg.spend > 0,
    isPmax: gRows.some((r: any) => /pmax|performance\s*max/i.test(r.name ?? '')),
    // Conversiones PRIMARIAS de la cuenta. Están en 0 porque el seguimiento de Google no
    // está enviando los eventos — es un tema de medición, no de resultado. Las
    // `all_conversions` incluyen acciones secundarias (vistas, clics de teléfono) que
    // NO son leads: se muestran como contexto, nunca como resultado.
    conversions: gConv, allConversions: gAllConv,
    lastActiveDay: gLastDay, daysSinceActive: daysSinceGoogle,
    ...buildFunnel(gAgg),
    campaigns: gRows.map((r: any) => {
      const spend = Number(r.spend), conv = Number(r.conversions);
      return { name: r.name, vertical: classifyVertical(r.name), spend, clicks: Number(r.clicks),
               impressions: Number(r.impressions), leads: conv, allConversions: Number(r.all_conversions),
               cpl: conv > 0 ? spend / conv : 0 };
    }),
  };

  // ─── Demografía (Meta) ──────────────────────────────────────────────────────
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
  // Cobertura real de cada dimensión: si una se dejó de sincronizar (le pasó a `region`
  // por falta de paginación), el front lo avisa en vez de mostrar un corte parcial como
  // si fuera el período completo.
  const demoCovRows = await sql`
    SELECT dimension_type, MAX(snapshot_date)::text last_day, SUM(spend)::numeric spend
    FROM meta_ads_breakdowns
    WHERE client_id = ${cid} AND snapshot_date BETWEEN ${start} AND ${end}
    GROUP BY dimension_type`;
  const metaSpendTotal = allAds.reduce((s, a) => s + a.spend, 0);
  const demoCoverage: Record<string, { lastDay: string | null; coverage: number }> = {};
  for (const r of demoCovRows) {
    demoCoverage[r.dimension_type] = {
      lastDay: r.last_day ?? null,
      coverage: metaSpendTotal > 0 ? Number(r.spend) / metaSpendTotal : 0,
    };
  }

  // ─── Lectura del período ────────────────────────────────────────────────────
  // Cada frase sale de un número calculado arriba. Si un caso no aplica, la línea no
  // se emite. Nada inventado, nada estático.
  type Note = { tone: 'good' | 'warn' | 'info'; text: string };
  const notes: Note[] = [];
  const money = (n: number) => '$' + Math.round(n).toLocaleString('es-AR');
  const spendGoogle = gAgg.spend;
  const spendTotal = metaSpendTotal + spendGoogle;
  const on = (k: keyof typeof SHOW_NOTES) => SHOW_NOTES[k];

  // Resultado del período. El CPL titular es el de Meta, que es donde entran los leads.
  // El costo sobre la inversión total (incluyendo Google) sigue disponible arriba en los
  // KPIs; acá no se remata con él porque en el panel de lectura suena a autocrítica y no
  // a información.
  if (on('resultado')) {
    if (overall.leads > 0) {
      notes.push({ tone: 'info', text: `En el período entraron ${overall.leads} lead${overall.leads === 1 ? '' : 's'} comercial${overall.leads === 1 ? '' : 'es'} a ${money(overall.cpl)} cada uno.` });
    } else if (overall.spend > 0) {
      notes.push({ tone: 'warn', text: `En el período se invirtieron ${money(overall.spend)} en lead-gen y todavía no entró ningún lead.` });
    }
  }

  // Rubro que mejor rinde → dónde apoyar el presupuesto. Es la señal más accionable
  // del panel y la única que además es una buena noticia.
  if (on('rubros')) {
    const vertsWithLeads = verticals.filter(v => v.leads > 0).sort((a, b) => a.cpl - b.cpl);
    if (vertsWithLeads.length >= 2) {
      const top = vertsWithLeads[0], bottom = vertsWithLeads[vertsWithLeads.length - 1];
      if (bottom.cpl / top.cpl >= 1.3) notes.push({
        tone: 'good',
        text: `${top.name} es el rubro más eficiente: cada lead sale ${money(top.cpl)} contra ${money(bottom.cpl)} en ${bottom.name}. Ahí conviene apoyar el presupuesto.`,
      });
    }
    // Rubro sin leads. OJO CON EL TONO: que un rubro todavía no convierta mientras se
    // testea es normal, no una falla — se emite como dato, y solo cuando el peso es
    // grande de verdad (>25% del presupuesto de lead-gen), no ante cualquier monto.
    const vertNoLeads = verticals
      .filter(v => v.leads === 0 && overall.spend > 0 && v.spend / overall.spend >= 0.25)
      .sort((a, b) => b.spend - a.spend)[0];
    if (vertNoLeads) notes.push({
      tone: 'info',
      text: `${vertNoLeads.name} todavía no convirtió en el período: se lleva ${money(vertNoLeads.spend)} de la inversión y es donde estamos ajustando mensaje y segmentación.`,
    });
  }

  // Formulario vs landing. El hecho es el mismo, pero el sujeto de la frase es la
  // DECISIÓN que tomamos, no el número que falló: el cliente necesita saber dónde está
  // yendo su presupuesto y por qué, no leer un diagnóstico sobre su sitio.
  if (on('caminos')) {
    const f = channels.form, l = channels.landing;
    if (f.spend > 0 && l.spend > 0) {
      if (f.leads > 0 && l.leads === 0) notes.push({
        tone: 'info',
        text: `El formulario nativo de Meta está rindiendo mejor que enviar al sitio: los ${f.leads} lead${f.leads === 1 ? '' : 's'} del período entraron por ahí. Estamos concentrando el presupuesto en ese camino y revisando la conversión del sitio con las ${l.visits} visita${l.visits === 1 ? '' : 's'} que ya llevamos.`,
      });
      else if (f.cpl > 0 && l.cpl > 0) notes.push({
        tone: 'info',
        text: `El formulario de Meta trae leads a ${money(f.cpl)} y la landing a ${money(l.cpl)}.`,
      });
    }
  }

  // Webinar: es una buena noticia y explica por qué va aparte.
  if (on('webinar') && webinar && webinar.leads > 0) notes.push({
    tone: 'good',
    text: `El webinar Orbatix trajo ${webinar.leads} registro${webinar.leads === 1 ? '' : 's'} a ${money(webinar.cpl)}. Se miden aparte de los leads comerciales porque un registro a un evento es mucho más accesible.`,
  });

  // Google: por qué NO aparece acá. La inversión de Google está a la vista en los KPIs y
  // el estado del seguimiento se explica en su propia sección, en clave de qué estamos
  // haciendo. Repetirlo en el panel de lectura lo convertía en la alarma más grande de
  // la página, y es un tema de medición nuestro, no un resultado del período.
  //
  // Tráfico y alcance: idem. Tiene su propia sección con el rótulo de que no busca leads.
  // Explicar acá la metodología de por qué se excluye del CPM es conversación interna.

  // Cobertura de la demografía: solo si el hueco es grande. Es un dato de lectura del
  // reporte, no un problema de la cuenta.
  if (on('cobertura')) {
    const regionCov = demoCoverage['region'];
    if (regionCov && regionCov.coverage < 0.75) notes.push({
      tone: 'info',
      text: `La apertura por provincia cubre ${Math.round(regionCov.coverage * 100)}% de la inversión del período (llega hasta el ${regionCov.lastDay ?? '—'}). El resto de las secciones cubre el período completo.`,
    });
  }

  // ─── Frescura y cobertura ───────────────────────────────────────────────────
  const [upd] = await sql`
    SELECT MAX(s) AS last FROM (
      SELECT MAX(synced_at) s FROM meta_ads_campaigns WHERE client_id = ${cid}
      UNION ALL SELECT MAX(synced_at) FROM meta_ads_creatives WHERE client_id = ${cid}
      UNION ALL SELECT MAX(synced_at) FROM google_ads_campaigns WHERE client_id = ${cid}
    ) t`;
  const [metaUpd] = await sql`SELECT MAX(synced_at) s FROM meta_ads_campaigns WHERE client_id = ${cid}`;
  const [gUpd] = await sql`SELECT MAX(synced_at) s FROM google_ads_campaigns WHERE client_id = ${cid}`;
  const [firstDay] = await sql`SELECT MIN(snapshot_date)::text d FROM meta_ads_creatives WHERE client_id = ${cid}`;

  // ─── De qué anuncio vino cada lead (CRM GoHighLevel) ─────────────────────────
  // GHL guarda la atribución al anuncio de Meta (utmAdId/utmContent) en cada contacto;
  // el sync la baja a crm_leads. Se muestra el NOMBRE del lead en el link normal: el
  // owner decidió (16-10-2026) que el reporte solo lo abre el cliente y no hace falta
  // clave. Para volver a exigirla: showNames = url.searchParams.get('k') === env
  // SMARTWAY_LEADS_KEY (sigue cargada en Netlify). Teléfono y email nunca.
  const showNames = true;
  const crmRows = await sql`
    SELECT to_char(l.date_added AT TIME ZONE 'America/Argentina/Buenos_Aires', 'YYYY-MM-DD') AS d,
           l.ad_id, COALESCE(m.ad_name, l.ad_name) AS ad_name, l.campaign, l.source, l.quality, m.thumb,
           l.contact_name
    FROM crm_leads l
    LEFT JOIN (
      SELECT DISTINCT ON (ad_id) ad_id, ad_name, thumbnail_url AS thumb
      FROM meta_ads_creatives WHERE client_id = ${cid} ORDER BY ad_id, snapshot_date DESC
    ) m ON m.ad_id = l.ad_id
    WHERE l.client_id = ${cid}
      AND (l.date_added AT TIME ZONE 'America/Argentina/Buenos_Aires')::date BETWEEN ${start}::date AND ${end}::date
    ORDER BY l.date_added DESC`;
  const [crmUpd] = await sql`SELECT MAX(synced_at) s FROM crm_leads WHERE client_id = ${cid}`;
  const crmLeadRows = crmRows.map((r: any) => {
    const fromAd = !!(r.ad_id || r.ad_name);
    const label = `${r.campaign ?? ''} ${r.ad_name ?? ''}`;
    return {
      name: showNames ? (r.contact_name ?? null) : null,
      date: r.d, adId: r.ad_id ?? null, adName: r.ad_name ?? null, campaign: r.campaign ?? null,
      vertical: !fromAd ? null : /orbatix/i.test(label) ? 'Webinar Orbatix' : classifyVertical(label),
      quality: r.quality ?? 'unclassified',
      // El origen crudo de GHL puede traer el nombre de una persona (ej. la asesora que
      // derivó el lead): se traduce a un canal genérico para no exponerlo.
      origin: fromAd ? 'Meta' : originLabel(r.source),
      thumbnail: r.thumb ?? null,
    };
  });
  const byAdMap = new Map<string, any>();
  for (const r of crmLeadRows) {
    if (!r.adName && !r.adId) continue;
    // Se agrupa por NOMBRE: el mismo anuncio duplicado en varias campañas tiene un ad_id
    // distinto en cada una, pero para el cliente es una sola pieza.
    const k = r.adName || r.adId;
    const e = byAdMap.get(k) || { adId: r.adId, adName: r.adName, campaigns: new Set<string>(), vertical: r.vertical, thumbnail: r.thumbnail, leads: 0, qualified: 0, meeting: 0, lastDate: r.date };
    if (r.campaign) e.campaigns.add(r.campaign);
    if (!e.thumbnail && r.thumbnail) e.thumbnail = r.thumbnail;
    e.leads++;
    if (r.quality === 'qualified') e.qualified++;
    if (r.quality === 'meeting') e.meeting++;
    if (r.date > e.lastDate) e.lastDate = r.date;
    byAdMap.set(k, e);
  }
  const crmLeads = {
    updatedAt: crmUpd?.s ?? null,
    showNames,
    // Leads que reporta Meta en el embudo comercial del mismo período: el front lo usa
    // para mostrar que el CRM los registra a todos (solo si efectivamente es así).
    metaLeads: overall.leads,
    total: crmLeadRows.length,
    fromAds: crmLeadRows.filter(r => r.origin === 'Meta').length,
    rows: crmLeadRows,
    byAd: [...byAdMap.values()].map(({ campaigns, ...a }) => ({
      ...a, campaign: campaigns.size > 1 ? `En ${campaigns.size} campañas` : ([...campaigns][0] ?? null),
    })).sort((a, b) => b.leads - a.leads || b.lastDate.localeCompare(a.lastDate)),
  };

  const body = {
    config: {
      name: client.name, currency: 'ARS', period: { start, end },
      firstDataDate: firstDay?.d ?? null,
      generatedAt: new Date().toISOString(),
      dataUpdatedAt: upd?.last ?? null,
      metaUpdatedAt: metaUpd?.s ?? null,
      googleUpdatedAt: gUpd?.s ?? null,
    },
    // Inversión REAL de la cuenta en el período, para que el cliente pueda reconciliar
    // el número con su facturación. `overall.spend` es solo el lead-gen comercial.
    totals: {
      spendMeta: metaSpendTotal, spendGoogle, spendTotal,
      leads: overall.leads,
      cplTotal: overall.leads > 0 ? spendTotal / overall.leads : 0,
      // Leads de TODA la cuenta de Meta (comercial + webinar + trafico). La demografia
      // la pide Meta a nivel cuenta y no se puede filtrar por campana, asi que sus leads
      // suman este numero y no el comercial. El front lo aclara para que no parezca un
      // descuadre del reporte.
      leadsAllMeta: allAds.reduce((n, a) => n + a.leads, 0),
    },
    overall, channels, traffic, webinar,
    verticals, campaignTypes, daily, notes,
    ads: { best, worst, bestBy, spendFloor: SPEND_FLOOR },
    google, demographics, demoCoverage,
    leadQuality: null,
    crmLeads,
  };

  return new Response(JSON.stringify(body), { headers });
};
