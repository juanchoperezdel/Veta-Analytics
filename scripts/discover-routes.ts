// Discovery script para identificar la mejor fuente de data de rutas/tramos
// para Andesmar (GA4 sin e-commerce tracking decente).
//
// Prueba: pagePath + landingPage (GA4), eventName con params (GA4),
// nombres de campañas (Meta + Google Ads) y search terms (Google Ads).
//
// Uso:
//   npx dotenv-cli -e .env -- npx tsx scripts/discover-routes.ts

import { neon } from '@neondatabase/serverless';
import { SignJWT, importPKCS8 } from 'jose';

const sql = neon(process.env.DATABASE_URL!);

const PROPERTY_ID = process.env.GA4_PROPERTY_ID!;
const GADS_CUSTOMER_ID = process.env.GOOGLE_ADS_CUSTOMER_ID!;
const META_AD_ACCOUNT_ID = process.env.META_AD_ACCOUNT_ID!;
const META_TOKEN = process.env.META_ACCESS_TOKEN!;

// ─── Auth helpers ───────────────────────────────────────────────────────────

async function getGA4AccessToken(): Promise<string> {
  const cred = JSON.parse(process.env.GA4_SERVICE_ACCOUNT_JSON!);
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: cred.client_id,
      client_secret: cred.client_secret,
      refresh_token: cred.refresh_token,
      grant_type: 'refresh_token',
    }),
  });
  const data = await res.json();
  if (!data.access_token) throw new Error(`GA4 token error: ${JSON.stringify(data)}`);
  return data.access_token;
}

async function getGoogleAdsAccessToken(): Promise<string> {
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
  const { access_token } = await res.json() as any;
  if (!access_token) throw new Error('Google Ads token failed');
  return access_token;
}

async function ga4Report(token: string, body: any): Promise<any> {
  const res = await fetch(
    `https://analyticsdata.googleapis.com/v1beta/properties/${PROPERTY_ID}:runReport`,
    {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }
  );
  if (!res.ok) {
    const txt = await res.text();
    throw new Error(`GA4 error ${res.status}: ${txt}`);
  }
  return res.json();
}

// ─── Discovery probes ───────────────────────────────────────────────────────

async function probePagePaths(token: string) {
  console.log('\n━━━ PROBE 1: GA4 pagePath (top 30 por sesiones) ━━━');
  console.log('Buscando URLs que indiquen ruta/tramo (ej: /pasajes/buenos-aires-mendoza)\n');

  const data = await ga4Report(token, {
    dateRanges: [{ startDate: '30daysAgo', endDate: 'today' }],
    dimensions: [{ name: 'pagePath' }],
    metrics: [{ name: 'sessions' }, { name: 'totalUsers' }, { name: 'totalRevenue' }],
    orderBys: [{ metric: { metricName: 'sessions' }, desc: true }],
    limit: 30,
  });

  if (!data.rows?.length) {
    console.log('⚠ Sin datos.');
    return;
  }
  console.log('Path | Sessions | Users | Revenue');
  console.log('─'.repeat(80));
  for (const row of data.rows) {
    const path = row.dimensionValues[0].value;
    const sessions = row.metricValues[0].value;
    const users = row.metricValues[1].value;
    const revenue = row.metricValues[2].value;
    console.log(`${path.padEnd(60)} | ${sessions.padStart(7)} | ${users.padStart(6)} | ${revenue}`);
  }
}

async function probeLandingPages(token: string) {
  console.log('\n━━━ PROBE 2: GA4 landingPage + sessionDefaultChannelGroup (top 25) ━━━');
  console.log('Para entender qué landings reciben tráfico pago vs orgánico\n');

  const data = await ga4Report(token, {
    dateRanges: [{ startDate: '30daysAgo', endDate: 'today' }],
    dimensions: [{ name: 'landingPage' }, { name: 'sessionDefaultChannelGroup' }],
    metrics: [{ name: 'sessions' }, { name: 'conversions' }],
    orderBys: [{ metric: { metricName: 'sessions' }, desc: true }],
    limit: 25,
  });

  if (!data.rows?.length) {
    console.log('⚠ Sin datos.');
    return;
  }
  console.log('Landing | Channel | Sessions | Conversions');
  console.log('─'.repeat(95));
  for (const row of data.rows) {
    const landing = row.dimensionValues[0].value.slice(0, 50);
    const channel = row.dimensionValues[1].value;
    const sessions = row.metricValues[0].value;
    const convs = row.metricValues[1].value;
    console.log(`${landing.padEnd(50)} | ${channel.padEnd(20)} | ${sessions.padStart(7)} | ${convs.padStart(6)}`);
  }
}

