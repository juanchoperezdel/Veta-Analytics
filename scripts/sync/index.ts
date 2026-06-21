import { neon } from '@neondatabase/serverless';
import { SignJWT, importPKCS8 } from 'jose';
import { parseRoute } from './parse-routes';

const sql = neon(process.env.DATABASE_URL!);

function dateRange(daysBack: number): { since: string; until: string } {
  const until = new Date();
  const since = new Date();
  since.setDate(since.getDate() - daysBack);
  return {
    since: since.toISOString().split('T')[0],
    until: until.toISOString().split('T')[0],
  };
}

function ga4DateToISO(d: string): string {
  // GA4 returns YYYYMMDD
  return `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)}`;
}

// ─── Meta Ads ───────────────────────────────────────────────────────────────

// Conversión primaria de una cuenta Meta. Toma el primer action_type de la lista de
// prioridad con valor > 0 → elige UN solo evento (evita doble conteo entre fb_pixel /
// omni / onsite). Cubre e-commerce (purchase) y lead-gen (leads / registros / mensajes),
// así una cuenta como Smartway (sin compras) reporta sus leads en vez de 0.
const META_CONV_PRIORITY = [
  'purchase',
  'offsite_conversion.fb_pixel_purchase',
  'omni_purchase',
  'lead',
  'offsite_conversion.fb_pixel_lead',
  'onsite_web_lead',
  'onsite_conversion.lead_grouped',
  'complete_registration',
  'omni_complete_registration',
  'offsite_conversion.fb_pixel_complete_registration',
  'onsite_conversion.messaging_conversation_started_7d',
];
function extractMetaConversions(actions: any[]): number {
  if (!actions?.length) return 0;
  for (const t of META_CONV_PRIORITY) {
    const f = actions.find((a: any) => a.action_type === t);
    if (f && Number(f.value) > 0) return Number(f.value);
  }
  return 0;
}

async function syncMetaAds(clientId: string, adAccountId: string, accessToken: string) {
  const { since, until } = dateRange(30);
  const fields = [
    'campaign_id', 'campaign_name', 'objective', 'date_start',
    'spend', 'reach', 'impressions', 'clicks', 'ctr', 'cpc',
    'actions', 'action_values',
  ].join(',');

  // Forzamos attribution window estándar (7d_click + 1d_view) y incluimos todos los effective_status
  // para capturar campañas pausadas/archivadas con impresiones en el rango.
  const attribution = JSON.stringify(['7d_click', '1d_view']);
  const filtering = JSON.stringify([{
    field: 'campaign.effective_status',
    operator: 'IN',
    value: ['ACTIVE','PAUSED','DELETED','ARCHIVED','PENDING_REVIEW','DISAPPROVED','PREAPPROVED',
            'PENDING_BILLING_INFO','CAMPAIGN_PAUSED','ADSET_PAUSED','IN_PROCESS','WITH_ISSUES'],
  }]);

  const url = `https://graph.facebook.com/v21.0/act_${adAccountId}/insights?` +
    `level=campaign&time_increment=1` +
    `&time_range=${encodeURIComponent(JSON.stringify({ since, until }))}` +
    `&use_unified_attribution_setting=true` +
    `&action_attribution_windows=${encodeURIComponent(attribution)}` +
    `&filtering=${encodeURIComponent(filtering)}` +
    `&fields=${fields}&access_token=${accessToken}&limit=500`;

  const res = await fetch(url);
  if (!res.ok) throw new Error(`Meta API error: ${res.status} ${await res.text()}`);
  const body = await res.json();
  const data: any[] = body.data ?? [];

  // Para saber el effective_status actual (no viene en insights), una query paralela.
  const statusByCampaign = new Map<string, string>();
  try {
    const sRes = await fetch(
      `https://graph.facebook.com/v21.0/act_${adAccountId}/campaigns?` +
      `fields=id,effective_status&limit=500&access_token=${accessToken}`
    );
    if (sRes.ok) {
      const sBody = await sRes.json();
      for (const c of (sBody.data ?? [])) statusByCampaign.set(c.id, c.effective_status);
    }
  } catch { /* status es opcional */ }

  for (const row of data) {
    const date      = row.date_start;
    const objective = row.objective ?? null;
    const status    = statusByCampaign.get(row.campaign_id) ?? null;
    const spend     = parseFloat(row.spend ?? '0');
    // Conversión primaria de la cuenta (purchase para e-commerce; lead/registro/mensaje
    // para lead-gen). Se guarda en la columna `purchases` (= conversiones primarias).
    const purchases = extractMetaConversions(row.actions ?? []);
    const revenue   = parseFloat((row.action_values ?? []).find((a: any) => a.action_type === 'purchase')?.value ?? '0');
    const cpa       = Number(purchases) > 0 ? spend / Number(purchases) : 0;
    const roas      = spend > 0 ? revenue / spend : 0;

    const route     = parseRoute(row.campaign_name);

    await sql`
      INSERT INTO meta_ads_campaigns
        (client_id, snapshot_date, campaign_id, type, effective_status, segment,
         spend, reach, purchases, revenue, cpa, roas, ctr, cpc, route)
      VALUES
        (${clientId}, ${date}, ${row.campaign_id}, ${objective}, ${status}, ${row.campaign_name},
         ${spend}, ${parseInt(row.reach ?? '0')}, ${purchases}, ${revenue},
         ${cpa}, ${roas}, ${parseFloat(row.ctr ?? '0')}, ${parseFloat(row.cpc ?? '0')}, ${route})
      ON CONFLICT (client_id, snapshot_date, campaign_id)
      DO UPDATE SET
        type = EXCLUDED.type, effective_status = EXCLUDED.effective_status, segment = EXCLUDED.segment,
        spend = EXCLUDED.spend, reach = EXCLUDED.reach, purchases = EXCLUDED.purchases,
        revenue = EXCLUDED.revenue, cpa = EXCLUDED.cpa, roas = EXCLUDED.roas,
        ctr = EXCLUDED.ctr, cpc = EXCLUDED.cpc, route = EXCLUDED.route, synced_at = NOW()
    `;
  }

  console.log(`✓ Meta Ads synced: ${data.length} daily rows`);
}

