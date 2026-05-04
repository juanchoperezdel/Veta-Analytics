import { useParams } from 'react-router-dom';
import { useState, useEffect } from 'react';
import { Clock, TrendingUp, DollarSign, Info } from 'lucide-react';
import { formatCurrency, cn } from '@/lib/utils';
import { Card } from '@/components/ui/Card';
import { api, getClients } from '@/lib/api';

type Cell = { dow: number; hour: number; spend: number; purchases: number; revenue: number; roas: number; impressions: number; clicks: number };
type DowAgg = { dow: number; label: string; spend: number; revenue: number; purchases: number; roas: number };
type HourAgg = { hour: number; spend: number; revenue: number; purchases: number; roas: number };
type SlotWithLabel = Cell & { dayLabel: string };
type SeasonalityData = {
  cells: Cell[];
  dows: DowAgg[];
  hours: HourAgg[];
  source: 'all' | 'meta' | 'google';
  minSpendThreshold: number;
  topVolumeSlot: SlotWithLabel | null;
  bestEfficiencySlot: SlotWithLabel | null;
  worstEfficiencySlot: SlotWithLabel | null;
};

type Source = 'all' | 'meta' | 'google';
const DAY_LABELS = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'];
const SOURCE_LABELS: Record<Source, string> = { all: 'Meta + Google', meta: 'Solo Meta Ads', google: 'Solo Google Ads' };

