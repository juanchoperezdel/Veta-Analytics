import { useParams } from 'react-router-dom';
import { useState, useEffect } from 'react';
import { AlertTriangle, TrendingUp, Activity, CheckCircle2, ArrowUpRight, ArrowDownRight, Target, Calendar, X } from 'lucide-react';
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
type Forecast = {
  daysIn: number; daysTotal: number; progress: number;
  spend:     { projected: number; prevMonth: number; delta: number };
  revenue:   { projected: number; prevMonth: number; delta: number };
  purchases: { projected: number; prevMonth: number; delta: number };
};
type Pacing = {
  planned: number; spent: number;
  monthProgress: number; spendProgress: number;
  status: 'on_track' | 'over' | 'under';
  projectedSpend: number; projectedDelta: number;
} | null;

export default function Pulse() {
  const { clientSlug } = useParams();
  const [data, setData] = useState<{ summary: Summary; health: Health[]; alerts: Alert[]; wins: Win[]; forecast: Forecast; pacing: Pacing } | null>(null);
  const [loading, setLoading] = useState(true);
  const [budgetModalOpen, setBudgetModalOpen] = useState(false);

  const allClients = getClients();
  const currentClient = allClients.find(c => c.slug === clientSlug) ?? { name: clientSlug ?? '' };

  function refresh() {
    if (!clientSlug) return;
    setLoading(true);
    api.pulse(clientSlug).then(d => setData(d)).finally(() => setLoading(false));
  }

  useEffect(() => { refresh(); }, [clientSlug]);

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

      {/* Forecast + Pacing */}
      <section className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Forecast del fin de mes */}
        {data.forecast && (
          <Card className="p-6">
            <div className="flex items-center gap-2 mb-4">
              <div className="bg-violet-50 text-violet-600 p-1.5 rounded-lg">
                <Calendar size={16} strokeWidth={2.5} />
              </div>
              <h3 className="text-lg font-bold text-slate-900">Proyección de fin de mes</h3>
              <span className="ml-auto text-xs text-slate-400 font-medium">día {data.forecast.daysIn}/{data.forecast.daysTotal}</span>
            </div>
            <p className="text-sm text-slate-500 mb-4">A este pace, vas a terminar el mes con:</p>
            <div className="space-y-3">
              <ForecastRow label="Revenue"   projected={formatCurrency(data.forecast.revenue.projected)}   prevMonth={formatCurrency(data.forecast.revenue.prevMonth)}   delta={data.forecast.revenue.delta} />
              <ForecastRow label="Inversión" projected={formatCurrency(data.forecast.spend.projected)}     prevMonth={formatCurrency(data.forecast.spend.prevMonth)}     delta={data.forecast.spend.delta} invert />
              <ForecastRow label="Compras"   projected={formatNumber(data.forecast.purchases.projected)}   prevMonth={formatNumber(data.forecast.purchases.prevMonth)}   delta={data.forecast.purchases.delta} />
            </div>
          </Card>
        )}

        {/* Pacing presupuestario */}
        <Card className="p-6">
          <div className="flex items-center gap-2 mb-4">
            <div className="bg-blue-50 text-blue-600 p-1.5 rounded-lg">
              <Target size={16} strokeWidth={2.5} />
            </div>
            <h3 className="text-lg font-bold text-slate-900">Pacing presupuestario</h3>
            <button onClick={() => setBudgetModalOpen(true)} className="ml-auto text-xs font-semibold text-blue-600 hover:text-blue-800">
              {data.pacing ? 'Editar' : 'Cargar budget'}
            </button>
          </div>
          {data.pacing ? <PacingCard pacing={data.pacing} /> : (
            <div className="text-sm text-slate-500 py-4">
              Cargá el budget mensual para ver si vas on-track, sobre-gastado o sub-gastado.
            </div>
          )}
        </Card>
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

      {/* Budget modal */}
      {budgetModalOpen && (
        <BudgetModal
          slug={clientSlug!}
          currentPlanned={data.pacing?.planned ?? null}
          onClose={() => setBudgetModalOpen(false)}
          onSaved={() => { setBudgetModalOpen(false); refresh(); }}
        />
      )}

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

function ForecastRow({ label, projected, prevMonth, delta, invert }: { label: string; projected: string; prevMonth: string; delta: number; invert?: boolean }) {
  const isPos = delta > 0;
  const isGood = invert ? !isPos : isPos;
  return (
    <div className="flex items-center justify-between gap-4 py-2 border-b border-slate-100 last:border-0">
      <div className="text-sm font-semibold text-slate-700">{label}</div>
      <div className="text-right">
        <div className="text-sm font-bold text-slate-900 tabular-nums">{projected}</div>
        <div className={cn(
          "text-[11px] font-semibold flex items-center justify-end gap-0.5",
          isGood ? "text-emerald-600" : "text-orange-600"
        )}>
          {isPos ? <ArrowUpRight size={10} strokeWidth={3} /> : <ArrowDownRight size={10} strokeWidth={3} />}
          {Math.abs(delta * 100).toFixed(1)}% vs {prevMonth}
        </div>
      </div>
    </div>
  );
}

