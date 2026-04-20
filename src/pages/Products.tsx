import { useParams } from 'react-router-dom';
import { ArrowUpRight, ArrowDownRight, Search } from 'lucide-react';
import { formatCurrency, formatNumber, cn } from '@/lib/utils';
import { Card, CardContent } from '@/components/ui/Card';
import { clients, mockData } from '@/data/mockData';

export default function Products() {
  const { clientSlug } = useParams();
  const data = mockData[clientSlug as keyof typeof mockData] || mockData['andesmar'];
  const currentClient = clients.find(c => c.slug === clientSlug) || clients[0];

  if (!data?.routes) return <div className="p-8 text-slate-500">No hay datos disponibles</div>;

  const routes = data.routes;

  return (
    <div className="py-12 max-w-7xl mx-auto space-y-8 relative z-10">
      
      {/* Header breadcrumbs & Controls */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-slate-200 pb-6">
        <div className="flex items-center gap-2 text-sm text-slate-500 font-medium">
          <span className="hover:text-slate-900 cursor-pointer">{currentClient.name}</span>
          <span>/</span>
          <span className="text-slate-900">Rutas y Productos</span>
        </div>
        
        <div className="flex items-center gap-2">
          <button className="bg-white border border-slate-200 shadow-sm rounded-lg px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 transition-colors">
            Filtro de fechas
          </button>
        </div>
      </div>

      <div className="pt-4">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-bold text-slate-900 tracking-tight">Rutas destacadas por ingresos</h3>
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={14} />
            <input 
              type="text" 
              placeholder="Buscar ruta..." 
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
                {routes.map(route => {
                  const isRevenuePositive = route.revenueDelta > 0;
                  const isArticlesPositive = route.articlesDelta > 0;
                  const isPurchasesPositive = route.purchasesDelta > 0;
                  
                  return (
                    <tr key={route.id} className="hover:bg-slate-50 transition-colors">
                      <td className="px-5 py-4 font-medium text-slate-900">{route.route}</td>
                      
                      <td className="px-5 py-4 text-right tabular-nums">
                        <div className="font-semibold text-slate-900">{formatCurrency(route.revenue)}</div>
                        <div className={cn(
                          "text-[11px] font-bold flex items-center justify-end gap-0.5 mt-1",
                          isRevenuePositive ? "text-[#009960]" : "text-orange-600"
                        )}>
                          {isRevenuePositive ? <ArrowUpRight size={10} strokeWidth={3} /> : <ArrowDownRight size={10} strokeWidth={3} />}
                          {Math.abs(route.revenueDelta).toFixed(1)}%
                        </div>
                      </td>
                      
                      <td className="px-5 py-4 text-right tabular-nums text-slate-600">
                        <div>{formatNumber(route.articles)}</div>
                        <div className={cn(
                          "text-[11px] font-bold flex items-center justify-end gap-0.5 mt-1",
                          isArticlesPositive ? "text-[#009960]" : "text-orange-600"
                        )}>
                          {isArticlesPositive ? <ArrowUpRight size={10} strokeWidth={3} /> : <ArrowDownRight size={10} strokeWidth={3} />}
                          {Math.abs(route.articlesDelta).toFixed(1)}%
                        </div>
                      </td>
                      
                      <td className="px-5 py-4 text-right tabular-nums text-slate-600">
                        <div>{formatNumber(route.purchases)}</div>
                        <div className={cn(
                          "text-[11px] font-bold flex items-center justify-end gap-0.5 mt-1",
                          isPurchasesPositive ? "text-[#009960]" : "text-orange-600"
                        )}>
                          {isPurchasesPositive ? <ArrowUpRight size={10} strokeWidth={3} /> : <ArrowDownRight size={10} strokeWidth={3} />}
                          {Math.abs(route.purchasesDelta).toFixed(1)}%
                        </div>
                      </td>
                      
                      <td className="px-5 py-4 text-right tabular-nums text-slate-500 font-medium">
                        {formatNumber(route.addToCart)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Card>
      </div>
    </div>
  );
}
