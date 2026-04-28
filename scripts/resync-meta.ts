// Re-sincroniza Meta Ads con los nuevos campos (objective, effective_status, attribution windows)
// para el rango histórico completo. Uso:
//   npx tsx scripts/resync-meta.ts               -> desde 2024-10-01 hasta hoy
//   npx tsx scripts/resync-meta.ts 2026-03-01    -> desde la fecha indicada hasta hoy
//   npx tsx scripts/resync-meta.ts 2026-03-01 2026-04-23

import { neon } from '@neondatabase/serverless';
const sql = neon(process.env.DATABASE_URL!);

const SINCE = process.argv[2] ?? '2024-10-01';
const UNTIL = process.argv[3] ?? new Date().toISOString().split('T')[0];

console.log(`Meta Ads resync: ${SINCE} → ${UNTIL}\n`);

function pad(n: number) { return String(n).padStart(2, '0'); }
function ymd(y: number, m: number, d: number) { return `${y}-${pad(m)}-${pad(d)}`; }

function monthRanges(since: string, until: string): { since: string; until: string }[] {
  const [sy, sm, sd] = since.split('-').map(Number);
  const [uy, um, ud] = until.split('-').map(Number);
  const ranges: { since: string; until: string }[] = [];
  let y = sy, m = sm;
  while (y < uy || (y === uy && m <= um)) {
    const startDay = (y === sy && m === sm) ? sd : 1;
    const lastDay  = new Date(y, m, 0).getDate();
    const endDay   = (y === uy && m === um) ? ud : lastDay;
    ranges.push({ since: ymd(y, m, startDay), until: ymd(y, m, endDay) });
    m++; if (m > 12) { m = 1; y++; }
  }
  return ranges;
}

async function fetchStatuses(adAccountId: string, token: string): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  let url: string | null =
    `https://graph.facebook.com/v21.0/act_${adAccountId}/campaigns?fields=id,effective_status&limit=500&access_token=${token}`;
  while (url) {
    const res = await fetch(url);
    if (!res.ok) break;
    const body = await res.json();
    for (const c of (body.data ?? [])) map.set(c.id, c.effective_status);
    url = body.paging?.next ?? null;
  }
  return map;
}

async function syncMonth(
  clientId: string, adAccountId: string, token: string,
  since: string, until: string, statusByCampaign: Map<string, string>,
): Promise<number> {
  const fields = [
    'campaign_id','campaign_name','objective','date_start',
    'spend','reach','impressions','clicks','ctr','cpc',
    'actions','action_values',
  ].join(',');
  const attribution = JSON.stringify(['7d_click','1d_view']);
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
    `&fields=${fields}&access_token=${token}&limit=500`;

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
      const purchases = (row.actions ?? []).find((a: any) => a.action_type === 'purchase')?.value ?? 0;
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

async function main() {
  const clients = await sql`SELECT id, slug FROM clients` as any[];
  const adAccountId = process.env.META_AD_ACCOUNT_ID!;
  const token = process.env.META_ACCESS_TOKEN!;

  for (const c of clients) {
    console.log(`→ Cliente: ${c.slug}`);
    const statusByCampaign = await fetchStatuses(adAccountId, token);
    console.log(`  (status snapshot: ${statusByCampaign.size} campañas)`);

    const ranges = monthRanges(SINCE, UNTIL);
    let total = 0;
    for (const r of ranges) {
      process.stdout.write(`  ${r.since} → ${r.until}  ... `);
      const n = await syncMonth(c.id, adAccountId, token, r.since, r.until, statusByCampaign);
      total += n;
      console.log(`${n} filas`);
    }
    console.log(`✓ Total: ${total} filas\n`);
  }
}

main().catch(e => { console.error(e); process.exit(1); });
