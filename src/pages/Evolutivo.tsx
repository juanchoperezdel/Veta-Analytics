import { useParams } from 'react-router-dom';
import { useState, useEffect, useMemo } from 'react';
import { ArrowUpRight, ArrowDownRight } from 'lucide-react';
import { formatCurrency, formatNumber, cn } from '@/lib/utils';
import { Card, CardContent } from '@/components/ui/Card';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from 'recharts';
import { api, getClients } from '@/lib/api';

type ChannelData = { spend: number; revenue: number; purchases: number; roas: number };
type MonthRow = { month: string; meta: ChannelData; google: ChannelData; total: ChannelData };

const METRICS = [
  { key: 'spend',     label: 'Inversión', format: (v: number) => formatCurrency(v) },
  { key: 'revenue',   label: 'Ingresos',  format: (v: number) => formatCurrency(v) },
  { key: 'purchases', label: 'Compras',   format: (v: number) => formatNumber(v) },
  { key: 'roas',      label: 'ROAS',      format: (v: number) => `${v.toFixed(2)}x` },
] as const;

type MetricKey = typeof METRICS[number]['key'];

const MONTH_NAMES_ES = ['Ene','Feb','Mar','Abr','May','Jun','Jul','Ago','Sep','Oct','Nov','Dic'];
function formatMonth(ym: string) {
  const [y, m] = ym.split('-').map(Number);
  return `${MONTH_NAMES_ES[m - 1]} ${String(y).slice(2)}`;
}

