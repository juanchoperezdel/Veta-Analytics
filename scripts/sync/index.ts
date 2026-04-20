import { neon } from '@neondatabase/serverless';

const sql = neon(process.env.DATABASE_URL!);

const TODAY = new Date().toISOString().split('T')[0];

// ─── Helpers ────────────────────────────────────────────────────────────────

function prevPeriodDelta(current: number, previous: number): number {
  if (!previous || previous === 0) return 0;
  return (current - previous) / previous;
}

// ─── Meta Ads ───────────────────────────────────────────────────────────────

async function syncMetaAds(clientId: string, adAccountId: string, accessToken: string) {
  const datePreset = 'last_30d';
  const fields = [
    'campaign_id', 'campaign_name', 'spend', 'reach',
    'impressions', 'clicks', 'ctr', 'cpc',
    'actions', 'action_values'
  ].join(',');

  const url = `https://graph.facebook.com/v21.0/act_${adAccountId}/insights?` +
    `level=campaign&date_preset=${datePreset}&fields=${fields}&access_token=${accessToken}`;

  const res = await fetch(url);
  if (!res.ok) throw new Error(`Meta API error: ${res.status} ${await res.text()}`);
  const { data }: { data: any[] } = await res.json();

  let totalSpend = 0, totalPurchases = 0, totalRevenue = 0;

  for (const row of data) {
    const spend = parseFloat(row.spend ?? '0');
    const purchases = (row.actions ?? []).find((a: any) => a.action_type === 'purchase')?.value ?? 0;
    const revenue = (row.action_values ?? []).find((a: any) => a.action_type === 'purchase')?.value ?? 0;
    const cpa = purchases > 0 ? spend / purchases : 0;
    const roas = spend > 0 ? revenue / spend : 0;

    totalSpend += spend;
    totalPurchases += Number(purchases);
    totalRevenue += parseFloat(revenue);

    await sql`
      INSERT INTO meta_ads_campaigns
        (client_id, snapshot_date, campaign_id, type, segment, spend, reach, purchases, revenue, cpa, roas, ctr, cpc)
      VALUES
        (${clientId}, ${TODAY}, ${row.campaign_id}, 'Conversión', ${row.campaign_name},
         ${spend}, ${parseInt(row.reach ?? '0')}, ${purchases}, ${revenue},
         ${cpa}, ${roas}, ${parseFloat(row.ctr ?? '0')}, ${parseFloat(row.cpc ?? '0')})
      ON CONFLICT (client_id, snapshot_date, campaign_id)
      DO UPDATE SET
        spend = EXCLUDED.spend, reach = EXCLUDED.reach, purchases = EXCLUDED.purchases,
        revenue = EXCLUDED.revenue, cpa = EXCLUDED.cpa, roas = EXCLUDED.roas,
        ctr = EXCLUDED.ctr, cpc = EXCLUDED.cpc, synced_at = NOW()
    `;
  }

  const aov = totalPurchases > 0 ? totalRevenue / totalPurchases : 0;
  const totalRoas = totalSpend > 0 ? totalRevenue / totalSpend : 0;
  const totalCpa = totalPurchases > 0 ? totalSpend / totalPurchases : 0;

  await sql`
    INSERT INTO meta_ads_kpis
      (client_id, snapshot_date, spend, purchases, revenue, cpa, roas, aov)
    VALUES
      (${clientId}, ${TODAY}, ${totalSpend}, ${totalPurchases}, ${totalRevenue}, ${totalCpa}, ${totalRoas}, ${aov})
    ON CONFLICT (client_id, snapshot_date)
    DO UPDATE SET
      spend = EXCLUDED.spend, purchases = EXCLUDED.purchases, revenue = EXCLUDED.revenue,
      cpa = EXCLUDED.cpa, roas = EXCLUDED.roas, aov = EXCLUDED.aov, synced_at = NOW()
  `;

  console.log(`✓ Meta Ads synced: ${data.length} campaigns`);
}

// ─── Google Ads ──────────────────────────────────────────────────────────────

async function getGoogleAccessToken(): Promise<string> {
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: process.env.GOOGLE_ADS_CLIENT_ID!,
      client_secret: process.env.GOOGLE_ADS_CLIENT_SECRET!,
      refresh_token: process.env.GOOGLE_ADS_REFRESH_TOKEN!,
      grant_type: 'refresh_token',
    }),
  });
  const { access_token } = await res.json();
  return access_token;
}

