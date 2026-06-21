import { useEffect, useState, Fragment, type ReactNode } from 'react';
import {
  TrendingUp, TrendingDown, Target, DollarSign,
  Trophy, AlertTriangle, Users, Loader2,
} from 'lucide-react';
import { Card } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { formatCurrency, formatNumber, formatPercent, cn } from '@/lib/utils';

const BASE = import.meta.env.DEV ? 'http://localhost:8888/.netlify/functions' : '/.netlify/functions';

// ─── Tipos ───────────────────────────────────────────────────────────────────
type Health = { status: 'scale' | 'ok' | 'optimize' | 'pause'; reason: string };
type MetaKpis = { spend: number; conversions: number; cpl: number; reach: number; impressions: number; clicks: number; ctr: number; deltas: { spend: number; conversions: number } };
type GoogleKpis = { spend: number; conversions: number; cpl: number; impressions: number; clicks: number; ctr: number; deltas: { spend: number; conversions: number }; hasData: boolean };
type Campaign = { id: string; name: string; platform: 'meta' | 'google'; status: string | null; spend: number; conversions: number; cpl: number; ctr?: number; health: Health };
type Ad = { adId: string; adName: string; campaignName: string; thumbnailUrl: string | null; status: string | null; spend: number; conversions: number; impressions: number; clicks: number; ctr: number; cpl: number };
type Demo = { value: string; spend: number; conversions: number; cpl: number; impressions: number };
type Data = {
  config: { name: string; currency: string; days: number; generatedAt: string };
  kpis: { total: { spend: number; conversions: number; cpl: number }; meta: MetaKpis; google: GoogleKpis };
  campaigns: Campaign[];
  ads: { best: Ad[]; worst: Ad[] };
  demographics: Record<string, Demo[]>;
};

const HEALTH_LABEL: Record<Health['status'], { label: string; variant: 'success' | 'secondary' | 'high' | 'critical' }> = {
  scale:    { label: 'Escalar',   variant: 'success' },
  ok:       { label: 'OK',        variant: 'secondary' },
  optimize: { label: 'Optimizar', variant: 'high' },
  pause:    { label: 'Revisar',   variant: 'critical' },
};

const DEMO_LABELS: Record<string, string> = { age: 'Edad', gender: 'Género', region: 'Región', publisher_platform: 'Placement' };
const GENDER_ES: Record<string, string> = { male: 'Hombres', female: 'Mujeres', unknown: 'Sin dato' };

