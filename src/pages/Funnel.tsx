import { useParams } from 'react-router-dom';
import { useState, useEffect } from 'react';
import { ArrowDown, ArrowUpRight, ArrowDownRight } from 'lucide-react';
import { formatCurrency, formatNumber, formatPercent, cn } from '@/lib/utils';
import { Card } from '@/components/ui/Card';
import { api, getClients } from '@/lib/api';
import { DateRangePicker, defaultRange } from '@/components/ui/DateRangePicker';
import type { DateRange } from '@/components/ui/DateRangePicker';

type Stage = {
  label: string;
  value: number;
  delta: number;
  conversionFromPrevStage: number;
  conversionDelta: number;
};
type FunnelData = {
  stages: Stage[];
  totalConversion: number;
  totalConversionDelta: number;
  revenue: { value: number; delta: number };
};

export default function Funnel() {
  const { clientSlug } = useParams();
  const [data, setData] = useState<FunnelData | null>(null);
  const [loading, setLoading] = useState(true);
  const [range, setRange] = useState<DateRange>(defaultRange());

  const allClients = getClients();
  const currentClient = allClients.find(c => c.slug === clientSlug) ?? { name: clientSlug ?? '' };

  useEffect(() => {
    if (!clientSlug) return;
    setLoading(true);
    api.funnel(clientSlug, range.start, range.end)
      .then(d => setData(d))
      .finally(() => setLoading(false));
  }, [clientSlug, range]);

  if (loading) return <div className="p-8 text-slate-400 animate-pulse">Cargando embudo...</div>;
  if (!data || !data.stages.length) return (
    <div className="py-12 max-w-7xl mx-auto space-y-8 relative z-10">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-slate-200 pb-6">
        <div className="flex items-center gap-2 text-sm text-slate-500 font-medium">
          <span>{currentClient.name}</span>
          <span>/</span>
          <span className="text-slate-900">Embudo de conversión</span>
        </div>
      </div>
      <div className="text-slate-500">No hay datos disponibles. El sync de GA4 puede estar desactualizado.</div>
    </div>
  );

  // Para visualizar el embudo, escalamos por la primera etapa
  const maxValue = data.stages[0]?.value ?? 1;

  return (
    <div className="py-12 max-w-7xl mx-auto space-y-10 relative z-10">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-slate-200 pb-6">
        <div className="flex items-center gap-2 text-sm text-slate-500 font-medium">
          <span className="hover:text-slate-900 cursor-pointer">{currentClient.name}</span>
          <span>/</span>
          <span className="text-slate-900">Embudo de conversión</span>
        </div>
        <DateRangePicker value={range} onChange={setRange} />
      </div>

      {/* Top stats: conversión total y revenue */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card className="p-5">
          <div className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Conversión total</div>
          <div className="text-3xl font-bold text-slate-900 mt-2 tabular-nums">
            {formatPercent(data.totalConversion * 100)}
          </div>
          <Delta value={data.totalConversionDelta} label="vs mes pasado" />
        </Card>
        <Card className="p-5">
          <div className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Revenue del período</div>
          <div className="text-3xl font-bold text-slate-900 mt-2 tabular-nums">
            {formatCurrency(data.revenue.value)}
          </div>
          <Delta value={data.revenue.delta} label="vs mes pasado" />
        </Card>
        <Card className="p-5">
          <div className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Etapas trackeadas</div>
          <div className="text-3xl font-bold text-slate-900 mt-2 tabular-nums">{data.stages.length}</div>
          <div className="text-xs text-slate-400 font-medium mt-1">Usuarios → Sesiones → Carritos → Compras</div>
        </Card>
      </div>

      {/* Embudo visual */}
      <section className="space-y-4">
        <h2 className="text-xl font-bold text-slate-900 tracking-tight">Embudo del período</h2>
        <Card className="p-8">
          <div className="space-y-6">
            {data.stages.map((s, i) => {
              const widthPct = Math.max(5, (s.value / maxValue) * 100);
              const isFirst = i === 0;
              return (
                <div key={s.label}>
                  {!isFirst && (
                    <div className="flex items-center justify-center mb-3">
                      <div className={cn(
                        "flex items-center gap-2 text-xs font-semibold px-3 py-1 rounded-full",
                        s.conversionDelta >= 0 ? "bg-emerald-50 text-emerald-700" : "bg-orange-50 text-orange-700"
                      )}>
                        <ArrowDown size={12} strokeWidth={3} />
                        <span>{formatPercent(s.conversionFromPrevStage * 100)} pasa a la siguiente</span>
                        <span className="text-slate-500">·</span>
                        <span>{s.conversionDelta >= 0 ? '+' : ''}{(s.conversionDelta * 100).toFixed(1)}% vs mes pasado</span>
                      </div>
                    </div>
                  )}
                  <div className="relative">
                    <div
                      className="bg-gradient-to-r from-slate-900 to-slate-700 rounded-2xl mx-auto p-5 text-white transition-all duration-500"
                      style={{ width: `${widthPct}%`, minWidth: '280px' }}
                    >
                      <div className="flex items-center justify-between gap-4">
                        <div>
                          <div className="text-xs font-semibold uppercase tracking-wider opacity-70">{s.label}</div>
                          <div className="text-3xl font-bold tabular-nums mt-1">{formatNumber(s.value)}</div>
                        </div>
                        <Delta value={s.delta} label="vs mes pasado" inverted />
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </Card>
      </section>
    </div>
  );
}

function Delta({ value, label, inverted }: { value: number; label?: string; inverted?: boolean }) {
  const isPos = value > 0;
  const colorClass = inverted
    ? (isPos ? "text-emerald-300" : "text-orange-300")
    : (isPos ? "text-emerald-600" : "text-orange-600");
  return (
    <div className={cn("text-xs font-bold flex items-center gap-1 mt-1", colorClass)}>
      {isPos ? <ArrowUpRight size={12} strokeWidth={3} /> : <ArrowDownRight size={12} strokeWidth={3} />}
      {Math.abs(value * 100).toFixed(1)}%
      {label && <span className={cn("font-medium ml-1", inverted ? "opacity-70" : "text-slate-400")}>{label}</span>}
    </div>
  );
}
