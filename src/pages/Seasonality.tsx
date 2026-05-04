import { useParams } from 'react-router-dom';
import { useState, useEffect } from 'react';
import { Clock, TrendingUp } from 'lucide-react';
import { formatCurrency, cn } from '@/lib/utils';
import { Card } from '@/components/ui/Card';
import { api, getClients } from '@/lib/api';

type Cell = { dow: number; hour: number; spend: number; purchases: number; revenue: number; roas: number; impressions: number; clicks: number };
type DowAgg = { dow: number; label: string; spend: number; revenue: number; purchases: number; roas: number };
type HourAgg = { hour: number; spend: number; revenue: number; purchases: number; roas: number };
type SeasonalityData = {
  cells: Cell[];
  dows: DowAgg[];
  hours: HourAgg[];
  bestSlot: (Cell & { dayLabel: string }) | null;
  worstSlot: (Cell & { dayLabel: string }) | null;
};

const DAY_LABELS = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'];

export default function Seasonality() {
  const { clientSlug } = useParams();
  const [data, setData] = useState<SeasonalityData | null>(null);
  const [loading, setLoading] = useState(true);

  const allClients = getClients();
  const currentClient = allClients.find(c => c.slug === clientSlug) ?? { name: clientSlug ?? '' };

  useEffect(() => {
    if (!clientSlug) return;
    setLoading(true);
    api.seasonality(clientSlug).then(d => setData(d)).finally(() => setLoading(false));
  }, [clientSlug]);

  if (loading) return <div className="p-8 text-slate-400 animate-pulse">Cargando estacionalidad...</div>;
  if (!data || data.cells.length === 0) return (
    <div className="py-12 max-w-7xl mx-auto space-y-8">
      <div className="border-b border-slate-200 pb-6">
        <span className="text-sm text-slate-500">{currentClient.name} / Estacionalidad</span>
      </div>
      <div className="text-slate-500">No hay data hourly disponible. El sync hourly se incorporó recientemente — esperá la próxima ejecución del cron.</div>
    </div>
  );

  // Para el heat-map: matriz 7 × 24 con ROAS de cada celda
  const matrix: (Cell | null)[][] = Array(7).fill(null).map(() => Array(24).fill(null));
  let maxRoas = 0;
  for (const c of data.cells) {
    matrix[c.dow][c.hour] = c;
    if (c.roas > maxRoas) maxRoas = c.roas;
  }

  return (
    <div className="py-12 max-w-7xl mx-auto space-y-10 relative z-10">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-slate-200 pb-6">
        <div className="flex items-center gap-2 text-sm text-slate-500 font-medium">
          <span className="hover:text-slate-900 cursor-pointer">{currentClient.name}</span>
          <span>/</span>
          <span className="text-slate-900">Estacionalidad</span>
        </div>
        <div className="text-xs text-slate-400 font-medium">Últimos 14 días · combinado Meta + Google</div>
      </div>

      {/* Best slot / Worst slot */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {data.bestSlot && (
          <Card className="p-5 bg-emerald-50/30 border-emerald-200">
            <div className="flex items-center gap-2 mb-2">
              <TrendingUp size={18} className="text-emerald-600" />
              <h3 className="text-sm font-bold text-slate-900">Mejor momento</h3>
            </div>
            <div className="text-2xl font-bold text-slate-900">
              {data.bestSlot.dayLabel} {data.bestSlot.hour.toString().padStart(2, '0')}:00
            </div>
            <div className="text-sm text-emerald-700 font-bold mt-1">ROAS {data.bestSlot.roas.toFixed(2)}x</div>
            <div className="text-xs text-slate-500 mt-1">{formatCurrency(data.bestSlot.spend)} → {formatCurrency(data.bestSlot.revenue)}</div>
          </Card>
        )}
        {data.worstSlot && (
          <Card className="p-5 bg-orange-50/30 border-orange-200">
            <div className="flex items-center gap-2 mb-2">
              <Clock size={18} className="text-orange-600" />
              <h3 className="text-sm font-bold text-slate-900">Peor momento</h3>
            </div>
            <div className="text-2xl font-bold text-slate-900">
              {data.worstSlot.dayLabel} {data.worstSlot.hour.toString().padStart(2, '0')}:00
            </div>
            <div className="text-sm text-orange-700 font-bold mt-1">ROAS {data.worstSlot.roas.toFixed(2)}x</div>
            <div className="text-xs text-slate-500 mt-1">{formatCurrency(data.worstSlot.spend)} → {formatCurrency(data.worstSlot.revenue)}</div>
          </Card>
        )}
      </div>

      {/* Heat-map ROAS por día × hora */}
      <Card className="p-6">
        <h3 className="text-lg font-bold text-slate-900 mb-1">ROAS por día y hora</h3>
        <p className="text-sm text-slate-500 mb-4">Intensidad del color = ROAS. Las celdas vacías no tuvieron pauta.</p>
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
                  return <HeatCell key={hour} cell={cell} maxRoas={maxRoas} />;
                })}
              </div>
            ))}
          </div>
        </div>
      </Card>

      {/* Por día de semana */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Card className="p-5">
          <h3 className="text-sm font-bold text-slate-900 mb-3">ROAS por día de la semana</h3>
          <ul className="space-y-2">
            {data.dows.map(d => (
              <BarRow key={d.dow} label={d.label} value={d.roas} max={Math.max(...data.dows.map(x => x.roas), 1)} unit="x" />
            ))}
          </ul>
        </Card>
        <Card className="p-5">
          <h3 className="text-sm font-bold text-slate-900 mb-3">ROAS por hora del día</h3>
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

function HeatCell({ cell, maxRoas }: { cell: Cell | null; maxRoas: number; key?: any }) {
  if (!cell || cell.spend < 10) {
    return <div className="w-7 h-7 m-px bg-slate-50 border border-slate-100 rounded-sm" />;
  }
  // Mapeo del ROAS a una escala de color (0 → blanco/rojo, max → verde intenso)
  const intensity = maxRoas > 0 ? Math.min(1, cell.roas / maxRoas) : 0;
  const bgColor =
    cell.roas >= 3   ? `rgba(16, 185, 129, ${0.3 + intensity * 0.7})` :
    cell.roas >= 1.5 ? `rgba(245, 158, 11, ${0.3 + intensity * 0.7})` :
                       `rgba(249, 115, 22, ${0.3 + intensity * 0.7})`;
  const tooltip = `${cell.dow} ${cell.hour}:00 — Spend ${cell.spend.toFixed(0)}, Revenue ${cell.revenue.toFixed(0)}, ROAS ${cell.roas.toFixed(2)}x`;
  return (
    <div
      title={tooltip}
      className="w-7 h-7 m-px rounded-sm border border-white/50"
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