function PacingCard({ pacing }: { pacing: NonNullable<Pacing> }) {
  const statusMap = {
    on_track: { color: 'emerald', text: 'on track', dot: 'bg-emerald-500', textColor: 'text-emerald-700' },
    over:     { color: 'red',     text: 'sobre-gastado',  dot: 'bg-red-500',     textColor: 'text-red-700' },
    under:    { color: 'amber',   text: 'sub-gastado',    dot: 'bg-amber-500',   textColor: 'text-amber-700' },
  }[pacing.status];
  return (
    <div className="space-y-4">
      <div>
        <div className="flex items-center justify-between mb-2">
          <div className="text-sm">
            <span className="font-bold text-slate-900">{formatCurrency(pacing.spent)}</span>
            <span className="text-slate-500"> de {formatCurrency(pacing.planned)} planeado</span>
          </div>
          <div className={cn("text-xs font-bold flex items-center gap-1.5", statusMap.textColor)}>
            <div className={cn("h-2 w-2 rounded-full", statusMap.dot)} />
            {statusMap.text}
          </div>
        </div>
        <div className="relative h-3 rounded-full bg-slate-100 overflow-hidden">
          {/* Marca del avance del mes */}
          <div className="absolute top-0 bottom-0 w-px bg-slate-400" style={{ left: `${pacing.monthProgress * 100}%` }}>
            <div className="absolute -top-1 -translate-x-1/2 h-5 w-0.5 bg-slate-400" />
          </div>
          {/* Barra de gasto */}
          <div className={cn("h-full transition-all duration-500",
            pacing.status === 'over' ? "bg-red-500" : pacing.status === 'under' ? "bg-amber-500" : "bg-emerald-500"
          )} style={{ width: `${Math.min(100, pacing.spendProgress * 100)}%` }} />
        </div>
        <div className="flex justify-between text-[10px] text-slate-400 mt-1">
          <span>Día {Math.round(pacing.monthProgress * 100)}% del mes</span>
          <span>{Math.round(pacing.spendProgress * 100)}% gastado</span>
        </div>
      </div>
      <div className="text-xs text-slate-600 pt-2 border-t border-slate-100">
        A este pace, vas a terminar gastando <strong className="text-slate-900">{formatCurrency(pacing.projectedSpend)}</strong>
        {' '}({pacing.projectedDelta > 0 ? '+' : ''}{(pacing.projectedDelta * 100).toFixed(1)}% del budget).
      </div>
    </div>
  );
}

function BudgetModal({ slug, currentPlanned, onClose, onSaved }: {
  slug: string;
  currentPlanned: number | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const today = new Date();
  const monthStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-01`;
  const monthLabel = today.toLocaleDateString('es-AR', { month: 'long', year: 'numeric' });
  const [value, setValue] = useState(currentPlanned?.toString() ?? '');
  const [saving, setSaving] = useState(false);

  async function save() {
    const num = Number(value);
    if (isNaN(num) || num < 0) return;
    setSaving(true);
    try {
      await api.budgetsSet(slug, monthStr, num);
      onSaved();
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 bg-black/30 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <Card className="p-6 max-w-md w-full" onClick={(e: any) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-bold text-slate-900">Budget de {monthLabel}</h3>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-700"><X size={18} /></button>
        </div>
        <div className="space-y-4">
          <label className="block">
            <span className="text-xs font-semibold text-slate-600 uppercase tracking-wider">Inversión planeada (ARS)</span>
            <input
              type="number"
              value={value}
              onChange={e => setValue(e.target.value)}
              placeholder="ej: 5000000"
              className="mt-2 w-full bg-white border border-slate-200 rounded-lg px-4 py-2 text-lg font-bold tabular-nums focus:outline-none focus:border-slate-400"
              autoFocus
            />
          </label>
          <div className="flex gap-2 pt-2">
            <button onClick={onClose} className="flex-1 px-4 py-2 text-sm font-semibold text-slate-600 hover:bg-slate-50 rounded-lg">Cancelar</button>
            <button onClick={save} disabled={saving || !value} className="flex-1 px-4 py-2 text-sm font-semibold bg-slate-900 text-white rounded-lg hover:bg-slate-700 disabled:opacity-50">
              {saving ? 'Guardando...' : 'Guardar'}
            </button>
          </div>
        </div>
      </Card>
    </div>
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