export default function Seasonality() {
  const { clientSlug } = useParams();
  const [data, setData] = useState<SeasonalityData | null>(null);
  const [loading, setLoading] = useState(true);
  const [source, setSource] = useState<Source>('all');

  const allClients = getClients();
  const currentClient = allClients.find(c => c.slug === clientSlug) ?? { name: clientSlug ?? '' };

  useEffect(() => {
    if (!clientSlug) return;
    setLoading(true);
    api.seasonality(clientSlug, source).then(d => setData(d)).finally(() => setLoading(false));
  }, [clientSlug, source]);

  if (loading) return <div className="p-8 text-slate-400 animate-pulse">Cargando estacionalidad...</div>;
  if (!data || data.cells.length === 0) return (
    <div className="py-12 max-w-7xl mx-auto space-y-8">
      <div className="border-b border-slate-200 pb-6">
        <span className="text-sm text-slate-500">{currentClient.name} / Estacionalidad</span>
      </div>
      <div className="text-slate-500">No hay data hourly disponible para esta plataforma. El sync hourly se incorporó recientemente — esperá la próxima ejecución del cron.</div>
    </div>
  );

  // Para el heat-map: matriz 7 × 24 con ROAS de cada celda
  const matrix: (Cell | null)[][] = Array(7).fill(null).map(() => Array(24).fill(null));
  let maxRoas = 0;
  for (const c of data.cells) {
    matrix[c.dow][c.hour] = c;
    if (c.roas > maxRoas && c.spend >= data.minSpendThreshold) maxRoas = c.roas;
  }

  return (
    <div className="py-12 max-w-7xl mx-auto space-y-10 relative z-10">
      {/* Header con selector */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-slate-200 pb-6">
        <div>
          <div className="flex items-center gap-2 text-sm text-slate-500 font-medium">
            <span className="hover:text-slate-900 cursor-pointer">{currentClient.name}</span>
            <span>/</span>
            <span className="text-slate-900">Estacionalidad</span>
          </div>
          <p className="text-xs text-slate-400 font-medium mt-1">¿Qué días y horas conviene pautar más? · últimos 14 días</p>
        </div>
        <div className="flex items-center gap-1 bg-slate-100 rounded-lg p-1">
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

      {/* 3 cards: dónde más vendés / mejor relación / peor relación */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {data.topVolumeSlot && (
          <SlotCard
            title="Cuándo más vendés"
            subtitle="El día y hora con más ingresos en absoluto"
            slot={data.topVolumeSlot}
            tone="emerald"
            icon={<DollarSign size={18} />}
            metric="revenue"
          />
        )}
        {data.bestEfficiencySlot && (
          <SlotCard
            title="Mejor rendimiento"
            subtitle="El día y hora con mejor relación inversión/retorno"
            slot={data.bestEfficiencySlot}
            tone="violet"
            icon={<TrendingUp size={18} />}
            metric="efficiency"
          />
        )}
        {data.worstEfficiencySlot && (
          <SlotCard
            title="Donde menos rinde"
            subtitle="El día y hora donde el peso invertido vuelve menos"
            slot={data.worstEfficiencySlot}
            tone="orange"
            icon={<Clock size={18} />}
            metric="efficiency"
          />
        )}
      </div>

      {/* Heat-map ROAS por día × hora */}
      <Card className="p-6">
        <div className="flex items-start justify-between mb-1 gap-4">
          <div>
            <h3 className="text-lg font-bold text-slate-900">Mapa de calor — rendimiento por día y hora</h3>
            <p className="text-sm text-slate-500 mt-1">
              <strong className="text-emerald-700">Verde</strong> = el peso volvió multiplicado.
              <strong className="text-amber-700"> Amarillo</strong> = más o menos a la par.
              <strong className="text-orange-700"> Naranja</strong> = perdiste plata. <strong className="text-slate-400">Gris</strong> = sin pauta.
            </p>
          </div>
          <div className="text-[10px] text-slate-400 shrink-0 flex items-center gap-1 mt-1">
            <Info size={12} />
            <span>Pasá el mouse para ver el detalle</span>
          </div>
        </div>
        <div className="overflow-x-auto mt-4">
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

      {/* Por día de semana y por hora */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Card className="p-5">
          <h3 className="text-sm font-bold text-slate-900 mb-1">Promedio por día de la semana</h3>
          <p className="text-[11px] text-slate-500 mb-3">Por cada $1 invertido en cada día, cuánto te volvió</p>
          <ul className="space-y-2">
            {data.dows.map(d => (
              <BarRow key={d.dow} label={d.label} value={d.roas} max={Math.max(...data.dows.map(x => x.roas), 1)} unit="x" />
            ))}
          </ul>
        </Card>
        <Card className="p-5">
          <h3 className="text-sm font-bold text-slate-900 mb-1">Promedio por hora del día</h3>
          <p className="text-[11px] text-slate-500 mb-3">Por cada $1 invertido en cada hora, cuánto te volvió</p>
          <div className="space-y-1">
            {data.hours.map(h => (
              <BarRow key={h.hour} label={h.hour.toString().padStart(2, '0') + ':00'} value={h.roas} max={Math.max(...data.hours.map(x => x.roas), 1)} unit="x" small />
            ))}
          </div>
        </Card>
      </div>
    </div>
  );
}

function SlotCard({ title, subtitle, slot, tone, icon, metric }: {
  title: string;
  subtitle: string;
  slot: SlotWithLabel;
  tone: 'emerald' | 'violet' | 'orange';
  icon: any;
  metric: 'revenue' | 'efficiency';
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
          <div className={cn("text-sm font-bold mt-1", styles.text)}>
            Ingresos: {formatCurrency(slot.revenue)}
          </div>
          <div className="text-xs text-slate-500 mt-1">
            Con {formatCurrency(slot.spend)} invertidos · {slot.purchases} compras
          </div>
        </>
      ) : (
        <>
          <div className={cn("text-sm font-bold mt-1", styles.text)}>
            Por cada $1 invertido, recuperaste ${slot.roas.toFixed(2)}
          </div>
          <div className="text-xs text-slate-500 mt-1">
            {formatCurrency(slot.spend)} → {formatCurrency(slot.revenue)}
          </div>
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
  const bgColor =
    cell.roas >= 3   ? `rgba(16, 185, 129, ${0.3 + intensity * 0.7})` :
    cell.roas >= 1.5 ? `rgba(245, 158, 11, ${0.3 + intensity * 0.7})` :
                       `rgba(249, 115, 22, ${0.3 + intensity * 0.7})`;
  const tooltip = `${dayLabel} ${cell.hour.toString().padStart(2, '0')}:00\nInvertido: $${cell.spend.toLocaleString('es-AR', { maximumFractionDigits: 0 })}\nRevenue: $${cell.revenue.toLocaleString('es-AR', { maximumFractionDigits: 0 })}\nPor cada $1 → $${cell.roas.toFixed(2)}\n${cell.purchases} compras`;
  return (
    <div
      title={tooltip}
      className="w-7 h-7 m-px rounded-sm border border-white/50 cursor-help"
      style={{ backgroundColor: bgColor }}
    />
  );
}

function BarRow({ label, value, max, unit, small }: { label: string; value: number; max: number; unit: string; small?: boolean; key?: any }) {
  return (
    <div className={cn("flex items-center gap-3", small ? "py-0.5" : "py-1")}>
      <div className={cn("text-slate-700 shrink-0", small ? "w-12 text-xs" : "w-20 text-sm font-medium")}>{label}</div>
      <div className="flex-1 h-2 bg-slate-100 rounded-full overflow-hidden">
        <div
          className={cn(
            "h-full rounded-full transition-all duration-500",
            value >= 3 ? "bg-emerald-500" : value >= 1.5 ? "bg-amber-500" : "bg-orange-500"
          )}
          style={{ width: `${(value / max) * 100}%` }}
        />
      </div>
      <div className={cn("tabular-nums font-bold shrink-0", small ? "w-12 text-xs" : "w-16 text-sm",
        value >= 3 ? "text-emerald-700" : value >= 1.5 ? "text-amber-700" : "text-orange-700"
      )}>
        {value.toFixed(2)}{unit}
      </div>
    </div>
  );
}