// ─── Google Ads ──────────────────────────────────────────────────────────────

async function getGoogleAccessToken(): Promise<string> {
  const sa = JSON.parse(process.env.GOOGLE_ADS_SERVICE_ACCOUNT_JSON!);
  const privateKey = await importPKCS8(sa.private_key, 'RS256');
  const now = Math.floor(Date.now() / 1000);
  const jwt = await new SignJWT({ scope: 'https://www.googleapis.com/auth/adwords' })
    .setProtectedHeader({ alg: 'RS256' })
    .setIssuedAt(now)
    .setExpirationTime(now + 3600)
    .setIssuer(sa.client_email)
    .setSubject(sa.client_email)
    .setAudience('https://oauth2.googleapis.com/token')
    .sign(privateKey);

  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion: jwt,
    }),
  });
  const { access_token, error, error_description } = await res.json() as any;
  if (!access_token) throw new Error(`Google Ads token error: ${error} ${error_description}`);
  return access_token;
}

async function syncGoogleAds(clientId: string, customerId: string) {
  const accessToken = await getGoogleAccessToken();
  // BETWEEN explícito en lugar de LAST_30_DAYS para incluir el día corriente
  // (LAST_*_DAYS de Google Ads API excluye TODAY, dejando 24h de delay).
  const { since, until } = dateRange(30);

  const query = `
    SELECT
      segments.date,
      campaign.id, campaign.name,
      metrics.cost_micros, metrics.impressions, metrics.clicks,
      metrics.ctr, metrics.average_cpc,
      metrics.conversions, metrics.conversions_value
    FROM campaign
    WHERE segments.date BETWEEN '${since}' AND '${until}'
      AND metrics.cost_micros > 0
    ORDER BY segments.date DESC, metrics.cost_micros DESC
  `;

  const res = await fetch(
    `https://googleads.googleapis.com/v20/customers/${customerId}/googleAds:searchStream`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'developer-token': process.env.GOOGLE_ADS_DEV_TOKEN!,
        'login-customer-id': process.env.GOOGLE_ADS_LOGIN_CUSTOMER_ID!,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ query }),
    }
  );

  if (!res.ok) throw new Error(`Google Ads API error: ${res.status} ${await res.text()}`);
  const batches: any[] = await res.json();
  const results = batches.flatMap((b: any) => b.results ?? []);

  for (const row of results) {
    const date        = row.segments.date;
    const spend       = (row.metrics.costMicros ?? 0) / 1_000_000;
    const conversions = parseFloat(row.metrics.conversions ?? '0');
    const revenue     = parseFloat(row.metrics.conversionsValue ?? '0');

    const route       = parseRoute(row.campaign.name);

    await sql`
      INSERT INTO google_ads_campaigns
        (client_id, snapshot_date, campaign_id, name, spend, impressions, clicks, ctr, cpc, carts, revenue, roas, route)
      VALUES
        (${clientId}, ${date}, ${String(row.campaign.id)}, ${row.campaign.name},
         ${spend}, ${row.metrics.impressions ?? 0}, ${row.metrics.clicks ?? 0},
         ${parseFloat(row.metrics.ctr ?? '0')},
         ${(row.metrics.averageCpc ?? 0) / 1_000_000},
         ${Math.round(conversions)}, ${revenue},
         ${spend > 0 ? revenue / spend : 0},
         ${route})
      ON CONFLICT (client_id, snapshot_date, campaign_id)
      DO UPDATE SET
        spend = EXCLUDED.spend, impressions = EXCLUDED.impressions, clicks = EXCLUDED.clicks,
        ctr = EXCLUDED.ctr, cpc = EXCLUDED.cpc, carts = EXCLUDED.carts,
        revenue = EXCLUDED.revenue, roas = EXCLUDED.roas,
        route = EXCLUDED.route, synced_at = NOW()
    `;
  }

  console.log(`✓ Google Ads synced: ${results.length} daily rows`);
}

// ─── YouTube Ads (via Google Ads API) ────────────────────────────────────────

