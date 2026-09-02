import { neon } from '@neondatabase/serverless';
import { SignJWT, importPKCS8 } from 'jose';

const sql = neon(process.env.DATABASE_URL!);

const SINCE = process.argv[2] ?? '2024-10-01';
const UNTIL = process.argv[3] ?? new Date().toISOString().split('T')[0];

console.log(`\nBackfill: ${SINCE} → ${UNTIL}\n`);

function ga4DateToISO(d: string): string {
  return `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)}`;
}
function secondsToMMSS(seconds: number): string {
  const m = Math.floor(seconds / 60).toString().padStart(2, '0');
  const s = Math.floor(seconds % 60).toString().padStart(2, '0');
  return `${m}:${s}`;
}

// ─── Meta Ads ────────────────────────────────────────────────────────────────

async function backfillMetaMonth(
  clientId: string, adAccountId: string, accessToken: string,
  since: string, until: string,
  statusByCampaign: Map<string, string>,
): Promise<number> {
  const fields = [
    'campaign_id', 'campaign_name', 'objective', 'date_start',
    'spend', 'reach', 'impressions', 'clicks', 'ctr', 'cpc',
    'actions', 'action_values',
  ].join(',');

  const attribution = JSON.stringify(['7d_click', '1d_view']);
  const filtering = JSON.stringify([{
    field: 'campaign.effective_status',
    operator: 'IN',
    value: ['ACTIVE','PAUSED','DELETED','ARCHIVED','PENDING_REVIEW','DISAPPROVED','PREAPPROVED',
            'PENDING_BILLING_INFO','CAMPAIGN_PAUSED','ADSET_PAUSED','IN_PROCESS','WITH_ISSUES'],
  }]);

  let url: string | null =
    `https://graph.facebook.com/v21.0/act_${adAccountId}/insights?` +
    `level=campaign&time_increment=1` +
    `&time_range=${encodeURIComponent(JSON.stringify({ since, until }))}` +
    `&use_unified_attribution_setting=true` +
    `&action_attribution_windows=${encodeURIComponent(attribution)}` +
    `&filtering=${encodeURIComponent(filtering)}` +
    `&fields=${fields}&access_token=${accessToken}&limit=500`;

  let total = 0;
  while (url) {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Meta API: ${res.status} ${await res.text()}`);
    const body = await res.json();
    const data: any[] = body.data ?? [];

    for (const row of data) {
      const date      = row.date_start;
      const objective = row.objective ?? null;
      const status    = statusByCampaign.get(row.campaign_id) ?? null;
      const spend     = parseFloat(row.spend ?? '0');
      const purchases = (row.actions ?? []).find((a: any) => a.action_type === 'purchase')?.value ?? 0;  // TODO: extractMetaConversions
      const revenue   = parseFloat((row.action_values ?? []).find((a: any) => a.action_type === 'purchase')?.value ?? '0');
      const cpa       = Number(purchases) > 0 ? spend / Number(purchases) : 0;
      const roas      = spend > 0 ? revenue / spend : 0;

      await sql`
        INSERT INTO meta_ads_campaigns
          (client_id, snapshot_date, campaign_id, type, effective_status, segment,
           spend, reach, purchases, revenue, cpa, roas, ctr, cpc)
        VALUES
          (${clientId}, ${date}, ${row.campaign_id}, ${objective}, ${status}, ${row.campaign_name},
           ${spend}, ${parseInt(row.reach ?? '0')}, ${purchases}, ${revenue},
           ${cpa}, ${roas}, ${parseFloat(row.ctr ?? '0')}, ${parseFloat(row.cpc ?? '0')})
        ON CONFLICT (client_id, snapshot_date, campaign_id)
        DO UPDATE SET
          type = EXCLUDED.type, effective_status = EXCLUDED.effective_status, segment = EXCLUDED.segment,
          spend = EXCLUDED.spend, reach = EXCLUDED.reach, purchases = EXCLUDED.purchases,
          revenue = EXCLUDED.revenue, cpa = EXCLUDED.cpa, roas = EXCLUDED.roas,
          ctr = EXCLUDED.ctr, cpc = EXCLUDED.cpc, synced_at = NOW()
      `;
    }
    total += data.length;
    url = body.paging?.next ?? null;
  }
  return total;
}

async function fetchMetaCampaignStatuses(adAccountId: string, accessToken: string): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  let url: string | null =
    `https://graph.facebook.com/v21.0/act_${adAccountId}/campaigns?` +
    `fields=id,effective_status&limit=500&access_token=${accessToken}`;
  while (url) {
    const res = await fetch(url);
    if (!res.ok) break;
    const body = await res.json();
    for (const c of (body.data ?? [])) map.set(c.id, c.effective_status);
    url = body.paging?.next ?? null;
  }
  return map;
}

function pad(n: number) { return String(n).padStart(2, '0'); }
function ymd(y: number, m: number, d: number) { return `${y}-${pad(m)}-${pad(d)}`; }

function monthRanges(since: string, until: string): { since: string; until: string }[] {
  const [sy, sm, sd] = since.split('-').map(Number);
  const [uy, um, ud] = until.split('-').map(Number);
  const ranges: { since: string; until: string }[] = [];
  let y = sy, m = sm;
  while (y < uy || (y === uy && m <= um)) {
    const startDay  = (y === sy && m === sm) ? sd : 1;
    const lastDay   = new Date(y, m, 0).getDate(); // last day of month (local)
    const endDay    = (y === uy && m === um) ? ud : lastDay;
    ranges.push({ since: ymd(y, m, startDay), until: ymd(y, m, endDay) });
    m++; if (m > 12) { m = 1; y++; }
  }
  return ranges;
}

async function backfillMeta(clientId: string, adAccountId: string, accessToken: string) {
  const statusByCampaign = await fetchMetaCampaignStatuses(adAccountId, accessToken);
  console.log(`  (status snapshot: ${statusByCampaign.size} campañas)`);
  const ranges = monthRanges(SINCE, UNTIL);
  let total = 0;
  for (const r of ranges) {
    console.log(`  Meta: ${r.since} → ${r.until}`);
    const n = await backfillMetaMonth(clientId, adAccountId, accessToken, r.since, r.until, statusByCampaign);
    total += n;
  }
  console.log(`✓ Meta Ads: ${total} filas insertadas`);
}

// ─── Google Ads ───────────────────────────────────────────────────────────────

async function getGoogleAdsToken(): Promise<string> {
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

async function backfillGoogleAds(clientId: string, customerId: string) {
  const accessToken = await getGoogleAdsToken();
  const query = `
    SELECT
      segments.date,
      campaign.id, campaign.name,
      metrics.cost_micros, metrics.impressions, metrics.clicks,
      metrics.ctr, metrics.average_cpc,
      metrics.conversions, metrics.conversions_value
    FROM campaign
    WHERE segments.date BETWEEN '${SINCE}' AND '${UNTIL}'
      AND metrics.cost_micros > 0
    ORDER BY segments.date DESC, metrics.cost_micros DESC
  `;

  const res = await fetch(
    `https://googleads.googleapis.com/v24/customers/${customerId}/googleAds:searchStream`,
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
  if (!res.ok) throw new Error(`Google Ads API: ${res.status} ${await res.text()}`);
  const batches: any[] = await res.json();
  const results = batches.flatMap((b: any) => b.results ?? []);

  for (const row of results) {
    const date        = row.segments.date;
    const spend       = (row.metrics.costMicros ?? 0) / 1_000_000;
    const conversions = parseFloat(row.metrics.conversions ?? '0');
    const revenue     = parseFloat(row.metrics.conversionsValue ?? '0');

    await sql`
      INSERT INTO google_ads_campaigns
        (client_id, snapshot_date, campaign_id, name, spend, impressions, clicks, ctr, cpc, carts, revenue, roas)
      VALUES
        (${clientId}, ${date}, ${String(row.campaign.id)}, ${row.campaign.name},
         ${spend}, ${row.metrics.impressions ?? 0}, ${row.metrics.clicks ?? 0},
         ${parseFloat(row.metrics.ctr ?? '0')},
         ${(row.metrics.averageCpc ?? 0) / 1_000_000},
         ${Math.round(conversions)}, ${revenue},
         ${spend > 0 ? revenue / spend : 0})
      ON CONFLICT (client_id, snapshot_date, campaign_id)
      DO UPDATE SET
        spend = EXCLUDED.spend, impressions = EXCLUDED.impressions, clicks = EXCLUDED.clicks,
        ctr = EXCLUDED.ctr, cpc = EXCLUDED.cpc, carts = EXCLUDED.carts,
        revenue = EXCLUDED.revenue, roas = EXCLUDED.roas, synced_at = NOW()
    `;
  }

  console.log(`✓ Google Ads: ${results.length} filas insertadas`);
}

// ─── YouTube ──────────────────────────────────────────────────────────────────

async function backfillYouTube(clientId: string, customerId: string) {
  const accessToken = await getGoogleAdsToken();
  const query = `
    SELECT
      segments.date,
      ad_group_ad.ad.id,
      ad_group_ad.ad.name,
      campaign.name,
      metrics.cost_micros, metrics.impressions, metrics.clicks,
      metrics.ctr, metrics.all_conversions, metrics.all_conversions_value
    FROM ad_group_ad
    WHERE segments.date BETWEEN '${SINCE}' AND '${UNTIL}'
      AND campaign.advertising_channel_type = 'VIDEO'
      AND metrics.cost_micros > 0
    ORDER BY segments.date DESC, metrics.cost_micros DESC
  `;

  const res = await fetch(
    `https://googleads.googleapis.com/v24/customers/${customerId}/googleAds:searchStream`,
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
  if (!res.ok) throw new Error(`YouTube API: ${res.status} ${await res.text()}`);
  const batches: any[] = await res.json();
  const results = batches.flatMap((b: any) => b.results ?? []);

  for (const row of results) {
    const date        = row.segments.date;
    const videoId     = String(row.adGroupAd?.ad?.id ?? row.adGroupAd?.ad?.name ?? 'unknown');
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

  console.log(`✓ YouTube: ${results.length} filas insertadas`);
}

// ─── GA4 ──────────────────────────────────────────────────────────────────────

async function backfillGA4(clientId: string, propertyId: string) {
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
  const { access_token } = await tokenRes.json();
  if (!access_token) throw new Error('GA4 token fallido');

  // KPIs diarios
  const kpisRes = await fetch(
    `https://analyticsdata.googleapis.com/v1beta/properties/${propertyId}:runReport`,
    {
      method: 'POST',
      headers: { Authorization: `Bearer ${access_token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        dateRanges: [{ startDate: SINCE, endDate: UNTIL }],
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
        limit: 100000,
      }),
    }
  );
  const kpisData = await kpisRes.json();

  for (const row of kpisData.rows ?? []) {
    const date     = ga4DateToISO(row.dimensionValues[0].value);
    const m        = row.metricValues;
    const users    = parseInt(m[0].value ?? '0');
    const sessions = parseInt(m[1].value ?? '0');
    const avgDur   = secondsToMMSS(parseFloat(m[2].value ?? '0'));
    const tickets  = parseInt(m[3].value ?? '0');
    const revenue  = parseFloat(m[4].value ?? '0');
    const carts    = parseInt(m[5].value ?? '0');
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
  console.log(`✓ GA4 KPIs: ${kpisData.rows?.length ?? 0} días`);

  // Rutas con paginación
  let routeOffset = 0;
  let routeTotal  = 0;

  while (true) {
    const routesRes = await fetch(
      `https://analyticsdata.googleapis.com/v1beta/properties/${propertyId}:runReport`,
      {
        method: 'POST',
        headers: { Authorization: `Bearer ${access_token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          dateRanges: [{ startDate: SINCE, endDate: UNTIL }],
          dimensions: [{ name: 'date' }, { name: 'itemName' }],
          metrics: [
            { name: 'itemRevenue' },
            { name: 'itemsPurchased' },
            { name: 'transactions' },
            { name: 'addToCarts' },
          ],
          orderBys: [{ dimension: { dimensionName: 'date' } }],
          limit: 10000,
          offset: routeOffset,
        }),
      }
    );
    const routesData = await routesRes.json();
    const rows: any[] = routesData.rows ?? [];
    if (!rows.length) break;

    for (const row of rows) {
      const date      = ga4DateToISO(row.dimensionValues[0].value);
      const route     = row.dimensionValues[1].value;
      const m         = row.metricValues;
      const revenue   = parseFloat(m[0].value ?? '0');
      const articles  = parseInt(m[1].value ?? '0');
      const purchases = parseInt(m[2].value ?? '0');
      const addToCart = parseInt(m[3].value ?? '0');

      await sql`
        INSERT INTO product_routes
          (client_id, snapshot_date, route, revenue, articles, purchases, add_to_cart)
        VALUES
          (${clientId}, ${date}, ${route}, ${revenue}, ${articles}, ${purchases}, ${addToCart})
        ON CONFLICT (client_id, snapshot_date, route)
        DO UPDATE SET
          revenue = EXCLUDED.revenue, articles = EXCLUDED.articles,
          purchases = EXCLUDED.purchases, add_to_cart = EXCLUDED.add_to_cart, synced_at = NOW()
      `;
    }

    routeTotal  += rows.length;
    routeOffset += rows.length;
    if (rows.length < 10000) break;
    console.log(`  GA4 rutas: ${routeTotal} filas...`);
  }

  console.log(`✓ GA4 Rutas: ${routeTotal} filas insertadas`);
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  // ⚠ DESACTUALIZADO — NO CORRER SIN ARREGLAR.
  // Este script quedó en el modelo mono-cliente: usa META_AD_ACCOUNT_ID /
  // GOOGLE_ADS_CUSTOMER_ID / GA4_PROPERTY_ID de las env vars para TODOS los clientes,
  // así que escribiría la data de una cuenta bajo el client_id de las otras (es el bug
  // que scripts/sync/index.ts ya documenta como arreglado). Para habilitarlo hay que
  // leer los IDs de la fila del cliente, igual que index.ts.
  if (process.env.BACKFILL_I_KNOW_ITS_BROKEN !== 'yes') {
    throw new Error('backfill.ts está desactualizado (multi-cliente): contaminaría los datos de todos los clientes. Ver comentario en el código.');
  }
  const clients = await sql`SELECT id, slug FROM clients`;

  for (const client of clients) {
    console.log(`\n→ Cliente: ${client.slug}`);

    try { await backfillMeta(client.id, process.env.META_AD_ACCOUNT_ID!, process.env.META_ACCESS_TOKEN!); }
    catch (e) { console.error('  ✗ Meta:', e); }

    try { await backfillGoogleAds(client.id, process.env.GOOGLE_ADS_CUSTOMER_ID!); }
    catch (e) { console.error('  ✗ Google Ads:', e); }

    // YouTube deshabilitado por ahora
    // try { await backfillYouTube(client.id, process.env.GOOGLE_ADS_CUSTOMER_ID!); }
    // catch (e) { console.error('  ✗ YouTube:', e); }

    try { await backfillGA4(client.id, process.env.GA4_PROPERTY_ID!); }
    catch (e) { console.error('  ✗ GA4:', e); }
  }

  console.log('\n✓ Backfill completo\n');
}

main().catch(e => { console.error(e); process.exit(1); });
