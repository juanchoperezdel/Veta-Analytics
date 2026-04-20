import { neon } from '@neondatabase/serverless';
import { SignJWT, importPKCS8 } from 'jose';

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

async function syncMetaAds(clientId: string, adAccountId: string, accessToken: string) {
  const { since, until } = dateRange(30);
  const fields = [
    'campaign_id', 'campaign_name', 'date_start',
    'spend', 'reach', 'impressions', 'clicks', 'ctr', 'cpc',
    'actions', 'action_values',
  ].join(',');

  const url = `https://graph.facebook.com/v21.0/act_${adAccountId}/insights?` +
    `level=campaign&time_increment=1` +
    `&time_range=${encodeURIComponent(JSON.stringify({ since, until }))}` +
    `&fields=${fields}&access_token=${accessToken}&limit=500`;

  const res = await fetch(url);
  if (!res.ok) throw new Error(`Meta API error: ${res.status} ${await res.text()}`);
  const body = await res.json();
  const data: any[] = body.data ?? [];

  for (const row of data) {
    const date      = row.date_start;
    const spend     = parseFloat(row.spend ?? '0');
    const purchases = (row.actions ?? []).find((a: any) => a.action_type === 'purchase')?.value ?? 0;
    const revenue   = parseFloat((row.action_values ?? []).find((a: any) => a.action_type === 'purchase')?.value ?? '0');
    const cpa       = Number(purchases) > 0 ? spend / Number(purchases) : 0;
    const roas      = spend > 0 ? revenue / spend : 0;

    await sql`
      INSERT INTO meta_ads_campaigns
        (client_id, snapshot_date, campaign_id, type, segment, spend, reach, purchases, revenue, cpa, roas, ctr, cpc)
      VALUES
        (${clientId}, ${date}, ${row.campaign_id}, 'Conversión', ${row.campaign_name},
         ${spend}, ${parseInt(row.reach ?? '0')}, ${purchases}, ${revenue},
         ${cpa}, ${roas}, ${parseFloat(row.ctr ?? '0')}, ${parseFloat(row.cpc ?? '0')})
      ON CONFLICT (client_id, snapshot_date, campaign_id)
      DO UPDATE SET
        spend = EXCLUDED.spend, reach = EXCLUDED.reach, purchases = EXCLUDED.purchases,
        revenue = EXCLUDED.revenue, cpa = EXCLUDED.cpa, roas = EXCLUDED.roas,
        ctr = EXCLUDED.ctr, cpc = EXCLUDED.cpc, synced_at = NOW()
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

  const query = `
    SELECT
      segments.date,
      campaign.id, campaign.name,
      metrics.cost_micros, metrics.impressions, metrics.clicks,
      metrics.ctr, metrics.average_cpc,
      metrics.conversions, metrics.conversions_value
    FROM campaign
    WHERE segments.date DURING LAST_30_DAYS
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

  console.log(`✓ Google Ads synced: ${results.length} daily rows`);
}

// ─── YouTube Ads (via Google Ads API) ────────────────────────────────────────

async function syncYouTube(clientId: string, customerId: string) {
  const accessToken = await getGoogleAccessToken();

  const query = `
    SELECT
      segments.date,
      ad_group_ad.ad.video_ad.video.id,
      ad_group_ad.ad.name,
      campaign.name,
      metrics.cost_micros, metrics.impressions, metrics.clicks,
      metrics.ctr, metrics.all_conversions, metrics.all_conversions_value
    FROM ad_group_ad
    WHERE segments.date DURING LAST_30_DAYS
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

  // Rutas diarias (e-commerce items)
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
          { name: 'transactions' },
          { name: 'addToCarts' },
        ],
        orderBys: [{ dimension: { dimensionName: 'date' } }],
        limit: 2000,
      }),
    }
  );
  const routesData = await routesRes.json();

  for (const row of routesData.rows ?? []) {
    const date    = ga4DateToISO(row.dimensionValues[0].value);
    const route   = row.dimensionValues[1].value;
    const m       = row.metricValues;
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

  console.log(`✓ GA4 synced: ${kpisData.rows?.length ?? 0} days KPIs, ${routesData.rows?.length ?? 0} route-days`);
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

  const clients = await sql`SELECT id, slug FROM clients`;

  for (const client of clients) {
    console.log(`\n→ Syncing client: ${client.slug}`);

    try {
      await syncMetaAds(client.id, process.env.META_AD_ACCOUNT_ID!, process.env.META_ACCESS_TOKEN!);
    } catch (e) { console.error(`  ✗ Meta Ads:`, e); }

    try {
      await syncGoogleAds(client.id, process.env.GOOGLE_ADS_CUSTOMER_ID!);
    } catch (e) { console.error(`  ✗ Google Ads:`, e); }

    // YouTube deshabilitado por ahora
    // try {
    //   await syncYouTube(client.id, process.env.GOOGLE_ADS_CUSTOMER_ID!);
    // } catch (e) { console.error(`  ✗ YouTube:`, e); }

    try {
      await syncGA4(client.id, process.env.GA4_PROPERTY_ID!);
    } catch (e) { console.error(`  ✗ GA4:`, e); }
  }

  console.log('\n✓ Sync complete\n');
}

main().catch((e) => { console.error(e); process.exit(1); });