async function syncYouTube(clientId: string, customerId: string) {
  const accessToken = await getGoogleAccessToken();
  const { since, until } = dateRange(30);

  const query = `
    SELECT
      segments.date,
      ad_group_ad.ad.video_ad.video.id,
      ad_group_ad.ad.name,
      campaign.name,
      metrics.cost_micros, metrics.impressions, metrics.clicks,
      metrics.ctr, metrics.all_conversions, metrics.all_conversions_value
    FROM ad_group_ad
    WHERE segments.date BETWEEN '${since}' AND '${until}'
      AND campaign.advertising_channel_type = 'VIDEO'
      AND metrics.cost_micros > 0
    ORDER BY segments.date DESC, metrics.cost_micros DESC
    LIMIT 500
  `;

  const res = await fetch(
    `https://googleads.googleapis.com/v19/customers/${customerId}/googleAds:search`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'developer-token': process.env.GOOGLE_ADS_DEV_TOKEN!,
        'login-customer-id': process.env.GOOGLE_ADS_LOGIN_CUSTOMER_ID!,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ query }),
    }
  );

  if (!res.ok) throw new Error(`YouTube API error: ${res.status} ${await res.text()}`);
  const { results = [] }: { results: any[] } = await res.json();

  for (const row of results) {
    const date        = row.segments.date;
    const videoId     = row.adGroupAd?.ad?.videoAd?.video?.id ?? row.adGroupAd?.ad?.name ?? 'unknown';
    const title       = row.adGroupAd?.ad?.name ?? 'Sin título';
    const campaign    = row.campaign?.name ?? '';
    const spend       = (row.metrics?.costMicros ?? 0) / 1_000_000;
    const impressions = Number(row.metrics?.impressions ?? 0);
    const clicks      = Number(row.metrics?.clicks ?? 0);
    const ctr         = parseFloat(row.metrics?.ctr ?? '0');
    const conversions = parseFloat(row.metrics?.allConversions ?? '0');
    const convRate    = impressions > 0 ? conversions / impressions : 0;

    await sql`
      INSERT INTO youtube_videos
        (client_id, snapshot_date, video_id, title, campaign, impressions, clicks, ctr, conversions, conversion_rate, spend)
      VALUES
        (${clientId}, ${date}, ${videoId}, ${title}, ${campaign},
         ${impressions}, ${clicks}, ${ctr}, ${conversions}, ${convRate}, ${spend})
      ON CONFLICT (client_id, snapshot_date, video_id)
      DO UPDATE SET
        impressions = EXCLUDED.impressions, clicks = EXCLUDED.clicks,
        ctr = EXCLUDED.ctr, conversions = EXCLUDED.conversions,
        conversion_rate = EXCLUDED.conversion_rate, spend = EXCLUDED.spend,
        synced_at = NOW()
    `;
  }

  console.log(`✓ YouTube synced: ${results.length} daily rows`);
}

// ─── Google Ads — Search Terms ───────────────────────────────────────────────

async function syncGoogleAdsSearchTerms(clientId: string, customerId: string) {
  const accessToken = await getGoogleAccessToken();
  const { since, until } = dateRange(30);

  const query = `
    SELECT
      segments.date,
      search_term_view.search_term,
      metrics.clicks, metrics.impressions, metrics.cost_micros,
      metrics.conversions, metrics.conversions_value
    FROM search_term_view
    WHERE segments.date BETWEEN '${since}' AND '${until}'
      AND metrics.impressions > 0
    ORDER BY segments.date DESC, metrics.clicks DESC
  `;

  const res = await fetch(
    `https://googleads.googleapis.com/v20/customers/${customerId}/googleAds:searchStream`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'developer-token': process.env.GOOGLE_ADS_DEV_TOKEN!,
        'login-customer-id': process.env.GOOGLE_ADS_LOGIN_CUSTOMER_ID!,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ query }),
    }
  );

  if (!res.ok) throw new Error(`Search Terms API error: ${res.status} ${await res.text()}`);
  const batches: any[] = await res.json();
  const results = batches.flatMap((b: any) => b.results ?? []);

  // Aggregate por (date, search_term) — la API puede devolver duplicados por ad_group.
  const agg = new Map<string, { date: string; term: string; clicks: number; impr: number; cost: number; conv: number; convValue: number }>();
  for (const row of results) {
    const date = row.segments.date;
    const term = row.searchTermView?.searchTerm ?? '';
    if (!term) continue;
    const key = `${date}|${term}`;
    const ex = agg.get(key);
    const clicks = Number(row.metrics?.clicks ?? 0);
    const impr   = Number(row.metrics?.impressions ?? 0);
    const cost   = Number(row.metrics?.costMicros ?? 0) / 1_000_000;
    const conv   = parseFloat(row.metrics?.conversions ?? '0');
    const convValue = parseFloat(row.metrics?.conversionsValue ?? '0');
    if (ex) {
      ex.clicks += clicks; ex.impr += impr; ex.cost += cost; ex.conv += conv; ex.convValue += convValue;
    } else {
      agg.set(key, { date, term, clicks, impr, cost, conv, convValue });
    }
  }

  // Insertamos en chunks paralelos de 30 (evita serializar 1000s de queries HTTP secuenciales)
  const entries = [...agg.values()];
  const concurrency = 30;
  for (let i = 0; i < entries.length; i += concurrency) {
    const chunk = entries.slice(i, i + concurrency);
    await Promise.all(chunk.map(r => {
      const route = parseRoute(r.term);
      return sql`
        INSERT INTO google_ads_search_terms
          (client_id, snapshot_date, search_term, clicks, impressions, cost, conversions, conv_value, route)
        VALUES
          (${clientId}, ${r.date}, ${r.term}, ${r.clicks}, ${r.impr}, ${r.cost}, ${r.conv}, ${r.convValue}, ${route})
        ON CONFLICT (client_id, snapshot_date, search_term)
        DO UPDATE SET
          clicks = EXCLUDED.clicks, impressions = EXCLUDED.impressions,
          cost = EXCLUDED.cost, conversions = EXCLUDED.conversions,
          conv_value = EXCLUDED.conv_value, route = EXCLUDED.route, synced_at = NOW()
      `;
    }));
  }

  console.log(`✓ Google Ads search terms synced: ${agg.size} unique (date,term) pairs`);
}

// ─── Meta — Creatives (ad-level con thumbnails) ──────────────────────────────
// Rango corto (7 días) para evitar rate limits en level=ad — y de todos modos
// el dashboard solo muestra los TOP por spend, no histórico largo.

