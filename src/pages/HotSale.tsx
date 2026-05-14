import { useEffect, useState, type ReactNode } from 'react';
import {
  ArrowUpRight, ArrowDownRight, Flame, TrendingUp,
  MapPin, Users, Smartphone, Image as ImageIcon, Clock, Globe,
} from 'lucide-react';
import { LineChart, Line, XAxis, YAxis, ResponsiveContainer, Tooltip, ReferenceArea as RechartsReferenceArea, Legend } from 'recharts';

// Recharts 3.x no expone fill/fillOpacity en los tipos de ReferenceArea, pero
// los acepta en runtime. Cast a any para evitar el TS error.
const ReferenceArea = RechartsReferenceArea as any;
import { Card } from '@/components/ui/Card';
import { formatCurrency, formatNumber, cn } from '@/lib/utils';

const BASE = import.meta.env.DEV ? 'http://localhost:8888/.netlify/functions' : '/.netlify/functions';
const DAY_LABELS_LONG  = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado'];
const DAY_LABELS_SHORT = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'];

type ChannelKpis = {
  spend: number; revenue: number; purchases: number;
  roas: number; cpa: number; aov: number;
  reach?: number; clicks?: number; impressions?: number;
};
type RangeKpis = { start: string; end: string; total: ChannelKpis; meta: ChannelKpis; google: ChannelKpis };
type DailyPoint = {
  date: string; spend: number; revenue: number; purchases: number;
  metaSpend: number; metaRevenue: number; googleSpend: number; googleRevenue: number;
  isHotWeek: boolean;
};
type Route = { route: string; revenue: number; items: number; purchases: number };
type Channel = { channel: string; sessions: number; items: number; revenue: number };
type Campaign = {
  name: string; channel: 'Meta' | 'Google';
  spend: number; revenue: number; purchases: number;
  impressions: number; clicks: number;
  roas: number; cpa: number;
};
type Creative = {
  adId: string; adName: string; campaignName: string; thumbnailUrl: string | null;
  status: string; spend: number; impressions: number; clicks: number; purchases: number;
  revenue: number; roas: number; cpa: number; ctr: number;
};
type HeatCell = { dow: number; hour: number; dayLabel: string; spend: number; purchases: number; revenue: number; roas: number };
type DemoItem = { value: string; spend: number; impressions: number; reach: number; purchases: number; revenue: number; roas: number; cpa: number };

type HotSaleData = {
  config: {
    slug: string;
    weekBase:    { start: string; end: string };
    hotWeek:     { start: string; end: string };
    hotWeek2025: { start: string; end: string };
  };
  weekly: {
    base:    RangeKpis;
    hotWeek: RangeKpis;
    daily:   DailyPoint[];
    routes:  {
      hotWeek: Route[];
      base: Route[];
      hotWeekTotals: { routesCount: number; revenue: number; items: number };
    };
    channels: Channel[];
    creatives: Creative[];
    campaigns: Campaign[];
  };
  yoy: {
    hs2025: RangeKpis;
    hs2026: RangeKpis;
    mix: { 2025: any; 2026: any };
  };
  heatmap: {
    cells: HeatCell[];
    minSpendThreshold: number;
    topVolumeSlot: HeatCell | null;
    bestEfficiencySlot: HeatCell | null;
    worstEfficiencySlot: HeatCell | null;
  };
  demographics: { age: DemoItem[]; gender: DemoItem[]; region: DemoItem[]; placement: DemoItem[] };
  generatedAt: string;
};

export default function HotSale() {
  const [data, setData] = useState<HotSaleData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    setError(null);
    fetch(`${BASE}/hot-sale`)
      .then(async r => {
        const json = await r.json();
        if (!r.ok || json.error) {
          setError(json.error ?? `HTTP ${r.status}`);
          setData(null);
        } else {
          setData(json);
        }
      })
      .catch(err => setError(err?.message ?? String(err)))
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <FullScreenStatus title="Cargando informe Hot Sale..." subtitle="Andesmar · Veta Analytics" />;

  if (error) return (
    <FullScreenStatus
      title="No pudimos cargar el informe"
      subtitle={`Error: ${error}`}
      isError
    />
  );

  if (!data) return <FullScreenStatus title="Sin datos" subtitle="" />;

  return <Report data={data} />;
}