async function probeEvents(token: string) {
  console.log('\n━━━ PROBE 3: GA4 eventName (top 30 por count) ━━━');
  console.log('Buscando custom events de tipo select_route, view_route, etc.\n');

  const data = await ga4Report(token, {
    dateRanges: [{ startDate: '30daysAgo', endDate: 'today' }],
    dimensions: [{ name: 'eventName' }],
    metrics: [{ name: 'eventCount' }, { name: 'totalUsers' }],
    orderBys: [{ metric: { metricName: 'eventCount' }, desc: true }],
    limit: 30,
  });

  if (!data.rows?.length) {
    console.log('⚠ Sin datos.');
    return;
  }
  console.log('Event | Count | Users');
  console.log('─'.repeat(60));
  for (const row of data.rows) {
    const ev = row.dimensionValues[0].value;
    const count = row.metricValues[0].value;
    const users = row.metricValues[1].value;
    console.log(`${ev.padEnd(35)} | ${count.padStart(8)} | ${users.padStart(6)}`);
  }
}

async function probeItems(token: string) {
  console.log('\n━━━ PROBE 4: GA4 items (itemName, itemCategory, itemBrand) ━━━');
  console.log('Verifica si hay e-commerce items (debería estar vacío para Andesmar)\n');

  const data = await ga4Report(token, {
    dateRanges: [{ startDate: '30daysAgo', endDate: 'today' }],
    dimensions: [
      { name: 'itemName' },
      { name: 'itemCategory' },
      { name: 'itemBrand' },
    ],
    metrics: [
      { name: 'itemRevenue' },
      { name: 'itemsViewed' },
      { name: 'itemsAddedToCart' },
    ],
    orderBys: [{ metric: { metricName: 'itemsViewed' }, desc: true }],
    limit: 20,
  });

  if (!data.rows?.length) {
    console.log('⚠ Sin items en GA4 — confirmado: no hay e-commerce tracking.');
    return;
  }
  console.log('itemName | itemCategory | itemBrand | Revenue | Views | ATC');
  console.log('─'.repeat(95));
  for (const row of data.rows) {
    const n = row.dimensionValues[0].value;
    const c = row.dimensionValues[1].value;
    const b = row.dimensionValues[2].value;
    const rev = row.metricValues[0].value;
    const views = row.metricValues[1].value;
    const atc = row.metricValues[2].value;
    console.log(`${n.slice(0, 30).padEnd(30)} | ${c.slice(0, 15).padEnd(15)} | ${b.slice(0, 15).padEnd(15)} | ${rev.padStart(8)} | ${views.padStart(6)} | ${atc.padStart(5)}`);
  }
}

async function probeMetaCampaignNames() {
  console.log('\n━━━ PROBE 5: Nombres de campañas Meta (de DB, top 30 por spend) ━━━');
  console.log('Para ver si los nombres tienen patrón ruta-orientado\n');

  const rows = await sql`
    SELECT segment AS name, SUM(spend)::numeric(12,2) AS spend, SUM(purchases) AS purchases
    FROM meta_ads_campaigns
    WHERE snapshot_date >= CURRENT_DATE - INTERVAL '30 days'
    GROUP BY segment
    ORDER BY spend DESC
    LIMIT 30
  `;

  if (!rows.length) {
    console.log('⚠ Sin campañas Meta en últimos 30 días.');
    return;
  }
  console.log('Campaign | Spend | Purchases');
  console.log('─'.repeat(85));
  for (const r of rows) {
    console.log(`${(r.name ?? '(null)').slice(0, 60).padEnd(60)} | ${String(r.spend).padStart(10)} | ${String(r.purchases).padStart(6)}`);
  }
}

async function probeGoogleCampaignNames() {
  console.log('\n━━━ PROBE 6: Nombres de campañas Google Ads (de DB, top 30 por spend) ━━━');
  console.log('Para ver si los nombres tienen patrón ruta-orientado\n');

  const rows = await sql`
    SELECT name, SUM(spend)::numeric(12,2) AS spend, SUM(carts) AS carts
    FROM google_ads_campaigns
    WHERE snapshot_date >= CURRENT_DATE - INTERVAL '30 days'
    GROUP BY name
    ORDER BY spend DESC
    LIMIT 30
  `;

  if (!rows.length) {
    console.log('⚠ Sin campañas Google Ads en últimos 30 días.');
    return;
  }
  console.log('Campaign | Spend | Carts');
  console.log('─'.repeat(85));
  for (const r of rows) {
    console.log(`${(r.name ?? '(null)').slice(0, 60).padEnd(60)} | ${String(r.spend).padStart(10)} | ${String(r.carts).padStart(5)}`);
  }
}

