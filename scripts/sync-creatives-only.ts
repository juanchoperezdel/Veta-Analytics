// One-off: corre solo el sync de Meta creatives (en caso de que el sync regular
// haya fallado por rate limit). Lo demás ya está sincronizado.

import { neon } from '@neondatabase/serverless';
import { parseRoute } from './sync/parse-routes';

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

async function syncMetaCreatives(clientId: string, adAccountId: string, accessToken: string) {
  const { since, until } = dateRange(7);
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
  if (!res.ok) throw new Error(`Meta creatives error: ${res.status} ${await res.text()}`);
  const body = await res.json();
  const data: any[] = body.data ?? [];

  // Top ads by spend → fetch thumbnails for those only
  const spendByAd = new Map<string, number>();
  for (const r of data) {
    spendByAd.set(r.ad_id, (spendByAd.get(r.ad_id) ?? 0) + parseFloat(r.spend ?? '0'));
  }
  const topAdIds = [...spendByAd.entries()].sort((a, b) => b[1] - a[1]).slice(0, 60).map(([id]) => id);

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
        body: new URLSearchParams({ access_token: accessToken, batch: JSON.stringify(batch) }),
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
    } catch (e) {
      console.error(`Thumbnail batch failed:`, e);
    }
    if (i + 50 < topAdIds.length) await new Promise(r => setTimeout(r, 1500));
  }

  // Insert in chunks
  const concurrency = 30;
  for (let i = 0; i < data.length; i += concurrency) {
    const chunk = data.slice(i, i + concurrency);
    await Promise.all(chunk.map((row: any) => {
      const date = row.date_start;
      const spend = parseFloat(row.spend ?? '0');
      const impressions = parseInt(row.impressions ?? '0');
      const clicks = parseInt(row.clicks ?? '0');
      const reach = parseInt(row.reach ?? '0');
      const purchases = (row.actions ?? []).find((a: any) => a.action_type === 'purchase')?.value ?? 0;
      const revenue = parseFloat((row.action_values ?? []).find((a: any) => a.action_type === 'purchase')?.value ?? '0');
      const cpa = Number(purchases) > 0 ? spend / Number(purchases) : 0;
      const roas = spend > 0 ? revenue / spend : 0;
      const ctr = parseFloat(row.ctr ?? '0');
      const info = adInfo.get(row.ad_id);
      return sql`
        INSERT INTO meta_ads_creatives
          (client_id, snapshot_date, ad_id, ad_name, campaign_id, campaign_name,
           thumbnail_url, effective_status,
           spend, impressions, clicks, reach, purchases, revenue, cpa, roas, ctr)
        VALUES
          (${clientId}, ${date}, ${row.ad_id}, ${row.ad_name}, ${row.campaign_id}, ${row.campaign_name},
           ${info?.thumb ?? null}, ${info?.status ?? null},
           ${spend}, ${impressions}, ${clicks}, ${reach}, ${purchases}, ${revenue},
           ${cpa}, ${roas}, ${ctr})
        ON CONFLICT (client_id, snapshot_date, ad_id)
        DO UPDATE SET
          ad_name = EXCLUDED.ad_name, campaign_id = EXCLUDED.campaign_id, campaign_name = EXCLUDED.campaign_name,
          thumbnail_url = EXCLUDED.thumbnail_url, effective_status = EXCLUDED.effective_status,
          spend = EXCLUDED.spend, impressions = EXCLUDED.impressions, clicks = EXCLUDED.clicks,
          reach = EXCLUDED.reach, purchases = EXCLUDED.purchases, revenue = EXCLUDED.revenue,
          cpa = EXCLUDED.cpa, roas = EXCLUDED.roas, ctr = EXCLUDED.ctr, synced_at = NOW()
      `;
    }));
  }

  console.log(`✓ Meta creatives synced: ${data.length} ad-day rows (${adInfo.size} unique ads with thumbnails)`);
}

const clients = await sql`SELECT id, slug FROM clients`;
for (const c of clients) {
  console.log(`\n→ ${c.slug}`);
  await syncMetaCreatives(c.id, process.env.META_AD_ACCOUNT_ID!, process.env.META_ACCESS_TOKEN!);
}
