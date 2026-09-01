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

// ¿Se pueden mostrar las conversiones de Google como un RESULTADO? Hoy no.
// Verificado contra la API el 26-08-2026 (desglose por conversion_action, 18-27 ago):
//   Control Pet (web) page_view ....... 66 conversiones  [PAGE_VIEW, primary_for_goal=true]
//   manual_event_SUBMIT_LEAD_FORM ......  0              [primary]
//   Control Pet (web) whatsapp_click ...  0              [primary]
//   Control Pet (web) form_start .......  0
// O sea: el 100% de las "conversiones" son visitas a una página, y como page_view está
// marcada como conversión primaria, PMax está pujando por visitas en lugar de contactos.
// Mostrar ese 52/66 al lado de los leads de Meta haría creer que Google trae contactos
// baratísimos. Hasta que se corrija la configuración, el bloque muestra inversión y
// tráfico, sin etapa de conversión. Cuando se arregle: poner en true.
const GOOGLE_CONVERSIONS_TRUSTED = false;

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
  adId: string; adName: string; campaignName: string; zone: string; variants: number;
  thumbnailUrl: string | null; status: string | null; previewLink: string | null;
  spend: number; impressions: number; clicks: number; leads: number; reach: number;
  ctr: number; cpl: number;
};
function adOut(a: AdRow) {
  return { adId: a.adId, adName: a.adName, campaignName: a.campaignName, zone: a.zone, variants: a.variants,
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
      adId: a.ad_id, adName, campaignName, variants: 1,
      zone: classifyZone(campaignName),
      thumbnailUrl: a.thumbnail_url ?? null, status: a.status, previewLink: a.preview_link ?? null,
      spend, impressions, clicks, leads, reach,
      ctr: impressions > 0 ? clicks / impressions : 0,
      cpl: leads > 0 ? spend / leads : 0,
    };
  });

  const managedAds = allAds.filter(a => isManaged(a.campaignName));

  // El MISMO aviso corre en varios ad sets de una campaña → Meta le da un `ad_id` distinto
  // a cada copia, con el mismo nombre y el mismo creativo. Listarlos por ad_id mostraba
  // "Ad3_Agosto" dos veces con números partidos. Se agrupan por (campaña + nombre) y se
  // suman: para el cliente es un solo aviso. `variants` deja registro de cuántas copias son.
  const byCreative = new Map<string, AdRow>();
  for (const a of managedAds) {
    const key = `${a.campaignName}||${a.adName}`;
    const prev = byCreative.get(key);
    if (!prev) { byCreative.set(key, { ...a }); continue; }
    // el ad_id/preview/thumbnail representativo es el de la copia que más gastó
    const lead = a.spend > prev.spend ? a : prev;
    byCreative.set(key, {
      ...lead,
      variants: prev.variants + a.variants,
      spend: prev.spend + a.spend,
      impressions: prev.impressions + a.impressions,
      clicks: prev.clicks + a.clicks,
      leads: prev.leads + a.leads,
      reach: prev.reach + a.reach,
      ctr: 0, cpl: 0, // se recalculan abajo sobre el total
    });
  }
  const leadgenAds: AdRow[] = [...byCreative.values()].map(a => ({
    ...a,
    ctr: a.impressions > 0 ? a.clicks / a.impressions : 0,
    cpl: a.leads > 0 ? a.spend / a.leads : 0,
  }));

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
  // Calibrado después de agrupar por creativo: con $1.500 se ocultaban tres avisos que
  // juntos se llevaron $3.159 sin traer un solo contacto, que es justo lo que hay que ver.
  const SPEND_FLOOR = 800;
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

  // Ultimo dia en que Google efectivamente gasto. Si quedo viejo, la campana dejo de
  // entregar aunque figure activa: hay que decirlo, no mostrar un total congelado.
  const [gLast] = await sql`
    SELECT MAX(snapshot_date)::text d FROM google_ads_campaigns
    WHERE client_id = ${cid} AND spend > 0`;
  const googleLastActiveDay: string | null = gLast?.d ?? null;
  const daysSinceGoogle = googleLastActiveDay
    ? Math.round((Date.parse(end) - Date.parse(googleLastActiveDay)) / 86400000)
    : null;
  // isPmax: PMax mezcla tipos de conversión (formulario, llamada, visita, etc.) en un solo
  // número. El front lo usa para avisar que NO es comparable con los leads de Meta.
  const isPmax = gRows.some((r: any) => /pmax|performance\s*max/i.test(r.name ?? ''));
  const google = {
    hasData: gAgg.spend > 0,
    isPmax,
    conversionsTrusted: GOOGLE_CONVERSIONS_TRUSTED,
    lastActiveDay: googleLastActiveDay,
    daysSinceActive: daysSinceGoogle,
    // Qué está contando Google hoy (verificado por conversion_action, ver constante arriba)
    conversionsAre: 'page_view',
    ...buildFunnel(gAgg),
    campaigns: gRows.map((r: any) => {
      const spend = Number(r.spend), leads = Number(r.leads);
      return { name: r.name, spend, clicks: Number(r.clicks), impressions: Number(r.impressions), leads, cpl: leads > 0 ? spend / leads : 0 };
    }),
  };

  // ─── Lectura del período ─────────────────────────────────────────────────────
  // Los hechos que un analista señalaría, calculados sobre la data del período. No hay
  // texto inventado: cada frase sale de un número de arriba. Si un caso no aplica
  // (una sola zona, sin leads, etc.) la línea simplemente no se emite.
  type Note = { tone: 'good' | 'warn' | 'info'; text: string };
  const notes: Note[] = [];
  const money = (n: number) => '$' + Math.round(n).toLocaleString('es-AR');
  const pct = (n: number) => (n * 100).toFixed(n < 0.1 ? 1 : 0).replace('.', ',') + '%';

  // 1) Concentración y rendimiento por zona
  const zonesByLeads = [...zones].filter(z => z.spend > 0).sort((a, b) => b.leads - a.leads);
  if (zonesByLeads.length >= 2 && overall.leads > 0) {
    const top = zonesByLeads[0];
    const rest = zonesByLeads.slice(1);
    const worst = [...rest].sort((a, b) => b.spend - a.spend)[0];
    notes.push({
      tone: 'info',
      text: `${top.name} concentra ${pct(top.spend / overall.spend)} de la inversión y ${pct(top.leads / overall.leads)} de los contactos.`,
    });
    if (top.cpl > 0 && worst.cpl > 0) {
      const ratio = worst.cpl / top.cpl;
      if (ratio >= 1.3) notes.push({
        tone: 'good',
        text: `Cada contacto de ${top.name} sale ${money(top.cpl)} y uno de ${worst.name} ${money(worst.cpl)}: ${ratio.toFixed(1).replace('.', ',')} veces más caro. La plata rinde mejor en ${top.name}.`,
      });
    } else if (worst.leads === 0 && worst.spend > 0) {
      notes.push({
        tone: 'warn',
        text: `${worst.name} lleva ${money(worst.spend)} invertidos y todavía no trajo ningún contacto.`,
      });
    }
  }

  // 2) El ganador. OJO CON EL TONO: que un aviso concentre los contactos es cómo
  // funciona Meta — el algoritmo prueba, encuentra el que rinde y le vuelca la
  // entrega. Es una buena noticia, no una fragilidad. Solo si la dependencia es
  // extrema Y no hay un segundo aviso con volumen se agrega el matiz, y aun así
  // como dato, nunca como alarma.
  if (best.length > 0 && overall.leads > 0) {
    const star = best[0];
    const share = star.leads / overall.leads;
    if (share >= 0.4) {
      const second = best[1];
      const secondOk = second && second.leads >= Math.max(2, star.leads * 0.25);
      notes.push({
        tone: 'good',
        text: secondOk
          ? `Meta ya encontró lo que funciona: "${star.adName}" (${star.zone}) trajo ${star.leads} de los ${overall.leads} contactos a ${money(star.cpl)} cada uno, con "${second.adName}" acompañando. El presupuesto se está volcando solo a lo que rinde.`
          : `Meta ya encontró lo que funciona: "${star.adName}" (${star.zone}) trajo ${star.leads} de los ${overall.leads} contactos a ${money(star.cpl)} cada uno. Conviene ir preparando un segundo aviso que lo acompañe, para cuando este se desgaste.`,
      });
    }
  }

  // 3) Avisos sin contactos. OJO CON EL TONO: que varios avisos no traigan nada NO es
  // un problema, es cómo aprende Meta — reparte, mide y corta. Esa plata es el costo
  // de descubrir cuál funciona. Solo pasa a advertencia si la porción es DESPROPORCIONADA
  // (más de un tercio del presupuesto) o si un aviso suelto se comió mucho sin devolver.
  const deadAds = leadgenAds.filter(a => a.leads === 0);
  const deadSpend = deadAds.reduce((acc, a) => acc + a.spend, 0);
  const deadShare = overall.spend > 0 ? deadSpend / overall.spend : 0;
  const worstSingle = [...deadAds].sort((a, b) => b.spend - a.spend)[0];
  const singleShare = worstSingle && overall.spend > 0 ? worstSingle.spend / overall.spend : 0;
  if (deadAds.length > 0 && deadShare >= 0.03) {
    if (deadShare > 0.35) {
      notes.push({
        tone: 'warn',
        text: `${pct(deadShare)} del presupuesto (${money(deadSpend)}) se fue en avisos que no trajeron contactos. Es una porción alta: vale la pena cortar los que ya tuvieron prueba suficiente y concentrar en los que rinden.`,
      });
    } else if (singleShare >= 0.15) {
      notes.push({
        tone: 'warn',
        text: `El aviso "${worstSingle.adName}" (${worstSingle.zone}) se llevó ${money(worstSingle.spend)} — ${pct(singleShare)} de la inversión — sin traer un solo contacto. Ese sí conviene cortarlo.`,
      });
    } else {
      notes.push({
        tone: 'info',
        text: `${deadAds.length} de los ${leadgenAds.length} avisos no trajeron contactos y se llevaron ${money(deadSpend)} (${pct(deadShare)} de la inversión). Es lo normal y lo esperable: Meta reparte para probar, mide cuál funciona y vuelca el resto del presupuesto ahí. Esa parte es el costo de averiguarlo.`,
      });
    }
  }

  // 4) Tendencia: primera mitad vs segunda mitad del período (excluyendo el día en curso)
  const closed = daily.filter(d => !d.partial);
  if (closed.length >= 4) {
    const mid = Math.floor(closed.length / 2);
    const sum = (arr: typeof closed, k: 'spend' | 'leads') => arr.reduce((a, x) => a + x[k], 0);
    const l1 = sum(closed.slice(0, mid), 'leads'), l2 = sum(closed.slice(mid), 'leads');
    const s1 = sum(closed.slice(0, mid), 'spend'), s2 = sum(closed.slice(mid), 'spend');
    const cpl1 = l1 > 0 ? s1 / l1 : 0, cpl2 = l2 > 0 ? s2 / l2 : 0;
    if (l2 > l1) notes.push({
      tone: 'good',
      text: `Los contactos vienen en alza: ${l1} en los primeros ${mid} días y ${l2} en los últimos ${closed.length - mid}.`,
    });
    if (cpl1 > 0 && cpl2 > 0 && cpl2 < cpl1 * 0.85) notes.push({
      tone: 'good',
      text: `El costo por contacto bajó de ${money(cpl1)} a ${money(cpl2)} en la segunda mitad del período.`,
    });
  }

  // 5) Google dejo de entregar
  if (googleLastActiveDay && daysSinceGoogle !== null && daysSinceGoogle >= 2) {
    const [, m, d] = googleLastActiveDay.split('-');
    notes.push({
      tone: 'warn',
      text: `Google dejó de mostrar avisos el ${d}/${m} (${daysSinceGoogle} días) aunque la campaña figura activa. Lo estamos destrabando; mientras tanto los contactos siguen entrando por Meta.`,
    });
  }

  // 6) Estado de la medición en Google
  if (google.hasData && !GOOGLE_CONVERSIONS_TRUSTED) notes.push({
    tone: 'warn',
    text: `Google registró ${money(gAgg.spend)} de inversión, pero lo que hoy cuenta como conversión son visitas a una página, no contactos. Hasta corregir esa medición, los contactos que se ven acá son los de Meta.`,
  });

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
    notes,
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
