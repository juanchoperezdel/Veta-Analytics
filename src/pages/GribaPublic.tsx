import { useEffect, useState, Fragment, type ReactNode } from 'react';
import {
  TrendingDown, Target, Trophy, AlertTriangle, Users, Loader2,
  Eye, MousePointerClick, ClipboardList, Globe, Flag, ExternalLink, BadgeCheck,
  CalendarCheck, CheckCircle2, XCircle, CircleDashed,
} from 'lucide-react';
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
  spend: number; impressions: number; clicks: number; visits: number; leads: number;
  ctr: number; cpm: number; cpc: number; costPerVisit: number; cpl: number; frequency: number;
  clickRate: number; visitRate: number; leadRate: number;
};
type Ad = { adId: string; adName: string; vertical?: string; channel?: string; thumbnailUrl: string | null; previewLink?: string | null; spend: number; impressions?: number; clicks?: number; lpv?: number; leads: number; ctr: number; cpl: number };
type Campaign = { name: string; spend: number; clicks: number; leads: number; cpl: number };
type Channel = Funnel & { kind: 'form' | 'landing'; adCount: number; ads: Ad[]; best: Ad[]; worst: Ad[]; campaigns: Campaign[] };
type Vertical = Funnel & { name: string; ads: Ad[] };
type Demo = { value: string; spend: number; leads: number; cpl: number; ctr: number };
type GoogleData = Funnel & { hasData: boolean; campaigns: { name: string; vertical: string; spend: number; clicks: number; impressions: number; leads: number; cpl: number }[] };
type Data = {
  config: { name: string; currency: string; period: { start: string; end: string }; generatedAt: string; dataUpdatedAt: string | null; metaUpdatedAt: string | null; googleUpdatedAt: string | null };
  overall: Funnel;
  channels: { form: Channel; landing: Channel };
  verticals: Vertical[];
  ads: { best: Ad[]; worst: Ad[] };
  google: GoogleData;
  demographics: Record<string, Demo[]>;
  leadQuality: LeadQuality | null;
};
type QualByAd = { adId: string; adName: string; thumbnailUrl: string | null; previewLink: string | null; channel: string | null; vertical: string | null; total: number; qualified: number; unqualified: number; meetings: number; noResponse: number; unclassified: number };
type LeadQuality = {
  total: number; qualified: number; unqualified: number; meetings: number; noResponse: number; unclassified: number;
  classified: number; updatedAt: string | null; byAd: QualByAd[];
};

const DEMO_LABELS: Record<string, string> = { age: 'Edad', gender: 'Género', region: 'Región', publisher_platform: 'Placement' };
const GENDER_ES: Record<string, string> = { male: 'Hombres', female: 'Mujeres', unknown: 'Sin dato' };
const VERT_COLOR: Record<string, string> = { 'CRM': '#0866FF', 'ERP': '#0e9f6e', 'Kit 4.0': '#7c3aed', 'General': '#64748b' };