async function syncMetaCreatives(clientId: string, adAccountId: string, accessToken: string) {
  // 30 días para poder armar el funnel ad-level del mes (impresiones→clicks→visitas→leads)
  // y segmentar por vertical (el vertical va en el ad_name: Kit4 / Orbatix / etc.).
  const { since, until } = dateRange(30);
  const fields = [
    'ad_id', 'ad_name',
    'campaign_id', 'campaign_name',
    'date_start',
    'spend', 'impressions', 'clicks', 'reach',
    'actions', 'action_values', 'ctr',
  ].join(',');

  const url = `https://graph.facebook.com/v21.0/act_${adAccountId}/insights?` +
    `level=ad&time_increment=1` +
    `&time_range=${encodeURIComponent(JSON.stringify({ since, until }))}` +
    `&filtering=${encodeURIComponent(JSON.stringify([{ field: 'spend', operator: 'GREATER_THAN', value: 0 }]))}` +
    `&fields=${fields}&access_token=${accessToken}&limit=500`;

  const res = await fetch(url);
  if (!res.ok) throw new Error(`Meta creatives API error: ${res.status} ${await res.text()}`);
  const body = await res.json();
  const data: any[] = body.data ?? [];

  // Pedimos creative info (thumbnail_url + effective_status) — solo para los top ads por spend
  // y con sleep de 1.5s entre batches para no pegar rate limit.
  const spendByAd = new Map<string, number>();
  for (const r of data) {
    spendByAd.set(r.ad_id, (spendByAd.get(r.ad_id) ?? 0) + parseFloat(r.spend ?? '0'));
  }
  const topAdIds = [...spendByAd.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 60)  // top 60 — más que suficiente para una galería de "top creatives"
    .map(([id]) => id);

  const adInfo = new Map<string, { thumb: string | null; status: string | null }>();
  for (let i = 0; i < topAdIds.length; i += 50) {
    const chunk = topAdIds.slice(i, i + 50);
    const batch = chunk.map(id => ({
      method: 'GET',
      relative_url: `${id}?fields=effective_status,creative{thumbnail_url}`,
    }));
    try {
      const bRes = await fetch('https://graph.facebook.com/v21.0/', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          access_token: accessToken,
          batch: JSON.stringify(batch),
        }),
      });
      const bBody = await bRes.json();
      if (Array.isArray(bBody)) {
        bBody.forEach((sub: any, idx: number) => {
          if (sub?.code === 200) {
            const parsed = JSON.parse(sub.body);
            adInfo.set(chunk[idx], {
              thumb: parsed.creative?.thumbnail_url ?? null,
              status: parsed.effective_status ?? null,
            });
          }
        });
      }
    } catch { /* thumbnails son opcionales */ }
    if (i + 50 < topAdIds.length) await new Promise(r => setTimeout(r, 1500));
  }

  for (const row of data) {
    const date      = row.date_start;
    const spend     = parseFloat(row.spend ?? '0');
    const impressions = parseInt(row.impressions ?? '0');
    const clicks    = parseInt(row.clicks ?? '0');
    const reach     = parseInt(row.reach ?? '0');
    // Conversión primaria por ad (purchase / lead / registro / mensaje) — ver extractMetaConversions.
    const purchases = extractMetaConversions(row.actions ?? []);
    const revenue   = parseFloat((row.action_values ?? []).find((a: any) => a.action_type === 'purchase')?.value ?? '0');
    // Visita a la landing (paso intermedio del funnel)
    const lpv       = parseInt((row.actions ?? []).find((a: any) => a.action_type === 'landing_page_view')?.value ?? '0');
    const cpa       = Number(purchases) > 0 ? spend / Number(purchases) : 0;
    const roas      = spend > 0 ? revenue / spend : 0;
    const ctr       = parseFloat(row.ctr ?? '0');
    const info      = adInfo.get(row.ad_id);

    await sql`
      INSERT INTO meta_ads_creatives
        (client_id, snapshot_date, ad_id, ad_name, campaign_id, campaign_name,
         thumbnail_url, effective_status,
         spend, impressions, clicks, reach, purchases, revenue, cpa, roas, ctr, landing_page_view)
      VALUES
        (${clientId}, ${date}, ${row.ad_id}, ${row.ad_name}, ${row.campaign_id}, ${row.campaign_name},
         ${info?.thumb ?? null}, ${info?.status ?? null},
         ${spend}, ${impressions}, ${clicks}, ${reach}, ${purchases}, ${revenue},
         ${cpa}, ${roas}, ${ctr}, ${lpv})
      ON CONFLICT (client_id, snapshot_date, ad_id)
      DO UPDATE SET
        ad_name = EXCLUDED.ad_name, campaign_id = EXCLUDED.campaign_id, campaign_name = EXCLUDED.campaign_name,
        thumbnail_url = EXCLUDED.thumbnail_url, effective_status = EXCLUDED.effective_status,
        spend = EXCLUDED.spend, impressions = EXCLUDED.impressions, clicks = EXCLUDED.clicks,
        reach = EXCLUDED.reach, purchases = EXCLUDED.purchases, revenue = EXCLUDED.revenue,
        cpa = EXCLUDED.cpa, roas = EXCLUDED.roas, ctr = EXCLUDED.ctr,
        landing_page_view = EXCLUDED.landing_page_view, synced_at = NOW()
    `;
  }

  console.log(`✓ Meta creatives synced: ${data.length} ad-day rows (${adInfo.size} unique ads with thumbnails)`);
}