export default function SmartwayPublic() {
  const [data, setData] = useState<Data | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch(`${BASE}/public-smartway`)
      .then(async r => {
        const json = await r.json();
        if (!r.ok || json.error) { setError(json.error ?? `HTTP ${r.status}`); return; }
        setData(json);
      })
      .catch(e => setError(e?.message ?? String(e)))
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <Status icon={<Loader2 className="animate-spin" />} title="Cargando datos de Smartway…" />;
  if (error || !data) return <Status icon={<AlertTriangle />} title="No pudimos cargar el reporte" subtitle={error ?? ''} isError />;

  const { kpis, campaigns, ads, demographics, config } = data;
  const updated = new Date(config.generatedAt);

  return (
    <div className="min-h-screen bg-[#f6f7f9] text-slate-900">
      {/* Header */}
      <header className="sticky top-0 z-10 border-b border-slate-200 bg-white/80 backdrop-blur">
        <div className="mx-auto max-w-6xl px-5 py-4 flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-veta text-white grid place-items-center font-black text-lg">S</div>
            <div>
              <h1 className="text-lg font-black leading-none">{config.name}</h1>
              <p className="text-xs text-slate-500 mt-0.5">Reporte de pauta · Meta + Google</p>
            </div>
          </div>
          <div className="text-right">
            <p className="text-[11px] text-slate-500">Últimos {config.days} días</p>
            <p className="text-[11px] text-slate-400">Actualizado {updated.toLocaleString('es-AR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })} hs</p>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-5 py-6 space-y-8">
        {/* ── Resumen total ── */}
        <section>
          <SectionTitle icon={<Target size={15} />} title="Resumen general" hint="Meta + Google combinados" />
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <KpiCard label="Inversión total" value={formatCurrency(kpis.total.spend)} icon={<DollarSign size={16} />} />
            <KpiCard label="Conversiones" value={formatNumber(kpis.total.conversions)} sub="leads / registros / mensajes" icon={<Target size={16} />} />
            <KpiCard label="Costo por conversión" value={kpis.total.cpl > 0 ? formatCurrency(kpis.total.cpl) : '—'} sub="CPL promedio" icon={<TrendingDown size={16} />} />
          </div>
        </section>

        {/* ── Por plataforma ── */}
        <section className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <PlatformCard
            name="Meta Ads" color="#0866FF"
            spend={kpis.meta.spend} conversions={kpis.meta.conversions} cpl={kpis.meta.cpl}
            ctr={kpis.meta.ctr} impressions={kpis.meta.impressions}
            deltas={kpis.meta.deltas}
          />
          {kpis.google.hasData ? (
            <PlatformCard
              name="Google Ads" color="#34A853"
              spend={kpis.google.spend} conversions={kpis.google.conversions} cpl={kpis.google.cpl}
              ctr={kpis.google.ctr} impressions={kpis.google.impressions}
              deltas={kpis.google.deltas}
            />
          ) : (
            <Card className="p-5 flex flex-col justify-center items-center text-center gap-1">
              <p className="font-bold text-slate-700">Google Ads</p>
              <p className="text-sm text-slate-400">Sin datos todavía — se completan en la próxima actualización automática.</p>
            </Card>
          )}
        </section>

        {/* ── Campañas ── */}
        <section>
          <SectionTitle icon={<TrendingUp size={15} />} title="Rendimiento por campaña" hint={`${campaigns.length} campañas activas en el período`} />
          <Card className="p-0 overflow-hidden">
            <div className="grid grid-cols-[1.8fr_0.7fr_0.9fr_0.9fr_0.9fr] gap-2 px-4 py-2.5 bg-slate-50 text-[11px] font-bold uppercase tracking-wide text-slate-500 border-b border-slate-100">
              <span>Campaña</span><span>Canal</span><span className="text-right">Inversión</span><span className="text-right">Conv.</span><span className="text-right">Estado</span>
            </div>
            {campaigns.map(c => (
              <div key={`${c.platform}-${c.id}`} className="grid grid-cols-[1.8fr_0.7fr_0.9fr_0.9fr_0.9fr] gap-2 px-4 py-2.5 items-center border-b border-slate-50 last:border-0 hover:bg-slate-50/60">
                <div className="min-w-0">
                  <p className="text-sm font-semibold truncate" title={c.name}>{c.name}</p>
                  <p className="text-[11px] text-slate-400">{c.conversions > 0 ? `CPL ${formatCurrency(c.cpl)}` : 'Sin conversiones'}</p>
                </div>
                <span className={cn('text-[11px] font-bold', c.platform === 'meta' ? 'text-[#0866FF]' : 'text-[#34A853]')}>
                  {c.platform === 'meta' ? 'Meta' : 'Google'}
                </span>
                <span className="text-right text-sm font-semibold tabular-nums">{formatCurrency(c.spend)}</span>
                <span className="text-right text-sm tabular-nums">{formatNumber(c.conversions)}</span>
                <span className="text-right" title={c.health.reason}>
                  <Badge variant={HEALTH_LABEL[c.health.status].variant} className="text-[10px]">
                    {HEALTH_LABEL[c.health.status].label}
                  </Badge>
                </span>
              </div>
            ))}
            {campaigns.length === 0 && <p className="px-4 py-8 text-center text-sm text-slate-400">Sin campañas en el período.</p>}
          </Card>
        </section>

        {/* ── Mejores anuncios ── */}
        <section>
          <SectionTitle icon={<Trophy size={15} className="text-veta" />} title="Anuncios que mejor rinden" hint="Últimos 14 días · menor costo por conversión" />
          {ads.best.length === 0 ? (
            <Card className="p-6 text-center text-sm text-slate-400">Todavía no hay anuncios con conversiones en la ventana.</Card>
          ) : (
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
              {ads.best.map(a => <Fragment key={a.adId}><AdCard ad={a} tone="good" /></Fragment>)}
            </div>
          )}
        </section>

        {/* ── Peores anuncios ── */}
        {ads.worst.length > 0 && (
          <section>
            <SectionTitle icon={<AlertTriangle size={15} className="text-amber-500" />} title="Anuncios a revisar" hint="Gasto relevante sin conversiones (14 días)" />
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
              {ads.worst.map(a => <Fragment key={a.adId}><AdCard ad={a} tone="bad" /></Fragment>)}
            </div>
          </section>
        )}

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
          Datos directos de Meta Ads y Google Ads · Actualización automática cada hora · Veta Analytics
        </footer>
      </main>
    </div>
  );
}

// ─── Subcomponentes ────────────────────────────────────────────────────────────
function SectionTitle({ icon, title, hint }: { icon: ReactNode; title: string; hint?: string }) {
  return (
    <div className="flex items-center gap-2 mb-3">
      <span className="text-slate-600">{icon}</span>
      <h2 className="text-base font-black tracking-tight">{title}</h2>
      {hint && <span className="text-[11px] text-slate-400 font-medium">· {hint}</span>}
    </div>
  );
}

function KpiCard({ label, value, sub, icon }: { label: string; value: string; sub?: string; icon: ReactNode }) {
  return (
    <Card className="p-4">
      <div className="flex items-center gap-1.5 text-slate-400 text-[11px] font-bold uppercase tracking-wide">{icon}{label}</div>
      <p className="text-2xl font-black mt-1.5 tabular-nums">{value}</p>
      {sub && <p className="text-[11px] text-slate-400 mt-0.5">{sub}</p>}
    </Card>
  );
}

function DeltaPill({ value, invert }: { value: number; invert?: boolean }) {
  if (!value) return <span className="text-[11px] text-slate-300">—</span>;
  const good = invert ? value < 0 : value > 0;
  const Icon = value > 0 ? TrendingUp : TrendingDown;
  return (
    <span className={cn('inline-flex items-center gap-0.5 text-[11px] font-bold', good ? 'text-veta' : 'text-danger')}>
      <Icon size={11} />{formatPercent(Math.abs(value))}
    </span>
  );
}

function PlatformCard(props: { name: string; color: string; spend: number; conversions: number; cpl: number; ctr: number; impressions: number; deltas: { spend: number; conversions: number } }) {
  const { name, color, spend, conversions, cpl, ctr, impressions, deltas } = props;
  return (
    <Card className="p-5">
      <div className="flex items-center gap-2 mb-4">
        <span className="w-2.5 h-2.5 rounded-full" style={{ background: color }} />
        <h3 className="font-black">{name}</h3>
      </div>
      <div className="grid grid-cols-2 gap-y-4 gap-x-3">
        <Stat label="Inversión" value={formatCurrency(spend)} delta={<DeltaPill value={deltas.spend} />} />
        <Stat label="Conversiones" value={formatNumber(conversions)} delta={<DeltaPill value={deltas.conversions} />} />
        <Stat label="Costo / conv." value={cpl > 0 ? formatCurrency(cpl) : '—'} />
        <Stat label="CTR" value={ctr > 0 ? formatPercent(ctr) : '—'} sub={`${formatNumber(impressions)} impresiones`} />
      </div>
    </Card>
  );
}

function Stat({ label, value, sub, delta }: { label: string; value: string; sub?: string; delta?: ReactNode }) {
  return (
    <div>
      <p className="text-[11px] text-slate-400 font-bold uppercase tracking-wide">{label}</p>
      <div className="flex items-center gap-2">
        <p className="text-xl font-black tabular-nums">{value}</p>
        {delta}
      </div>
      {sub && <p className="text-[11px] text-slate-400">{sub}</p>}
    </div>
  );
}

function AdCard({ ad, tone }: { ad: Ad; tone: 'good' | 'bad' }) {
  return (
    <Card className="p-0 overflow-hidden flex flex-col">
      <div className="aspect-square bg-slate-100 overflow-hidden grid place-items-center">
        {ad.thumbnailUrl
          ? <img src={ad.thumbnailUrl} alt={ad.adName} className="w-full h-full object-cover" loading="lazy" />
          : <span className="text-slate-300 text-xs">sin imagen</span>}
      </div>
      <div className="p-2.5 flex flex-col gap-1">
        <p className="text-[12px] font-bold leading-tight line-clamp-2" title={ad.adName}>{ad.adName}</p>
        <div className="flex items-center justify-between text-[11px] mt-0.5">
          <span className="text-slate-400">{formatCurrency(ad.spend)}</span>
          {tone === 'good'
            ? <span className="font-bold text-veta">{ad.conversions > 0 ? `${ad.conversions} conv.` : `CTR ${formatPercent(ad.ctr)}`}</span>
            : <span className="font-bold text-danger">0 conv.</span>}
        </div>
        {tone === 'good' && ad.conversions > 0 && (
          <p className="text-[10px] text-slate-400">CPL {formatCurrency(ad.cpl)} · CTR {formatPercent(ad.ctr)}</p>
        )}
        {tone === 'bad' && (
          <p className="text-[10px] text-slate-400">CTR {formatPercent(ad.ctr)}</p>
        )}
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
                <span className="text-slate-400 tabular-nums">{formatCurrency(i.spend)}{i.conversions > 0 ? ` · ${i.conversions} conv.` : ''}</span>
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