export default function GribaPublic() {
  const [data, setData] = useState<Data | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [range, setRange] = useState<DateRange>(initialRange());

  // Título de pestaña + favicon con la marca Griba (solo esta página, no afecta a otras).
  useEffect(() => {
    const prevTitle = document.title;
    document.title = 'Griba · Reporte de pauta';
    let link = document.querySelector<HTMLLinkElement>("link[rel~='icon']");
    const prevHref = link?.href ?? '';
    if (!link) { link = document.createElement('link'); link.rel = 'icon'; document.head.appendChild(link); }
    link.href = '/griba-logo.png';
    return () => { document.title = prevTitle; if (link) link.href = prevHref; };
  }, []);

  useEffect(() => {
    setLoading(true);
    setError(null);
    // _t = cache-buster para que nunca devuelva una respuesta cacheada por el browser/CDN
    fetch(`${BASE}/public-griba?start=${range.start}&end=${range.end}&_t=${Date.now()}`, { cache: 'no-store' })
      .then(async r => {
        const json = await r.json();
        if (!r.ok || json.error) { setError(json.error ?? `HTTP ${r.status}`); return; }
        setData(json);
      })
      .catch(e => setError(e?.message ?? String(e)))
      .finally(() => setLoading(false));
  }, [range.start, range.end]);

  if (loading && !data) return <Status icon={<Loader2 className="animate-spin" />} title="Cargando el reporte de Griba…" />;
  if (error || !data) return <Status icon={<AlertTriangle />} title="No pudimos cargar el reporte" subtitle={error ?? ''} isError />;

  const { overall, channels, verticals, ads, google, demographics, config, leadQuality } = data;
  const metaSpend = overall.spend;
  const googleSpend = google.hasData ? google.spend : 0;
  const totalSpend = metaSpend + googleSpend;
  // Hora REAL del último sync de datos (no la del request)
  const dataUpd = config.dataUpdatedAt ? new Date(config.dataUpdatedAt) : null;
  const fmtTime = (d: Date) => d.toLocaleString('es-AR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });

  return (
    <div className="min-h-screen bg-[#f6f7f9] text-slate-900">
      <header className="sticky top-0 z-10 border-b border-slate-200 bg-white/80 backdrop-blur">
        <div className="mx-auto max-w-6xl px-5 py-4 flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <img src="/griba-logo.png" alt="Griba" className="w-10 h-10 rounded-xl shrink-0" />
            <div>
              <h1 className="text-lg font-black leading-none">{config.name}</h1>
              <p className="text-xs text-slate-500 mt-0.5">Reporte de pauta · Meta + Google</p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <DateRangePicker value={range} onChange={setRange} />
            <p className="text-[11px] text-slate-400 text-right hidden sm:block">
              Datos al<br />{dataUpd ? `${fmtTime(dataUpd)} hs` : '—'}
            </p>
          </div>
        </div>
        {loading && <div className="h-0.5 bg-veta/60 animate-pulse" />}
      </header>

      <main className="mx-auto max-w-6xl px-5 py-6 space-y-9">
        {/* ── Lo importante de un vistazo ── */}
        <section>
          <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
            <Kpi label="Inversión total" value={formatCurrency(totalSpend)} sub="Meta + Google" highlight />
            <Kpi label="Inversión Meta" value={formatCurrency(metaSpend)} />
            <Kpi label="Inversión Google" value={googleSpend > 0 ? formatCurrency(googleSpend) : '—'} />
            <Kpi label="Leads" value={formatNumber(overall.leads)} sub="contactos generados en Meta" highlight />
            <Kpi label="Costo por lead" value={overall.cpl > 0 ? formatCurrency(overall.cpl) : '—'} sub="cuánto sale cada contacto" />
          </div>
          <p className="text-[12px] text-slate-500 mt-3 leading-relaxed">
            De cada <b>100 personas</b> que ven un anuncio, algunas hacen click, algunas llegan a la landing y unas pocas
            dejan sus datos. El <b>embudo</b> de abajo muestra dónde se van cayendo — así se ve en qué parte conviene trabajar.
          </p>
        </section>

        {/* ── Embudo general ── */}
        <section>
          <SectionTitle icon={<Target size={15} />} title="El embudo, paso a paso" hint="Meta · de la impresión al lead" />
          <Card className="p-5">
            <FunnelView f={overall} />
          </Card>
        </section>

        {/* ── Los dos motores: Formularios vs Landing ── */}
        <section>
          <SectionTitle icon={<Flag size={15} />} title="Los dos caminos hacia el lead" hint="Formulario dentro de Meta vs. anuncio que lleva a la landing" />
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 items-start">
            <ChannelCard
              ch={channels.form} title="Formularios" subtitle="El lead completa un formulario dentro de Meta"
              icon={<ClipboardList size={15} />} accent="#0866FF"
            />
            <ChannelCard
              ch={channels.landing} title="Leads a landing" subtitle="El anuncio lleva al sitio y el lead convierte ahí"
              icon={<Globe size={15} />} accent="#0e9f6e"
            />
          </div>
        </section>

        {/* ── Por producto ── */}
        {verticals.length > 0 && (
          <section>
            <SectionTitle icon={<Flag size={15} />} title="Por producto" hint="CRM · ERP · Kit 4.0 · el producto viene del nombre del anuncio" />
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 items-start">
              {verticals.map(v => <Fragment key={v.name}><VerticalCard v={v} /></Fragment>)}
            </div>
          </section>
        )}

        {/* ── Mejores / peores anuncios (con miniatura) ── */}
        <section>
          <SectionTitle icon={<Trophy size={15} className="text-veta" />} title="Los anuncios que mejor funcionan" hint="Ordenados por menor costo por lead" />
          {ads.best.length === 0 ? (
            <Card className="p-6 text-center text-sm text-slate-400">Todavía no hay anuncios con leads en el período.</Card>
          ) : (
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
              {ads.best.map(a => <Fragment key={a.adId}><AdCard ad={a} tone="good" /></Fragment>)}
            </div>
          )}
        </section>

        {ads.worst.length > 0 && (
          <section>
            <SectionTitle icon={<AlertTriangle size={15} className="text-amber-500" />} title="Anuncios para revisar" hint="Gastaron pero no trajeron leads" />
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
              {ads.worst.map(a => <Fragment key={a.adId}><AdCard ad={a} tone="bad" /></Fragment>)}
            </div>
          </section>
        )}

        {/* ── Google ── */}
        <section>
          <SectionTitle icon={<MousePointerClick size={15} />} title="Google Ads" hint="Búsqueda y campañas" />
          {google.hasData ? (
            <Card className="p-5 space-y-4">
              {google.leads === 0 && (
                <p className="text-[12px] text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
                  ⚠ <span className="font-semibold">Sección en revisión.</span> Hay inversión y clicks, pero Google no está registrando conversiones en el período. Estamos validando si es un tema de <span className="font-semibold">medición (tracking)</span>, de <span className="font-semibold">volumen</span>, o si conviene reorientar la estrategia. Por ahora tomá estos números como inversión y tráfico, no como resultados finales.
                </p>
              )}
              <FunnelView f={google} hideVisits />
              <div className="border-t border-slate-100 pt-3">
                {google.campaigns.slice(0, 8).map(c => (
                  <div key={c.name} className="flex items-center justify-between py-1.5 text-sm border-b border-slate-50 last:border-0">
                    <span className="truncate font-medium" title={c.name}>{c.name}</span>
                    <span className="text-slate-400 tabular-nums">{formatCurrency(c.spend)} · {formatNumber(c.leads)} conv.</span>
                  </div>
                ))}
              </div>
            </Card>
          ) : (
            <Card className="p-6 text-center text-sm text-slate-400">Sin datos de Google todavía — se completan en la próxima actualización automática.</Card>
          )}
        </section>

        {/* ── Calidad de leads / CRM ── */}
        <section>
          <SectionTitle icon={<BadgeCheck size={15} className="text-veta" />} title="Calidad de los leads" hint="Cruce con el CRM (GoHighLevel)" />
          {leadQuality ? <LeadQualityView lq={leadQuality} /> : (
            <Card className="p-5 border-dashed border-2 border-slate-200 bg-slate-50/40">
              <div className="flex items-start gap-3">
                <BadgeCheck size={22} className="text-slate-300 shrink-0 mt-0.5" />
                <div className="text-sm text-slate-500 leading-relaxed">
                  <p className="font-bold text-slate-700 mb-1">Próximamente — se conecta con el CRM.</p>
                  <p>Cuando entren los datos del CRM, acá vas a ver qué anuncio trajo leads que realmente se calificaron y con cuáles se agendó reunión.</p>
                </div>
              </div>
            </Card>
          )}
        </section>

        {/* ── Demografía ── */}
        {Object.keys(demographics).some(k => (demographics[k] ?? []).length > 0) && (
          <section>
            <SectionTitle icon={<Users size={15} />} title="A quién le llegó la pauta" hint="Meta · cuánto se invirtió y CTR por segmento — no implica calidad del lead" />
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {(['age', 'gender', 'region', 'publisher_platform'] as const).map(dim =>
                (demographics[dim] ?? []).length
                  ? <Fragment key={dim}><DemoCard title={DEMO_LABELS[dim]} items={demographics[dim]} isGender={dim === 'gender'} /></Fragment>
                  : null
              )}
            </div>
          </section>
        )}

        <footer className="pt-4 pb-8 text-center text-[11px] text-slate-400">
          Datos directos de Meta Ads y Google Ads · Actualización automática cada hora · Veta Analytics<br />
          <span className="text-slate-300">{leadQuality ? 'Calidad de leads cruzada con el CRM (GoHighLevel) · actualización diaria' : 'Leads calificados y reuniones (CRM) — próximamente'}</span>
        </footer>
      </main>
    </div>
  );
}

// ─── Funnel ────────────────────────────────────────────────────────────────────
function FunnelView({ f, hideVisits }: { f: Funnel; hideVisits?: boolean }) {
  const stages = [
    { key: 'impr', label: 'Impresiones', icon: <Eye size={14} />, value: f.impressions, rate: null as number | null, cost: f.cpm, costLabel: 'CPM' },
    { key: 'clk', label: 'Clicks', icon: <MousePointerClick size={14} />, value: f.clicks, rate: f.clickRate, cost: f.cpc, costLabel: 'CPC' },
    ...(hideVisits ? [] : [{ key: 'vis', label: 'Visitas a la landing', icon: <Globe size={14} />, value: f.visits, rate: f.visitRate, cost: f.costPerVisit, costLabel: '$/visita' }]),
    { key: 'lead', label: 'Leads', icon: <Target size={14} />, value: f.leads, rate: hideVisits ? (f.clicks > 0 ? f.leads / f.clicks : 0) : f.leadRate, cost: f.cpl, costLabel: 'CPL' },
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
              <div className="w-36 shrink-0 flex items-center gap-1.5 text-[12px] font-semibold text-slate-600">
                <span className="text-slate-400">{s.icon}</span>{s.label}
              </div>
              <div className="flex-1 h-8 rounded-lg bg-slate-100 overflow-hidden relative">
                <div className={cn('h-full rounded-lg flex items-center px-2', isLead ? 'bg-veta' : 'bg-sky-500/85')} style={{ width: `${w}%` }}>
                  <span className={cn('text-[12px] font-black tabular-nums', w > 12 ? 'text-white' : 'text-slate-700 absolute left-2')}>{formatNumber(s.value)}</span>
                </div>
              </div>
              <div className="w-28 shrink-0 text-right">
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

// ─── Motor (Formularios / Landing) ──────────────────────────────────────────────
function ChannelCard({ ch, title, subtitle, icon, accent }: { ch: Channel; title: string; subtitle: string; icon: ReactNode; accent: string }) {
  const isForm = ch.kind === 'form';
  const steps = [
    { label: 'Impr.', value: ch.impressions },
    { label: 'Clicks', value: ch.clicks },
    ...(isForm ? [] : [{ label: 'Visitas', value: ch.visits }]),
    { label: 'Leads', value: ch.leads },
  ];
  return (
    <Card className="p-4">
      <div className="flex items-start justify-between mb-3">
        <div className="flex items-center gap-2">
          <span className="grid place-items-center w-7 h-7 rounded-lg text-white" style={{ background: accent }}>{icon}</span>
          <div>
            <h3 className="font-black leading-none">{title}</h3>
            <p className="text-[11px] text-slate-400 mt-0.5">{subtitle}</p>
          </div>
        </div>
        <span className="text-[11px] text-slate-400 shrink-0">{formatCurrency(ch.spend)}</span>
      </div>

      {ch.adCount === 0 ? (
        <p className="text-[12px] text-slate-400 text-center py-6">Sin anuncios de este tipo en el período.</p>
      ) : (
        <>
          {/* mini funnel en línea */}
          <div className="flex items-stretch gap-1 mb-3">
            {steps.map((s, i) => (
              <div key={s.label} className="flex-1 text-center">
                <div className="rounded-md bg-slate-50 py-1.5">
                  <p className="text-sm font-black tabular-nums leading-none">{formatNumber(s.value)}</p>
                  <p className="text-[9px] text-slate-400 mt-0.5">{s.label}</p>
                </div>
                {i < steps.length - 1 && <span className="text-slate-300 text-[9px]">▼</span>}
              </div>
            ))}
          </div>
          <div className="grid grid-cols-3 gap-2 mb-3 text-center">
            <MiniStat label="Costo x lead" value={ch.leads > 0 ? formatCurrency(ch.cpl) : '—'} accent={accent} />
            <MiniStat label="CTR" value={ch.impressions > 0 ? formatPercent(ch.ctr) : '—'} />
            <MiniStat label="CPC" value={ch.clicks > 0 ? formatCurrency(ch.cpc) : '—'} />
          </div>
          {/* top anuncios del motor */}
          <div className="space-y-1.5">
            {ch.best.slice(0, 4).map(a => {
              const row = (
                <>
                  <div className="w-8 h-8 rounded-md bg-slate-100 overflow-hidden shrink-0 grid place-items-center">
                    {a.thumbnailUrl ? <img src={a.thumbnailUrl} alt="" className="w-full h-full object-cover" loading="lazy" /> : <span className="text-[8px] text-slate-300">—</span>}
                  </div>
                  <span className={cn('text-[11px] font-medium truncate flex-1', a.previewLink && 'group-hover:text-veta group-hover:underline')} title={a.adName}>{a.adName}</span>
                  <span className="text-[11px] text-slate-400 tabular-nums shrink-0">{a.leads > 0 ? `${a.leads} lead${a.leads > 1 ? 's' : ''}` : formatPercent(a.ctr)}</span>
                </>
              );
              return a.previewLink
                ? <a key={a.adId} href={a.previewLink} target="_blank" rel="noopener noreferrer" className="group flex items-center gap-2" title="Ver el anuncio">{row}</a>
                : <div key={a.adId} className="flex items-center gap-2">{row}</div>;
            })}
          </div>
        </>
      )}
    </Card>
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

function VerticalCard({ v }: { v: Vertical }) {
  const color = VERT_COLOR[v.name] ?? '#64748b';
  const steps = [
    { label: 'Impr.', value: v.impressions },
    { label: 'Clicks', value: v.clicks },
    { label: 'Visitas', value: v.visits },
    { label: 'Leads', value: v.leads },
  ];
  return (
    <Card className="p-4">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <span className="w-2.5 h-2.5 rounded-full" style={{ background: color }} />
          <h3 className="font-black">{v.name}</h3>
        </div>
        <span className="text-[11px] text-slate-400">{formatCurrency(v.spend)}</span>
      </div>
      {/* mini funnel en línea */}
      <div className="flex items-stretch gap-1 mb-3">
        {steps.map((s, i) => (
          <div key={s.label} className="flex-1 text-center">
            <div className="rounded-md bg-slate-50 py-1.5">
              <p className="text-sm font-black tabular-nums leading-none">{formatNumber(s.value)}</p>
              <p className="text-[9px] text-slate-400 mt-0.5">{s.label}</p>
            </div>
            {i < steps.length - 1 && <span className="text-slate-300 text-[9px]">▼</span>}
          </div>
        ))}
      </div>
      <div className="flex items-center justify-between text-[12px] mb-3">
        <span className="text-slate-500">CPL</span>
        <span className="font-black" style={{ color }}>{v.leads > 0 ? formatCurrency(v.cpl) : 'sin leads'}</span>
      </div>
      <div className="space-y-1.5">
        {v.ads.slice(0, 4).map(a => {
          const row = (
            <>
              <div className="w-8 h-8 rounded-md bg-slate-100 overflow-hidden shrink-0 grid place-items-center">
                {a.thumbnailUrl ? <img src={a.thumbnailUrl} alt="" className="w-full h-full object-cover" loading="lazy" /> : <span className="text-[8px] text-slate-300">—</span>}
              </div>
              <span className={cn('text-[11px] font-medium truncate flex-1', a.previewLink && 'group-hover:text-veta group-hover:underline')} title={a.adName}>{a.adName}</span>
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

// ─── Subcomponentes ─────────────────────────────────────────────────────────────
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
    <Card className={cn('p-4', highlight && 'ring-1 ring-veta/25 bg-veta/[0.03]')}>
      <p className="text-slate-400 text-[11px] font-bold uppercase tracking-wide">{label}</p>
      <p className="text-2xl font-black tabular-nums mt-1">{value}</p>
      {sub && <p className="text-[11px] text-slate-400 mt-0.5">{sub}</p>}
    </Card>
  );
}

function AdCard({ ad, tone }: { ad: Ad; tone: 'good' | 'bad' }) {
  const badge = ad.channel === 'form' ? 'Formulario' : ad.channel === 'landing' ? 'Landing' : ad.vertical;
  const media = (
    <div className="aspect-square bg-slate-100 overflow-hidden grid place-items-center relative group">
      {ad.thumbnailUrl
        ? <img src={ad.thumbnailUrl} alt={ad.adName} className="w-full h-full object-cover" loading="lazy" />
        : <span className="text-slate-300 text-xs">sin imagen</span>}
      {badge && <span className="absolute top-1 left-1 text-[9px] font-bold px-1.5 py-0.5 rounded bg-black/55 text-white">{badge}</span>}
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
            ? <span className="font-bold text-veta">{ad.leads > 0 ? `${ad.leads} lead${ad.leads > 1 ? 's' : ''}` : `CTR ${formatPercent(ad.ctr)}`}</span>
            : <span className="font-bold text-danger">0 leads</span>}
        </div>
        {tone === 'good' && ad.leads > 0
          ? <p className="text-[10px] text-slate-400">CPL {formatCurrency(ad.cpl)} · CTR {formatPercent(ad.ctr)}</p>
          : <p className="text-[10px] text-slate-400">CTR {formatPercent(ad.ctr)}</p>}
      </div>
    </Card>
  );
}

function DemoCard({ title, items, isGender }: { title: string; items: Demo[]; isGender?: boolean }) {
  const max = Math.max(...items.map(i => i.spend), 1);
  return (
    <Card className="p-4">
      <p className="text-sm font-black mb-3">{title}</p>
      <div className="space-y-2">
        {items.map(i => {
          const label = isGender ? (GENDER_ES[i.value] ?? i.value) : i.value;
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
                <div className="h-full rounded-full bg-veta/70" style={{ width: `${(i.spend / max) * 100}%` }} />
              </div>
            </div>
          );
        })}
      </div>
    </Card>
  );
}

function LeadQualityView({ lq }: { lq: LeadQuality }) {
  const pct = lq.total > 0 ? Math.round((lq.classified / lq.total) * 100) : 0;
  const winners = lq.byAd.filter(a => a.qualified + a.meetings > 0);
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <QualKpi icon={<CheckCircle2 size={16} />} label="Calificados" value={lq.qualified} tone="good" />
        <QualKpi icon={<CalendarCheck size={16} />} label="Reuniones agendadas" value={lq.meetings} tone="veta" />
        <QualKpi icon={<XCircle size={16} />} label="No calificados" value={lq.unqualified} tone="bad" />
        <QualKpi icon={<CircleDashed size={16} />} label="Sin clasificar" value={lq.unclassified} tone="muted" />
      </div>
      <p className="text-[11px] text-slate-400">
        {lq.classified} de {lq.total} leads ya revisados por el equipo ({pct}%).
        {lq.unclassified > 0 && ' El resto se va etiquetando en el CRM y esta sección se actualiza sola.'}
      </p>

      <Card className="p-4">
        <div className="flex items-center gap-2 mb-3">
          <Trophy size={14} className="text-veta" />
          <h3 className="font-black text-sm">Anuncios que trajeron los mejores leads</h3>
        </div>
        {winners.length === 0 ? (
          <p className="text-[12px] text-slate-400 py-4 text-center">
            Todavía no hay leads calificados o reuniones atribuidos a un anuncio puntual. Aparecen acá a medida que el equipo los etiqueta en el CRM.
          </p>
        ) : (
          <div className="space-y-1.5">
            {winners.map(a => {
              const row = (
                <>
                  <div className="w-9 h-9 rounded-md bg-slate-100 overflow-hidden shrink-0 grid place-items-center">
                    {a.thumbnailUrl ? <img src={a.thumbnailUrl} alt="" className="w-full h-full object-cover" loading="lazy" /> : <span className="text-[8px] text-slate-300">—</span>}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className={cn('text-[12px] font-semibold truncate', a.previewLink && 'group-hover:text-veta group-hover:underline')} title={a.adName}>{a.adName}</p>
                    <p className="text-[10px] text-slate-400 truncate">{a.channel === 'form' ? 'Formulario' : a.channel === 'landing' ? 'Landing' : ''}{a.vertical ? ` · ${a.vertical}` : ''}</p>
                  </div>
                  <div className="flex items-center gap-1.5 shrink-0 text-[11px] font-bold tabular-nums">
                    {a.qualified > 0 && <span className="inline-flex items-center gap-0.5 text-emerald-600" title="Calificados"><CheckCircle2 size={12} />{a.qualified}</span>}
                    {a.meetings > 0 && <span className="inline-flex items-center gap-0.5 text-veta" title="Reuniones"><CalendarCheck size={12} />{a.meetings}</span>}
                    {a.unqualified > 0 && <span className="inline-flex items-center gap-0.5 text-slate-300" title="No calificados"><XCircle size={12} />{a.unqualified}</span>}
                  </div>
                </>
              );
              return a.previewLink
                ? <a key={a.adId} href={a.previewLink} target="_blank" rel="noopener noreferrer" className="group flex items-center gap-2.5" title="Ver el anuncio">{row}</a>
                : <div key={a.adId} className="flex items-center gap-2.5">{row}</div>;
            })}
          </div>
        )}
      </Card>
    </div>
  );
}

function QualKpi({ icon, label, value, tone }: { icon: ReactNode; label: string; value: number; tone: 'good' | 'veta' | 'bad' | 'muted' }) {
  const col = tone === 'good' ? 'text-emerald-600' : tone === 'veta' ? 'text-veta' : tone === 'bad' ? 'text-rose-500' : 'text-slate-400';
  return (
    <Card className="p-4">
      <div className={cn('flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wide', col)}>
        {icon}<span className="text-slate-400">{label}</span>
      </div>
      <p className={cn('text-2xl font-black tabular-nums mt-1', col)}>{formatNumber(value)}</p>
    </Card>
  );
}

function Status({ icon, title, subtitle, isError }: { icon: ReactNode; title: string; subtitle?: string; isError?: boolean }) {
  return (
    <div className="min-h-screen grid place-items-center bg-[#f6f7f9] px-6 text-center">
      <div>
        <div className={cn('mx-auto mb-3 w-10 h-10 grid place-items-center', isError ? 'text-danger' : 'text-veta')}>{icon}</div>
        <p className="font-black text-slate-800">{title}</p>
        {subtitle && <p className="text-sm text-slate-400 mt-1 max-w-md">{subtitle}</p>}
      </div>
    </div>
  );
}