function Report({ data }: { data: HotSaleData }) {
  const { weekly, yoy, heatmap, demographics, config } = data;
  const today = new Date().toISOString().slice(0, 10);
  const phase: 'before' | 'during' | 'after' =
    today < config.hotWeek.start ? 'before'
    : today <= config.hotWeek.end ? 'during'
    : 'after';

  return (
    <div className="min-h-screen bg-slate-50">
      {/* ─── Header ─────────────────────────────────────────────────────── */}
      <header className="bg-gradient-to-r from-orange-500 via-rose-500 to-pink-600 text-white">
        <div className="max-w-7xl mx-auto px-6 py-10">
          <div className="flex items-center gap-3 mb-3">
            <div className="bg-white/20 backdrop-blur-sm p-2 rounded-lg">
              <Flame size={20} />
            </div>
            <span className="text-xs font-semibold uppercase tracking-wider opacity-90">Informe Hot Sale 2026 · Andesmar</span>
          </div>
          <h1 className="text-3xl md:text-4xl font-bold tracking-tight mb-2">
            {phase === 'before' && 'El Hot Sale arranca pronto'}
            {phase === 'during' && 'Hot Sale en curso'}
            {phase === 'after' && 'Cierre del Hot Sale 2026'}
          </h1>
          <p className="text-base md:text-lg opacity-90">
            Semana base <strong>{formatRange(config.weekBase)}</strong> vs Hot Week <strong>{formatRange(config.hotWeek)}</strong>
            {' · '}YoY contra Hot Week 2025 <strong>{formatRange(config.hotWeek2025)}</strong>
          </p>
          <div className="text-xs opacity-75 mt-3">
            Actualizado {formatDateTime(data.generatedAt)} · refresca solo la página para ver la última data
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-6 py-10 space-y-14">
        {phase === 'before' && (
          <Banner
            tone="amber"
            title="El Hot Sale todavía no empezó"
            text={`Esta página se actualiza cada hora. La data del 11-17 de mayo aparecerá automáticamente a medida que las campañas vayan corriendo. Mientras tanto, abajo ya podés ver la semana base (${formatRange(config.weekBase)}) en construcción.`}
          />
        )}

        {/* ═══════════════════════════════════════════════════════════════
            SECCIÓN 1 — Comparativa semana base vs Hot Week
            ═══════════════════════════════════════════════════════════════ */}
        <section className="space-y-6">
          <SectionHeader
            number={1}
            title="Semana base vs Hot Week"
            subtitle={`Comparativa entre ${formatRange(config.weekBase)} (semana previa al evento) y ${formatRange(config.hotWeek)} (Hot Week completa)`}
          />

          {/* KPIs hero — totales */}
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
            <KpiCard label="Inversión"  base={weekly.base.total.spend}     hot={weekly.hotWeek.total.spend}     fmt="currency" invertColor />
            <KpiCard label="Ingresos"   base={weekly.base.total.revenue}   hot={weekly.hotWeek.total.revenue}   fmt="currency" />
            <KpiCard label="Compras"    base={weekly.base.total.purchases} hot={weekly.hotWeek.total.purchases} fmt="number" />
            <KpiCard label="Por cada $1" base={weekly.base.total.roas}     hot={weekly.hotWeek.total.roas}      fmt="roas" suffix="" />
            <KpiCard label="CPA"        base={weekly.base.total.cpa}       hot={weekly.hotWeek.total.cpa}       fmt="currency" invertColor />
            <KpiCard label="Ticket prom." base={weekly.base.total.aov}     hot={weekly.hotWeek.total.aov}       fmt="currency" />
          </div>

          {/* Por canal */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <ChannelCompareCard label="Meta Ads"   base={weekly.base.meta}   hot={weekly.hotWeek.meta}   color="blue" />
            <ChannelCompareCard label="Google Ads" base={weekly.base.google} hot={weekly.hotWeek.google} color="emerald" />
          </div>

          {/* Curva diaria */}
          <Card className="p-6">
            <div className="mb-4">
              <h3 className="text-base font-bold text-slate-900">Curva diaria — 14 días</h3>
              <p className="text-xs text-slate-500 mt-1">Ingresos por día. La franja resaltada es la Hot Week.</p>
            </div>
            <DailyCurveChart daily={weekly.daily} hotWeek={config.hotWeek} />
          </Card>

          {/* Top rutas / destinos (data REAL de GA4) */}
          <Card className="p-6">
            <div className="mb-4 flex items-center gap-2">
              <MapPin size={18} className="text-slate-500" />
              <div>
                <h3 className="text-base font-bold text-slate-900">Top destinos vendidos durante la Hot Week</h3>
                <p className="text-xs text-slate-500 mt-1">Rutas con más revenue según Google Analytics (data real de ecommerce, no inferida)</p>
              </div>
            </div>
            <RoutesTable routes={weekly.routes.hotWeek} baseRoutes={weekly.routes.base} totals={weekly.routes.hotWeekTotals} />
          </Card>

          {/* Origen del tráfico (Paid Search, Paid Social, Direct, etc.) */}
          <Card className="p-6">
            <div className="mb-4 flex items-center gap-2">
              <Globe size={18} className="text-slate-500" />
              <div>
                <h3 className="text-base font-bold text-slate-900">De dónde vinieron las ventas — Hot Week</h3>
                <p className="text-xs text-slate-500 mt-1">Mix de canales según Google Analytics: pauta, orgánico, directo, referidos, etc.</p>
              </div>
            </div>
            <ChannelsTable channels={weekly.channels} />
          </Card>

          {/* Top creatives Meta */}
          <Card className="p-6">
            <div className="mb-4 flex items-center gap-2">
              <ImageIcon size={18} className="text-slate-500" />
              <div>
                <h3 className="text-base font-bold text-slate-900">Top creatives Meta — Hot Week</h3>
                <p className="text-xs text-slate-500 mt-1">Las piezas que más vendieron durante el evento</p>
              </div>
            </div>
            <CreativesGrid creatives={weekly.creatives} />
          </Card>

          {/* Top campañas (Meta + Google) */}
          <Card className="p-6">
            <div className="mb-4 flex items-center gap-2">
              <TrendingUp size={18} className="text-slate-500" />
              <div>
                <h3 className="text-base font-bold text-slate-900">Campañas que más vendieron — Hot Week</h3>
                <p className="text-xs text-slate-500 mt-1">Top campañas Meta + Google ordenadas por revenue durante el evento</p>
              </div>
            </div>
            <CampaignsTable campaigns={weekly.campaigns} />
          </Card>
        </section>

        {/* ═══════════════════════════════════════════════════════════════
            SECCIÓN 2 — YoY Hot Week 2025 vs 2026
            ═══════════════════════════════════════════════════════════════ */}
        <section className="space-y-6">
          <SectionHeader
            number={2}
            title="Año a año — Hot Week 2025 vs 2026"
            subtitle={`Comparativa apples-to-apples: ${formatRange(config.hotWeek2025)} (lun-dom 2025) vs ${formatRange(config.hotWeek)} (lun-dom 2026). Solo Meta + Google Ads.`}
          />

          {/* KPIs YoY total */}
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
            <KpiCard label="Inversión"  base={yoy.hs2025.total.spend}     hot={yoy.hs2026.total.spend}     fmt="currency" baseLabel="2025" hotLabel="2026" invertColor />
            <KpiCard label="Ingresos"   base={yoy.hs2025.total.revenue}   hot={yoy.hs2026.total.revenue}   fmt="currency" baseLabel="2025" hotLabel="2026" />
            <KpiCard label="Compras"    base={yoy.hs2025.total.purchases} hot={yoy.hs2026.total.purchases} fmt="number"   baseLabel="2025" hotLabel="2026" />
            <KpiCard label="Por cada $1" base={yoy.hs2025.total.roas}     hot={yoy.hs2026.total.roas}      fmt="roas"     baseLabel="2025" hotLabel="2026" suffix="" />
            <KpiCard label="CPA"        base={yoy.hs2025.total.cpa}       hot={yoy.hs2026.total.cpa}       fmt="currency" baseLabel="2025" hotLabel="2026" invertColor />
            <KpiCard label="Ticket prom." base={yoy.hs2025.total.aov}     hot={yoy.hs2026.total.aov}       fmt="currency" baseLabel="2025" hotLabel="2026" />
          </div>

          {/* Por canal */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <ChannelCompareCard label="Meta Ads"   base={yoy.hs2025.meta}   hot={yoy.hs2026.meta}   color="blue"    baseLabel="HS 2025" hotLabel="HS 2026" />
            <ChannelCompareCard label="Google Ads" base={yoy.hs2025.google} hot={yoy.hs2026.google} color="emerald" baseLabel="HS 2025" hotLabel="HS 2026" />
          </div>

          {/* Mix de canal */}
          <Card className="p-6">
            <div className="mb-4">
              <h3 className="text-base font-bold text-slate-900">Mix de canal año a año</h3>
              <p className="text-xs text-slate-500 mt-1">Qué porcentaje del spend e ingresos aportó cada canal en cada año</p>
            </div>
            <MixCompare mix2025={yoy.mix['2025']} mix2026={yoy.mix['2026']} />
          </Card>
        </section>

        {/* ═══════════════════════════════════════════════════════════════
            SECCIÓN 3 — Heat-map + Demografía
            ═══════════════════════════════════════════════════════════════ */}
        <section className="space-y-6">
          <SectionHeader
            number={3}
            title="Cuándo y a quién le vendiste"
            subtitle="Heat-map hora×día durante la Hot Week y perfil demográfico del comprador"
          />

          {/* Heat-map hora×día */}
          <Card className="p-6">
            <div className="mb-4 flex items-center gap-2">
              <Clock size={18} className="text-slate-500" />
              <div>
                <h3 className="text-base font-bold text-slate-900">Heat-map hora×día — Hot Week</h3>
                <p className="text-xs text-slate-500 mt-1">
                  Cuándo se vendió más durante el evento.
                  <strong className="text-emerald-700"> Verde</strong> = el peso volvió multiplicado.
                  <strong className="text-amber-700"> Amarillo</strong> = a la par.
                  <strong className="text-orange-700"> Naranja</strong> = bajo retorno.
                </p>
              </div>
            </div>
            {heatmap.cells.length === 0 ? (
              <div className="text-sm text-slate-500 py-12 text-center bg-slate-50 rounded-lg">
                Aún no hay datos de hora×día durante la Hot Week. Aparecerán automáticamente cuando arranque el evento.
              </div>
            ) : (
              <>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mb-5">
                  {heatmap.topVolumeSlot && <HeatSlotCard title="Cuándo más vendiste" slot={heatmap.topVolumeSlot} tone="emerald" metric="revenue" />}
                  {heatmap.bestEfficiencySlot && <HeatSlotCard title="Mejor rendimiento" slot={heatmap.bestEfficiencySlot} tone="violet" metric="efficiency" />}
                  {heatmap.worstEfficiencySlot && <HeatSlotCard title="Donde menos rindió" slot={heatmap.worstEfficiencySlot} tone="orange" metric="efficiency" />}
                </div>
                <HeatGrid cells={heatmap.cells} threshold={heatmap.minSpendThreshold} />
              </>
            )}
          </Card>

          {/* Demografía */}
          <Card className="p-6">
            <div className="mb-4 flex items-center gap-2">
              <Users size={18} className="text-slate-500" />
              <div>
                <h3 className="text-base font-bold text-slate-900">Perfil del comprador — Hot Week</h3>
                <p className="text-xs text-slate-500 mt-1">Edad, género, región y placement más eficientes durante el evento (Meta)</p>
              </div>
            </div>
            <DemographicsBlock demo={demographics} />
          </Card>
        </section>

        <footer className="text-center text-xs text-slate-400 pt-8 pb-4 border-t border-slate-200">
          Veta Analytics · Informe Hot Sale 2026 · Generado {formatDateTime(data.generatedAt)}
        </footer>
      </main>
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════════
// SUB-COMPONENTES
// ════════════════════════════════════════════════════════════════════════

function FullScreenStatus({ title, subtitle, isError }: { title: string; subtitle: string; isError?: boolean }) {
  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-50 px-6">
      <div className={cn("max-w-md text-center p-8 rounded-2xl border", isError ? "bg-red-50 border-red-200" : "bg-white border-slate-200")}>
        <div className={cn("inline-flex items-center justify-center w-12 h-12 rounded-xl mb-4", isError ? "bg-red-100 text-red-600" : "bg-slate-100 text-slate-600")}>
          <Flame size={22} />
        </div>
        <h1 className={cn("text-xl font-bold mb-2", isError ? "text-red-900" : "text-slate-900")}>{title}</h1>
        {subtitle && <p className="text-sm text-slate-500">{subtitle}</p>}
      </div>
    </div>
  );
}

function Banner({ tone, title, text }: { tone: 'amber' | 'emerald'; title: string; text: string }) {
  const styles = tone === 'amber'
    ? 'bg-amber-50 border-amber-200 text-amber-900'
    : 'bg-emerald-50 border-emerald-200 text-emerald-900';
  return (
    <div className={cn("p-5 rounded-xl border", styles)}>
      <div className="font-bold text-sm mb-1">{title}</div>
      <div className="text-sm opacity-90">{text}</div>
    </div>
  );
}

function SectionHeader({ number, title, subtitle }: { number: number; title: string; subtitle: string }) {
  return (
    <div className="flex items-start gap-4 border-b border-slate-200 pb-5">
      <div className="shrink-0 w-10 h-10 rounded-xl bg-slate-900 text-white flex items-center justify-center font-bold tabular-nums">
        {number}
      </div>
      <div>
        <h2 className="text-2xl font-bold tracking-tight text-slate-900">{title}</h2>
        <p className="text-sm text-slate-500 mt-1">{subtitle}</p>
      </div>
    </div>
  );
}

function KpiCard({
  label, base, hot, fmt, suffix = '', invertColor = false, baseLabel = 'Base', hotLabel = 'Hot Week',
}: {
  label: string;
  base: number; hot: number;
  fmt: 'currency' | 'number' | 'roas';
  suffix?: string;
  invertColor?: boolean;
  baseLabel?: string;
  hotLabel?: string;
}) {
  const fmtFn = fmt === 'currency' ? formatCurrency : fmt === 'number' ? formatNumber : (n: number) => `$${n.toFixed(2)}`;
  const hotIsEmpty = hot === 0 && base > 0;

  // Si Hot Week aún no tiene data, mostrar la Semana Base como protagonista
  const bigValue   = hotIsEmpty ? base : hot;
  const bigLabel   = hotIsEmpty ? baseLabel : hotLabel;
  const smallValue = hotIsEmpty ? hot : base;
  const smallLabel = hotIsEmpty ? hotLabel : baseLabel;

  const bothHaveData = base > 0 && hot > 0;
  const delta = bothHaveData ? (hot - base) / base : 0;
  const isPositive = invertColor ? delta < 0 : delta > 0;
  const Arrow = delta >= 0 ? ArrowUpRight : ArrowDownRight;

  return (
    <Card className="p-4">
      <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-500 mb-2">{label}</div>
      <div className="flex items-baseline justify-between gap-2">
        <div className="text-xl font-bold text-slate-900 tabular-nums">{fmtFn(bigValue)}{suffix}</div>
        {bothHaveData ? (
          <div className={cn("flex items-center gap-0.5 text-xs font-bold rounded px-1.5 py-0.5",
            isPositive ? "text-emerald-700 bg-emerald-50" : "text-rose-700 bg-rose-50"
          )}>
            <Arrow size={12} />
            {Math.abs(delta * 100).toFixed(0)}%
          </div>
        ) : (
          <div className="text-[10px] font-semibold rounded px-1.5 py-0.5 text-amber-700 bg-amber-50 whitespace-nowrap">
            {hotIsEmpty ? 'pendiente' : 'sin data'}
          </div>
        )}
      </div>
      <div className="mt-2 pt-2 border-t border-slate-100 flex justify-between text-[11px] text-slate-400">
        <span className="truncate">
          {smallLabel}: {hotIsEmpty ? <span className="italic">aún no comenzó</span> : fmtFn(smallValue)}
        </span>
        <span className="font-semibold text-slate-600 shrink-0">{bigLabel}</span>
      </div>
    </Card>
  );
}

function ChannelCompareCard({ label, base, hot, color, baseLabel = 'Semana base', hotLabel = 'Hot Week' }: {
  label: string;
  base: ChannelKpis; hot: ChannelKpis;
  color: 'blue' | 'emerald';
  baseLabel?: string;
  hotLabel?: string;
}) {
  const colorClass = color === 'blue' ? 'text-blue-700 bg-blue-50' : 'text-emerald-700 bg-emerald-50';
  const dot = color === 'blue' ? 'bg-blue-500' : 'bg-emerald-500';
  // Si el spend del Hot Week es 0 y el de la Base > 0, todo el card se invierte
  // (la Base se vuelve la columna principal y Hot Week aparece como pendiente).
  const hotIsEmpty = hot.spend === 0 && base.spend > 0;
  return (
    <Card className="p-5">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <span className={cn("w-2 h-2 rounded-full", dot)} />
          <h3 className="text-base font-bold text-slate-900">{label}</h3>
        </div>
        {hotIsEmpty ? (
          <span className="text-[10px] font-bold px-2 py-0.5 rounded uppercase text-amber-700 bg-amber-50">{hotLabel} pendiente</span>
        ) : (
          <span className={cn("text-[10px] font-bold px-2 py-0.5 rounded uppercase", colorClass)}>{label.split(' ')[0]}</span>
        )}
      </div>
      <div className="grid grid-cols-12 gap-2 items-center pb-2 border-b border-slate-200 text-[10px] font-semibold uppercase tracking-wider text-slate-400">
        <div className="col-span-4">Métrica</div>
        <div className="col-span-3 text-right">{hotIsEmpty ? hotLabel : baseLabel}</div>
        <div className="col-span-3 text-right">{hotIsEmpty ? baseLabel : hotLabel}</div>
        <div className="col-span-2 text-right">vs</div>
      </div>
      <div className="space-y-2 text-sm pt-2">
        <CompareRow label="Inversión"   base={base.spend}     hot={hot.spend}     fmt="currency" hotIsEmpty={hotIsEmpty} invertColor />
        <CompareRow label="Ingresos"    base={base.revenue}   hot={hot.revenue}   fmt="currency" hotIsEmpty={hotIsEmpty} />
        <CompareRow label="Compras"     base={base.purchases} hot={hot.purchases} fmt="number"   hotIsEmpty={hotIsEmpty} />
        <CompareRow label="Por cada $1" base={base.roas}      hot={hot.roas}      fmt="roas"     hotIsEmpty={hotIsEmpty} />
        <CompareRow label="CPA"         base={base.cpa}       hot={hot.cpa}       fmt="currency" hotIsEmpty={hotIsEmpty} invertColor />
      </div>
    </Card>
  );
}

function CompareRow({ label, base, hot, fmt, hotIsEmpty, invertColor = false }: {
  label: string; base: number; hot: number;
  fmt: 'currency' | 'number' | 'roas';
  hotIsEmpty: boolean;
  invertColor?: boolean;
}) {
  const fmtFn = fmt === 'currency' ? formatCurrency : fmt === 'number' ? formatNumber : (n: number) => `$${n.toFixed(2)}`;
  const bothHaveData = base > 0 && hot > 0;
  const delta = bothHaveData ? (hot - base) / base : 0;
  const isPositive = invertColor ? delta < 0 : delta > 0;

  // Cuando Hot Week está vacío, la columna principal pasa a ser la Base
  const leftValue  = hotIsEmpty ? hot : base;
  const rightValue = hotIsEmpty ? base : hot;
  const leftIsEmpty = hotIsEmpty && hot === 0;

  return (
    <div className="grid grid-cols-12 gap-2 items-center py-1.5 border-b border-slate-50 last:border-0">
      <div className="col-span-4 text-xs font-medium text-slate-500">{label}</div>
      <div className="col-span-3 text-right text-xs text-slate-400 tabular-nums">
        {leftIsEmpty ? <span className="italic">—</span> : fmtFn(leftValue)}
      </div>
      <div className="col-span-3 text-right text-sm font-bold text-slate-900 tabular-nums">{fmtFn(rightValue)}</div>
      <div className={cn("col-span-2 text-right text-xs font-bold tabular-nums",
        bothHaveData ? (isPositive ? "text-emerald-700" : "text-rose-700") : "text-amber-700"
      )}>
        {bothHaveData ? `${delta >= 0 ? '+' : ''}${(delta * 100).toFixed(0)}%` : (hotIsEmpty ? 'pend.' : '—')}
      </div>
    </div>
  );
}

function DailyCurveChart({ daily, hotWeek }: { daily: DailyPoint[]; hotWeek: { start: string; end: string } }) {
  if (daily.length === 0) {
    return <div className="py-12 text-center text-sm text-slate-400 bg-slate-50 rounded-lg">Sin datos diarios para graficar todavía.</div>;
  }
  const chartData = daily.map(d => ({ ...d, dateLabel: d.date.slice(8, 10) + '/' + d.date.slice(5, 7) }));
  return (
    <div className="h-72">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={chartData} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
          <ReferenceArea x1={chartData.find(d => d.date === hotWeek.start)?.dateLabel}
                         x2={chartData.find(d => d.date === hotWeek.end)?.dateLabel}
                         fill="#fb923c" fillOpacity={0.08} label={{ value: 'Hot Week', position: 'insideTop', fill: '#c2410c', fontSize: 11, fontWeight: 600 }} />
          <XAxis dataKey="dateLabel" tick={{ fontSize: 11, fill: '#64748b' }} axisLine={{ stroke: '#e2e8f0' }} tickLine={false} />
          <YAxis yAxisId="money" tick={{ fontSize: 11, fill: '#64748b' }} axisLine={false} tickLine={false} tickFormatter={(v) => formatCompact(v)} />
          <YAxis yAxisId="purchases" orientation="right" tick={{ fontSize: 11, fill: '#8b5cf6' }} axisLine={false} tickLine={false} tickFormatter={(v) => formatNumber(v)} />
          <Tooltip
            formatter={(value: number, name: string) => {
              if (name === 'Compras') return [formatNumber(value), name];
              return [formatCurrency(value), name];
            }}
            labelFormatter={(label) => `Día ${label}`}
            contentStyle={{ borderRadius: 8, border: '1px solid #e2e8f0', fontSize: 12 }}
          />
          <Legend wrapperStyle={{ fontSize: 11 }} />
          <Line yAxisId="money"     type="monotone" dataKey="revenue"   name="Ingresos"  stroke="#10b981" strokeWidth={2.5} dot={{ r: 3 }} activeDot={{ r: 5 }} />
          <Line yAxisId="money"     type="monotone" dataKey="spend"     name="Inversión" stroke="#f97316" strokeWidth={2}   dot={{ r: 2 }} />
          <Line yAxisId="purchases" type="monotone" dataKey="purchases" name="Compras"   stroke="#8b5cf6" strokeWidth={2}   dot={{ r: 2 }} strokeDasharray="4 2" />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

function ChannelsTable({ channels }: { channels: Channel[] }) {
  if (channels.length === 0) {
    return <div className="py-8 text-center text-sm text-slate-400">Aún no hay datos de tráfico por canal en la Hot Week.</div>;
  }
  const totalRev = channels.reduce((s, c) => s + c.revenue, 0);
  const totalSessions = channels.reduce((s, c) => s + c.sessions, 0);
  const totalItems = channels.reduce((s, c) => s + c.items, 0);
  const maxRev = Math.max(...channels.map(c => c.revenue), 1);

  // Colores por tipo de canal — paid en naranjas/azules, orgánico en verdes, directo en gris
  function colorFor(channel: string): { bar: string; pill: string } {
    const c = channel.toLowerCase();
    if (c.includes('paid search'))   return { bar: 'bg-orange-500', pill: 'text-orange-700 bg-orange-50' };
    if (c.includes('paid social'))   return { bar: 'bg-blue-500',   pill: 'text-blue-700 bg-blue-50'     };
    if (c.includes('display'))       return { bar: 'bg-pink-500',   pill: 'text-pink-700 bg-pink-50'     };
    if (c.includes('organic search'))return { bar: 'bg-emerald-500',pill: 'text-emerald-700 bg-emerald-50' };
    if (c.includes('organic social'))return { bar: 'bg-teal-500',   pill: 'text-teal-700 bg-teal-50'     };
    if (c.includes('direct'))        return { bar: 'bg-slate-500',  pill: 'text-slate-700 bg-slate-100'  };
    if (c.includes('referral'))      return { bar: 'bg-purple-500', pill: 'text-purple-700 bg-purple-50' };
    if (c.includes('email'))         return { bar: 'bg-amber-500',  pill: 'text-amber-700 bg-amber-50'   };
    return                                  { bar: 'bg-slate-400',  pill: 'text-slate-600 bg-slate-100'  };
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-slate-200 text-xs text-slate-500 uppercase">
            <th className="text-left py-2 font-semibold">Canal</th>
            <th className="text-right py-2 font-semibold">Sesiones</th>
            <th className="text-right py-2 font-semibold">Pasajes</th>
            <th className="text-right py-2 font-semibold">Ingresos</th>
            <th className="py-2 font-semibold pl-4 w-1/3">% del revenue</th>
          </tr>
        </thead>
        <tbody>
          {channels.map(c => {
            const share = totalRev > 0 ? c.revenue / totalRev : 0;
            const widthPct = (c.revenue / maxRev) * 100;
            const color = colorFor(c.channel);
            return (
              <tr key={c.channel} className="border-b border-slate-50 last:border-0 hover:bg-slate-50/50">
                <td className="py-2.5">
                  <span className={cn("text-[11px] font-bold px-2 py-0.5 rounded uppercase", color.pill)}>{c.channel}</span>
                </td>
                <td className="py-2.5 text-right tabular-nums text-slate-600">{formatNumber(c.sessions)}</td>
                <td className="py-2.5 text-right tabular-nums text-slate-600">{formatNumber(c.items)}</td>
                <td className="py-2.5 text-right tabular-nums font-semibold text-slate-900">{formatCurrency(c.revenue)}</td>
                <td className="py-2.5 pl-4">
                  <div className="flex items-center gap-2">
                    <div className="flex-1 h-2.5 bg-slate-100 rounded-full overflow-hidden">
                      <div className={cn("h-full rounded-full transition-all", color.bar)} style={{ width: `${widthPct}%` }} />
                    </div>
                    <span className="text-xs font-bold tabular-nums text-slate-700 w-12 text-right">{(share * 100).toFixed(0)}%</span>
                  </div>
                </td>
              </tr>
            );
          })}
          <tr className="border-t-2 border-slate-300 font-bold">
            <td className="py-3 text-slate-900">Total</td>
            <td className="py-3 text-right tabular-nums text-slate-900">{formatNumber(totalSessions)}</td>
            <td className="py-3 text-right tabular-nums text-slate-900">{formatNumber(totalItems)}</td>
            <td className="py-3 text-right tabular-nums text-slate-900">{formatCurrency(totalRev)}</td>
            <td className="py-3 pl-4 text-slate-500 text-xs">100%</td>
          </tr>
        </tbody>
      </table>
    </div>
  );
}

type RouteSort = 'revenue' | 'items' | 'delta' | 'avgPrice';
const ROUTE_SORT_LABELS: Record<RouteSort, string> = {
  revenue:  'Facturación',
  items:    'Cantidad de pasajes',
  delta:    'Crecimiento vs base',
  avgPrice: 'Precio promedio',
};

function RoutesTable({ routes, baseRoutes, totals }: {
  routes: Route[];
  baseRoutes: Route[];
  totals: { routesCount: number; revenue: number; items: number };
}) {
  const [sort, setSort] = useState<RouteSort>('revenue');

  if (routes.length === 0) {
    return <div className="py-8 text-center text-sm text-slate-400">Aún no hay rutas vendidas durante la Hot Week.</div>;
  }
  const baseMap = new Map(baseRoutes.map(r => [r.route, r]));

  const enriched = routes.map(r => {
    const base = baseMap.get(r.route);
    const baseRev = base?.revenue ?? 0;
    const bothHaveData = baseRev > 0 && r.revenue > 0;
    const delta = bothHaveData ? (r.revenue - baseRev) / baseRev : null;
    const avgPrice = r.items > 0 ? r.revenue / r.items : 0;
    return { ...r, baseRev, delta, avgPrice };
  });

  const sorted = [...enriched].sort((a, b) => {
    if (sort === 'revenue')  return b.revenue - a.revenue;
    if (sort === 'items')    return b.items - a.items;
    if (sort === 'avgPrice') return b.avgPrice - a.avgPrice;
    const ad = a.delta ?? -Infinity;
    const bd = b.delta ?? -Infinity;
    return bd - ad;
  }).slice(0, 12);

  // Totales del top 12 visible (para "Otras" y el footer)
  const topRevenue = sorted.reduce((s, r) => s + r.revenue, 0);
  const topItems   = sorted.reduce((s, r) => s + r.items, 0);
  const otrasRevenue = Math.max(0, totals.revenue - topRevenue);
  const otrasItems   = Math.max(0, totals.items - topItems);
  const otrasCount   = Math.max(0, totals.routesCount - sorted.length);
  const otrasAvg     = otrasItems > 0 ? otrasRevenue / otrasItems : 0;
  const revenueShare = totals.revenue > 0 ? topRevenue / totals.revenue : 0;
  const itemsShare   = totals.items   > 0 ? topItems   / totals.items   : 0;

  return (
    <div>
      <div className="flex items-center gap-2 mb-3 flex-wrap">
        <span className="text-xs text-slate-500 font-medium">Ordenar por:</span>
        <div className="flex items-center gap-1 bg-slate-100 rounded-lg p-1">
          {(Object.keys(ROUTE_SORT_LABELS) as RouteSort[]).map(s => (
            <button
              key={s}
              onClick={() => setSort(s)}
              className={cn(
                "px-3 py-1 text-xs font-semibold rounded-md transition-all",
                sort === s ? "bg-white text-slate-900 shadow-sm" : "text-slate-500 hover:text-slate-700"
              )}
            >
              {ROUTE_SORT_LABELS[s]}
            </button>
          ))}
        </div>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-slate-200 text-xs text-slate-500 uppercase">
              <th className="text-left py-2 font-semibold">Ruta / destino</th>
              <th className="text-right py-2 font-semibold">Ingresos</th>
              <th className="text-right py-2 font-semibold">Pasajes</th>
              <th className="text-right py-2 font-semibold">Precio prom.</th>
              <th className="text-right py-2 font-semibold">vs semana base</th>
            </tr>
          </thead>
          <tbody>
            {sorted.map(r => (
              <tr key={r.route} className="border-b border-slate-50 last:border-0 hover:bg-slate-50/50">
                <td className="py-2.5 font-medium text-slate-800">{r.route}</td>
                <td className="py-2.5 text-right tabular-nums font-semibold text-slate-900">{formatCurrency(r.revenue)}</td>
                <td className="py-2.5 text-right tabular-nums text-slate-600">{formatNumber(r.items)}</td>
                <td className="py-2.5 text-right tabular-nums text-slate-500 text-xs">{formatCurrency(r.avgPrice)}</td>
                <td className={cn("py-2.5 text-right tabular-nums text-xs font-bold",
                  r.delta === null ? "text-slate-400" : r.delta >= 0 ? "text-emerald-600" : "text-rose-600"
                )}>
                  {r.delta !== null
                    ? `${r.delta >= 0 ? '+' : ''}${(r.delta * 100).toFixed(0)}%`
                    : r.baseRev === 0 ? 'nueva' : '—'}
                </td>
              </tr>
            ))}
            {otrasCount > 0 && (
              <tr className="border-b border-slate-100 bg-slate-50/50 italic">
                <td className="py-2.5 font-medium text-slate-500">Otras ({formatNumber(otrasCount)} rutas)</td>
                <td className="py-2.5 text-right tabular-nums text-slate-600">{formatCurrency(otrasRevenue)}</td>
                <td className="py-2.5 text-right tabular-nums text-slate-500">{formatNumber(otrasItems)}</td>
                <td className="py-2.5 text-right tabular-nums text-slate-400 text-xs">{otrasItems > 0 ? formatCurrency(otrasAvg) : '—'}</td>
                <td className="py-2.5 text-right tabular-nums text-xs text-slate-400">—</td>
              </tr>
            )}
            <tr className="border-t-2 border-slate-300 font-bold">
              <td className="py-3 text-slate-900">Total Hot Week ({formatNumber(totals.routesCount)} rutas)</td>
              <td className="py-3 text-right tabular-nums text-slate-900">{formatCurrency(totals.revenue)}</td>
              <td className="py-3 text-right tabular-nums text-slate-900">{formatNumber(totals.items)}</td>
              <td className="py-3 text-right tabular-nums text-slate-500 text-xs">
                {totals.items > 0 ? formatCurrency(totals.revenue / totals.items) : '—'}
              </td>
              <td className="py-3"></td>
            </tr>
          </tbody>
        </table>
      </div>

      <div className="mt-3 text-[11px] text-slate-500 italic">
        El top 12 visible representa <strong className="text-slate-700">{(revenueShare * 100).toFixed(0)}%</strong> del revenue
        y <strong className="text-slate-700">{(itemsShare * 100).toFixed(0)}%</strong> de los pasajes vendidos en toda la Hot Week.
      </div>
    </div>
  );
}

function CreativesGrid({ creatives }: { creatives: Creative[] }) {
  if (creatives.length === 0) {
    return <div className="py-8 text-center text-sm text-slate-400">Aún no hay creatives con data en la Hot Week.</div>;
  }
  return (
    <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6 gap-2">
      {creatives.map(c => (
        <div key={c.adId} className="border border-slate-100 rounded-lg overflow-hidden bg-white hover:shadow-md transition-shadow">
          <div className="aspect-square bg-slate-100 relative">
            {c.thumbnailUrl ? (
              <img src={c.thumbnailUrl} alt={c.adName} className="w-full h-full object-cover" loading="lazy" />
            ) : (
              <div className="w-full h-full flex items-center justify-center text-slate-300">
                <ImageIcon size={24} />
              </div>
            )}
            <div className={cn(
              "absolute top-1 right-1 text-[9px] font-bold px-1 py-0.5 rounded",
              c.roas >= 3 ? "bg-emerald-500 text-white" :
              c.roas >= 1.5 ? "bg-amber-500 text-white" :
              "bg-slate-700 text-white"
            )}>
              ${c.roas.toFixed(1)}x
            </div>
          </div>
          <div className="p-2">
            <div className="text-[11px] font-semibold text-slate-900 line-clamp-2 mb-1 leading-tight" title={c.adName}>
              {c.adName || 'Sin nombre'}
            </div>
            <div className="text-[9px] text-slate-400 line-clamp-1 mb-1 leading-tight" title={c.campaignName}>
              {c.campaignName}
            </div>
            <div className="text-[9px] text-slate-500 pt-1.5 border-t border-slate-50 leading-tight">
              {formatCompact(c.revenue)} · {formatNumber(c.purchases)} compras
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

function CampaignsTable({ campaigns }: { campaigns: Campaign[] }) {
  if (campaigns.length === 0) {
    return <div className="py-8 text-center text-sm text-slate-400">Aún no hay campañas con data en la Hot Week.</div>;
  }
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-slate-200 text-xs text-slate-500 uppercase">
            <th className="text-left py-2 font-semibold">Campaña</th>
            <th className="text-left py-2 font-semibold">Canal</th>
            <th className="text-right py-2 font-semibold">Inversión</th>
            <th className="text-right py-2 font-semibold">Ingresos</th>
            <th className="text-right py-2 font-semibold">Compras</th>
            <th className="text-right py-2 font-semibold">Por $1</th>
          </tr>
        </thead>
        <tbody>
          {campaigns.map((c, i) => (
            <tr key={i} className="border-b border-slate-50 last:border-0 hover:bg-slate-50/50">
              <td className="py-2 font-medium text-slate-800 max-w-md truncate" title={c.name}>{c.name}</td>
              <td className="py-2">
                <span className={cn("text-[10px] font-bold px-1.5 py-0.5 rounded uppercase",
                  c.channel === 'Meta' ? "text-blue-700 bg-blue-50" : "text-emerald-700 bg-emerald-50"
                )}>{c.channel}</span>
              </td>
              <td className="py-2 text-right tabular-nums text-slate-600">{formatCurrency(c.spend)}</td>
              <td className="py-2 text-right tabular-nums font-semibold text-slate-900">{formatCurrency(c.revenue)}</td>
              <td className="py-2 text-right tabular-nums text-slate-600">{formatNumber(c.purchases)}</td>
              <td className={cn("py-2 text-right tabular-nums font-bold",
                c.roas >= 3 ? "text-emerald-700" : c.roas >= 1.5 ? "text-amber-700" : c.roas > 0 ? "text-orange-700" : "text-slate-400"
              )}>{c.roas > 0 ? `$${c.roas.toFixed(2)}` : '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function MixCompare({ mix2025, mix2026 }: { mix2025: any; mix2026: any }) {
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
      <MixYear year="2025" mix={mix2025} />
      <MixYear year="2026" mix={mix2026} />
    </div>
  );
}

function MixYear({ year, mix }: { year: string; mix: any }) {
  const metaSpend   = mix?.meta?.spendShare ?? 0;
  const googleSpend = mix?.google?.spendShare ?? 0;
  const metaRev     = mix?.meta?.revenueShare ?? 0;
  const googleRev   = mix?.google?.revenueShare ?? 0;
  return (
    <div>
      <div className="text-xs font-bold uppercase text-slate-500 mb-3">Hot Week {year}</div>
      <div className="space-y-3">
        <div>
          <div className="flex justify-between text-xs text-slate-500 mb-1">
            <span>Mix de inversión</span>
            <span className="font-semibold">Meta {(metaSpend*100).toFixed(0)}% · Google {(googleSpend*100).toFixed(0)}%</span>
          </div>
          <div className="flex h-3 rounded-full overflow-hidden bg-slate-100">
            <div className="bg-blue-500" style={{ width: `${metaSpend * 100}%` }} title={`Meta: ${(metaSpend*100).toFixed(1)}%`} />
            <div className="bg-emerald-500" style={{ width: `${googleSpend * 100}%` }} title={`Google: ${(googleSpend*100).toFixed(1)}%`} />
          </div>
        </div>
        <div>
          <div className="flex justify-between text-xs text-slate-500 mb-1">
            <span>Mix de ingresos</span>
            <span className="font-semibold">Meta {(metaRev*100).toFixed(0)}% · Google {(googleRev*100).toFixed(0)}%</span>
          </div>
          <div className="flex h-3 rounded-full overflow-hidden bg-slate-100">
            <div className="bg-blue-500" style={{ width: `${metaRev * 100}%` }} />
            <div className="bg-emerald-500" style={{ width: `${googleRev * 100}%` }} />
          </div>
        </div>
      </div>
    </div>
  );
}

function HeatGrid({ cells, threshold }: { cells: HeatCell[]; threshold: number }) {
  const matrix: (HeatCell | null)[][] = Array(7).fill(null).map(() => Array(24).fill(null));
  let maxRoas = 0;
  for (const c of cells) {
    matrix[c.dow][c.hour] = c;
    if (c.spend >= threshold && c.roas > maxRoas) maxRoas = c.roas;
  }
  return (
    <div className="overflow-x-auto">
      <div className="inline-block min-w-full">
        <div className="flex">
          <div className="w-12 shrink-0" />
          {Array.from({ length: 24 }, (_, h) => (
            <div key={h} className="w-7 text-center text-[9px] text-slate-400 font-semibold">
              {h % 3 === 0 ? h.toString().padStart(2, '0') : ''}
            </div>
          ))}
        </div>
        {DAY_LABELS_SHORT.map((label, dow) => (
          <div key={dow} className="flex items-center">
            <div className="w-12 shrink-0 text-xs font-semibold text-slate-600 pr-2">{label}</div>
            {Array.from({ length: 24 }, (_, hour) => {
              const cell = matrix[dow][hour];
              if (!cell || cell.spend < threshold * 0.1) {
                return <div key={hour} className="w-7 h-7 m-px bg-slate-50 border border-slate-100 rounded-sm" title="Sin pauta significativa" />;
              }
              const intensity = maxRoas > 0 ? Math.min(1, cell.roas / maxRoas) : 0;
              const bgColor = cell.roas >= 3   ? `rgba(16, 185, 129, ${0.3 + intensity * 0.7})`
                            : cell.roas >= 1.5 ? `rgba(245, 158, 11, ${0.3 + intensity * 0.7})`
                                               : `rgba(249, 115, 22, ${0.3 + intensity * 0.7})`;
              const tooltip = `${DAY_LABELS_LONG[dow]} ${hour.toString().padStart(2, '0')}:00\nInvertido: ${formatCurrency(cell.spend)}\nRevenue: ${formatCurrency(cell.revenue)}\nPor $1 → $${cell.roas.toFixed(2)}\n${cell.purchases} compras`;
              return <div key={hour} title={tooltip} className="w-7 h-7 m-px rounded-sm border border-white/50 cursor-help" style={{ backgroundColor: bgColor }} />;
            })}
          </div>
        ))}
      </div>
      <div className="text-[10px] text-slate-400 mt-3 italic">
        Solo se evalúan slots con inversión ≥ {formatCurrency(threshold)} (filtro anti-outliers).
      </div>
    </div>
  );
}

function HeatSlotCard({ title, slot, tone, metric }: {
  title: string; slot: HeatCell; tone: 'emerald' | 'violet' | 'orange'; metric: 'revenue' | 'efficiency';
}) {
  const styles = {
    emerald: { bg: 'bg-emerald-50/30 border-emerald-200', text: 'text-emerald-700' },
    violet:  { bg: 'bg-violet-50/30 border-violet-200',   text: 'text-violet-700'   },
    orange:  { bg: 'bg-orange-50/30 border-orange-200',   text: 'text-orange-700'   },
  }[tone];
  return (
    <div className={cn("p-4 rounded-xl border", styles.bg)}>
      <h4 className="text-xs font-bold text-slate-900 mb-2">{title}</h4>
      <div className="text-xl font-bold text-slate-900">
        {DAY_LABELS_LONG[slot.dow]} {slot.hour.toString().padStart(2, '0')}:00
      </div>
      {metric === 'revenue' ? (
        <>
          <div className={cn("text-sm font-bold mt-1", styles.text)}>{formatCurrency(slot.revenue)} ingresos</div>
          <div className="text-xs text-slate-500">{formatCurrency(slot.spend)} invertidos · {slot.purchases} compras</div>
        </>
      ) : (
        <>
          <div className={cn("text-sm font-bold mt-1", styles.text)}>Por $1 → ${slot.roas.toFixed(2)}</div>
          <div className="text-xs text-slate-500">{formatCurrency(slot.spend)} → {formatCurrency(slot.revenue)}</div>
        </>
      )}
    </div>
  );
}

function DemographicsBlock({ demo }: { demo: HotSaleData['demographics'] }) {
  const empty = !demo.age?.length && !demo.gender?.length && !demo.region?.length && !demo.placement?.length;
  if (empty) {
    return <div className="py-8 text-center text-sm text-slate-400">Aún no hay datos demográficos para la Hot Week.</div>;
  }
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
      <DemoBlock title="Edad" icon={<Users size={14} />} items={demo.age} />
      <DemoBlock title="Género" icon={<Users size={14} />} items={demo.gender} />
      <DemoBlock title="Región" icon={<MapPin size={14} />} items={demo.region} />
      <DemoBlock title="Placement" icon={<Smartphone size={14} />} items={demo.placement} />
    </div>
  );
}

function DemoBlock({ title, icon, items }: { title: string; icon: ReactNode; items: DemoItem[] }) {
  if (!items?.length) {
    return (
      <div>
        <div className="flex items-center gap-1.5 text-xs font-bold uppercase text-slate-500 mb-2">{icon} {title}</div>
        <div className="text-xs text-slate-400 italic">Sin datos</div>
      </div>
    );
  }
  const maxRev = Math.max(...items.map(i => i.revenue), 1);
  return (
    <div>
      <div className="flex items-center gap-1.5 text-xs font-bold uppercase text-slate-500 mb-3">{icon} {title}</div>
      <div className="space-y-1.5">
        {items.slice(0, 6).map((it, i) => (
          <div key={i} className="grid grid-cols-12 gap-2 items-center">
            <div className="col-span-3 text-xs font-medium text-slate-700 truncate" title={it.value}>{it.value}</div>
            <div className="col-span-5 h-2 bg-slate-100 rounded-full overflow-hidden">
              <div className={cn("h-full rounded-full",
                it.roas >= 3 ? "bg-emerald-500" : it.roas >= 1.5 ? "bg-amber-500" : "bg-orange-400"
              )} style={{ width: `${(it.revenue / maxRev) * 100}%` }} />
            </div>
            <div className="col-span-2 text-right text-xs font-semibold text-slate-700 tabular-nums">{formatCompact(it.revenue)}</div>
            <div className={cn("col-span-2 text-right text-xs font-bold tabular-nums",
              it.roas >= 3 ? "text-emerald-700" : it.roas >= 1.5 ? "text-amber-700" : it.roas > 0 ? "text-orange-700" : "text-slate-400"
            )}>{it.roas > 0 ? `$${it.roas.toFixed(1)}` : '—'}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════════
// HELPERS
// ════════════════════════════════════════════════════════════════════════

function formatRange(r: { start: string; end: string }) {
  const s = new Date(r.start + 'T00:00:00');
  const e = new Date(r.end + 'T00:00:00');
  const sd = s.getUTCDate();
  const ed = e.getUTCDate();
  const sm = MONTHS[s.getUTCMonth()];
  const em = MONTHS[e.getUTCMonth()];
  const sy = s.getUTCFullYear();
  const ey = e.getUTCFullYear();
  if (sy !== ey) return `${sd} ${sm} ${sy} → ${ed} ${em} ${ey}`;
  if (sm !== em) return `${sd} ${sm} → ${ed} ${em} ${ey}`;
  return `${sd}-${ed} ${sm} ${sy}`;
}
const MONTHS = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];

function formatDateTime(iso: string) {
  try {
    const d = new Date(iso);
    return d.toLocaleString('es-AR', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
  } catch { return iso; }
}

function formatCompact(n: number) {
  const abs = Math.abs(n);
  if (abs >= 1e6) return `$${(n / 1e6).toFixed(1)}M`;
  if (abs >= 1e3) return `$${(n / 1e3).toFixed(0)}K`;
  return `$${n.toFixed(0)}`;
}
