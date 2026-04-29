import { useParams } from 'react-router-dom';
import { useState, useEffect } from 'react';
import { AlertTriangle, TrendingUp, TrendingDown, Activity, CheckCircle2, ArrowUpRight, ArrowDownRight } from 'lucide-react';
import { formatCurrency, formatNumber, cn } from '@/lib/utils';
import { Card } from '@/components/ui/Card';
import { api, getClients } from '@/lib/api';

type HealthStatus = 'green' | 'amber' | 'red';
type Health = { label: string; value: string; status: HealthStatus; detail: string };
type Alert = { severity: 'critical' | 'warning'; title: string; detail: string };
type Win = { title: string; detail: string };
type Summary = {
  spend:     { value: number; delta: number };
  revenue:   { value: number; delta: number };
  purchases: { value: number; delta: number };
  roas:      { value: number; delta: number };
  cpa:       { value: number; delta: number };
};

export default function Pulse() {
  const { clientSlug } = useParams();
  const [data, setData] = useState<{ summary: Summary; health: Health[]; alerts: Alert[]; wins: Win[] } | null>(null);
  const [loading, setLoading] = useState(true);

  const allClients = getClients();
  const currentClient = allClients.find(c => c.slug === clientSlug) ?? { name: clientSlug ?? '' };

  useEffect(() => {
    if (!clientSlug) return;
    setLoading(true);
    api.pulse(clientSlug)
      .then(d => setData(d))
      .finally(() => setLoading(false));
  }, [clientSlug]);

  if (loading) return <div className="p-8 text-slate-400 animate-pulse">Cargando pulso del negocio...</div>;
  if (!data) return <div className="p-8 text-slate-500">No hay datos disponibles</div>;

  return (
    <div className="py-12 max-w-7xl mx-auto space-y-10 relative z-10">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-slate-200 pb-6">
        <div className="flex items-center gap-2 text-sm text-slate-500 font-medium">
          <span className="hover:text-slate-900 cursor-pointer">{currentClient.name}</span>
          <span>/</span>
          <span className="text-slate-900">Pulso del negocio</span>
        </div>
        <div className="text-xs text-slate-400 font-medium">
          Actualizado cada hora · vista CEO
        </div>
      </div>

      {/* Resumen del mes */}
      <section className="space-y-4">
        <h2 className="text-xl font-bold text-slate-900 tracking-tight">Resumen del mes</h2>
        <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
          <SummaryCard label="Inversión"  value={formatCurrency(data.summary.spend.value)}     delta={data.summary.spend.delta} invertColor />
          <SummaryCard label="Revenue"    value={formatCurrency(data.summary.revenue.value)}   delta={data.summary.revenue.delta} />
          <SummaryCard label="Compras"    value={formatNumber(data.summary.purchases.value)}   delta={data.summary.purchases.delta} />
          <SummaryCard label="ROAS"       value={data.summary.roas.value.toFixed(2) + 'x'}     delta={data.summary.roas.delta} />
          <SummaryCard label="CPA"        value={formatCurrency(data.summary.cpa.value)}       delta={data.summary.cpa.delta} invertColor />
        </div>
      </section>

      {/* Semáforos */}
      <section className="space-y-4">
        <h2 className="text-xl font-bold text-slate-900 tracking-tight">Semáforos de salud</h2>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {data.health.map((h, i) => (
            <HealthCard key={i} health={h} />
          ))}
        </div>
      </section>

      {/* Atención + Wins en 2 columnas */}
      <section className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Atención requerida */}
        <Card className="p-6">
          <div className="flex items-center gap-2 mb-4">
            <div className="bg-orange-50 text-orange-600 p-1.5 rounded-lg">
              <AlertTriangle size={16} strokeWidth={2.5} />
            </div>
            <h3 className="text-lg font-bold text-slate-900">Atención requerida</h3>
            <span className="ml-auto text-xs text-slate-400 font-medium">{data.alerts.length} ítem{data.alerts.length === 1 ? '' : 's'}</span>
          </div>
          {data.alerts.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-10 text-slate-400 text-sm">
              <CheckCircle2 size={32} className="mb-2 text-emerald-400" />
              Todo bajo control. Nada urgente.
            </div>
          ) : (
            <ul className="space-y-3">
              {data.alerts.map((a, i) => (
                <li key={i} className={cn(
                  "p-3 rounded-xl border",
                  a.severity === 'critical' ? "bg-red-50/50 border-red-100" : "bg-amber-50/50 border-amber-100"
                )}>
                  <div className="font-semibold text-sm text-slate-900">{a.title}</div>
                  <div className="text-xs text-slate-600 mt-1">{a.detail}</div>
                </li>
              ))}
            </ul>
          )}
        </Card>

        {/* Funcionando bien */}
        <Card className="p-6">
          <div className="flex items-center gap-2 mb-4">
            <div className="bg-emerald-50 text-emerald-600 p-1.5 rounded-lg">
              <TrendingUp size={16} strokeWidth={2.5} />
            </div>
            <h3 className="text-lg font-bold text-slate-900">Funcionando bien</h3>
            <span className="ml-auto text-xs text-slate-400 font-medium">{data.wins.length} oportunidad{data.wins.length === 1 ? '' : 'es'}</span>
          </div>
          {data.wins.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-10 text-slate-400 text-sm">
              <Activity size={32} className="mb-2 text-slate-300" />
              Sin wins notables todavía.
            </div>
          ) : (
            <ul className="space-y-3">
              {data.wins.map((w, i) => (
                <li key={i} className="p-3 rounded-xl border bg-emerald-50/30 border-emerald-100">
                  <div className="font-semibold text-sm text-slate-900">{w.title}</div>
                  <div className="text-xs text-slate-600 mt-1">{w.detail}</div>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </section>
    </div>
  );
}

function SummaryCard({ label, value, delta, invertColor }: { label: string; value: string; delta: number; invertColor?: boolean }) {
  const isPos = delta > 0;
  // Para spend y CPA, "subir" es malo, así que invertimos color
  const isGood = invertColor ? !isPos : isPos;
  return (
    <Card className="p-5">
      <div className="text-xs font-semibold text-slate-500 uppercase tracking-wider">{label}</div>
      <div className="text-2xl font-bold text-slate-900 mt-2 tabular-nums">{value}</div>
      <div className={cn(
        "text-[11px] font-bold flex items-center gap-0.5 mt-1",
        isGood ? "text-emerald-600" : "text-orange-600"
      )}>
        {isPos ? <ArrowUpRight size={10} strokeWidth={3} /> : <ArrowDownRight size={10} strokeWidth={3} />}
        {Math.abs(delta * 100).toFixed(1)}% <span className="text-slate-400 font-medium ml-1">vs mes pasado</span>
      </div>
    </Card>
  );
}

function HealthCard({ health }: { health: Health; key?: any }) {
  const colors = {
    green: { bg: 'bg-emerald-50', text: 'text-emerald-700', dot: 'bg-emerald-500' },
    amber: { bg: 'bg-amber-50', text: 'text-amber-700', dot: 'bg-amber-500' },
    red:   { bg: 'bg-red-50',   text: 'text-red-700',   dot: 'bg-red-500'   },
  }[health.status];
  return (
    <Card className="p-5">
      <div className="flex items-start justify-between gap-2">
        <div className="text-xs font-semibold text-slate-500 uppercase tracking-wider">{health.label}</div>
        <div className={cn("h-2.5 w-2.5 rounded-full mt-0.5 shrink-0", colors.dot)} />
      </div>
      <div className={cn("text-2xl font-bold mt-2 tabular-nums", colors.text)}>{health.value}</div>
      <div className="text-[11px] text-slate-500 font-medium mt-1">{health.detail}</div>
    </Card>
  );
}