// ─── Meta — Breakdowns (age, gender, region, placement) ──────────────────────

async function syncMetaBreakdowns(clientId: string, adAccountId: string, accessToken: string) {
  const { since, until } = dateRange(30);
  const breakdownDims = ['age', 'gender', 'region', 'publisher_platform'];

  for (const dim of breakdownDims) {
    const fields = [
      'date_start', 'spend', 'impressions', 'clicks', 'reach',
      'actions', 'action_values',
    ].join(',');

    const url = `https://graph.facebook.com/v21.0/act_${adAccountId}/insights?` +
      `level=account&time_increment=1` +
      `&breakdowns=${dim}` +
      `&time_range=${encodeURIComponent(JSON.stringify({ since, until }))}` +
      `&fields=${fields}&access_token=${accessToken}&limit=500`;

    try {
      const res = await fetch(url);
      if (!res.ok) {
        console.error(`  ✗ Meta breakdown ${dim}: ${res.status}`);
        continue;
      }
      const body = await res.json();
      const data: any[] = body.data ?? [];

      for (const row of data) {
        const date      = row.date_start;
        const value     = String(row[dim] ?? 'unknown');
        const spend     = parseFloat(row.spend ?? '0');
        const impressions = parseInt(row.impressions ?? '0');
        const clicks    = parseInt(row.clicks ?? '0');
        const reach     = parseInt(row.reach ?? '0');
        const purchases = (row.actions ?? []).find((a: any) => a.action_type === 'purchase')?.value ?? 0;
        const revenue   = parseFloat((row.action_values ?? []).find((a: any) => a.action_type === 'purchase')?.value ?? '0');
        const cpa       = Number(purchases) > 0 ? spend / Number(purchases) : 0;
        const roas      = spend > 0 ? revenue / spend : 0;

        await sql`
          INSERT INTO meta_ads_breakdowns
            (client_id, snapshot_date, dimension_type, dimension_value,
             spend, impressions, clicks, reach, purchases, revenue, cpa, roas)
          VALUES
            (${clientId}, ${date}, ${dim}, ${value},
             ${spend}, ${impressions}, ${clicks}, ${reach}, ${purchases}, ${revenue}, ${cpa}, ${roas})
          ON CONFLICT (client_id, snapshot_date, dimension_type, dimension_value)
          DO UPDATE SET
            spend = EXCLUDED.spend, impressions = EXCLUDED.impressions, clicks = EXCLUDED.clicks,
            reach = EXCLUDED.reach, purchases = EXCLUDED.purchases, revenue = EXCLUDED.revenue,
            cpa = EXCLUDED.cpa, roas = EXCLUDED.roas, synced_at = NOW()
        `;
      }
      console.log(`  ✓ Meta breakdown ${dim}: ${data.length} rows`);
    } catch (e: any) {
      console.error(`  ✗ Meta breakdown ${dim}:`, e.message);
    }
  }
}

// ─── Meta — Hourly (estacionalidad por hora del día) ────────────────────────

async function syncMetaHourly(clientId: string, adAccountId: string, accessToken: string) {
  const { since, until } = dateRange(14);  // 14 días de hourly: suficiente para patrones, no explota volumen
  const fields = ['date_start', 'spend', 'impressions', 'clicks', 'actions', 'action_values'].join(',');

  const url = `https://graph.facebook.com/v21.0/act_${adAccountId}/insights?` +
    `level=account&time_increment=1` +
    `&breakdowns=hourly_stats_aggregated_by_advertiser_time_zone` +
    `&time_range=${encodeURIComponent(JSON.stringify({ since, until }))}` +
    `&fields=${fields}&access_token=${accessToken}&limit=500`;

  const res = await fetch(url);
  if (!res.ok) throw new Error(`Meta hourly API error: ${res.status} ${await res.text()}`);
  const body = await res.json();
  const data: any[] = body.data ?? [];

  for (const row of data) {
    // hourly_stats viene como "00:00:00 - 00:59:59"
    const hourStr = row.hourly_stats_aggregated_by_advertiser_time_zone ?? '00:00:00';
    const hour = parseInt(String(hourStr).slice(0, 2));
    const spend = parseFloat(row.spend ?? '0');
    const impressions = parseInt(row.impressions ?? '0');
    const clicks = parseInt(row.clicks ?? '0');
    const purchases = (row.actions ?? []).find((a: any) => a.action_type === 'purchase')?.value ?? 0;
    const revenue = parseFloat((row.action_values ?? []).find((a: any) => a.action_type === 'purchase')?.value ?? '0');

    await sql`
      INSERT INTO meta_ads_hourly
        (client_id, snapshot_date, hour, spend, impressions, clicks, purchases, revenue)
      VALUES
        (${clientId}, ${row.date_start}, ${hour}, ${spend}, ${impressions}, ${clicks}, ${purchases}, ${revenue})
      ON CONFLICT (client_id, snapshot_date, hour)
      DO UPDATE SET
        spend = EXCLUDED.spend, impressions = EXCLUDED.impressions, clicks = EXCLUDED.clicks,
        purchases = EXCLUDED.purchases, revenue = EXCLUDED.revenue, synced_at = NOW()
    `;
  }

  console.log(`✓ Meta hourly synced: ${data.length} rows`);
}

// ─── Google Ads — Hourly ─────────────────────────────────────────────────────

