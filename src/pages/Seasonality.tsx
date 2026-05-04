import { useParams } from 'react-router-dom';
import { useState, useEffect } from 'react';
import { Clock, TrendingUp, DollarSign, Info, Calendar, CalendarDays, CalendarRange } from 'lucide-react';
import { formatCurrency, formatNumber, cn } from '@/lib/utils';
import { Card } from '@/components/ui/Card';
import { api, getClients } from '@/lib/api';
import { DateRangePicker, defaultRange } from '@/components/ui/DateRangePicker';
import type { DateRange } from '@/components/ui/DateRangePicker';

type Cell = { dow: number; hour: number; spend: number; purchases: number; revenue: number; roas: number };
type DowAgg = { dow: number; label: string; spend: number; revenue: number; purchases: number; roas: number; sampleSize: number };
type DomAgg = { day: number; spend: number; revenue: number; purchases: number; roas: number; sampleSize: number };
type PhaseAgg = { phase: string; spend: number; revenue: number; purchases: number; roas: number; sampleSize: number };
type HourAgg = { hour: number; spend: number; revenue: number; purchases: number; roas: number };
type SlotWithLabel = Cell & { dayLabel: string };

type SeasonalityData = {
  source: 'all' | 'meta' | 'google';
  cells: Cell[];
  hours: HourAgg[];
  dows: DowAgg[];
  daysOfMonth: DomAgg[];
  phases: PhaseAgg[];
  minSpendThreshold: number;
  topVolumeSlot: SlotWithLabel | null;
  bestEfficiencySlot: SlotWithLabel | null;
  worstEfficiencySlot: SlotWithLabel | null;
  bestDow: DowAgg | null;
  worstDow: DowAgg | null;
  bestDom: DomAgg | null;
  worstDom: DomAgg | null;
  bestPhase: PhaseAgg | null;
};

type Source = 'all' | 'meta' | 'google';
const DAY_LABELS = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'];
const SOURCE_LABELS: Record<Source, string> = { all: 'Meta + Google', meta: 'Solo Meta', google: 'Solo Google' };

