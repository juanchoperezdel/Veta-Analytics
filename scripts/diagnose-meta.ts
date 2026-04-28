import { neon } from '@neondatabase/serverless';

const sql = neon(process.env.DATABASE_URL!);

async function main() {
  const adAccountId = process.env.META_AD_ACCOUNT_ID!;
  const token       = process.env.META_ACCESS_TOKEN!;
  const since       = '2026-04-01';
  const until       = '2026-04-23';

  // ─── 1. Qué dice la DB actual ──────────────────────────────────────────────
  const [db] = await sql`
    SELECT SUM(purchases)::bigint AS purchases, SUM(spend)::numeric AS spend, SUM(revenue)::numeric AS revenue
    FROM meta_ads_campaigns m
    JOIN clients c ON c.id = m.client_id
    WHERE c.slug = 'andesmar'
      AND snapshot_date BETWEEN ${since} AND ${until}
  `;
  console.log('━━━ DB actual (abril 1-23) ━━━');
  console.log(`  Compras:  ${db.purchases}`);
  console.log(`  Spend:    ${Number(db.spend).toFixed(2)}`);
  console.log(`  Revenue:  ${Number(db.revenue).toFixed(2)}`);
  console.log(`  Real cliente: 886\n`);

  // Por campaña
  const rows = await sql`
    SELECT MAX(segment) AS name, SUM(purchases)::bigint AS p, SUM(spend)::numeric AS s
    FROM meta_ads_campaigns m
    JOIN clients c ON c.id = m.client_id
    WHERE c.slug = 'andesmar'
      AND snapshot_date BETWEEN ${since} AND ${until}
    GROUP BY campaign_id
    ORDER BY SUM(purchases) DESC
  ` as any[];
  console.log('━━━ Top campañas por compras en DB ━━━');
  for (const r of rows.slice(0, 20)) {
    console.log(`  ${String(r.p).padStart(6)}  $${Number(r.s).toFixed(0).padStart(8)}  ${r.name}`);
  }

  // ─── 2. Qué dice la API de Meta ahora mismo ─────────────────────────────────
  console.log('\n━━━ Meta API — con objective + effective_status + todos los action_types ━━━');
  const fields = [
    'campaign_id', 'campaign_name', 'objective',
    'date_start',
    'spend', 'reach', 'impressions',
    'actions', 'action_values',
  ].join(',');

  const url = `https://graph.facebook.com/v21.0/act_${adAccountId}/insights?` +
    `level=campaign&time_increment=1` +
    `&time_range=${encodeURIComponent(JSON.stringify({ since, until }))}` +
    `&fields=${fields}&access_token=${token}&limit=500`;

  const res = await fetch(url);
  if (!res.ok) {
    console.error('Meta API error:', res.status, await res.text());
    return;
  }
  const body = await res.json() as any;
  const data: any[] = body.data ?? [];
  console.log(`  Total daily rows: ${data.length}`);

  // Agrupamos por campaña + objective, sumamos múltiples action_types
  type CampAgg = {
    name: string;
    objective: string;
    spend: number;
    purchases_generic: number;
    fb_pixel_purchase: number;
    omni_purchase: number;
    onsite_web_purchase: number;
    offline_purchase: number;
    app_purchase: number;
    other_purchase_like: Record<string, number>;
  };
  const byCamp = new Map<string, CampAgg>();

  for (const r of data) {
    const key = r.campaign_id;
    if (!byCamp.has(key)) {
      byCamp.set(key, {
        name: r.campaign_name,
        objective: r.objective,
        spend: 0, purchases_generic: 0, fb_pixel_purchase: 0, omni_purchase: 0,
        onsite_web_purchase: 0, offline_purchase: 0, app_purchase: 0,
        other_purchase_like: {},
      });
    }
    const agg = byCamp.get(key)!;
    agg.spend += parseFloat(r.spend ?? '0');
    for (const a of (r.actions ?? [])) {
      const t: string = a.action_type;
      const v = parseFloat(a.value ?? '0');
      if (t === 'purchase') agg.purchases_generic += v;
      else if (t === 'offsite_conversion.fb_pixel_purchase') agg.fb_pixel_purchase += v;
      else if (t === 'omni_purchase') agg.omni_purchase += v;
      else if (t === 'onsite_web_purchase') agg.onsite_web_purchase += v;
      else if (t === 'offline_conversion.purchase' || t === 'offline_conversion') agg.offline_purchase += v;
      else if (t.includes('app_custom_event.fb_mobile_purchase') || t === 'app_custom_event.fb_mobile_purchase') agg.app_purchase += v;
      else if (t.toLowerCase().includes('purchase')) {
        agg.other_purchase_like[t] = (agg.other_purchase_like[t] ?? 0) + v;
      }
    }
  }

  const campaigns = Array.from(byCamp.values()).sort((a, b) => b.purchases_generic - a.purchases_generic);

  console.log(`  Total campañas distintas: ${campaigns.length}\n`);
  console.log('  objective                          spend    purchase  fb_pixel  omni  onsite  off  app   campaña');
  console.log('  ' + '─'.repeat(130));
  for (const c of campaigns) {
    console.log(
      `  ${(c.objective || '-').padEnd(33)}  ${c.spend.toFixed(0).padStart(7)}  ${String(c.purchases_generic).padStart(8)}  ${String(c.fb_pixel_purchase).padStart(8)}  ${String(c.omni_purchase).padStart(4)}  ${String(c.onsite_web_purchase).padStart(6)}  ${String(c.offline_purchase).padStart(3)}  ${String(c.app_purchase).padStart(3)}   ${c.name.slice(0, 60)}`
    );
  }

  // Totales API
  const totalPurchaseGeneric = campaigns.reduce((s, c) => s + c.purchases_generic, 0);
  const totalFbPixel         = campaigns.reduce((s, c) => s + c.fb_pixel_purchase, 0);
  const totalOmni            = campaigns.reduce((s, c) => s + c.omni_purchase, 0);
  const totalOnsite          = campaigns.reduce((s, c) => s + c.onsite_web_purchase, 0);
  const totalOffline         = campaigns.reduce((s, c) => s + c.offline_purchase, 0);
  const totalApp             = campaigns.reduce((s, c) => s + c.app_purchase, 0);

  console.log('\n━━━ Totales según API de Meta (abril 1-23) ━━━');
  console.log(`  Real cliente:                       886`);
  console.log(`  action_type='purchase' (generic):   ${totalPurchaseGeneric}`);
  console.log(`  offsite_conversion.fb_pixel_purchase:${totalFbPixel}`);
  console.log(`  omni_purchase:                      ${totalOmni}`);
  console.log(`  onsite_web_purchase:                ${totalOnsite}`);
  console.log(`  offline_purchase:                   ${totalOffline}`);
  console.log(`  app_purchase:                       ${totalApp}`);

  // Otros purchase-like que hayan aparecido
  const otherKeys = new Set<string>();
  for (const c of campaigns) for (const k of Object.keys(c.other_purchase_like)) otherKeys.add(k);
  if (otherKeys.size > 0) {
    console.log('\n  Otros action_types con "purchase" en el nombre:');
    for (const k of otherKeys) {
      const sum = campaigns.reduce((s, c) => s + (c.other_purchase_like[k] ?? 0), 0);
      console.log(`    ${k}: ${sum}`);
    }
  }

  // Desglose por objetivo
  console.log('\n━━━ Purchases (generic) por objetivo ━━━');
  const byObj = new Map<string, { purchases: number; spend: number; n: number }>();
  for (const c of campaigns) {
    const k = c.objective || 'UNKNOWN';
    if (!byObj.has(k)) byObj.set(k, { purchases: 0, spend: 0, n: 0 });
    const o = byObj.get(k)!;
    o.purchases += c.purchases_generic;
    o.spend     += c.spend;
    o.n         += 1;
  }
  for (const [k, v] of byObj) {
    console.log(`  ${k.padEnd(35)}  ${v.n} camp  spend ${v.spend.toFixed(0).padStart(7)}  purchases ${v.purchases}`);
  }
}

main().catch(e => { console.error(e); process.exit(1); });