async function syncGoogleAds(clientId: string, customerId: string) {
  const accessToken = await getGoogleAccessToken();
  const query = `
    SELECT
      campaign.id, campaign.name,
      metrics.cost_micros, metrics.impressions, metrics.clicks,
      metrics.ctr, metrics.average_cpc,
      metrics.conversions, metrics.conversions_value
    FROM campaign
    WHERE segments.date DURING LAST_30_DAYS
      AND metrics.cost_micros > 0
    ORDER BY metrics.cost_micros DESC
  `;

  const res = await fetch(
    `https://googleads.googleapis.com/v18/customers/${customerId}/googleAds:search`,
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
  const { results = [] }: { results: any[] } = await res.json();

  let totalSpend = 0, totalCarts = 0, totalRevenue = 0;

  for (const row of results) {
    const spend = (row.metrics.costMicros ?? 0) / 1_000_000;
    const clicks = row.metrics.clicks ?? 0;
    const conversions = parseFloat(row.metrics.conversions ?? '0');
    const revenue = parseFloat(row.metrics.conversionsValue ?? '0');

    totalSpend += spend;
    totalCarts += Math.round(conversions);
    totalRevenue += revenue;

    await sql`
      INSERT INTO google_ads_campaigns
        (client_id, snapshot_date, campaign_id, name, spend, impressions, clicks, ctr, cpc, carts, revenue, roas)
      VALUES
        (${clientId}, ${TODAY}, ${String(row.campaign.id)}, ${row.campaign.name},
         ${spend}, ${row.metrics.impressions ?? 0}, ${clicks},
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

  const roas = totalSpend > 0 ? totalRevenue / totalSpend : 0;
  const cpa = totalCarts > 0 ? totalSpend / totalCarts : 0;
  const aov = totalCarts > 0 ? totalRevenue / totalCarts : 0;

  await sql`
    INSERT INTO google_ads_kpis
      (client_id, snapshot_date, spend, carts, revenue, cpa, roas, aov)
    VALUES
      (${clientId}, ${TODAY}, ${totalSpend}, ${totalCarts}, ${totalRevenue}, ${cpa}, ${roas}, ${aov})
    ON CONFLICT (client_id, snapshot_date)
    DO UPDATE SET
      spend = EXCLUDED.spend, carts = EXCLUDED.carts, revenue = EXCLUDED.revenue,
      cpa = EXCLUDED.cpa, roas = EXCLUDED.roas, aov = EXCLUDED.aov, synced_at = NOW()
  `;

  console.log(`✓ Google Ads synced: ${results.length} campaigns`);
}

// ─── YouTube Ads (via Google Ads API) ────────────────────────────────────────

async function syncYouTube(clientId: string, customerId: string) {
  const accessToken = await getGoogleAccessToken();

  const query = `
    SELECT
      ad_group_ad.ad.video_ad.video.id,
      ad_group_ad.ad.name,
      campaign.name,
      metrics.cost_micros,
      metrics.impressions,
      metrics.clicks,
      metrics.ctr,
      metrics.video_views,
      metrics.all_conversions,
      metrics.all_conversions_value
    FROM ad_group_ad
    WHERE segments.date DURING LAST_30_DAYS
      AND campaign.advertising_channel_type = 'VIDEO'
      AND metrics.cost_micros > 0
    ORDER BY metrics.cost_micros DESC
    LIMIT 20
  `;

  const res = await fetch(
    `https://googleads.googleapis.com/v18/customers/${customerId}/googleAds:search`,
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
    const videoId   = row.adGroupAd?.ad?.videoAd?.video?.id ?? row.adGroupAd?.ad?.name ?? 'unknown';
    const title     = row.adGroupAd?.ad?.name ?? 'Sin título';
    const campaign  = row.campaign?.name ?? '';
    const spend     = (row.metrics?.costMicros ?? 0) / 1_000_000;
    const impressions  = Number(row.metrics?.impressions ?? 0);
    const clicks       = Number(row.metrics?.clicks ?? 0);
    const ctr          = parseFloat(row.metrics?.ctr ?? '0');
    const conversions  = parseFloat(row.metrics?.allConversions ?? '0');
    const convValue    = parseFloat(row.metrics?.allConversionsValue ?? '0');
    const convRate     = impressions > 0 ? conversions / impressions : 0;

    await sql`
      INSERT INTO youtube_videos
        (client_id, snapshot_date, video_id, title, campaign, impressions, clicks, ctr, conversions, conversion_rate, spend)
      VALUES
        (${clientId}, ${TODAY}, ${videoId}, ${title}, ${campaign},
         ${impressions}, ${clicks}, ${ctr}, ${conversions}, ${convRate}, ${spend})
      ON CONFLICT (client_id, snapshot_date, video_id)
      DO UPDATE SET
        title = EXCLUDED.title, campaign = EXCLUDED.campaign,
        impressions = EXCLUDED.impressions, clicks = EXCLUDED.clicks,
        ctr = EXCLUDED.ctr, conversions = EXCLUDED.conversions,
        conversion_rate = EXCLUDED.conversion_rate, spend = EXCLUDED.spend,
        synced_at = NOW()
    `;
  }

  console.log(`✓ YouTube synced: ${results.length} videos`);
}

// ─── GA4 (KPIs + rutas) ──────────────────────────────────────────────────────

async function syncGA4(clientId: string, propertyId: string) {
  // Usa authorized_user credential (refresh_token)
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

  // Reporte de KPIs de negocio
  const kpisRes = await fetch(
    `https://analyticsdata.googleapis.com/v1beta/properties/${propertyId}:runReport`,
    {
      method: 'POST',
      headers: { Authorization: `Bearer ${access_token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        dateRanges: [{ startDate: '30daysAgo', endDate: 'today' }],
        metrics: [
          { name: 'activeUsers' },
          { name: 'sessions' },
          { name: 'averageSessionDuration' },
          { name: 'transactions' },
          { name: 'purchaseRevenue' },
          { name: 'addToCarts' },
        ],
      }),
    }
  );
  const kpisData = await kpisRes.json();
  const row = kpisData.rows?.[0]?.metricValues ?? [];
  const users = parseInt(row[0]?.value ?? '0');
  const sessions = parseInt(row[1]?.value ?? '0');
  const avgDuration = secondsToMMSS(parseFloat(row[2]?.value ?? '0'));
  const tickets = parseInt(row[3]?.value ?? '0');
  const revenue = parseFloat(row[4]?.value ?? '0');
  const carts = parseInt(row[5]?.value ?? '0');
  const conversionRate = sessions > 0 ? tickets / sessions : 0;
  const aov = tickets > 0 ? revenue / tickets : 0;

  await sql`
    INSERT INTO business_kpis
      (client_id, snapshot_date, users, sessions, avg_session_duration,
       conversion_rate, carts, tickets, revenue, aov)
    VALUES
      (${clientId}, ${TODAY}, ${users}, ${sessions}, ${avgDuration},
       ${conversionRate}, ${carts}, ${tickets}, ${revenue}, ${aov})
    ON CONFLICT (client_id, snapshot_date)
    DO UPDATE SET
      users = EXCLUDED.users, sessions = EXCLUDED.sessions,
      avg_session_duration = EXCLUDED.avg_session_duration,
      conversion_rate = EXCLUDED.conversion_rate, carts = EXCLUDED.carts,
      tickets = EXCLUDED.tickets, revenue = EXCLUDED.revenue,
      aov = EXCLUDED.aov, synced_at = NOW()
  `;

  // Reporte de rutas (e-commerce items)
  const routesRes = await fetch(
    `https://analyticsdata.googleapis.com/v1beta/properties/${propertyId}:runReport`,
    {
      method: 'POST',
      headers: { Authorization: `Bearer ${access_token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        dateRanges: [{ startDate: '30daysAgo', endDate: 'today' }],
        dimensions: [{ name: 'itemName' }],
        metrics: [
          { name: 'itemRevenue' },
          { name: 'itemsPurchased' },
          { name: 'transactions' },
          { name: 'addToCarts' },
        ],
        orderBys: [{ metric: { metricName: 'itemRevenue' }, desc: true }],
        limit: 20,
      }),
    }
  );
  const routesData = await routesRes.json();

  for (const routeRow of routesData.rows ?? []) {
    const route = routeRow.dimensionValues[0].value;
    const routeRevenue = parseFloat(routeRow.metricValues[0].value ?? '0');
    const articles = parseInt(routeRow.metricValues[1].value ?? '0');
    const purchases = parseInt(routeRow.metricValues[2].value ?? '0');
    const addToCart = parseInt(routeRow.metricValues[3].value ?? '0');

    await sql`
      INSERT INTO product_routes
        (client_id, snapshot_date, route, revenue, articles, purchases, add_to_cart)
      VALUES
        (${clientId}, ${TODAY}, ${route}, ${routeRevenue}, ${articles}, ${purchases}, ${addToCart})
      ON CONFLICT (client_id, snapshot_date, route)
      DO UPDATE SET
        revenue = EXCLUDED.revenue, articles = EXCLUDED.articles,
        purchases = EXCLUDED.purchases, add_to_cart = EXCLUDED.add_to_cart, synced_at = NOW()
    `;
  }

  console.log(`✓ GA4 synced: KPIs + ${routesData.rows?.length ?? 0} routes`);
}

function secondsToMMSS(seconds: number): string {
  const m = Math.floor(seconds / 60).toString().padStart(2, '0');
  const s = Math.floor(seconds % 60).toString().padStart(2, '0');
  return `${m}:${s}`;
}

// ─── Main ────────────────────────────────────────────────────────────────────

async function main() {
  console.log(`\nVeta Analytics sync — ${TODAY}`);

  const clients = await sql`SELECT id, slug FROM clients`;

  for (const client of clients) {
    console.log(`\n→ Syncing client: ${client.slug}`);

    try {
      await syncMetaAds(
        client.id,
        process.env.META_AD_ACCOUNT_ID!,
        process.env.META_ACCESS_TOKEN!
      );
    } catch (e) {
      console.error(`  ✗ Meta Ads error:`, e);
    }

    try {
      await syncGoogleAds(client.id, process.env.GOOGLE_ADS_CUSTOMER_ID!);
    } catch (e) {
      console.error(`  ✗ Google Ads error:`, e);
    }

    try {
      await syncGA4(client.id, process.env.GA4_PROPERTY_ID!);
    } catch (e) {
      console.error(`  ✗ GA4 error:`, e);
    }

    try {
      await syncYouTube(client.id, process.env.GOOGLE_ADS_CUSTOMER_ID!);
    } catch (e) {
      console.error(`  ✗ YouTube error:`, e);
    }
  }

  console.log('\n✓ Sync complete\n');
}

main().catch((e) => { console.error(e); process.exit(1); });
