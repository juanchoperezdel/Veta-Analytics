import { useParams } from 'react-router-dom';
import { useState, useEffect } from 'react';
import { ArrowUpRight, ArrowDownRight, Search } from 'lucide-react';
import { formatCurrency, formatNumber, cn } from '@/lib/utils';
import { Card } from '@/components/ui/Card';
import { api, getClients } from '@/lib/api';
import { DateRangePicker, defaultRange } from '@/components/ui/DateRangePicker';
import type { DateRange } from '@/components/ui/DateRangePicker';
import type { ProductRoute } from '@/data/types';

export default function Products() {
  const { clientSlug } = useParams();
  const [routes, setRoutes] = useState<ProductRoute[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [range, setRange] = useState<DateRange>(defaultRange());

  const allClients = getClients();
  const currentClient = allClients.find(c => c.slug === clientSlug) ?? { name: clientSlug ?? '' };

  useEffect(() => {
    if (!clientSlug) return;
    setLoading(true);
    api.products(clientSlug, range.start, range.end)
      .then(data => setRoutes(data.routes ?? []))
      .finally(() => setLoading(false));
  }, [clientSlug, range]);

  if (loading) return <div className="p-8 text-slate-400 animate-pulse">Cargando datos...</div>;
  if (!routes.length) return <div className="p-8 text-slate-500">No hay datos disponibles</div>;

  const filtered = routes.filter(r => r.route.toLowerCase().includes(search.toLowerCase()));

  return (
    <div className="py-12 max-w-7xl mx-auto space-y-8 relative z-10">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-slate-200 pb-6">
        <div className="flex items-center gap-2 text-sm text-slate-500 font-medium">
          <span className="hover:text-slate-900 cursor-pointer">{currentClient.name}</span>
          <span>/</span>
          <span className="text-slate-900">Rutas y Productos</span>
        </div>
        <DateRangePicker value={range} onChange={setRange} />
      </div>

      <div className="pt-4">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-bold text-slate-900 tracking-tight">Rutas destacadas por ingresos</h3>
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
                  <th className="px-5 py-4 font-semibold text-right">Ingresos</th>
                  <th className="px-5 py-4 font-semibold text-right">Boletos (Artículos)</th>
                  <th className="px-5 py-4 font-semibold text-right">Compras</th>
                  <th className="px-5 py-4 font-semibold text-right">Añadidos al Carrito</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 bg-white">
                {filtered.map(route => (
                  <tr key={route.id} className="hover:bg-slate-50 transition-colors">
                    <td className="px-5 py-4 font-medium text-slate-900">{route.route}</td>
                    <td className="px-5 py-4 text-right tabular-nums">
                      <div className="font-semibold text-slate-900">{formatCurrency(route.revenue)}</div>
                      <Delta value={route.revenueDelta} percent />
                    </td>
                    <td className="px-5 py-4 text-right tabular-nums text-slate-600">
                      <div>{formatNumber(route.articles)}</div>
                      <Delta value={route.articlesDelta} percent />
                    </td>
                    <td className="px-5 py-4 text-right tabular-nums text-slate-600">
                      <div>{formatNumber(route.purchases)}</div>
                      <Delta value={route.purchasesDelta} percent />
                    </td>
                    <td className="px-5 py-4 text-right tabular-nums text-slate-500 font-medium">
                      {formatNumber(route.addToCart)}
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

function Delta({ value, percent }: { value: number; percent?: boolean }) {
  const isPos = value > 0;
  return (
    <div className={cn("text-[11px] font-bold flex items-center justify-end gap-0.5 mt-1", isPos ? "text-[#009960]" : "text-orange-600")}>
      {isPos ? <ArrowUpRight size={10} strokeWidth={3} /> : <ArrowDownRight size={10} strokeWidth={3} />}
      {Math.abs(value * 100).toFixed(1)}{percent ? '%' : ''}
    </div>
  );
}