async function syncGoogleAdsHourly(clientId: string, customerId: string) {
  const accessToken = await getGoogleAccessToken();
  const { since, until } = dateRange(14);

  const query = `
    SELECT
      segments.date,
      segments.hour,
      metrics.cost_micros, metrics.impressions, metrics.clicks,
      metrics.conversions, metrics.conversions_value
    FROM customer
    WHERE segments.date BETWEEN '${since}' AND '${until}'
  `;

  const res = await fetch(
    `https://googleads.googleapis.com/v20/customers/${customerId}/googleAds:searchStream`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'developer-token': process.env.GOOGLE_ADS_DEV_TOKEN!,
        'login-customer-id': process.env.GOOGLE_ADS_LOGIN_CUSTOMER_ID!,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ query }),
    }
  );

  if (!res.ok) throw new Error(`Google Ads hourly error: ${res.status} ${await res.text()}`);
  const batches: any[] = await res.json();
  const results = batches.flatMap((b: any) => b.results ?? []);

  // Inserts en chunks paralelos
  for (let i = 0; i < results.length; i += 30) {
    const chunk = results.slice(i, i + 30);
    await Promise.all(chunk.map((row: any) => {
      const date = row.segments.date;
      const hour = parseInt(row.segments.hour ?? '0');
      const spend = (row.metrics?.costMicros ?? 0) / 1_000_000;
      const impr  = Number(row.metrics?.impressions ?? 0);
      const clicks = Number(row.metrics?.clicks ?? 0);
      const conv  = parseFloat(row.metrics?.conversions ?? '0');
      const cv    = parseFloat(row.metrics?.conversionsValue ?? '0');
      return sql`
        INSERT INTO google_ads_hourly
          (client_id, snapshot_date, hour, spend, impressions, clicks, conversions, conv_value)
        VALUES
          (${clientId}, ${date}, ${hour}, ${spend}, ${impr}, ${clicks}, ${conv}, ${cv})
        ON CONFLICT (client_id, snapshot_date, hour)
        DO UPDATE SET
          spend = EXCLUDED.spend, impressions = EXCLUDED.impressions, clicks = EXCLUDED.clicks,
          conversions = EXCLUDED.conversions, conv_value = EXCLUDED.conv_value, synced_at = NOW()
      `;
    }));
  }

  console.log(`✓ Google Ads hourly synced: ${results.length} rows`);
}

// ─── GA4 (KPIs + rutas) ──────────────────────────────────────────────────────