async function probeGoogleSearchTerms(token: string) {
  console.log('\n━━━ PROBE 7: Search Terms reales de Google Ads (top 30 por clicks) ━━━');
  console.log('Las queries que la gente buscó y activaron ads → señal directa de demanda por ruta\n');

  const query = `
    SELECT
      search_term_view.search_term,
      metrics.clicks,
      metrics.impressions,
      metrics.cost_micros,
      metrics.conversions
    FROM search_term_view
    WHERE segments.date DURING LAST_30_DAYS
    ORDER BY metrics.clicks DESC
    LIMIT 30
  `;

  const res = await fetch(
    `https://googleads.googleapis.com/v24/customers/${GADS_CUSTOMER_ID}/googleAds:searchStream`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'developer-token': process.env.GOOGLE_ADS_DEV_TOKEN!,
        'login-customer-id': process.env.GOOGLE_ADS_LOGIN_CUSTOMER_ID!,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ query }),
    }
  );

  if (!res.ok) {
    console.log(`⚠ Google Ads error: ${res.status} ${await res.text()}`);
    return;
  }
  const batches: any[] = await res.json();
  const results = batches.flatMap((b: any) => b.results ?? []);

  if (!results.length) {
    console.log('⚠ Sin search terms.');
    return;
  }
  console.log('Search term | Clicks | Impressions | Cost | Conversions');
  console.log('─'.repeat(95));
  for (const r of results) {
    const term = (r.searchTermView?.searchTerm ?? '').slice(0, 50);
    const clicks = r.metrics?.clicks ?? 0;
    const impr = r.metrics?.impressions ?? 0;
    const cost = ((r.metrics?.costMicros ?? 0) / 1_000_000).toFixed(2);
    const convs = r.metrics?.conversions ?? 0;
    console.log(`${term.padEnd(50)} | ${String(clicks).padStart(5)} | ${String(impr).padStart(7)} | ${String(cost).padStart(8)} | ${String(convs).padStart(5)}`);
  }
}

// ─── Main ───────────────────────────────────────────────────────────────────

async function main() {
  console.log('═══════════════════════════════════════════════════════════════════');
  console.log('  DISCOVERY DE RUTAS — Veta Analytics (Andesmar)');
  console.log('═══════════════════════════════════════════════════════════════════');

  let ga4Token: string | null = null;
  try {
    ga4Token = await getGA4AccessToken();
  } catch (e: any) {
    console.log(`\n⚠ GA4 auth FALLÓ: ${e.message}`);
    console.log('  → Los 4 probes de GA4 se saltean. Refrescá el token y volvé a correr el script.');
  }

  let gadsToken: string | null = null;
  try {
    gadsToken = await getGoogleAdsAccessToken();
  } catch (e: any) {
    console.log(`\n⚠ Google Ads auth FALLÓ: ${e.message}`);
  }

  if (ga4Token) {
    await probePagePaths(ga4Token).catch(e => console.log(`Probe 1 falló: ${e.message}`));
    await probeLandingPages(ga4Token).catch(e => console.log(`Probe 2 falló: ${e.message}`));
    await probeEvents(ga4Token).catch(e => console.log(`Probe 3 falló: ${e.message}`));
    await probeItems(ga4Token).catch(e => console.log(`Probe 4 falló: ${e.message}`));
  }
  await probeMetaCampaignNames().catch(e => console.log(`Probe 5 falló: ${e.message}`));
  await probeGoogleCampaignNames().catch(e => console.log(`Probe 6 falló: ${e.message}`));
  if (gadsToken) {
    await probeGoogleSearchTerms(gadsToken).catch(e => console.log(`Probe 7 falló: ${e.message}`));
  }

  console.log('\n═══════════════════════════════════════════════════════════════════');
  console.log('  Discovery completo. Analizá los resultados y elegí la mejor fuente.');
  console.log('═══════════════════════════════════════════════════════════════════\n');
}

main().catch((e) => { console.error(e); process.exit(1); });
