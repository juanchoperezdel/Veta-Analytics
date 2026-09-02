import { useEffect, useState, Fragment, type ReactNode } from 'react';
import {
  TrendingDown, TrendingUp, Target, Trophy, AlertTriangle, Users, Loader2,
  Eye, MousePointerClick, Flag, ExternalLink, Info, ClipboardList, Filter,
  LineChart as LineChartIcon, Split, Megaphone,
} from 'lucide-react';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell } from 'recharts';
import { Card } from '@/components/ui/Card';
import { DateRangePicker, type DateRange } from '@/components/ui/DateRangePicker';
import { formatCurrency, formatNumber, formatPercent, cn } from '@/lib/utils';

// Ruta relativa: bajo `netlify dev` (cualquier puerto) y en producción es same-origin.
const BASE = '/.netlify/functions';

function initialRange(): DateRange {
  const end = new Date().toISOString().split('T')[0];
  const s = new Date(); s.setDate(s.getDate() - 29);
  return { start: s.toISOString().split('T')[0], end, label: 'Últimos 30 días' };
}

// ─── Tipos ───────────────────────────────────────────────────────────────────
type Funnel = {
  spend: number; impressions: number; clicks: number; linkClicks: number; visits: number; leads: number;
  hasVisits: boolean;
  ctr: number; ctrAll: number; cpm: number; cpc: number; costPerVisit: number; cpl: number;
  clickRate: number; visitRate: number; leadRate: number;
};
type Ad = {
  adId: string; adName: string; campaignName: string; vertical: string;
  channel: string; channelLabel: string;
  thumbnailUrl: string | null; previewLink: string | null;
  spend: number; impressions: number; clicks: number; linkClicks: number; lpv: number;
  leads: number; ctr: number; cpl: number;
};
type Campaign = { name: string; spend: number; leads: number; clicks: number; impressions: number; vertical: string; channel: string; channelLabel: string; cpl: number };
type Block = Funnel & { kind: string; label: string; adCount: number; campaigns: Campaign[]; ads: Ad[] };
type Vertical = Funnel & { name: string; adCount: number; campaigns: Campaign[]; ads: Ad[] };
type DailyPoint = { date: string; spend: number; leads: number; spendAll: number };
type Note = { tone: 'good' | 'warn' | 'info'; text: string };
type Demo = { value: string; spend: number; leads: number; cpl: number; ctr: number };
type GoogleData = Funnel & {
  hasData: boolean; isPmax: boolean; conversions: number; allConversions: number;
  lastActiveDay: string | null; daysSinceActive: number | null;
  campaigns: { name: string; vertical: string; spend: number; clicks: number; impressions: number; leads: number; allConversions: number; cpl: number }[];
};
type Data = {
  config: { name: string; currency: string; period: { start: string; end: string }; firstDataDate: string | null; generatedAt: string; dataUpdatedAt: string | null; metaUpdatedAt: string | null; googleUpdatedAt: string | null };
  totals: { spendMeta: number; spendGoogle: number; spendTotal: number; leads: number; cplTotal: number; leadsAllMeta: number };
  overall: Funnel;
  channels: { form: Block; landing: Block; remarketing: Block };
  traffic: Block | null;
  webinar: Block | null;
  verticals: Vertical[];
  campaignTypes: Campaign[];
  daily: DailyPoint[];
  notes: Note[];
  ads: { best: Ad[]; worst: Ad[]; bestBy: 'cpl' | 'ctr'; spendFloor: number };
  google: GoogleData;
  demographics: Record<string, Demo[]>;
  demoCoverage: Record<string, { lastDay: string | null; coverage: number }>;
  leadQuality: null;
};

const DEMO_LABELS: Record<string, string> = { age: 'Edad', gender: 'Género', region: 'Provincia', publisher_platform: 'Dónde se mostró' };
const GENDER_ES: Record<string, string> = { male: 'Hombres', female: 'Mujeres', unknown: 'Sin dato' };
const AGE_ES: Record<string, string> = { Unknown: 'Sin dato', unknown: 'Sin dato' };
const PLACEMENT_ES: Record<string, string> = { instagram: 'Instagram', facebook: 'Facebook', messenger: 'Messenger', audience_network: 'Audience Network', threads: 'Threads', whatsapp: 'WhatsApp' };

// Paleta de Smartway: negro + rojo de marca. El verde es de Veta (la agencia), no del
// cliente — en su reporte manda su marca.
const SW_RED = '#EA2A20';
const CHART_COLOR = '#EA2A20';
// Un color por rubro. Sin diccionario fijo: los rubros los define el naming de la
// cuenta y cambian con cada tanda, así que se asignan por orden y con fallback.
const VERT_PALETTE = ['#EA2A20', '#18243C', '#B45309', '#0369A1', '#6D28D9', '#64748b'];

function fmtShort(d: string) {
  const [, m, day] = d.split('-');
  return `${day}/${m}`;
}
function fmtDay(d: string | null) {
  if (!d) return '—';
  const [y, m, day] = d.split('-');
  return `${day}/${m}/${y.slice(2)}`;
}

