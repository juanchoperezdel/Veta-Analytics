import type { Context } from '@netlify/functions';
import { sql, corsHeaders, errorResponse } from './_db';

// Dashboard público de Smartway — endpoint SIN auth (gate por oscuridad, como hot-sale).
// El slug está fijado server-side: este endpoint NUNCA devuelve data de otro cliente.
// Para revocar el acceso, cambiar el path de la página en App.tsx y redeployar.
//
// Smartway es lead-gen (no e-commerce): la métrica primaria es CONVERSIONES (leads/
// registros/mensajes — ver extractMetaConversions en el sync), no ventas/ROAS. Por eso
// el KPI headline es CPL (costo por conversión), no ROAS.

const SLUG = 'smartway';
const DAYS = 30;

type Health = { status: 'scale' | 'ok' | 'optimize' | 'pause'; reason: string };

// Salud por reglas simples de lead-gen (sin ROAS): mira gasto y conversiones de 7d.
function scoreHealth(last7Spend: number, last7Conv: number, accountCpl: number): Health {
  if (last7Spend < 5000) return { status: 'ok', reason: 'Bajo gasto en 7d, no es prioritaria.' };
  if (last7Conv === 0) return { status: 'pause', reason: `0 conversiones con $${last7Spend.toFixed(0)} en 7d. Revisar urgente.` };
  const cpl = last7Spend / last7Conv;
  if (accountCpl > 0 && cpl <= accountCpl * 0.7) return { status: 'scale', reason: `CPL $${cpl.toFixed(0)} (mejor que el promedio). Considerá subir presupuesto.` };
  if (accountCpl > 0 && cpl >= accountCpl * 1.5) return { status: 'optimize', reason: `CPL $${cpl.toFixed(0)} (peor que el promedio). Revisar creativos o segmentación.` };
  return { status: 'ok', reason: `CPL $${cpl.toFixed(0)} en línea con el promedio.` };
}

function delta(c: number, p: number) { return (!p || p === 0) ? 0 : (c - p) / p; }

