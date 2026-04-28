import { neon } from '@neondatabase/serverless';

const sql = neon(process.env.DATABASE_URL!);

async function main() {
  const adAccountId = process.env.META_AD_ACCOUNT_ID!;
  const token       = process.env.META_ACCESS_TOKEN!;
  const since       = '2026-04-01';
  const until       = '2026-04-23';

  // Campañas presentes en DB para ese rango
  const dbCamps = await sql`
    SELECT campaign_id, MAX(segment) AS name, SUM(purchases)::bigint AS p
    FROM meta_ads_campaigns m
    JOIN clients c ON c.id = m.client_id
    WHERE c.slug = 'andesmar' AND snapshot_date BETWEEN ${since} AND ${until}
    GROUP BY campaign_id
  ` as any[];

  // Traer insights con filtering que fuerza incluir TODOS los effective_status
  const fields = 'campaign_id,campaign_name,objective,spend';
  const filtering = JSON.stringify([{
    field: 'campaign.effective_status',
    operator: 'IN',
    value: ['ACTIVE','PAUSED','DELETED','ARCHIVED','PENDING_REVIEW','DISAPPROVED','PREAPPROVED','PENDING_BILLING_INFO','CAMPAIGN_PAUSED','ADSET_PAUSED','IN_PROCESS','WITH_ISSUES'],
  }]);

  const url = `https://graph.facebook.com/v21.0/act_${adAccountId}/insights?` +
    `level=campaign` +
    `&time_range=${encodeURIComponent(JSON.stringify({ since, until }))}` +
    `&fields=${fields}` +
    `&filtering=${encodeURIComponent(filtering)}` +
    `&access_token=${token}&limit=500`;

  const res = await fetch(url);
  if (!res.ok) { console.error(res.status, await res.text()); return; }
  const body = await res.json() as any;
  const apiCamps = new Map<string, any>();
  for (const r of body.data ?? []) {
    apiCamps.set(r.campaign_id, r);
  }

  console.log(`DB tiene ${dbCamps.length} campañas, API (todos los status) devuelve ${apiCamps.size}\n`);

  console.log('Cruce DB vs API (con todos los effective_status):');
  for (const c of dbCamps) {
    const apiMatch = apiCamps.get(c.campaign_id);
    const marker = apiMatch ? '✓' : '✗ NO EN API';
    console.log(`  ${marker}  id=${c.campaign_id}  p=${String(c.p).padStart(4)}  name=${c.name}`);
  }

  console.log('\nPara las que NO están en la API, consultamos su estado por ID:');
  for (const c of dbCamps) {
    if (apiCamps.has(c.campaign_id)) continue;
    const r = await fetch(`https://graph.facebook.com/v21.0/${c.campaign_id}?fields=name,objective,effective_status,status,configured_status,created_time,updated_time&access_token=${token}`);
    if (!r.ok) {
      console.log(`  id=${c.campaign_id}: ERROR ${r.status} ${await r.text()}`);
      continue;
    }
    const d = await r.json() as any;
    console.log(`  id=${c.campaign_id}  status=${d.effective_status}  configured=${d.configured_status}  obj=${d.objective}  name=${d.name}`);
  }
}

main().catch(e => { console.error(e); process.exit(1); });
