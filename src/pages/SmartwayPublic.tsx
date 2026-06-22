import { useEffect, useState, Fragment, type ReactNode } from 'react';
import {
  TrendingUp, TrendingDown, Target, Trophy, AlertTriangle, Users, Loader2,
  Eye, MousePointerClick, MapPin, Flag,
} from 'lucide-react';
import { Card } from '@/components/ui/Card';
import { DateRangePicker, type DateRange } from '@/components/ui/DateRangePicker';
import { formatCurrency, formatNumber, formatPercent, cn } from '@/lib/utils';

const BASE = import.meta.env.DEV ? 'http://localhost:8888/.netlify/functions' : '/.netlify/functions';

function initialRange(): DateRange {
  const end = new Date().toISOString().split('T')[0];
  const s = new Date(); s.setDate(s.getDate() - 29);
  return { start: s.toISOString().split('T')[0], end, label: 'Últimos 30 días' };
}

// ─── Tipos ───────────────────────────────────────────────────────────────────
type Funnel = {
  spend: number; impressions: number; clicks: number; visits: number; leads: number;
  ctr: number; cpm: number; cpc: number; costPerVisit: number; cpl: number;
  clickRate: number; visitRate: number; leadRate: number;
};
type Ad = { adId: string; adName: string; vertical?: string; thumbnailUrl: string | null; spend: number; impressions?: number; clicks?: number; lpv?: number; leads: number; ctr: number; cpl: number };
type Vertical = Funnel & { name: string; ads: Ad[] };
type CampaignType = { name: string; spend: number; leads: number; cpl: number };
type Demo = { value: string; spend: number; leads: number; cpl: number };
type GoogleData = Funnel & { hasData: boolean; campaigns: { name: string; vertical: string; spend: number; clicks: number; impressions: number; leads: number; cpl: number }[] };
type Data = {
  config: { name: string; currency: string; period: { start: string; end: string }; generatedAt: string; dataUpdatedAt: string | null; metaUpdatedAt: string | null; googleUpdatedAt: string | null };
  overall: Funnel;
  verticals: Vertical[];
  webinar: (Funnel & { name: string; ads: Ad[] }) | null;
  campaignTypes: CampaignType[];
  ads: { best: Ad[]; worst: Ad[] };
  google: GoogleData;
  demographics: Record<string, Demo[]>;
};

const DEMO_LABELS: Record<string, string> = { age: 'Edad', gender: 'Género', region: 'Región', publisher_platform: 'Placement' };
const GENDER_ES: Record<string, string> = { male: 'Hombres', female: 'Mujeres', unknown: 'Sin dato' };
const VERT_COLOR: Record<string, string> = { 'Orbatix': '#7c3aed', 'Smartway': '#0866FF', 'Kit 4.0': '#0e9f6e' };