export default function SmartwayPublic() {
  const [data, setData] = useState<Data | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [range, setRange] = useState<DateRange>(initialRange());

  // Título de pestaña e ícono: sin esto el cliente abre el link y ve el título default
  // del scaffold ("My Google AI Studio App") en la solapa.
  useEffect(() => {
    document.title = 'Smartway · Reporte de pauta';
    let link = document.querySelector<HTMLLinkElement>("link[rel='icon']");
    if (!link) { link = document.createElement('link'); link.rel = 'icon'; document.head.appendChild(link); }
    link.href = '/smartway-icon.png';
  }, []);

  useEffect(() => {
    // AbortController: cambiar de rango rápido podía pisar la data buena con la
    // respuesta de un pedido anterior que llegaba tarde.
    const ctrl = new AbortController();
    setLoading(true);
    setError(null);
    // _t = cache-buster para que nunca devuelva una respuesta cacheada por el browser/CDN
    fetch(`${BASE}/public-smartway?start=${range.start}&end=${range.end}&_t=${Date.now()}`, { cache: 'no-store', signal: ctrl.signal })
      .then(async r => {
        const json = await r.json();
        if (!r.ok || json.error) { setError(json.error ?? `HTTP ${r.status}`); return; }
        setData(json);
      })
      .catch(e => { if (e?.name !== 'AbortError') setError(e?.message ?? String(e)); })
      .finally(() => { if (!ctrl.signal.aborted) setLoading(false); });
    return () => ctrl.abort();
  }, [range.start, range.end]);

  if (loading && !data) return <Status icon={<Loader2 className="animate-spin" />} title="Cargando el reporte de Smartway…" />;
  if (error || !data) return <Status icon={<AlertTriangle />} title="No pudimos cargar el reporte" subtitle={error ?? ''} isError />;

  const { overall, totals, channels, traffic, webinar, verticals, campaignTypes, daily, notes, ads, google, demographics, demoCoverage, config } = data;
  const dataUpd = config.dataUpdatedAt ? new Date(config.dataUpdatedAt) : null;
  const fmtTime = (d: Date) => d.toLocaleString('es-AR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });

  // ¿El rango pedido es más ancho que la vida de la cuenta en el sistema?
  const shortHistory = config.firstDataDate && config.firstDataDate > config.period.start;
  const noData = overall.spend === 0 && (!traffic || traffic.spend === 0) && !google.hasData;
  const vertColor = (name: string) => VERT_PALETTE[verticals.findIndex(v => v.name === name)] ?? '#64748b';
  const activeChannels = ([channels.form, channels.landing, channels.remarketing] as Block[]).filter(c => c.spend > 0);

  return (
    <div className="min-h-screen bg-[#f6f7f9] text-slate-900">
      <header className="sticky top-0 z-10 border-b border-slate-200 bg-white/80 backdrop-blur">
        <div className="mx-auto max-w-6xl px-5 py-4 flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <Wordmark name={config.name} />
            <div>
              <h1 className="sr-only">{config.name}</h1>
              <p className="text-xs text-slate-500 font-semibold">Reporte de pauta · Meta + Google</p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <DateRangePicker value={range} onChange={setRange} />
            <p className="text-[11px] text-slate-400 text-right hidden sm:block">
              Datos al<br />{dataUpd ? `${fmtTime(dataUpd)} hs` : '—'}
            </p>
          </div>
        </div>
        {loading && <div className="h-0.5 animate-pulse" style={{ background: SW_RED }} />}
      </header>

      <main className="mx-auto max-w-6xl px-5 py-6 space-y-9">
        {noData ? (
          <Card className="p-8 text-center">
            <Info className="mx-auto mb-2 text-slate-300" />
            <p className="font-black text-slate-700">No hay actividad en el período elegido</p>
            <p className="text-sm text-slate-400 mt-1">
              Entre el {fmtDay(config.period.start)} y el {fmtDay(config.period.end)} no se registró inversión.
              {config.firstDataDate && <> Los datos del sistema arrancan el {fmtDay(config.firstDataDate)}.</>}
            </p>
          </Card>
        ) : (
        <>
        {/* ── KPIs hero ── */}
        <section>
          <div className="grid grid-cols-2 lg:grid-cols-3 gap-3">
            <Kpi label="Inversión total" value={formatCurrency(totals.spendTotal)} sub="Meta + Google, todo lo que se facturó" highlight />
            <Kpi label="Leads comerciales" value={formatNumber(totals.leads)} sub="sin el webinar Orbatix" highlight />
            <Kpi label="Costo por lead" value={totals.cplTotal > 0 ? formatCurrency(totals.cplTotal) : '—'} sub="sobre la inversión total" />
            <Kpi label="Inversión en Meta" value={formatCurrency(totals.spendMeta)} />
            <Kpi label="Inversión en Google" value={formatCurrency(totals.spendGoogle)} />
            <Kpi label="CTR del lead-gen" value={overall.impressions > 0 ? formatPercent(overall.ctr) : '—'} sub="clics al link ÷ impresiones" />
          </div>
          {shortHistory && (
            <p className="text-[11px] text-amber-700 bg-amber-50/60 border border-amber-200 rounded-lg px-3 py-2 mt-2">
              Los datos del sistema arrancan el {fmtDay(config.firstDataDate)}, así que los números de arriba son de
              esos días y no del rango completo que elegiste.
            </p>
          )}
        </section>

        {/* ── Lectura del período ── */}
        {notes.length > 0 && (
          <section>
            <SectionTitle icon={<ClipboardList size={15} />} title="Qué está pasando" hint="lectura de los números de este período" />
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {notes.map((n, i) => <Fragment key={i}><NoteCard note={n} /></Fragment>)}
            </div>
          </section>
        )}

        {/* ── Embudo comercial ── */}
        <section>
          <SectionTitle
            icon={<Target size={15} />}
            title="Embudo comercial"
            hint="Meta · solo lo que busca leads (sin tráfico ni webinar)"
          />
          <Card className="p-5">
            <FunnelView f={overall} />
            <p className="text-[11px] text-slate-400 mt-3 leading-relaxed">
              Los clics son <span className="font-semibold">clics al link</span>, no reacciones ni comentarios.
              {overall.hasVisits
                ? ' La etapa de visitas a la landing solo aplica a las campañas que llevan al sitio; las de formulario se completan dentro de Meta.'
                : ' No aparece la etapa de visitas a la landing porque en este período los leads entraron por formulario nativo de Meta, sin pasar por el sitio.'}
            </p>
          </Card>
        </section>

        {/* ── Los caminos hacia el lead ── */}
        {activeChannels.length > 1 && (
          <section>
            <SectionTitle icon={<Split size={15} />} title="Los caminos hacia el lead" hint="cada uno se mide con su propia vara" />
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 items-start">
              {activeChannels.map(c => <Fragment key={c.kind}><ChannelCard c={c} /></Fragment>)}
            </div>
          </section>
        )}

        {/* ── Por rubro ── */}
        {verticals.length > 0 && (
          <section>
            <SectionTitle icon={<Flag size={15} />} title="Por rubro" hint="el rubro sale del nombre de la campaña" />
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 items-start">
              {verticals.map(v => <Fragment key={v.name}><VerticalCard v={v} color={vertColor(v.name)} /></Fragment>)}
            </div>
          </section>
        )}

        {/* ── Evolución diaria ── */}
        {daily.length > 1 && (
          <section>
            <SectionTitle icon={<LineChartIcon size={15} />} title="Cómo viene evolucionando" hint="día a día · lead-gen comercial" />
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <DailyChart data={daily} metric="spend" title="Inversión por día" isCurrency />
              <DailyChart data={daily} metric="leads" title="Leads por día" />
            </div>
          </section>
        )}

        {/* ── Mejores / a revisar ── */}
        {(ads.best.length > 0 || ads.worst.length > 0) && (
          <section className="grid grid-cols-1 lg:grid-cols-2 gap-6 items-start">
            {ads.best.length > 0 && (
              <div>
                <SectionTitle
                  icon={<Trophy size={15} className="text-amber-500" />}
                  title={ads.bestBy === 'cpl' ? 'Los que traen leads más baratos' : 'Los que más enganchan'}
                  hint={ads.bestBy === 'cpl' ? 'ordenados por costo por lead' : 'todavía sin leads en el período · ordenados por CTR'}
                />
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                  {ads.best.map(a => <Fragment key={a.adId}><AdCard ad={a} tone="good" /></Fragment>)}
                </div>
              </div>
            )}
            {ads.worst.length > 0 && (
              <div>
                <SectionTitle
                  icon={<Filter size={15} className="text-slate-400" />}
                  title="Los que Meta fue dejando de lado"
                  hint="gasto relevante y todavía sin leads"
                />
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                  {ads.worst.map(a => <Fragment key={a.adId}><AdCard ad={a} tone="bad" /></Fragment>)}
                </div>
              </div>
            )}
          </section>
        )}

        {/* ── Campañas ── */}
        {campaignTypes.length > 0 && (
          <section>
            <SectionTitle icon={<Users size={15} />} title="Campaña por campaña" hint="lead-gen comercial · ordenado por inversión" />
            <Card className="p-0 overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-[13px]">
                  <thead className="bg-slate-50 text-[11px] uppercase tracking-wide text-slate-400">
                    <tr>
                      <th className="text-left font-bold px-4 py-2.5">Campaña</th>
                      <th className="text-left font-bold px-3 py-2.5 hidden sm:table-cell">Tipo</th>
                      <th className="text-right font-bold px-3 py-2.5">Inversión</th>
                      <th className="text-right font-bold px-3 py-2.5">Leads</th>
                      <th className="text-right font-bold px-4 py-2.5">CPL</th>
                    </tr>
                  </thead>
                  <tbody>
                    {campaignTypes.map(c => (
                      <tr key={c.name} className="border-t border-slate-100">
                        <td className="px-4 py-2.5">
                          <span className="inline-flex items-center gap-2">
                            <span className="w-2 h-2 rounded-full shrink-0" style={{ background: vertColor(c.vertical) }} />
                            <span className="font-semibold">{c.name}</span>
                          </span>
                          <span className="block text-[11px] text-slate-400 sm:hidden">{c.channelLabel} · {c.vertical}</span>
                        </td>
                        <td className="px-3 py-2.5 text-slate-500 hidden sm:table-cell">{c.channelLabel}</td>
                        <td className="px-3 py-2.5 text-right tabular-nums">{formatCurrency(c.spend)}</td>
                        <td className="px-3 py-2.5 text-right tabular-nums font-bold">{c.leads || <span className="text-slate-300">—</span>}</td>
                        <td className="px-4 py-2.5 text-right tabular-nums">{c.cpl > 0 ? formatCurrency(c.cpl) : <span className="text-slate-300">—</span>}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>
          </section>
        )}

        {/* ── Tráfico y alcance (fuera del promedio comercial) ── */}
        {traffic && traffic.spend > 0 && (
          <section>
            <SectionTitle icon={<Megaphone size={15} className="text-sky-600" />} title="Tráfico y alcance" hint="no busca leads · medido aparte" />
            <Card className="p-5 border-sky-200 bg-sky-50/30">
              <div className="flex flex-wrap items-end gap-x-8 gap-y-3 mb-3">
                <Stat label="Inversión" value={formatCurrency(traffic.spend)} />
                <Stat label="Impresiones" value={formatNumber(traffic.impressions)} />
                <Stat label="Clics al link" value={formatNumber(traffic.linkClicks)} />
                <Stat label="Costo por mil" value={formatCurrency(traffic.cpm)} />
                <Stat label="CTR" value={formatPercent(traffic.ctr)} />
              </div>
              <p className="text-[11px] text-slate-500 leading-relaxed">
                Estas campañas buscan visibilidad, no leads. Son mucho más baratas por impresión, así que si entraran
                al promedio harían parecer que toda la pauta es más eficiente de lo que es. Por eso se miden aparte.
              </p>
              {traffic.campaigns.length > 0 && (
                <div className="mt-3 flex flex-wrap gap-2">
                  {traffic.campaigns.map(c => (
                    <span key={c.name} className="text-[11px] bg-white border border-sky-200 rounded-lg px-2 py-1">
                      {c.name} · <span className="tabular-nums">{formatCurrency(c.spend)}</span>
                    </span>
                  ))}
                </div>
              )}
            </Card>
          </section>
        )}

        {/* ── Webinar Orbatix ── */}
        {webinar && (
          <section>
            <SectionTitle icon={<Flag size={15} className="text-violet-600" />} title={webinar.label} hint="registros a un evento · medido aparte del lead-gen" />
            <Card className="p-5 border-violet-200 bg-violet-50/30">
              <div className="flex flex-wrap items-end gap-x-8 gap-y-3 mb-3">
                <Stat label="Inversión" value={formatCurrency(webinar.spend)} />
                <Stat label="Registros" value={formatNumber(webinar.leads)} />
                <Stat label="Costo por registro" value={webinar.cpl > 0 ? formatCurrency(webinar.cpl) : '—'} accent="#7c3aed" />
                <Stat label="CTR" value={formatPercent(webinar.ctr)} />
              </div>
              <p className="text-[11px] text-slate-500 leading-relaxed">
                Un registro a un webinar es mucho más fácil y barato de conseguir que un lead comercial. Mezclarlos
                haría ver un costo por lead promedio que no representa a ninguno de los dos.
              </p>
            </Card>
          </section>
        )}

        {/* ── Google ── */}
        {google.hasData && (
          <section>
            <SectionTitle icon={<Eye size={15} />} title="Google Ads" hint={google.isPmax ? 'incluye Performance Max' : undefined} />
            <Card className="p-5">
              <div className="flex flex-wrap items-end gap-x-8 gap-y-3 mb-4">
                <Stat label="Inversión" value={formatCurrency(google.spend)} />
                <Stat label="Impresiones" value={formatNumber(google.impressions)} />
                <Stat label="Clics" value={formatNumber(google.clicks)} />
                <Stat label="Costo por clic" value={formatCurrency(google.cpc)} />
              </div>

              {google.conversions === 0 && (
                <div className="rounded-xl border border-amber-200 bg-amber-50/60 p-3.5 flex items-start gap-2.5 mb-4">
                  <AlertTriangle size={15} className="text-amber-700 shrink-0 mt-0.5" />
                  <p className="text-[13px] leading-relaxed text-slate-700">
                    <span className="font-bold">La medición de Google no está enviando conversiones.</span>{' '}
                    La inversión y los clics de arriba son reales y están llegando al sitio, pero no podemos atribuirle
                    leads a estas campañas hasta que se corrija el seguimiento.
                    {google.allConversions > 0 && (
                      <> Google registra {formatNumber(Math.round(google.allConversions))} acciones secundarias en el período
                      (vistas de página, clics de teléfono): <span className="font-semibold">no son leads</span> y por eso no
                      se muestran como resultado.</>
                    )}
                  </p>
                </div>
              )}

              {google.daysSinceActive !== null && google.daysSinceActive > 2 && (
                <p className="text-[11px] text-slate-500 mb-3">
                  Último día con actividad registrada: {fmtDay(google.lastActiveDay)}.
                </p>
              )}

              <div className="space-y-1.5">
                {google.campaigns.map(c => (
                  <div key={c.name} className="flex items-center justify-between gap-3 text-[12px] border-t border-slate-100 pt-1.5 first:border-0 first:pt-0">
                    <span className="font-semibold truncate">{c.name}</span>
                    <span className="text-slate-400 tabular-nums shrink-0">
                      {formatCurrency(c.spend)} · {formatNumber(c.clicks)} clics
                      {c.leads > 0 ? ` · ${formatNumber(c.leads)} conv.` : ''}
                    </span>
                  </div>
                ))}
              </div>
            </Card>
          </section>
        )}

        {/* ── Demografía ── */}
        {Object.keys(demographics).some(k => (demographics[k] ?? []).length > 0) && (
          <section>
            <SectionTitle icon={<Users size={15} />} title="A quién le llegó la pauta" hint="cuánto se invirtió y CTR por segmento — no implica calidad del lead" />
            {totals.leadsAllMeta > totals.leads && (
              <p className="text-[11px] text-slate-500 bg-slate-100/70 border border-slate-200 rounded-lg px-3 py-2 mb-3 leading-relaxed">
                Meta solo entrega esta apertura para <span className="font-semibold">toda la cuenta junta</span>, sin poder
                separar por campaña. Por eso los leads de estas tarjetas suman {totals.leadsAllMeta} (incluyen el webinar
                y el tráfico) y no los {totals.leads} del embudo comercial.
              </p>
            )}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {(['age', 'gender', 'region', 'publisher_platform'] as const).map(dim =>
                (demographics[dim] ?? []).length ? (
                  <Fragment key={dim}>
                    <DemoCard
                      title={DEMO_LABELS[dim]}
                      items={demographics[dim]}
                      labels={dim === 'gender' ? GENDER_ES : dim === 'publisher_platform' ? PLACEMENT_ES : dim === 'age' ? AGE_ES : undefined}
                      coverage={demoCoverage?.[dim]}
                    />
                  </Fragment>
                ) : null
              )}
            </div>
          </section>
        )}
        </>
        )}

        <footer className="pt-4 pb-8 text-center text-[11px] text-slate-400">
          Datos directos de Meta Ads y Google Ads · Actualización automática cada 6 horas · Veta Analytics
        </footer>
      </main>
    </div>
  );
}

// ─── Wordmark ──────────────────────────────────────────────────────────────────
// Marca del cliente (negro + rojo), no el verde de la agencia. Si más adelante se sube
// /public/smartway-logo.png, la <img> lo toma y el wordmark queda de respaldo.
function Wordmark({ name }: { name: string }) {
  const [failed, setFailed] = useState(false);
  if (!failed) {
    return <img src="/smartway-logo.png" alt={name} className="h-8 w-auto max-w-[190px] object-contain" onError={() => setFailed(true)} />;
  }
  return (
    <div className="h-9 px-2.5 rounded-xl bg-[#111] text-white grid place-items-center">
      <span className="font-black tracking-tight text-[15px] leading-none">
        smart<span style={{ color: SW_RED }}>way</span>
      </span>
    </div>
  );
}

// ─── Funnel ────────────────────────────────────────────────────────────────────
// La etapa "visitas a la landing" se OMITE cuando no aplica: en las campañas de
// formulario nativo el lead se carga dentro de Meta y no hay sitio de por medio.
// Mostrarla en 0 hacía leer una caída del 95% que nunca ocurrió.
function FunnelView({ f }: { f: Funnel }) {
  const stages = [
    { key: 'impr', label: 'Impresiones', icon: <Eye size={14} />, value: f.impressions, rate: null as number | null, cost: f.cpm, costLabel: 'Costo por mil' },
    { key: 'clk', label: 'Clics al link', icon: <MousePointerClick size={14} />, value: f.linkClicks, rate: f.clickRate, cost: f.cpc, costLabel: 'Costo por clic' },
    ...(f.hasVisits ? [{ key: 'visit', label: 'Visitas a la landing', icon: <ExternalLink size={14} />, value: f.visits, rate: f.visitRate, cost: f.costPerVisit, costLabel: 'Costo por visita' }] : []),
    { key: 'lead', label: 'Leads', icon: <Target size={14} />, value: f.leads, rate: f.leadRate, cost: f.cpl, costLabel: 'Costo por lead' },
  ];
  const max = Math.max(f.impressions, 1);
  return (
    <div className="space-y-2">
      {stages.map((s, i) => {
        const w = Math.max(1.5, (s.value / max) * 100);
        const isLead = s.key === 'lead';
        return (
          <div key={s.key}>
            {i > 0 && s.rate !== null && (
              <div className="flex items-center gap-1 pl-1 py-0.5 text-[10px] text-slate-400">
                <TrendingDown size={10} /> {formatPercent(s.rate)} pasa de la etapa anterior
              </div>
            )}
            <div className="flex items-center gap-3">
              <div className="w-40 shrink-0 flex items-center gap-1.5 text-[12px] font-semibold text-slate-600">
                <span className="text-slate-400">{s.icon}</span>{s.label}
              </div>
              <div className="flex-1 h-8 rounded-lg bg-slate-100 overflow-hidden relative">
                <div className="h-full rounded-lg flex items-center px-2" style={{ width: `${w}%`, background: isLead ? SW_RED : '#334155' }}>
                  <span className={cn('text-[12px] font-black tabular-nums', w > 12 ? 'text-white' : 'text-slate-700 absolute left-2')}>{formatNumber(s.value)}</span>
                </div>
              </div>
              <div className="w-32 shrink-0 text-right">
                <p className="text-[12px] font-bold tabular-nums">{s.value > 0 && s.cost > 0 ? formatCurrency(s.cost) : '—'}</p>
                <p className="text-[10px] text-slate-400">{s.costLabel}</p>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ─── Lectura del período ───────────────────────────────────────────────────────
// El tono NUNCA va solo por color: cada tarjeta lleva su ícono, para que se entienda
// impresa en blanco y negro y para quien no distingue verde de ámbar.
function NoteCard({ note }: { note: Note }) {
  const cfg = {
    good: { icon: <TrendingUp size={15} />, ring: 'border-emerald-200 bg-emerald-50/60', ink: 'text-emerald-700' },
    warn: { icon: <AlertTriangle size={15} />, ring: 'border-amber-200 bg-amber-50/60', ink: 'text-amber-700' },
    info: { icon: <Info size={15} />, ring: 'border-slate-200 bg-white', ink: 'text-slate-500' },
  }[note.tone];
  return (
    <div className={cn('rounded-xl border p-3.5 flex items-start gap-2.5', cfg.ring)}>
      <span className={cn('shrink-0 mt-0.5', cfg.ink)}>{cfg.icon}</span>
      <p className="text-[13px] leading-relaxed text-slate-700">{note.text}</p>
    </div>
  );
}

// ─── Evolución diaria ──────────────────────────────────────────────────────────
// Inversión y leads tienen escalas incomparables → van en DOS gráficos con el mismo
// color (los distingue el título), nunca en un eje doble. El día en curso va más claro
// y aclarado en el tooltip: el color solo no alcanza.
function DailyChart({ data, metric, title, isCurrency }: { data: DailyPoint[]; metric: 'spend' | 'leads'; title: string; isCurrency?: boolean }) {
  const today = new Date().toISOString().split('T')[0];
  const rows = data.map(d => ({ ...d, label: fmtShort(d.date), value: metric === 'spend' ? d.spend : d.leads, partial: d.date === today }));
  const fmt = (v: number) => (isCurrency ? formatCurrency(v) : formatNumber(v));
  const total = rows.reduce((acc, r) => acc + r.value, 0);
  return (
    <Card className="p-4">
      <div className="flex items-baseline justify-between mb-3">
        <h3 className="font-black text-sm">{title}</h3>
        <span className="text-[11px] text-slate-400 tabular-nums">{fmt(total)} en total</span>
      </div>
      <div style={{ width: '100%', height: 180 }}>
        <ResponsiveContainer>
          <BarChart data={rows} margin={{ top: 4, right: 4, bottom: 0, left: -12 }} barCategoryGap="18%">
            <CartesianGrid vertical={false} stroke="#e9edf1" />
            <XAxis dataKey="label" tickLine={false} axisLine={false} tick={{ fontSize: 10, fill: '#94a3b8' }} interval="preserveStartEnd" />
            <YAxis tickLine={false} axisLine={false} tick={{ fontSize: 10, fill: '#94a3b8' }} width={48}
                   allowDecimals={!isCurrency ? false : undefined}
                   tickFormatter={(v: number) => (isCurrency ? `$${Math.round(v / 1000)}k` : String(v))} />
            <Tooltip
              cursor={{ fill: 'rgba(234,42,32,0.06)' }}
              contentStyle={{ borderRadius: 10, border: '1px solid #e2e8f0', fontSize: 12, boxShadow: '0 4px 14px rgba(15,23,42,.08)' }}
              formatter={(v: number, _n: string, p: any) => [fmt(v) + (p?.payload?.partial ? ' (día en curso)' : ''), title]}
            />
            <Bar dataKey="value" radius={[4, 4, 0, 0]} isAnimationActive={false}>
              {rows.map(r => <Cell key={r.date} fill={CHART_COLOR} fillOpacity={r.partial ? 0.4 : 1} />)}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
    </Card>
  );
}

// ─── Camino hacia el lead (formulario / landing / remarketing) ──────────────────
function ChannelCard({ c }: { c: Block }) {
  const help: Record<string, string> = {
    form: 'El lead se completa en un formulario dentro de Meta: no pasa por el sitio, por eso no hay visitas a la landing.',
    landing: 'El anuncio lleva al sitio y el lead se carga ahí. Acá sí se puede ver cuánta gente llegó a la landing.',
    remarketing: 'Le habla a gente que ya interactuó con la marca. Volumen chico por definición.',
  };
  return (
    <Card className="p-4">
      <div className="flex items-center justify-between mb-3 gap-2">
        <div>
          <h3 className="font-black">{c.label}</h3>
          <p className="text-[11px] text-slate-400">{c.adCount} anuncio{c.adCount === 1 ? '' : 's'} · {c.campaigns.length} campaña{c.campaigns.length === 1 ? '' : 's'}</p>
        </div>
        <span className="text-[11px] text-slate-400 tabular-nums shrink-0">{formatCurrency(c.spend)}</span>
      </div>
      <div className={cn('grid gap-2 text-center mb-3', c.hasVisits ? 'grid-cols-4' : 'grid-cols-3')}>
        <MiniStat label="Impresiones" value={formatNumber(c.impressions)} />
        <MiniStat label="Clics" value={formatNumber(c.linkClicks)} />
        {c.hasVisits && <MiniStat label="Visitas" value={formatNumber(c.visits)} />}
        <MiniStat label="Leads" value={formatNumber(c.leads)} accent={c.leads > 0 ? SW_RED : undefined} />
      </div>
      <div className="flex items-center justify-between text-[12px] border-t border-slate-100 pt-2">
        <span className="text-slate-400">Costo por lead</span>
        <span className="font-black tabular-nums">{c.cpl > 0 ? formatCurrency(c.cpl) : <span className="text-slate-300">sin leads todavía</span>}</span>
      </div>
      <p className="text-[11px] text-slate-400 mt-2 leading-relaxed">{help[c.kind]}</p>
    </Card>
  );
}

// ─── Rubro ─────────────────────────────────────────────────────────────────────
function VerticalCard({ v, color }: { v: Vertical; color: string }) {
  return (
    <Card className="p-4">
      <div className="flex items-center justify-between mb-3 gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: color }} />
          <h3 className="font-black truncate">{v.name}</h3>
          <span className="text-[11px] text-slate-400 shrink-0">{v.adCount} aviso{v.adCount === 1 ? '' : 's'}</span>
        </div>
        <span className="text-[11px] text-slate-400 tabular-nums shrink-0">{formatCurrency(v.spend)}</span>
      </div>
      <div className="grid grid-cols-4 gap-2 text-center mb-3">
        <MiniStat label="Impresiones" value={formatNumber(v.impressions)} />
        <MiniStat label="Clics" value={formatNumber(v.linkClicks)} />
        <MiniStat label="CTR" value={v.impressions > 0 ? formatPercent(v.ctr) : '—'} />
        <MiniStat label="Leads" value={formatNumber(v.leads)} accent={v.leads > 0 ? color : undefined} />
      </div>
      <div className="flex items-center justify-between text-[12px] border-t border-slate-100 pt-2 mb-2">
        <span className="text-slate-400">Costo por lead</span>
        <span className="font-black tabular-nums">{v.cpl > 0 ? formatCurrency(v.cpl) : <span className="text-slate-300">sin leads todavía</span>}</span>
      </div>
      <div className="space-y-1.5">
        {v.ads.slice(0, 4).map(a => {
          const row = (
            <>
              <div className="w-8 h-8 rounded-md bg-slate-100 overflow-hidden shrink-0 grid place-items-center">
                <Thumb url={a.thumbnailUrl} alt="" />
              </div>
              <span className="text-[11px] font-medium truncate flex-1" title={`${a.adName} · ${a.campaignName}`}>{a.adName}</span>
              <span className="text-[11px] text-slate-400 tabular-nums shrink-0">{a.leads > 0 ? `${a.leads} lead${a.leads > 1 ? 's' : ''}` : formatPercent(a.ctr)}</span>
            </>
          );
          return a.previewLink
            ? <a key={a.adId} href={a.previewLink} target="_blank" rel="noopener noreferrer" className="group flex items-center gap-2" title="Ver el anuncio">{row}</a>
            : <div key={a.adId} className="flex items-center gap-2">{row}</div>;
        })}
        {v.ads.length === 0 && <p className="text-[11px] text-slate-400 text-center py-2">Sin anuncios</p>}
      </div>
    </Card>
  );
}

// ─── Subcomponentes ────────────────────────────────────────────────────────────
// Las URLs de thumbnail que devuelve Meta están firmadas y expiran: sin onError, al
// cliente le quedan íconos de imagen rota en la galería.
function Thumb({ url, alt, className }: { url: string | null; alt: string; className?: string }) {
  const [failed, setFailed] = useState(false);
  if (!url || failed) return <span className="text-[8px] text-slate-300">sin imagen</span>;
  return <img src={url} alt={alt} className={className ?? 'w-full h-full object-cover'} loading="lazy" onError={() => setFailed(true)} />;
}

function Stat({ label, value, accent }: { label: string; value: string; accent?: string }) {
  return (
    <div>
      <p className="text-lg font-black tabular-nums leading-none" style={accent ? { color: accent } : undefined}>{value}</p>
      <p className="text-[11px] text-slate-400 mt-1">{label}</p>
    </div>
  );
}

function MiniStat({ label, value, accent }: { label: string; value: string; accent?: string }) {
  return (
    <div className="rounded-md bg-slate-50 py-1.5">
      <p className="text-[13px] font-black tabular-nums leading-none" style={accent ? { color: accent } : undefined}>{value}</p>
      <p className="text-[9px] text-slate-400 mt-0.5">{label}</p>
    </div>
  );
}

function SectionTitle({ icon, title, hint }: { icon: ReactNode; title: string; hint?: string }) {
  return (
    <div className="flex items-baseline gap-2 mb-3 flex-wrap">
      <span className="text-slate-600 self-center">{icon}</span>
      <h2 className="text-base font-black tracking-tight">{title}</h2>
      {hint && <span className="text-[11px] text-slate-400 font-medium">· {hint}</span>}
    </div>
  );
}

function Kpi({ label, value, sub, highlight }: { label: string; value: string; sub?: string; highlight?: boolean }) {
  return (
    <Card className={cn('p-4', highlight && 'ring-1 bg-[#EA2A20]/[0.03]')} style={highlight ? { boxShadow: 'inset 0 0 0 1px rgba(234,42,32,0.25)' } : undefined}>
      <p className="text-slate-400 text-[11px] font-bold uppercase tracking-wide">{label}</p>
      <p className="text-2xl font-black tabular-nums mt-1">{value}</p>
      {sub && <p className="text-[11px] text-slate-400 mt-0.5">{sub}</p>}
    </Card>
  );
}

function AdCard({ ad, tone }: { ad: Ad; tone: 'good' | 'bad' }) {
  // Varios avisos se llaman igual en campañas distintas (hay 14 "Ad3_Julio26_V2") → sin
  // el badge de campaña, el cliente ve el mismo nombre repetido con números distintos y
  // parece un error del reporte.
  const media = (
    <div className="aspect-square bg-slate-100 overflow-hidden grid place-items-center relative group">
      <Thumb url={ad.thumbnailUrl} alt={ad.adName} />
      <span className="absolute top-1 left-1 text-[9px] font-bold px-1.5 py-0.5 rounded bg-black/55 text-white max-w-[92%] truncate" title={ad.campaignName}>
        {ad.campaignName || ad.vertical}
      </span>
      {ad.previewLink && (
        <span className="absolute inset-0 bg-black/0 group-hover:bg-black/45 transition-colors grid place-items-center opacity-0 group-hover:opacity-100">
          <span className="inline-flex items-center gap-1 text-white text-[11px] font-bold bg-black/40 px-2 py-1 rounded-lg"><ExternalLink size={12} /> Ver anuncio</span>
        </span>
      )}
    </div>
  );
  return (
    <Card className="p-0 overflow-hidden flex flex-col">
      {ad.previewLink
        ? <a href={ad.previewLink} target="_blank" rel="noopener noreferrer" title="Ver el anuncio">{media}</a>
        : media}
      <div className="p-2.5 flex flex-col gap-1">
        <p className="text-[12px] font-bold leading-tight line-clamp-2" title={ad.adName}>{ad.adName}</p>
        <div className="flex items-center justify-between text-[11px] mt-0.5">
          <span className="text-slate-400">{formatCurrency(ad.spend)}</span>
          {tone === 'good'
            ? <span className="font-bold" style={{ color: SW_RED }}>{ad.leads > 0 ? `${ad.leads} lead${ad.leads > 1 ? 's' : ''}` : `CTR ${formatPercent(ad.ctr)}`}</span>
            : <span className="font-bold text-slate-400">sin leads</span>}
        </div>
        {tone === 'good' && ad.leads > 0
          ? <p className="text-[10px] text-slate-400">CPL {formatCurrency(ad.cpl)} · CTR {formatPercent(ad.ctr)}</p>
          : <p className="text-[10px] text-slate-400">CTR {formatPercent(ad.ctr)}</p>}
      </div>
    </Card>
  );
}

function DemoCard({ title, items, labels, coverage }: { title: string; items: Demo[]; labels?: Record<string, string>; coverage?: { lastDay: string | null; coverage: number } }) {
  const max = Math.max(...items.map(i => i.spend), 1);
  // Si una dimensión no cubre todo el período (le pasó a provincia cuando el sync
  // truncaba), se avisa acá mismo en vez de mostrar un corte parcial como si fuera todo.
  const partial = coverage && coverage.coverage < 0.9;
  return (
    <Card className="p-4">
      <p className="text-sm font-black mb-1">{title}</p>
      {partial && (
        <p className="text-[10px] text-amber-700 mb-2">
          Cubre el {(coverage!.coverage * 100).toFixed(0)}% de la inversión del período (hasta el {fmtDay(coverage!.lastDay)}).
        </p>
      )}
      <div className="space-y-2 mt-2">
        {items.map(i => {
          const label = labels?.[i.value] ?? i.value;
          return (
            <div key={i.value}>
              <div className="flex items-center justify-between text-[12px] mb-0.5 gap-2">
                <span className="font-semibold text-slate-700 truncate">{label}</span>
                <span className="text-slate-400 tabular-nums shrink-0">
                  {formatCurrency(i.spend)}
                  {i.ctr > 0 ? <span className="text-slate-300"> · CTR {formatPercent(i.ctr)}</span> : null}
                  {i.leads > 0 ? ` · ${i.leads} lead${i.leads > 1 ? 's' : ''}` : ''}
                </span>
              </div>
              <div className="h-1.5 rounded-full bg-slate-100 overflow-hidden">
                <div className="h-full rounded-full" style={{ width: `${(i.spend / max) * 100}%`, background: SW_RED, opacity: 0.75 }} />
              </div>
            </div>
          );
        })}
      </div>
    </Card>
  );
}

function Status({ icon, title, subtitle, isError }: { icon: ReactNode; title: string; subtitle?: string; isError?: boolean }) {
  return (
    <div className="min-h-screen grid place-items-center bg-[#f6f7f9] px-6 text-center">
      <div>
        <div className={cn('mx-auto mb-3 w-10 h-10 grid place-items-center', isError ? 'text-danger' : 'text-slate-400')}>{icon}</div>
        <p className="font-black text-slate-800">{title}</p>
        {subtitle && <p className="text-sm text-slate-400 mt-1 max-w-md">{subtitle}</p>}
      </div>
    </div>
  );
}