async function syncGA4(clientId: string, propertyId: string) {
  const cred = JSON.parse(process.env.GA4_SERVICE_ACCOUNT_JSON!);
  const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id:     cred.client_id,
      client_secret: cred.client_secret,
      refresh_token: cred.refresh_token,
      grant_type:    'refresh_token',
    }),
  });
  const tokenData = await tokenRes.json();
  if (!tokenData.access_token) throw new Error(`GA4 token error: ${JSON.stringify(tokenData)}`);
  const access_token = tokenData.access_token;

  // KPIs diarios
  const kpisRes = await fetch(
    `https://analyticsdata.googleapis.com/v1beta/properties/${propertyId}:runReport`,
    {
      method: 'POST',
      headers: { Authorization: `Bearer ${access_token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        dateRanges: [{ startDate: '30daysAgo', endDate: 'today' }],
        dimensions: [{ name: 'date' }],
        metrics: [
          { name: 'activeUsers' },
          { name: 'sessions' },
          { name: 'averageSessionDuration' },
          { name: 'transactions' },
          { name: 'purchaseRevenue' },
          { name: 'addToCarts' },
        ],
        orderBys: [{ dimension: { dimensionName: 'date' } }],
      }),
    }
  );
  const kpisData = await kpisRes.json();

  for (const row of kpisData.rows ?? []) {
    const date    = ga4DateToISO(row.dimensionValues[0].value);
    const m       = row.metricValues;
    const users   = parseInt(m[0].value ?? '0');
    const sessions = parseInt(m[1].value ?? '0');
    const avgDur  = secondsToMMSS(parseFloat(m[2].value ?? '0'));
    const tickets = parseInt(m[3].value ?? '0');
    const revenue = parseFloat(m[4].value ?? '0');
    const carts   = parseInt(m[5].value ?? '0');
    const convRate = sessions > 0 ? tickets / sessions : 0;
    const aov      = tickets > 0 ? revenue / tickets : 0;

    await sql`
      INSERT INTO business_kpis
        (client_id, snapshot_date, users, sessions, avg_session_duration,
         conversion_rate, carts, tickets, revenue, aov)
      VALUES
        (${clientId}, ${date}, ${users}, ${sessions}, ${avgDur},
         ${convRate}, ${carts}, ${tickets}, ${revenue}, ${aov})
      ON CONFLICT (client_id, snapshot_date)
      DO UPDATE SET
        users = EXCLUDED.users, sessions = EXCLUDED.sessions,
        avg_session_duration = EXCLUDED.avg_session_duration,
        conversion_rate = EXCLUDED.conversion_rate, carts = EXCLUDED.carts,
        tickets = EXCLUDED.tickets, revenue = EXCLUDED.revenue,
        aov = EXCLUDED.aov, synced_at = NOW()
    `;
  }

  // Rutas diarias (e-commerce items).
  // GA4 NO permite combinar métricas de evento (transactions, addToCarts) con
  // métricas item-level (itemRevenue, itemsPurchased) en el mismo runReport.
  // Solo pedimos las item-level — alcanza para ranking de rutas por revenue.
  // purchases queda = itemsPurchased (a nivel item, "cantidad de ese item vendida").
  const routesRes = await fetch(
    `https://analyticsdata.googleapis.com/v1beta/properties/${propertyId}:runReport`,
    {
      method: 'POST',
      headers: { Authorization: `Bearer ${access_token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        dateRanges: [{ startDate: '30daysAgo', endDate: 'today' }],
        dimensions: [{ name: 'date' }, { name: 'itemName' }],
        metrics: [
          { name: 'itemRevenue' },
          { name: 'itemsPurchased' },
        ],
        orderBys: [{ dimension: { dimensionName: 'date' } }],
        limit: 10000,
      }),
    }
  );
  const routesData = await routesRes.json();
  if (routesData.error) {
    console.error(`  ✗ GA4 routes query error: ${routesData.error.message}`);
  }

  for (const row of routesData.rows ?? []) {
    const date    = ga4DateToISO(row.dimensionValues[0].value);
    const route   = row.dimensionValues[1].value;
    const m       = row.metricValues;
    const revenue   = parseFloat(m[0].value ?? '0');
    const articles  = parseInt(m[1].value ?? '0');

    await sql`
      INSERT INTO product_routes
        (client_id, snapshot_date, route, revenue, articles, purchases, add_to_cart)
      VALUES
        (${clientId}, ${date}, ${route}, ${revenue}, ${articles}, ${articles}, 0)
      ON CONFLICT (client_id, snapshot_date, route)
      DO UPDATE SET
        revenue = EXCLUDED.revenue, articles = EXCLUDED.articles,
        purchases = EXCLUDED.purchases, synced_at = NOW()
    `;
  }

  // Canales de tráfico — pedimos sessionSource + sessionMedium y aplicamos
  // clasificación PROPIA. El sessionDefaultChannelGroup de GA4 mal-categoriza
  // (ej: Facebook_Ads/fbc lo manda a Organic Social, UTMs no estándar a
  // Unassigned).
  //
  // Importante: usamos itemRevenue + itemsPurchased (item-level) en lugar
  // de purchaseRevenue + transactions para que los números cuadren con la
  // tabla de Top Destinos (que también usa itemRevenue/itemsPurchased).
  // En GA4 esto equivale a mirar Monetization → Ecommerce purchases con
  // dimensión secundaria Source/Medium.
  const channelsRes = await fetch(
    `https://analyticsdata.googleapis.com/v1beta/properties/${propertyId}:runReport`,
    {
      method: 'POST',
      headers: { Authorization: `Bearer ${access_token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        dateRanges: [{ startDate: '30daysAgo', endDate: 'today' }],
        dimensions: [
          { name: 'date' },
          { name: 'sessionSource' },
          { name: 'sessionMedium' },
          { name: 'sessionDefaultChannelGroup' }, // fallback para Cross-network y Display
        ],
        metrics: [
          { name: 'sessions' },        // sesiones scope-item (las que tuvieron compra)
          { name: 'itemsPurchased' },  // cantidad de pasajes vendidos
          { name: 'itemRevenue' },     // revenue de items (= purchaseRevenue para Andesmar)
        ],
        orderBys: [{ dimension: { dimensionName: 'date' } }],
        limit: 50000,
      }),
    }
  );
  const channelsData = await channelsRes.json();
  if (channelsData.error) {
    console.error(`  ✗ GA4 channels query error: ${channelsData.error.message}`);
  }

  // Agrupamos en JS por (date, channelClassified) antes de insertar
  type Agg = { sessions: number; transactions: number; revenue: number };
  const agg = new Map<string, Agg>();
  for (const row of channelsData.rows ?? []) {
    const date     = ga4DateToISO(row.dimensionValues[0].value);
    const source   = row.dimensionValues[1].value || '';
    const medium   = row.dimensionValues[2].value || '';
    const original = row.dimensionValues[3].value || '';
    const channel  = classifyChannel(source, medium, original);
    const key = `${date}|${channel}`;
    if (!agg.has(key)) agg.set(key, { sessions: 0, transactions: 0, revenue: 0 });
    const a = agg.get(key)!;
    a.sessions     += parseInt(row.metricValues[0].value ?? '0');
    a.transactions += parseInt(row.metricValues[1].value ?? '0');
    a.revenue      += parseFloat(row.metricValues[2].value ?? '0');
  }

  for (const [key, v] of agg) {
    const [date, channel] = key.split('|');
    await sql`
      INSERT INTO traffic_channels
        (client_id, snapshot_date, channel_group, sessions, transactions, revenue)
      VALUES
        (${clientId}, ${date}, ${channel}, ${v.sessions}, ${v.transactions}, ${v.revenue})
      ON CONFLICT (client_id, snapshot_date, channel_group)
      DO UPDATE SET
        sessions = EXCLUDED.sessions, transactions = EXCLUDED.transactions,
        revenue = EXCLUDED.revenue, synced_at = NOW()
    `;
  }

  console.log(`✓ GA4 synced: ${kpisData.rows?.length ?? 0} days KPIs, ${routesData.rows?.length ?? 0} route-days, ${agg.size} channel-days (${channelsData.rows?.length ?? 0} source-medium rows clasificadas)`);
}

// Clasificación propia de canales — supera las limitaciones del
// sessionDefaultChannelGroup de GA4 cuando los UTMs no son estándar.
function classifyChannel(source: string, medium: string, originalChannel: string): string {
  const s = source.toLowerCase();
  const m = medium.toLowerCase();
  const orig = originalChannel;

  // Cross-network (Performance Max de Google) lo respetamos
  if (orig === 'Cross-network') return 'Cross-network';

  // Display lo respetamos
  if (orig === 'Display') return 'Display';

  // Paid Video (YouTube Ads)
  if (orig === 'Paid Video') return 'Paid Video';

  // Meta / Facebook / Instagram
  if (/facebook|meta|instagram|^fb$|^ig$/.test(s)) {
    if (/paid|cpc|ppc|fbc|social|cpm/.test(m)) return 'Paid Social';
    if (m === 'referral') return 'Organic Social';
    return 'Organic Social';
  }

  // TikTok / Twitter / LinkedIn
  if (/tiktok|twitter|^t\.co|linkedin/.test(s)) {
    return /paid|cpc|ppc/.test(m) ? 'Paid Social' : 'Organic Social';
  }

  // Google
  if (s === 'google' || s.startsWith('google.') || s === 'googleads') {
    if (/cpc|ppc|paid/.test(m)) return 'Paid Search';
    if (m === 'organic' || /search/.test(m)) return 'Organic Search';
  }

  // Otros buscadores
  if (/bing|^yahoo|duckduckgo|ecosia|brave|search\.yahoo/.test(s)) return 'Organic Search';

  // Email
  if (/email|newsletter|emailing/.test(m) || /emblue|mailchimp|sendgrid/.test(s)) return 'Email';

  // Afiliados / partners — CACE, cupones, sitios partner
  if (
    /cace|cupon|partner|afiliados|black|bomba|recorrido|aderpe/.test(s)
    || /cupon|partner|black|bomba|logo|oferta|banner/.test(m)
  ) return 'Afiliados / Partners';

  // Direct
  if (s === '(direct)' || (s === '' && m === '(none)')) return 'Direct';

  // Referral
  if (m === 'referral') return 'Referral';

  // Lo que GA4 no pudo clasificar Y nosotros tampoco — Unassigned
  if (orig === 'Unassigned' || orig === '(unassigned)' || !orig) return 'Otros';
  return orig;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function secondsToMMSS(seconds: number): string {
  const m = Math.floor(seconds / 60).toString().padStart(2, '0');
  const s = Math.floor(seconds % 60).toString().padStart(2, '0');
  return `${m}:${s}`;
}

// ─── Main ────────────────────────────────────────────────────────────────────

async function main() {
  console.log(`\nVeta Analytics sync — ${new Date().toISOString()}`);

  // Multi-cliente: cada fila trae sus IDs de cuenta. Las credenciales (token Meta,
  // service-account Google) siguen siendo globales (env). Si un ID está NULL en la DB,
  // se hace fallback a la env var global (mantiene a Andesmar funcionando como antes).
  const clients = await sql`
    SELECT id, slug, meta_ad_account_id, google_ads_customer_id, ga4_property_id
    FROM clients
    WHERE active = true
  `;

  for (const client of clients) {
    console.log(`\n→ Syncing client: ${client.slug}`);

    // IDs de cuenta por cliente desde la DB (sembrados con scripts/seed-clients.ts).
    // SIN fallback a env vars: en multi-cliente un fallback global filtraría la cuenta
    // de otro cliente (ej: GA4 de un cliente bajo el client_id de otro). Si el ID es
    // NULL, se saltea esa plataforma para ese cliente.
    const metaAcct = client.meta_ad_account_id     || null;
    const gAdsCust = client.google_ads_customer_id || null;
    const ga4Prop  = client.ga4_property_id        || null;
    const metaTok  = process.env.META_ACCESS_TOKEN!;

    if (!metaAcct) {
      console.log(`  ⊘ Sin meta_ad_account_id — se saltea Meta para ${client.slug}`);
    } else {
      try {
        await syncMetaAds(client.id, metaAcct, metaTok);
      } catch (e) { console.error(`  ✗ Meta Ads:`, e); }

      try {
        await syncMetaCreatives(client.id, metaAcct, metaTok);
      } catch (e) { console.error(`  ✗ Meta Creatives:`, e); }

      try {
        await syncMetaBreakdowns(client.id, metaAcct, metaTok);
      } catch (e) { console.error(`  ✗ Meta Breakdowns:`, e); }

      try {
        await syncMetaHourly(client.id, metaAcct, metaTok);
      } catch (e) { console.error(`  ✗ Meta Hourly:`, e); }
    }

    if (!gAdsCust) {
      console.log(`  ⊘ Sin google_ads_customer_id — se saltea Google para ${client.slug}`);
    } else {
      try {
        await syncGoogleAds(client.id, gAdsCust);
      } catch (e) { console.error(`  ✗ Google Ads:`, e); }

      try {
        await syncGoogleAdsSearchTerms(client.id, gAdsCust);
      } catch (e) { console.error(`  ✗ Google Ads Search Terms:`, e); }

      try {
        await syncGoogleAdsHourly(client.id, gAdsCust);
      } catch (e) { console.error(`  ✗ Google Ads Hourly:`, e); }
    }

    // YouTube deshabilitado por ahora

    if (!ga4Prop) {
      console.log(`  ⊘ Sin ga4_property_id — se saltea GA4 para ${client.slug}`);
    } else {
      try {
        await syncGA4(client.id, ga4Prop);
      } catch (e: any) {
        // GA4 puede tener token expirado (OAuth en modo Testing expira a los 7 días).
        // No frenamos el resto del sync — los demás canales siguen actualizándose.
        const isAuth = String(e?.message ?? '').includes('invalid_grant') || String(e?.message ?? '').includes('expired');
        console.error(`  ✗ GA4${isAuth ? ' (token EXPIRADO — refrescar GA4_SERVICE_ACCOUNT_JSON)' : ''}:`, e?.message ?? e);
      }
    }
  }

  console.log('\n✓ Sync complete\n');
}

main().catch((e) => { console.error(e); process.exit(1); });