export default function Evolutivo() {
  const { clientSlug } = useParams();
  const [months, setMonths] = useState<MonthRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [metric, setMetric] = useState<MetricKey>('revenue');

  const allClients = getClients();
  const currentClient = allClients.find(c => c.slug === clientSlug) ?? { name: clientSlug ?? '' };

  useEffect(() => {
    if (!clientSlug) return;
    setLoading(true);
    api.evolutivo(clientSlug)
      .then(data => setMonths(data.months ?? []))
      .finally(() => setLoading(false));
  }, [clientSlug]);

  const metricDef = METRICS.find(m => m.key === metric)!;

  const chartData = useMemo(() => months.map(m => ({
    month:  formatMonth(m.month),
    raw:    m.month,
    Meta:   m.meta[metric],
    Google: m.google[metric],
    Total:  m.total[metric],
  })), [months, metric]);

  const tableRows = useMemo(() => {
    const byMonth = Object.fromEntries(months.map(m => [m.month, m]));
    return [...months].reverse().map(curr => {
      const [y, mo] = curr.month.split('-').map(Number);
      const prevKey = `${y - 1}-${String(mo).padStart(2, '0')}`;
      const prev = byMonth[prevKey];
      const currVal = curr.total[metric];
      const prevVal = prev?.total[metric] ?? 0;
      const delta = prevVal > 0 ? (currVal - prevVal) / prevVal : null;
      return { month: curr.month, meta: curr.meta, google: curr.google, total: curr.total, prevTotal: prev?.total, delta };
    });
  }, [months, metric]);

  if (loading) return <div className="p-8 text-slate-400 animate-pulse">Cargando datos...</div>;
  if (!months.length) return <div className="p-8 text-slate-500">No hay datos disponibles</div>;

  return (
    <div className="py-12 max-w-7xl mx-auto space-y-8 relative z-10">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-slate-200 pb-6">
        <div className="flex items-center gap-2 text-sm text-slate-500 font-medium">
          <span className="hover:text-slate-900 cursor-pointer">{currentClient.name}</span>
          <span>/</span>
          <span className="text-slate-900">Evolutivo</span>
        </div>

        <div className="flex gap-1 bg-white border border-slate-200 rounded-lg p-1 shadow-sm">
          {METRICS.map(m => (
            <button
              key={m.key}
              onClick={() => setMetric(m.key)}
              className={cn(
                'px-3 py-1.5 text-sm font-medium rounded-md transition-colors',
                metric === m.key ? 'bg-[#111827] text-white' : 'text-slate-600 hover:bg-slate-50'
              )}
            >
              {m.label}
            </button>
          ))}
        </div>
      </div>

      <div>
        <h2 className="text-2xl font-bold tracking-tight text-slate-900">{metricDef.label} por mes</h2>
        <p className="text-sm text-slate-500 font-medium mt-1">Evolución mensual por canal desde el inicio del tracking</p>
      </div>

      <Card>
        <CardContent className="p-6">
          <div className="h-[380px] w-full">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={chartData} margin={{ top: 10, right: 30, left: 10, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                <XAxis dataKey="month" stroke="#94a3b8" fontSize={12} tickLine={false} axisLine={false} />
                <YAxis stroke="#94a3b8" fontSize={12} tickLine={false} axisLine={false} tickFormatter={v => metric === 'roas' ? `${v.toFixed(1)}x` : formatNumber(v)} />
                <Tooltip
                  formatter={(value: number) => metricDef.format(value)}
                  contentStyle={{ borderRadius: '12px', border: '1px solid #f1f5f9', boxShadow: '0 10px 15px -3px rgb(0 0 0 / 0.1)' }}
                  itemStyle={{ fontWeight: 600 }}
                />
                <Legend wrapperStyle={{ paddingTop: 12, fontSize: 13, fontWeight: 600 }} />
                <Line type="monotone" dataKey="Meta"   stroke="#8b5cf6" strokeWidth={2.5} dot={{ r: 3 }} />
                <Line type="monotone" dataKey="Google" stroke="#3b82f6" strokeWidth={2.5} dot={{ r: 3 }} />
                <Line type="monotone" dataKey="Total"  stroke="#111827" strokeWidth={2.5} dot={{ r: 3 }} strokeDasharray="4 4" />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </CardContent>
      </Card>

      <div className="pt-4">
        <h3 className="text-lg font-bold text-slate-900 tracking-tight mb-4">Tabla mensual · {metricDef.label}</h3>

        <Card className="overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm text-left">
              <thead className="bg-[#FCFCFD] text-slate-500 border-b border-slate-100">
                <tr>
                  <th className="px-5 py-4 font-semibold">Mes</th>
                  <th className="px-5 py-4 font-semibold text-right">Meta</th>
                  <th className="px-5 py-4 font-semibold text-right">Google</th>
                  <th className="px-5 py-4 font-semibold text-right">Total</th>
                  <th className="px-5 py-4 font-semibold text-right">Año anterior</th>
                  <th className="px-5 py-4 font-semibold text-right">YoY</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 bg-white">
                {tableRows.map(row => (
                  <tr key={row.month} className="hover:bg-slate-50 transition-colors">
                    <td className="px-5 py-4 font-semibold text-slate-900">{formatMonth(row.month)}</td>
                    <td className="px-5 py-4 text-right tabular-nums text-slate-600">{metricDef.format(row.meta[metric])}</td>
                    <td className="px-5 py-4 text-right tabular-nums text-slate-600">{metricDef.format(row.google[metric])}</td>
                    <td className="px-5 py-4 text-right tabular-nums font-semibold text-slate-900">{metricDef.format(row.total[metric])}</td>
                    <td className="px-5 py-4 text-right tabular-nums text-slate-400">
                      {row.prevTotal ? metricDef.format(row.prevTotal[metric]) : '—'}
                    </td>
                    <td className="px-5 py-4 text-right tabular-nums">
                      {row.delta === null ? <span className="text-slate-400">—</span> : <DeltaBadge value={row.delta} />}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      </div>
    </div>
  );
}

function DeltaBadge({ value }: { value: number }) {
  const isPos = value > 0;
  return (
    <span className={cn(
      'inline-flex items-center gap-0.5 text-xs font-bold',
      isPos ? 'text-[#009960]' : 'text-orange-600'
    )}>
      {isPos ? <ArrowUpRight size={12} strokeWidth={3} /> : <ArrowDownRight size={12} strokeWidth={3} />}
      {Math.abs(value * 100).toFixed(1)}%
    </span>
  );
}
