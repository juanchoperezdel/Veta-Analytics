import { useParams } from 'react-router-dom';
import { Search } from 'lucide-react';
import { formatCurrency, formatNumber, formatPercent } from '@/lib/utils';
import { Card } from '@/components/ui/Card';
import { clients, mockData } from '@/data/mockData';

export default function YouTube() {
  const { clientSlug } = useParams();
  const data = mockData[clientSlug as keyof typeof mockData] || mockData['andesmar'];
  const currentClient = clients.find(c => c.slug === clientSlug) || clients[0];

  if (!data?.youtube) return <div className="p-8 text-slate-500">No hay datos disponibles</div>;

  const videos = data.youtube;

  return (
    <div className="py-12 max-w-7xl mx-auto space-y-8 relative z-10">
      
      {/* Header breadcrumbs & Controls */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-slate-200 pb-6">
        <div className="flex items-center gap-2 text-sm text-slate-500 font-medium">
          <span className="hover:text-slate-900 cursor-pointer">{currentClient.name}</span>
          <span>/</span>
          <span className="text-slate-900">YouTube Ads</span>
        </div>
        
        <div className="flex items-center gap-2">
          <button className="bg-white border border-slate-200 shadow-sm rounded-lg px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 transition-colors">
            Filtro de fechas
          </button>
        </div>
      </div>

      <div className="pt-4">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-bold text-slate-900 tracking-tight">Contenido de mayor rendimiento</h3>
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={14} />
            <input 
              type="text" 
              placeholder="Buscar videos..." 
              className="bg-white border border-slate-200 shadow-sm rounded-lg pl-9 pr-4 py-2 text-sm text-slate-900 focus:outline-none focus:border-slate-300 focus:ring-1 focus:ring-slate-300 transition-all w-64"
            />
          </div>
        </div>

        <Card className="overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm text-left">
              <thead className="bg-[#FCFCFD] text-slate-500 border-b border-slate-100">
                <tr>
                  <th className="px-5 py-4 font-semibold min-w-[300px]">Video</th>
                  <th className="px-5 py-4 font-semibold">Campaña</th>
                  <th className="px-5 py-4 font-semibold text-right">Inversión</th>
                  <th className="px-5 py-4 font-semibold text-right">Impresiones</th>
                  <th className="px-5 py-4 font-semibold text-right">Clics</th>
                  <th className="px-5 py-4 font-semibold text-right">CTR</th>
                  <th className="px-5 py-4 font-semibold text-right">Tasa Conversión</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 bg-white">
                {videos.map(video => (
                  <tr key={video.id} className="hover:bg-slate-50 transition-colors">
                    <td className="px-5 py-4 font-medium text-slate-900">
                      <div className="line-clamp-2">{video.title}</div>
                    </td>
                    <td className="px-5 py-4 text-slate-500">{video.campaign}</td>
                    <td className="px-5 py-4 text-right tabular-nums text-slate-600">{formatCurrency(video.spend)}</td>
                    <td className="px-5 py-4 text-right tabular-nums text-slate-600">{formatNumber(video.impressions)}</td>
                    <td className="px-5 py-4 text-right tabular-nums text-slate-600">{formatNumber(video.clicks)}</td>
                    <td className="px-5 py-4 text-right tabular-nums text-slate-600">{formatPercent(video.ctr)}</td>
                    <td className="px-5 py-4 text-right tabular-nums font-semibold text-slate-900">{formatPercent(video.conversionRate)}</td>
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