export default async (req: Request, _context: Context) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: corsHeaders() });

  const [client] = await sql`SELECT id, name FROM clients WHERE slug = ${SLUG}`;
  if (!client) return errorResponse('Client not found', 404);
  const cid = client.id;

  // ─── META: KPIs headline (spend + conversiones + reach, rango completo) ──────
  const [metaCurr] = await sql`
    SELECT COALESCE(SUM(spend),0)::numeric spend,
           COALESCE(SUM(purchases),0)::bigint conv,
           COALESCE(SUM(reach),0)::bigint reach
    FROM meta_ads_campaigns
    WHERE client_id = ${cid} AND snapshot_date >= CURRENT_DATE - 29`;
  const [metaPrev] = await sql`
    SELECT COALESCE(SUM(spend),0)::numeric spend, COALESCE(SUM(purchases),0)::bigint conv
    FROM meta_ads_campaigns
    WHERE client_id = ${cid}
      AND snapshot_date BETWEEN (CURRENT_DATE - 29)::date - INTERVAL '1 month'
                            AND (CURRENT_DATE)::date - INTERVAL '1 month'`;
  // Impresiones/clicks de Meta: la tabla de campañas no los guarda → se suman del
  // breakdown por edad (cobertura ~total de la cuenta). Best-effort para CTR.
  const [metaImpr] = await sql`
    SELECT COALESCE(SUM(impressions),0)::bigint impressions, COALESCE(SUM(clicks),0)::bigint clicks
    FROM meta_ads_breakdowns
    WHERE client_id = ${cid} AND dimension_type = 'age'
      AND snapshot_date >= CURRENT_DATE - 29`;

  const metaSpend = Number(metaCurr.spend), metaConv = Number(metaCurr.conv);
  const metaImpressions = Number(metaImpr?.impressions ?? 0), metaClicks = Number(metaImpr?.clicks ?? 0);
  const meta = {
    spend: metaSpend,
    conversions: metaConv,
    cpl: metaConv > 0 ? metaSpend / metaConv : 0,
    reach: Number(metaCurr.reach),
    impressions: metaImpressions,
    clicks: metaClicks,
    ctr: metaImpressions > 0 ? metaClicks / metaImpressions : 0,
    deltas: {
      spend: delta(metaSpend, Number(metaPrev.spend)),
      conversions: delta(metaConv, Number(metaPrev.conv)),
    },
  };

  // ─── GOOGLE: KPIs headline (la tabla guarda impresiones/clicks/ctr) ──────────
  const [gCurr] = await sql`
    SELECT COALESCE(SUM(spend),0)::numeric spend, COALESCE(SUM(carts),0)::bigint conv,
           COALESCE(SUM(impressions),0)::bigint impressions, COALESCE(SUM(clicks),0)::bigint clicks
    FROM google_ads_campaigns
    WHERE client_id = ${cid} AND snapshot_date >= CURRENT_DATE - 29`;
  const [gPrev] = await sql`
    SELECT COALESCE(SUM(spend),0)::numeric spend, COALESCE(SUM(carts),0)::bigint conv
    FROM google_ads_campaigns
    WHERE client_id = ${cid}
      AND snapshot_date BETWEEN (CURRENT_DATE - 29)::date - INTERVAL '1 month'
                            AND (CURRENT_DATE)::date - INTERVAL '1 month'`;
  const gSpend = Number(gCurr.spend), gConv = Number(gCurr.conv);
  const gImpr = Number(gCurr.impressions), gClicks = Number(gCurr.clicks);
  const google = {
    spend: gSpend,
    conversions: gConv,
    cpl: gConv > 0 ? gSpend / gConv : 0,
    impressions: gImpr,
    clicks: gClicks,
    ctr: gImpr > 0 ? gClicks / gImpr : 0,
    deltas: {
      spend: delta(gSpend, Number(gPrev.spend)),
      conversions: delta(gConv, Number(gPrev.conv)),
    },
    hasData: gSpend > 0,
  };

  const totalSpend = metaSpend + gSpend;
  const totalConv = metaConv + gConv;
  const total = {
    spend: totalSpend,
    conversions: totalConv,
    cpl: totalConv > 0 ? totalSpend / totalConv : 0,
  };

  // ─── CAMPAÑAS Meta (agregadas en el rango) + salud ──────────────────────────
  const metaCampRows = await sql`
    SELECT campaign_id, MAX(segment) name, MAX(effective_status) status,
           SUM(spend)::numeric spend, SUM(purchases)::bigint conv
    FROM meta_ads_campaigns
    WHERE client_id = ${cid} AND snapshot_date >= CURRENT_DATE - 29
    GROUP BY campaign_id ORDER BY SUM(spend) DESC`;
  const metaLast7 = await sql`
    SELECT campaign_id, SUM(spend)::numeric spend, SUM(purchases)::bigint conv
    FROM meta_ads_campaigns
    WHERE client_id = ${cid} AND snapshot_date >= CURRENT_DATE - 6
    GROUP BY campaign_id`;
  const metaL7 = new Map(metaLast7.map((r: any) => [r.campaign_id, r]));
  const accountCplMeta = meta.cpl;
  const metaCampaigns = metaCampRows.map((c: any) => {
    const spend = Number(c.spend), conv = Number(c.conv);
    const l7 = metaL7.get(c.campaign_id) as any;
    return {
      id: c.campaign_id, name: c.name ?? '(sin nombre)', platform: 'meta' as const,
      status: c.status, spend, conversions: conv,
      cpl: conv > 0 ? spend / conv : 0,
      health: scoreHealth(Number(l7?.spend ?? 0), Number(l7?.conv ?? 0), accountCplMeta),
    };
  });

  // ─── CAMPAÑAS Google (agregadas) + salud ────────────────────────────────────
  const gCampRows = await sql`
    SELECT campaign_id, MAX(name) name,
           SUM(spend)::numeric spend, SUM(carts)::bigint conv,
           SUM(clicks)::numeric / NULLIF(SUM(impressions)::numeric,0) ctr
    FROM google_ads_campaigns
    WHERE client_id = ${cid} AND snapshot_date >= CURRENT_DATE - 29
    GROUP BY campaign_id ORDER BY SUM(spend) DESC`;
  const gLast7 = await sql`
    SELECT campaign_id, SUM(spend)::numeric spend, SUM(carts)::bigint conv
    FROM google_ads_campaigns
    WHERE client_id = ${cid} AND snapshot_date >= CURRENT_DATE - 6
    GROUP BY campaign_id`;
  const gL7 = new Map(gLast7.map((r: any) => [r.campaign_id, r]));
  const accountCplG = google.cpl;
  const googleCampaigns = gCampRows.map((c: any) => {
    const spend = Number(c.spend), conv = Number(c.conv);
    const l7 = gL7.get(c.campaign_id) as any;
    return {
      id: c.campaign_id, name: c.name ?? '(sin nombre)', platform: 'google' as const,
      status: null, spend, conversions: conv, ctr: Number(c.ctr ?? 0),
      cpl: conv > 0 ? spend / conv : 0,
      health: scoreHealth(Number(l7?.spend ?? 0), Number(l7?.conv ?? 0), accountCplG),
    };
  });

  // ─── MEJORES / PEORES ANUNCIOS (Meta, ad-level con thumbnails, 14 días) ──────
  const adRows = await sql`
    SELECT ad_id, MAX(ad_name) ad_name, MAX(campaign_name) campaign_name,
           MAX(thumbnail_url) thumbnail_url, MAX(effective_status) status,
           SUM(spend)::numeric spend, SUM(impressions)::bigint impressions,
           SUM(clicks)::bigint clicks, SUM(purchases)::bigint conv
    FROM meta_ads_creatives
    WHERE client_id = ${cid} AND snapshot_date >= CURRENT_DATE - 13
    GROUP BY ad_id
    HAVING SUM(spend) > 0
    ORDER BY SUM(spend) DESC`;
  const ads = adRows.map((a: any) => {
    const spend = Number(a.spend), conv = Number(a.conv);
    const impr = Number(a.impressions), clicks = Number(a.clicks);
    return {
      adId: a.ad_id, adName: a.ad_name ?? '(sin nombre)', campaignName: a.campaign_name ?? '',
      thumbnailUrl: a.thumbnail_url ?? null, status: a.status,
      spend, conversions: conv, impressions: impr, clicks,
      ctr: impr > 0 ? clicks / impr : 0,
      cpl: conv > 0 ? spend / conv : 0,
    };
  });
  // Mejores: con conversiones, menor CPL; desempate por CTR. Peores: con gasto
  // relevante y 0 conversiones (plata sin resultado), ordenados por gasto.
  const SPEND_FLOOR = 3000;
  const withConv = ads.filter(a => a.conversions > 0).sort((a, b) => a.cpl - b.cpl);
  const noConv = ads.filter(a => a.conversions === 0 && a.spend >= SPEND_FLOOR).sort((a, b) => b.spend - a.spend);
  const best = (withConv.length ? withConv : [...ads].sort((a, b) => b.ctr - a.ctr)).slice(0, 6);
  const worst = noConv.slice(0, 6);

  // ─── DEMOGRAFÍA (Meta, top por gasto en cada dimensión) ──────────────────────
  const demoRows = await sql`
    SELECT dimension_type, dimension_value,
           SUM(spend)::numeric spend, SUM(purchases)::bigint conv, SUM(impressions)::bigint impressions
    FROM meta_ads_breakdowns
    WHERE client_id = ${cid} AND snapshot_date >= CURRENT_DATE - 29
    GROUP BY dimension_type, dimension_value
    HAVING SUM(spend) > 0`;
  const demographics: Record<string, any[]> = { age: [], gender: [], region: [], publisher_platform: [] };
  for (const r of demoRows) {
    const t = r.dimension_type;
    if (!demographics[t]) demographics[t] = [];
    const spend = Number(r.spend), conv = Number(r.conv);
    demographics[t].push({
      value: r.dimension_value, spend, conversions: conv,
      cpl: conv > 0 ? spend / conv : 0, impressions: Number(r.impressions),
    });
  }
  for (const k of Object.keys(demographics)) {
    demographics[k].sort((a, b) => b.spend - a.spend);
    demographics[k] = demographics[k].slice(0, 8);
  }

  const body = {
    config: { name: client.name, currency: 'ARS', days: DAYS, generatedAt: new Date().toISOString() },
    kpis: { total, meta, google },
    campaigns: [...metaCampaigns, ...googleCampaigns].sort((a, b) => b.spend - a.spend),
    ads: { best, worst },
    demographics,
  };

  return new Response(JSON.stringify(body), { headers: corsHeaders() });
};