export default function Seasonality() {
  const { clientSlug } = useParams();
  const [data, setData] = useState<SeasonalityData | null>(null);
  const [loading, setLoading] = useState(true);
  const [source, setSource] = useState<Source>('all');
  const [range, setRange] = useState<DateRange>(defaultRange());

  const allClients = getClients();
  const currentClient = allClients.find(c => c.slug === clientSlug) ?? { name: clientSlug ?? '' };

  useEffect(() => {
    if (!clientSlug) return;
    setLoading(true);
    api.seasonality(clientSlug, source, range.start, range.end)
      .then(d => setData(d))
      .finally(() => setLoading(false));
  }, [clientSlug, source, range]);

  if (loading) return <div className="p-8 text-slate-400 animate-pulse">Cargando estacionalidad...</div>;
  if (!data) return <div className="p-8 text-slate-500">Sin datos.</div>;

  // Heat-map matriz 7×24
  const matrix: (Cell | null)[][] = Array(7).fill(null).map(() => Array(24).fill(null));
  let maxRoas = 0;
  for (const c of data.cells) {
    matrix[c.dow][c.hour] = c;
    if (c.roas > maxRoas && c.spend >= data.minSpendThreshold) maxRoas = c.roas;
  }

  return (
    <div className="py-12 max-w-7xl mx-auto space-y-10 relative z-10">
      {/* Header con selector + fecha */}
      <div className="flex flex-col gap-4 border-b border-slate-200 pb-6">
        <div className="flex flex-col md:flex-row md:items-start justify-between gap-4">
          <div>
            <div className="flex items-center gap-2 text-sm text-slate-500 font-medium">
              <span className="hover:text-slate-900 cursor-pointer">{currentClient.name}</span>
              <span>/</span>
              <span className="text-slate-900">Estacionalidad</span>
            </div>
            <p className="text-xs text-slate-400 font-medium mt-1">¿Qué días del mes / días de semana / horas conviene pautar más?</p>
          </div>
          <DateRangePicker value={range} onChange={setRange} />
        </div>
        <div className="flex items-center gap-1 bg-slate-100 rounded-lg p-1 self-start">
          {(['all', 'meta', 'google'] as Source[]).map(s => (
            <button
              key={s}
              onClick={() => setSource(s)}
              className={cn(
                "px-3 py-1.5 text-xs font-semibold rounded-md transition-all",
                source === s ? "bg-white text-slate-900 shadow-sm" : "text-slate-500 hover:text-slate-700"
              )}
            >
              {SOURCE_LABELS[s]}
            </button>
          ))}
        </div>
      </div>

      {/* Por fase del mes — 3 cards principales */}
      <section>
        <h2 className="text-xl font-bold text-slate-900 tracking-tight mb-1">¿Cuándo del mes vendés más?</h2>
        <p className="text-sm text-slate-500 mb-4">Comparativa entre principio, mitad y fin de mes</p>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {data.phases.map(p => (
            <PhaseCard key={p.phase} phase={p} isBest={data.bestPhase?.phase === p.phase} />
          ))}
        </div>
      </section>

      {/* Por día del mes — barras 1-31 */}
      <section>
        <div className="flex items-baseline justify-between mb-4">
          <div>
            <h2 className="text-xl font-bold text-slate-900 tracking-tight">¿Qué día del mes vende mejor?</h2>
            <p className="text-sm text-slate-500 mt-1">Promedio histórico de cada día (1-31). Tamaño de barra = ingresos totales.</p>
          </div>
          {data.bestDom && (
            <div className="text-right text-sm">
              <div className="text-slate-500">Mejor día</div>
              <div className="font-bold text-slate-900">Día {data.bestDom.day} · {formatCurrency(data.bestDom.revenue)}</div>
            </div>
          )}
        </div>
        <Card className="p-6">
          <DayOfMonthChart days={data.daysOfMonth} />
        </Card>
      </section>

      {/* Best/worst day-of-week + summary */}
      {data.bestDow && data.worstDow && (
        <section>
          <h2 className="text-xl font-bold text-slate-900 tracking-tight mb-4">¿Qué día de la semana rinde mejor?</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
            <DayCard title="Mejor día" subtitle="El día con mejor rendimiento por peso invertido"
                     day={data.bestDow} tone="emerald" icon={<TrendingUp size={18} />} />
            <DayCard title="Peor día" subtitle="El día donde el peso vuelve menos"
                     day={data.worstDow} tone="orange" icon={<Clock size={18} />} />
          </div>
          <Card className="p-5">
            <h3 className="text-sm font-bold text-slate-900 mb-1">Detalle por día de la semana</h3>
            <p className="text-[11px] text-slate-500 mb-3">Por cada $1 invertido cada día, cuánto te volvió</p>
            <ul className="space-y-2">
              {data.dows.map(d => (
                <BarRow key={d.dow} label={d.label} value={d.roas} max={Math.max(...data.dows.map(x => x.roas), 1)} unit="x" detail={`${formatCurrency(d.revenue)} en ${d.sampleSize} ${d.label.toLowerCase()}s`} />
              ))}
            </ul>
          </Card>
        </section>
      )}

      {/* Heat-map día×hora — siempre últimos 14 días */}
      <section>
        <div className="flex items-center justify-between mb-4">
          <div>
            <h2 className="text-xl font-bold text-slate-900 tracking-tight">Mapa de calor por día y hora</h2>
            <p className="text-sm text-slate-500 mt-1">
              <strong className="text-emerald-700">Verde</strong> = el peso volvió multiplicado.
              <strong className="text-amber-700"> Amarillo</strong> = más o menos a la par.
              <strong className="text-orange-700"> Naranja</strong> = perdiste plata.
              <strong className="text-slate-400"> Gris</strong> = sin pauta.
            </p>
          </div>
          <span className="text-[11px] text-slate-400 font-medium shrink-0 italic">⚠ Siempre últimos 14 días (limitación de la fuente)</span>
        </div>

        {/* 3 cards: dónde más vendés / mejor relación / peor relación */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
          {data.topVolumeSlot && (
            <SlotCard title="Cuándo más vendés"  subtitle="Día y hora con más ingresos en absoluto"
                      slot={data.topVolumeSlot} tone="emerald" icon={<DollarSign size={18} />} metric="revenue" />
          )}
          {data.bestEfficiencySlot && (
            <SlotCard title="Mejor rendimiento" subtitle="Día y hora con mejor relación inversión/retorno"
                      slot={data.bestEfficiencySlot} tone="violet" icon={<TrendingUp size={18} />} metric="efficiency" />
          )}
          {data.worstEfficiencySlot && (
            <SlotCard title="Donde menos rinde" subtitle="Día y hora donde el peso vuelve menos"
                      slot={data.worstEfficiencySlot} tone="orange" icon={<Clock size={18} />} metric="efficiency" />
          )}
        </div>

        <Card className="p-6">
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
              {DAY_LABELS.map((label, dow) => (
                <div key={dow} className="flex items-center">
                  <div className="w-12 shrink-0 text-xs font-semibold text-slate-600 pr-2">{label}</div>
                  {Array.from({ length: 24 }, (_, hour) => {
                    const cell = matrix[dow][hour];
                    return <HeatCell key={hour} cell={cell} maxRoas={maxRoas} dayLabel={label} threshold={data.minSpendThreshold} />;
                  })}
                </div>
              ))}
            </div>
          </div>
          <div className="text-[10px] text-slate-400 mt-3 italic">
            Solo se evalúan slots con inversión ≥ {formatCurrency(data.minSpendThreshold)} (filtro anti-outliers).
          </div>
        </Card>

        {/* Por hora del día */}
        <Card className="p-5 mt-4">
          <h3 className="text-sm font-bold text-slate-900 mb-1">Detalle por hora del día</h3>
          <p className="text-[11px] text-slate-500 mb-3">Por cada $1 invertido en cada hora, cuánto te volvió (últimos 14 días)</p>
          <div className="space-y-1">
            {data.hours.map(h => (
              <BarRow key={h.hour} label={h.hour.toString().padStart(2, '0') + ':00'} value={h.roas}
                      max={Math.max(...data.hours.map(x => x.roas), 1)} unit="x" small />
            ))}
          </div>
        </Card>
      </section>
    </div>
  );
}

function PhaseCard({ phase, isBest }: { phase: PhaseAgg; isBest: boolean; key?: any }) {
  const icon = phase.phase.startsWith('Principio') ? <Calendar size={18} />
             : phase.phase.startsWith('Mitad')      ? <CalendarRange size={18} />
                                                   : <CalendarDays size={18} />;
  return (
    <Card className={cn("p-5", isBest && "bg-emerald-50/30 border-emerald-200 ring-1 ring-emerald-200")}>
      <div className="flex items-center gap-2 mb-3">
        <div className={cn("p-1.5 rounded-lg", isBest ? "bg-emerald-100 text-emerald-700" : "bg-slate-100 text-slate-600")}>{icon}</div>
        <h3 className="text-sm font-bold text-slate-900">{phase.phase}</h3>
        {isBest && <span className="ml-auto text-[10px] font-bold text-emerald-700 bg-emerald-100 px-2 py-0.5 rounded">Mejor</span>}
      </div>
      <div className="text-2xl font-bold text-slate-900 tabular-nums">{formatCurrency(phase.revenue)}</div>
      <div className="text-xs text-slate-500 mt-1">en ingresos · {formatNumber(phase.purchases)} compras</div>
      <div className="mt-3 pt-3 border-t border-slate-100 flex justify-between text-xs">
        <span className="text-slate-500">Por cada $1 invertido</span>
        <span className={cn("font-bold tabular-nums",
          phase.roas >= 3 ? "text-emerald-700" : phase.roas >= 1.5 ? "text-amber-700" : "text-orange-700"
        )}>${phase.roas.toFixed(2)}</span>
      </div>
    </Card>
  );
}

function DayCard({ title, subtitle, day, tone, icon }: {
  title: string; subtitle: string; day: DowAgg; tone: 'emerald' | 'orange'; icon: any; key?: any;
}) {
  const styles = tone === 'emerald'
    ? { bg: 'bg-emerald-50/30 border-emerald-200', text: 'text-emerald-700', iconBg: 'bg-emerald-100 text-emerald-700' }
    : { bg: 'bg-orange-50/30 border-orange-200',   text: 'text-orange-700',   iconBg: 'bg-orange-100 text-orange-700'   };
  return (
    <Card className={cn("p-5", styles.bg)}>
      <div className="flex items-center gap-2 mb-2">
        <div className={cn("p-1.5 rounded-lg", styles.iconBg)}>{icon}</div>
        <div>
          <h3 className="text-sm font-bold text-slate-900">{title}</h3>
          <p className="text-[10px] text-slate-500 leading-tight">{subtitle}</p>
        </div>
      </div>
      <div className="text-2xl font-bold text-slate-900 mt-3">{day.label}</div>
      <div className={cn("text-sm font-bold mt-1", styles.text)}>
        Por cada $1 → ${day.roas.toFixed(2)}
      </div>
      <div className="text-xs text-slate-500 mt-1">
        {formatCurrency(day.revenue)} ingresos en {day.sampleSize} {day.label.toLowerCase()}s del rango
      </div>
    </Card>
  );
}

function DayOfMonthChart({ days }: { days: DomAgg[] | undefined }) {
  if (!days || days.length === 0) {
    return <div className="text-sm text-slate-400 py-8 text-center">Sin datos en este rango. Esperá 1-2 minutos y refrescá si recién desplegaste.</div>;
  }
  const totalRevenue = days.reduce((s, d) => s + (Number(d.revenue) || 0), 0);
  if (totalRevenue === 0) {
    return <div className="text-sm text-slate-400 py-8 text-center">No hay revenue registrado para los días en este rango.</div>;
  }
  const maxRevenue = Math.max(...days.map(d => Number(d.revenue) || 0), 1);
  // Grid de 31 días — días sin datos quedan vacíos
  const dayMap = new Map(days.map(d => [Number(d.day), d]));
  return (
    <div>
      <div className="flex items-end gap-px h-40">
        {Array.from({ length: 31 }, (_, i) => i + 1).map(day => {
          const d = dayMap.get(day);
          const dayRevenue = d ? Number(d.revenue) || 0 : 0;
          if (!d || dayRevenue === 0) {
            return <div key={day} className="flex-1 h-1 bg-slate-100 rounded-sm" title={`Día ${day} · sin datos`} />;
          }
          const heightPct = (dayRevenue / maxRevenue) * 100;
          const roas = Number(d.roas) || 0;
          const colorClass = roas >= 3 ? 'bg-emerald-500' : roas >= 1.5 ? 'bg-amber-500' : 'bg-orange-500';
          const tooltip = `Día ${day}\nIngresos: ${formatCurrency(dayRevenue)}\nInvertido: ${formatCurrency(Number(d.spend) || 0)}\nPor cada $1 → $${roas.toFixed(2)}\n${d.sampleSize} muestras`;
          return (
            <div key={day} title={tooltip} className="flex-1 flex flex-col items-center justify-end cursor-help group">
              <div
                className={cn("w-full rounded-sm transition-all duration-300 group-hover:opacity-80", colorClass)}
                style={{ height: `${Math.max(2, heightPct)}%` }}
              />
            </div>
          );
        })}
      </div>
      <div className="flex justify-between text-[10px] text-slate-400 mt-2 font-semibold">
        <span>1</span><span>5</span><span>10</span><span>15</span><span>20</span><span>25</span><span>31</span>
      </div>
      <div className="flex items-center gap-4 mt-3 text-[10px] text-slate-500">
        <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-sm bg-emerald-500" /> Por $1 → $3+</span>
        <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-sm bg-amber-500" /> $1.5-3</span>
        <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-sm bg-orange-500" /> menos de $1.5</span>
      </div>
    </div>
  );
}

function SlotCard({ title, subtitle, slot, tone, icon, metric }: {
  title: string; subtitle: string; slot: SlotWithLabel; tone: 'emerald' | 'violet' | 'orange'; icon: any; metric: 'revenue' | 'efficiency'; key?: any;
}) {
  const styles = {
    emerald: { bg: 'bg-emerald-50/30 border-emerald-200', text: 'text-emerald-700', iconBg: 'bg-emerald-100 text-emerald-700' },
    violet:  { bg: 'bg-violet-50/30 border-violet-200',   text: 'text-violet-700',   iconBg: 'bg-violet-100 text-violet-700'   },
    orange:  { bg: 'bg-orange-50/30 border-orange-200',   text: 'text-orange-700',   iconBg: 'bg-orange-100 text-orange-700'   },
  }[tone];
  return (
    <Card className={cn("p-5", styles.bg)}>
      <div className="flex items-center gap-2 mb-2">
        <div className={cn("p-1.5 rounded-lg", styles.iconBg)}>{icon}</div>
        <div>
          <h3 className="text-sm font-bold text-slate-900">{title}</h3>
          <p className="text-[10px] text-slate-500 leading-tight">{subtitle}</p>
        </div>
      </div>
      <div className="text-2xl font-bold text-slate-900 mt-3">
        {slot.dayLabel} {slot.hour.toString().padStart(2, '0')}:00
      </div>
      {metric === 'revenue' ? (
        <>
          <div className={cn("text-sm font-bold mt-1", styles.text)}>Ingresos: {formatCurrency(slot.revenue)}</div>
          <div className="text-xs text-slate-500 mt-1">Con {formatCurrency(slot.spend)} invertidos · {slot.purchases} compras</div>
        </>
      ) : (
        <>
          <div className={cn("text-sm font-bold mt-1", styles.text)}>Por cada $1 invertido, recuperaste ${slot.roas.toFixed(2)}</div>
          <div className="text-xs text-slate-500 mt-1">{formatCurrency(slot.spend)} → {formatCurrency(slot.revenue)}</div>
        </>
      )}
    </Card>
  );
}

function HeatCell({ cell, maxRoas, dayLabel, threshold }: { cell: Cell | null; maxRoas: number; dayLabel: string; threshold: number; key?: any }) {
  if (!cell || cell.spend < threshold * 0.1) {
    return <div className="w-7 h-7 m-px bg-slate-50 border border-slate-100 rounded-sm" title="Sin pauta significativa" />;
  }
  const intensity = maxRoas > 0 ? Math.min(1, cell.roas / maxRoas) : 0;
  const bgColor = cell.roas >= 3   ? `rgba(16, 185, 129, ${0.3 + intensity * 0.7})`
                : cell.roas >= 1.5 ? `rgba(245, 158, 11, ${0.3 + intensity * 0.7})`
                                   : `rgba(249, 115, 22, ${0.3 + intensity * 0.7})`;
  const tooltip = `${dayLabel} ${cell.hour.toString().padStart(2, '0')}:00\nInvertido: $${cell.spend.toLocaleString('es-AR', { maximumFractionDigits: 0 })}\nRevenue: $${cell.revenue.toLocaleString('es-AR', { maximumFractionDigits: 0 })}\nPor cada $1 → $${cell.roas.toFixed(2)}\n${cell.purchases} compras`;
  return <div title={tooltip} className="w-7 h-7 m-px rounded-sm border border-white/50 cursor-help" style={{ backgroundColor: bgColor }} />;
}

function BarRow({ label, value, max, unit, small, detail }: {
  label: string; value: number; max: number; unit: string; small?: boolean; detail?: string; key?: any;
}) {
  return (
    <div className={cn("flex items-center gap-3", small ? "py-0.5" : "py-1")}>
      <div className={cn("text-slate-700 shrink-0", small ? "w-12 text-xs" : "w-20 text-sm font-medium")}>{label}</div>
      <div className="flex-1 h-2 bg-slate-100 rounded-full overflow-hidden">
        <div
          className={cn("h-full rounded-full transition-all duration-500",
            value >= 3 ? "bg-emerald-500" : value >= 1.5 ? "bg-amber-500" : "bg-orange-500")}
          style={{ width: `${(value / max) * 100}%` }}
        />
      </div>
      {detail && !small && (
        <div className="text-[10px] text-slate-400 hidden sm:block w-44 truncate">{detail}</div>
      )}
      <div className={cn("tabular-nums font-bold shrink-0", small ? "w-12 text-xs" : "w-16 text-sm",
        value >= 3 ? "text-emerald-700" : value >= 1.5 ? "text-amber-700" : "text-orange-700"
      )}>
        {value.toFixed(2)}{unit}
      </div>
    </div>
  );
}