export default function SmartwayPublic() {
  const [data, setData] = useState<Data | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [range, setRange] = useState<DateRange>(initialRange());

  useEffect(() => {
    setLoading(true);
    setError(null);
    // _t = cache-buster para que nunca devuelva una respuesta cacheada por el browser/CDN
    fetch(`${BASE}/public-smartway?start=${range.start}&end=${range.end}&_t=${Date.now()}`, { cache: 'no-store' })
      .then(async r => {
        const json = await r.json();
        if (!r.ok || json.error) { setError(json.error ?? `HTTP ${r.status}`); return; }
        setData(json);
      })
      .catch(e => setError(e?.message ?? String(e)))
      .finally(() => setLoading(false));
  }, [range.start, range.end]);

  if (loading && !data) return <Status icon={<Loader2 className="animate-spin" />} title="Cargando datos de Smartway…" />;
  if (error || !data) return <Status icon={<AlertTriangle />} title="No pudimos cargar el reporte" subtitle={error ?? ''} isError />;

  const { overall, verticals, webinar, campaignTypes, ads, google, demographics, config } = data;
  // Hora REAL del último sync de datos (no la del request)
  const dataUpd = config.dataUpdatedAt ? new Date(config.dataUpdatedAt) : null;
  const fmtTime = (d: Date) => d.toLocaleString('es-AR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });

  return (
    <div className="min-h-screen bg-[#f6f7f9] text-slate-900">
      <header className="sticky top-0 z-10 border-b border-slate-200 bg-white/80 backdrop-blur">
        <div className="mx-auto max-w-6xl px-5 py-4 flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-veta text-white grid place-items-center font-black text-lg">S</div>
            <div>
              <h1 className="text-lg font-black leading-none">{config.name}</h1>
              <p className="text-xs text-slate-500 mt-0.5">Funnel de pauta · Meta + Google</p>
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
        {/* ── KPIs hero (lead-gen comercial, SIN el webinar Orbatix) ── */}
        <section>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <Kpi label="Inversión" value={formatCurrency(overall.spend)} />
            <Kpi label="Leads comerciales" value={formatNumber(overall.leads)} sub="sin contar el webinar" />
            <Kpi label="Costo por lead" value={overall.cpl > 0 ? formatCurrency(overall.cpl) : '—'} sub="CPL comercial" />
            <Kpi label="Costo por visita" value={overall.costPerVisit > 0 ? formatCurrency(overall.costPerVisit) : '—'} sub="a la landing" />
          </div>
          <p className="text-[11px] text-slate-400 mt-2">
            Los leads del webinar <span className="font-semibold text-violet-600">Orbatix</span> se miden aparte (más abajo) — son registros masivos y distorsionan el CPL comercial.
          </p>
        </section>

        {/* ── Funnel general ── */}
        <section>
          <SectionTitle icon={<Target size={15} />} title="Embudo comercial" hint="Meta · de la impresión al lead · sin webinar" />
          <Card className="p-5">
            <FunnelView f={overall} />
          </Card>
        </section>

        {/* ── Verticales (lead-gen comercial) ── */}
        <section>
          <SectionTitle icon={<Flag size={15} />} title="Por vertical" hint="Lead-gen comercial · el vertical viene del nombre del anuncio" />
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 items-start">
            {verticals.map(v => <Fragment key={v.name}><VerticalCard v={v} /></Fragment>)}
          </div>
        </section>

        {/* ── Webinar Orbatix (bucket aparte) ── */}
        {webinar && (
          <section>
            <SectionTitle icon={<Flag size={15} className="text-violet-600" />} title="Webinar Orbatix" hint="Campaña de evento · medida aparte del lead-gen comercial" />
            <Card className="p-5 border-violet-200 bg-violet-50/30">
              <div className="flex flex-wrap items-end gap-x-8 gap-y-3 mb-4">
                <Stat label="Inversión" value={formatCurrency(webinar.spend)} />
                <Stat label="Registros" value={formatNumber(webinar.leads)} />
                <Stat label="Costo por registro" value={webinar.cpl > 0 ? formatCurrency(webinar.cpl) : '—'} />
                <Stat label="CTR" value={webinar.impressions > 0 ? formatPercent(webinar.ctr) : '—'} />
              </div>
              <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
                {webinar.ads.slice(0, 6).map(a => <Fragment key={a.adId}><AdCard ad={a} tone="good" /></Fragment>)}
              </div>
            </Card>
          </section>
        )}

        {/* ── Por tipo de campaña ── */}
        <section>
          <SectionTitle icon={<TrendingUp size={15} />} title="Por campaña" hint="Estructura de cuenta (Leads, Advantage, Remarketing…)" />
          <Card className="p-0 overflow-hidden">
            <div className="grid grid-cols-[2fr_1fr_0.8fr_1fr] gap-2 px-4 py-2.5 bg-slate-50 text-[11px] font-bold uppercase tracking-wide text-slate-500 border-b border-slate-100">
              <span>Campaña</span><span className="text-right">Inversión</span><span className="text-right">Leads</span><span className="text-right">CPL</span>
            </div>
            {campaignTypes.map(c => (
              <div key={c.name} className="grid grid-cols-[2fr_1fr_0.8fr_1fr] gap-2 px-4 py-2.5 items-center border-b border-slate-50 last:border-0 hover:bg-slate-50/60">
                <span className="text-sm font-semibold truncate" title={c.name}>{c.name}</span>
                <span className="text-right text-sm tabular-nums">{formatCurrency(c.spend)}</span>
                <span className="text-right text-sm tabular-nums font-semibold">{formatNumber(c.leads)}</span>
                <span className="text-right text-sm tabular-nums">{c.leads > 0 ? formatCurrency(c.cpl) : '—'}</span>
              </div>
            ))}
            {campaignTypes.length === 0 && <p className="px-4 py-8 text-center text-sm text-slate-400">Sin campañas en el período.</p>}
          </Card>
        </section>

        {/* ── Mejores / peores anuncios ── */}
        <section>
          <SectionTitle icon={<Trophy size={15} className="text-veta" />} title="Anuncios que mejor rinden" hint="Menor costo por lead (30 días)" />
          {ads.best.length === 0 ? (
            <Card className="p-6 text-center text-sm text-slate-400">Todavía no hay anuncios con leads en la ventana.</Card>
          ) : (
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
              {ads.best.map(a => <Fragment key={a.adId}><AdCard ad={a} tone="good" /></Fragment>)}
            </div>
          )}
        </section>

        {ads.worst.length > 0 && (
          <section>
            <SectionTitle icon={<AlertTriangle size={15} className="text-amber-500" />} title="Anuncios a revisar" hint="Gasto relevante sin leads (30 días)" />
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
              {ads.worst.map(a => <Fragment key={a.adId}><AdCard ad={a} tone="bad" /></Fragment>)}
            </div>
          </section>
        )}

        {/* ── Google ── */}
        <section>
          <SectionTitle icon={<MousePointerClick size={15} />} title="Google Ads" hint="Búsqueda y display" />
          {google.hasData ? (
            <Card className="p-5 space-y-4">
              {google.leads === 0 && (
                <p className="text-[12px] text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
                  ⚠ Google no tiene conversiones registradas en este período — el tracking de conversiones está a revisar con el equipo. Se ven inversión y clicks, pero no leads.
                </p>
              )}
              <FunnelView f={google} hideVisits />
              <div className="border-t border-slate-100 pt-3">
                {google.campaigns.slice(0, 8).map(c => (
                  <div key={c.name} className="flex items-center justify-between py-1.5 text-sm border-b border-slate-50 last:border-0">
                    <span className="truncate font-medium" title={c.name}>{c.name}</span>
                    <span className="text-slate-400 tabular-nums">{formatCurrency(c.spend)} · {formatNumber(c.leads)} leads</span>
                  </div>
                ))}
              </div>
            </Card>
          ) : (
            <Card className="p-6 text-center text-sm text-slate-400">Sin datos de Google todavía — se completan en la próxima actualización automática.</Card>
          )}
        </section>

        {/* ── Demografía ── */}
        {Object.keys(demographics).some(k => (demographics[k] ?? []).length > 0) && (
          <section>
            <SectionTitle icon={<Users size={15} />} title="A quién le llegamos" hint="Distribución de inversión (Meta)" />
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
          <span className="text-slate-300">Leads calificados y reuniones (HubSpot) — próximamente</span>
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
    ...(hideVisits ? [] : [{ key: 'vis', label: 'Visitas a la landing', icon: <MapPin size={14} />, value: f.visits, rate: f.visitRate, cost: f.costPerVisit, costLabel: '$/visita' }]),
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
        {v.ads.slice(0, 4).map(a => (
          <div key={a.adId} className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-md bg-slate-100 overflow-hidden shrink-0 grid place-items-center">
              {a.thumbnailUrl ? <img src={a.thumbnailUrl} alt="" className="w-full h-full object-cover" loading="lazy" /> : <span className="text-[8px] text-slate-300">—</span>}
            </div>
            <span className="text-[11px] font-medium truncate flex-1" title={a.adName}>{a.adName}</span>
            <span className="text-[11px] text-slate-400 tabular-nums shrink-0">{a.leads > 0 ? `${a.leads} lead${a.leads > 1 ? 's' : ''}` : formatPercent(a.ctr)}</span>
          </div>
        ))}
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

function Kpi({ label, value, sub, delta }: { label: string; value: string; sub?: string; delta?: ReactNode }) {
  return (
    <Card className="p-4">
      <p className="text-slate-400 text-[11px] font-bold uppercase tracking-wide">{label}</p>
      <div className="flex items-center gap-2 mt-1">
        <p className="text-2xl font-black tabular-nums">{value}</p>
        {delta}
      </div>
      {sub && <p className="text-[11px] text-slate-400 mt-0.5">{sub}</p>}
    </Card>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-[11px] text-slate-400 font-bold uppercase tracking-wide">{label}</p>
      <p className="text-xl font-black tabular-nums mt-0.5">{value}</p>
    </div>
  );
}

function AdCard({ ad, tone }: { ad: Ad; tone: 'good' | 'bad' }) {
  return (
    <Card className="p-0 overflow-hidden flex flex-col">
      <div className="aspect-square bg-slate-100 overflow-hidden grid place-items-center relative">
        {ad.thumbnailUrl
          ? <img src={ad.thumbnailUrl} alt={ad.adName} className="w-full h-full object-cover" loading="lazy" />
          : <span className="text-slate-300 text-xs">sin imagen</span>}
        {ad.vertical && <span className="absolute top-1 left-1 text-[9px] font-bold px-1.5 py-0.5 rounded bg-black/55 text-white">{ad.vertical}</span>}
      </div>
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
              <div className="flex items-center justify-between text-[12px] mb-0.5">
                <span className="font-semibold text-slate-700 truncate">{label}</span>
                <span className="text-slate-400 tabular-nums">{formatCurrency(i.spend)}{i.leads > 0 ? ` · ${i.leads} lead${i.leads > 1 ? 's' : ''}` : ''}</span>
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