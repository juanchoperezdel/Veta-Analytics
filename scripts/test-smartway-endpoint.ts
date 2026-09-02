import handler from '../netlify/functions/public-smartway';
const ranges = process.argv.slice(2);
async function run(qs: string, label: string) {
  const req = new Request(`http://x/.netlify/functions/public-smartway${qs}`);
  const res = await handler(req as any, {} as any);
  const d: any = await (res as Response).json();
  const m = (n: number) => '$' + Math.round(n).toLocaleString('es-AR');
  const p = (n: number) => (100 * n).toFixed(2) + '%';
  console.log(`\n════════ ${label} (${d.config.period.start} .. ${d.config.period.end}) ════════`);
  console.log(`TOTALES  Meta ${m(d.totals.spendMeta)} + Google ${m(d.totals.spendGoogle)} = ${m(d.totals.spendTotal)} | ${d.totals.leads} leads | CPL total ${m(d.totals.cplTotal)}`);
  const o = d.overall;
  console.log(`EMBUDO   spend ${m(o.spend)} | imp ${o.impressions} | clicks ${o.clicks} (link ${o.linkClicks}) | visitas ${o.visits} | leads ${o.leads}`);
  console.log(`         CTR ${p(o.ctr)} (todos los clicks: ${p(o.ctrAll)}) | CPM ${m(o.cpm)} | CPC ${m(o.cpc)} | CPL ${m(o.cpl)} | hasVisits=${o.hasVisits} | leadRate ${p(o.leadRate)}`);
  console.log('CAMINOS  ' + ['form','landing','remarketing'].map(k => `${k}: ${m(d.channels[k].spend)}/${d.channels[k].leads}L`).join(' | '));
  console.log('TRAFICO  ' + (d.traffic ? `${m(d.traffic.spend)} | imp ${d.traffic.impressions} | CTR ${p(d.traffic.ctr)} | ${d.traffic.campaigns.length} camp` : 'sin campañas de tráfico'));
  console.log('WEBINAR  ' + (d.webinar ? `${m(d.webinar.spend)} | ${d.webinar.leads} reg | ${m(d.webinar.cpl)} c/u` : 'sin webinar'));
  console.log('RUBROS   ' + d.verticals.map((v: any) => `${v.name}: ${m(v.spend)}/${v.leads}L${v.cpl ? '/' + m(v.cpl) : ''}`).join(' | '));
  console.log(`ADS      best=${d.ads.best.length} (por ${d.ads.bestBy}) worst=${d.ads.worst.length} floor=${m(d.ads.spendFloor)}`);
  if (d.ads.best.length) console.log('         top: ' + d.ads.best.slice(0,3).map((a: any) => `${a.adName}[${a.campaignName}] ${a.leads}L`).join(' | '));
  console.log(`GOOGLE   ${m(d.google.spend)} | conv ${d.google.conversions} | allConv ${d.google.allConversions} | ultimo dia ${d.google.lastActiveDay} (hace ${d.google.daysSinceActive}d) | pmax=${d.google.isPmax}`);
  console.log(`DEMO     ` + Object.entries(d.demographics).map(([k, v]: any) => `${k}:${v.length}`).join(' ') + '  | cobertura: ' + Object.entries(d.demoCoverage).map(([k, v]: any) => `${k} ${(100*v.coverage).toFixed(0)}% hasta ${v.lastDay}`).join(' | '));
  console.log(`DAILY    ${d.daily.length} dias`);
  console.log('NOTAS:');
  for (const n of d.notes) console.log(`  [${n.tone}] ${n.text}`);
}
(async () => {
  for (const r of ranges) {
    const [s, e, lbl] = r.split('|');
    await run(s ? `?start=${s}&end=${e}` : '', lbl);
  }
})().catch(e => { console.error(e); process.exit(1); });
