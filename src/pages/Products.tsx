import { useParams } from 'react-router-dom';
import { useState, useEffect } from 'react';
import { ArrowUpRight, ArrowDownRight, Search, TrendingUp, TrendingDown, Lightbulb } from 'lucide-react';
import { LineChart, Line, ResponsiveContainer } from 'recharts';
import { formatCurrency, formatNumber, formatPercent, cn } from '@/lib/utils';
import { Card } from '@/components/ui/Card';
import { api, getClients } from '@/lib/api';
import { DateRangePicker, defaultRange } from '@/components/ui/DateRangePicker';
import type { DateRange } from '@/components/ui/DateRangePicker';

type Route = {
  id: string;
  route: string;
  spend: number;
  spendDelta: number;
  purchases: number;
  purchasesDelta: number;
  revenue: number;
  revenueDelta: number;
  cpa: number;
  roas: number;
  channelMix: { meta: number; google: number };
  demand: { clicks: number; impressions: number };
  sparkline: { date: string; spend: number }[];
};

type ProductsData = {
  routes: Route[];
  topGainers: Route[];
  topLosers: Route[];
  opportunities: (Route & { opportunityScore: number })[];
};

export default function Products() {
  const { clientSlug } = useParams();
  const [data, setData] = useState<ProductsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [range, setRange] = useState<DateRange>(defaultRange());

  const allClients = getClients();
  const currentClient = allClients.find(c => c.slug === clientSlug) ?? { name: clientSlug ?? '' };

  useEffect(() => {
    if (!clientSlug) return;
    setLoading(true);
    api.products(clientSlug, range.start, range.end)
      .then(d => setData(d))
      .finally(() => setLoading(false));
  }, [clientSlug, range]);

  if (loading) return <div className="p-8 text-slate-400 animate-pulse">Cargando rutas...</div>;
  if (!data || !data.routes.length) return (
    <div className="py-12 max-w-7xl mx-auto space-y-8 relative z-10">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-slate-200 pb-6">
        <div className="flex items-center gap-2 text-sm text-slate-500 font-medium">
          <span>{currentClient.name}</span>
          <span>/</span>
          <span className="text-slate-900">Rutas</span>
        </div>
      </div>
      <div className="text-slate-500">No hay rutas identificadas en este período.</div>
    </div>
  );

  const filtered = data.routes
    .filter(r => r.route.toLowerCase().includes(search.toLowerCase()))
    .sort((a, b) => {
      // Default: por revenue desc; pero priorizamos rutas con ROAS bajo (rentabilidad mala) ARRIBA
      // para que sean visibles. Mejor: ordenar por revenue desc igual.
      return b.revenue - a.revenue;
    });

  return (
    <div className="py-12 max-w-7xl mx-auto space-y-10 relative z-10">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-slate-200 pb-6">
        <div className="flex items-center gap-2 text-sm text-slate-500 font-medium">
          <span className="hover:text-slate-900 cursor-pointer">{currentClient.name}</span>
          <span>/</span>
          <span className="text-slate-900">Rutas / Destinos</span>
        </div>
        <DateRangePicker value={range} onChange={setRange} />
      </div>

      {/* Movers + Opportunities */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <MoverCard
          title="Mayores subidas"
          icon={<TrendingUp size={16} />}
          color="emerald"
          routes={data.topGainers}
          metric="revenue"
        />
        <MoverCard
          title="Mayores caídas"
          icon={<TrendingDown size={16} />}
          color="orange"
          routes={data.topLosers}
          metric="revenue"
        />
        <Card className="p-6">
          <div className="flex items-center gap-2 mb-4">
            <div className="bg-amber-50 text-amber-600 p-1.5 rounded-lg">
              <Lightbulb size={16} strokeWidth={2.5} />
            </div>
            <h3 className="text-sm font-bold text-slate-900">Oportunidades</h3>
          </div>
          {data.opportunities.length === 0 ? (
            <div className="text-xs text-slate-400 py-4">No hay oportunidades obvias todavía.</div>
          ) : (
            <ul className="space-y-2">
              {data.opportunities.slice(0, 5).map(r => (
                <li key={r.route} className="text-sm">
                  <div className="font-semibold text-slate-900">{r.route}</div>
                  <div className="text-[11px] text-slate-500">
                    {formatNumber(r.demand.clicks)} clicks de búsqueda · gasto {formatCurrency(r.spend)}
                  </div>
                </li>
              ))}
            </ul>
          )}
          <div className="text-[10px] text-slate-400 mt-3 italic">
            Rutas con alta demanda en search pero baja inversión publicitaria.
          </div>
        </Card>
      </div>

      {/* Tabla principal con sparklines */}
      <div className="pt-2">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-bold text-slate-900 tracking-tight">Todas las rutas</h3>
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={14} />
            <input
              type="text"
              placeholder="Buscar ruta..."
              value={search}
              onChange={e => setSearch(e.target.value)}
              className="bg-white border border-slate-200 shadow-sm rounded-lg pl-9 pr-4 py-2 text-sm text-slate-900 focus:outline-none focus:border-slate-300 focus:ring-1 focus:ring-slate-300 transition-all w-64"
            />
          </div>
        </div>

        <Card className="overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm text-left">
              <thead className="bg-[#FCFCFD] text-slate-500 border-b border-slate-100">
                <tr>
                  <th className="px-5 py-4 font-semibold">Ruta</th>
                  <th className="px-5 py-4 font-semibold text-right">Inversión</th>
                  <th className="px-5 py-4 font-semibold text-right">Compras</th>
                  <th className="px-5 py-4 font-semibold text-right">Revenue</th>
                  <th className="px-5 py-4 font-semibold text-right">ROAS</th>
                  <th className="px-5 py-4 font-semibold text-right">CPA</th>
                  <th className="px-5 py-4 font-semibold">Mix de canal</th>
                  <th className="px-5 py-4 font-semibold text-right">Demanda</th>
                  <th className="px-5 py-4 font-semibold text-center">Tendencia</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 bg-white">
                {filtered.map(route => (
                  <tr key={route.id} className="hover:bg-slate-50 transition-colors">
                    <td className="px-5 py-4 font-medium text-slate-900">{route.route}</td>
                    <td className="px-5 py-4 text-right tabular-nums">
                      <div className="font-semibold text-slate-900">{formatCurrency(route.spend)}</div>
                      <Delta value={route.spendDelta} inverted />
                    </td>
                    <td className="px-5 py-4 text-right tabular-nums text-slate-600">
                      <div>{formatNumber(route.purchases)}</div>
                      <Delta value={route.purchasesDelta} />
                    </td>
                    <td className="px-5 py-4 text-right tabular-nums">
                      <div className="font-semibold text-slate-900">{formatCurrency(route.revenue)}</div>
                      <Delta value={route.revenueDelta} />
                    </td>
                    <td className="px-5 py-4 text-right tabular-nums">
                      <RoasBadge roas={route.roas} />
                    </td>
                    <td className="px-5 py-4 text-right tabular-nums text-slate-600">
                      {route.cpa > 0 ? formatCurrency(route.cpa) : '—'}
                    </td>
                    <td className="px-5 py-4">
                      <ChannelMix mix={route.channelMix} />
                    </td>
                    <td className="px-5 py-4 text-right tabular-nums text-slate-500">
                      {route.demand.clicks > 0 ? formatNumber(route.demand.clicks) : '—'}
                      {route.demand.clicks > 0 && <div className="text-[10px] text-slate-400">clicks</div>}
                    </td>
                    <td className="px-5 py-4">
                      <Sparkline data={route.sparkline} />
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

function RoasBadge({ roas }: { roas: number }) {
  if (roas === 0) return <span className="text-slate-300 text-xs">—</span>;
  const colors = roas >= 3
    ? 'bg-emerald-50 text-emerald-700'
    : roas >= 1.5
      ? 'bg-amber-50 text-amber-700'
      : 'bg-orange-50 text-orange-700';
  return (
    <span className={cn("inline-flex px-2 py-0.5 rounded-md text-xs font-bold tabular-nums", colors)}>
      {roas.toFixed(2)}x
    </span>
  );
}

function MoverCard({ title, icon, color, routes, metric }: {
  title: string;
  icon: any;
  color: 'emerald' | 'orange';
  routes: Route[];
  metric: 'revenue' | 'spend';
}) {
  const colorMap = {
    emerald: { bg: 'bg-emerald-50', text: 'text-emerald-600' },
    orange:  { bg: 'bg-orange-50',  text: 'text-orange-600'  },
  }[color];
  return (
    <Card className="p-6">
      <div className="flex items-center gap-2 mb-4">
        <div className={cn("p-1.5 rounded-lg", colorMap.bg, colorMap.text)}>{icon}</div>
        <h3 className="text-sm font-bold text-slate-900">{title}</h3>
      </div>
      {routes.length === 0 ? (
        <div className="text-xs text-slate-400 py-4">Sin movimientos significativos.</div>
      ) : (
        <ul className="space-y-2">
          {routes.slice(0, 5).map(r => {
            const delta = metric === 'revenue' ? r.revenueDelta : r.spendDelta;
            return (
              <li key={r.route} className="flex items-center justify-between gap-2 text-sm">
                <div>
                  <div className="font-semibold text-slate-900">{r.route}</div>
                  <div className="text-[11px] text-slate-500">{formatCurrency(r.revenue)}</div>
                </div>
                <div className={cn(
                  "text-xs font-bold tabular-nums",
                  delta > 0 ? "text-emerald-600" : "text-orange-600"
                )}>
                  {delta > 0 ? '+' : ''}{(delta * 100).toFixed(0)}%
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </Card>
  );
}

function ChannelMix({ mix }: { mix: { meta: number; google: number } }) {
  if (mix.meta + mix.google === 0) return <span className="text-xs text-slate-400">—</span>;
  const metaPct   = Math.round(mix.meta * 100);
  const googlePct = Math.round(mix.google * 100);
  return (
    <div className="flex flex-col gap-1 min-w-[120px]">
      <div className="flex h-2 rounded-full overflow-hidden bg-slate-100">
        <div className="bg-purple-500" style={{ width: `${metaPct}%` }} />
        <div className="bg-blue-500" style={{ width: `${googlePct}%` }} />
      </div>
      <div className="flex gap-2 text-[10px] font-medium text-slate-500">
        <span><span className="text-purple-600">●</span> Meta {metaPct}%</span>
        <span><span className="text-blue-600">●</span> Google {googlePct}%</span>
      </div>
    </div>
  );
}

function Sparkline({ data }: { data: { date: string; spend: number }[] }) {
  if (!data || data.length < 2) {
    return <div className="text-xs text-slate-300 text-center w-[100px]">—</div>;
  }
  return (
    <div className="w-[100px] h-[32px]">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data}>
          <Line type="monotone" dataKey="spend" stroke="#0f172a" strokeWidth={1.5} dot={false} />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

function Delta({ value, inverted }: { value: number; inverted?: boolean }) {
  if (Math.abs(value) < 0.0001) return <div className="text-[11px] text-slate-300 mt-1">—</div>;
  const isPos = value > 0;
  const isGood = inverted ? !isPos : isPos;
  return (
    <div className={cn("text-[11px] font-bold flex items-center justify-end gap-0.5 mt-1", isGood ? "text-[#009960]" : "text-orange-600")}>
      {isPos ? <ArrowUpRight size={10} strokeWidth={3} /> : <ArrowDownRight size={10} strokeWidth={3} />}
      {Math.abs(value * 100).toFixed(1)}%
    </div>
  );
}
