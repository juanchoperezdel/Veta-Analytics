import { useParams } from 'react-router-dom';
import { Search, Filter, ArrowUpRight, ArrowDownRight } from 'lucide-react';
import { mockData } from '@/data/mockData';
import { formatCurrency, formatNumber, formatPercent, cn } from '@/lib/utils';
import { Badge } from '@/components/ui/Badge';

export default function Campaigns() {
  const { clientSlug } = useParams();
  const data = mockData[(clientSlug as keyof typeof mockData) || 'saas-b2b'];

  if (!data) return <div className="p-8">No data found</div>;

  return (
    <div className="p-8 max-w-7xl mx-auto space-y-6">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Campañas</h1>
          <p className="text-sm text-muted mt-1">Performance detallada por campaña activa</p>
        </div>
      </div>

      <div className="flex items-center gap-3">
        <div className="relative flex-1 max-w-md">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-muted" size={16} />
          <input 
            type="text" 
            placeholder="Buscar por nombre..." 
            className="w-full bg-[#111] border border-veta rounded-xl pl-9 pr-4 py-2 text-sm text-foreground focus:outline-none focus:border-veta/50 transition-colors"
          />
        </div>
        <button className="flex items-center gap-2 px-4 py-2 rounded-xl border border-veta bg-[#111] text-sm hover:bg-white/5 transition-colors">
          <Filter size={16} />
          Filtros
        </button>
      </div>

      <div className="border border-veta rounded-xl overflow-hidden bg-[#0A0A0A]">
        <div className="overflow-x-auto">
          <table className="w-full text-sm text-left">
            <thead className="bg-[#111] border-b border-veta text-xs uppercase text-muted font-semibold tracking-wider">
              <tr>
                <th className="px-5 py-4">Campaña</th>
                <th className="px-5 py-4">Estado</th>
                <th className="px-5 py-4 text-right">Inversión</th>
                <th className="px-5 py-4 text-right">Conv.</th>
                <th className="px-5 py-4 text-right">CPA</th>
                <th className="px-5 py-4 text-right">ROAS</th>
                <th className="px-5 py-4 text-right">CTR</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-veta/50">
              {data.campaigns.map((camp) => (
                <tr key={camp.id} className="hover:bg-white/5 transition-colors group cursor-pointer">
                  <td className="px-5 py-4">
                    <div className="font-medium text-foreground">{camp.name}</div>
                    <div className="text-xs text-muted flex items-center gap-2 mt-1">
                      <span className="capitalize">{camp.platform.replace('_', ' ')}</span>
                      <span className="w-1 h-1 rounded-full bg-muted/50" />
                      <span>{camp.objective}</span>
                    </div>
                  </td>
                  <td className="px-5 py-4">
                    <Badge variant={camp.status === 'active' ? 'success' : 'secondary'}>
                      {camp.status === 'active' ? 'Activa' : 'Pausada'}
                    </Badge>
                  </td>
                  <td className="px-5 py-4 text-right font-mono">
                    <div className="text-foreground">{formatCurrency(camp.spend)}</div>
                    <DeltaBadge delta={camp.spendDelta} />
                  </td>
                  <td className="px-5 py-4 text-right font-mono">
                    <div className="text-foreground">{formatNumber(camp.conversions)}</div>
                    <DeltaBadge delta={camp.conversionsDelta} />
                  </td>
                  <td className="px-5 py-4 text-right font-mono">
                    <div className="text-foreground">{formatCurrency(camp.cpa)}</div>
                    <DeltaBadge delta={camp.cpaDelta} inverse />
                  </td>
                  <td className="px-5 py-4 text-right font-mono">
                    <div className="text-foreground">{camp.roas.toFixed(1)}x</div>
                  </td>
                  <td className="px-5 py-4 text-right font-mono text-muted">
                    {formatPercent(camp.ctr)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function DeltaBadge({ delta, inverse = false }: { delta: number, inverse?: boolean }) {
  const isPositive = delta > 0;
  const isGood = inverse ? !isPositive : isPositive;
  
  if (delta === 0) return null;

  return (
    <div className={cn(
      "flex items-center justify-end gap-0.5 text-[11px] font-medium mt-1",
      isGood ? "text-veta" : "text-danger"
    )}>
      {isPositive ? <ArrowUpRight size={10} /> : <ArrowDownRight size={10} />}
      {Math.abs(delta * 100).toFixed(1)}%
    </div>
  );
}
