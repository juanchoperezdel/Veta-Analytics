import { useParams } from 'react-router-dom';
import { useState, useEffect } from 'react';
import { ArrowUpRight, ArrowDownRight, Search } from 'lucide-react';
import { formatCurrency, formatNumber, cn } from '@/lib/utils';
import { Card, CardContent } from '@/components/ui/Card';
import { api, getClients } from '@/lib/api';
import type { MetaAdsCampaign, PlatformKPIs } from '@/data/types';

export default function MetaAds() {
  const { clientSlug } = useParams();
  const [kpis, setKpis] = useState<PlatformKPIs | null>(null);
  const [campaigns, setCampaigns] = useState<MetaAdsCampaign[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');

  const allClients = getClients();
  const currentClient = allClients.find(c => c.slug === clientSlug) ?? { name: clientSlug ?? '' };

  useEffect(() => {
    if (!clientSlug) return;
    setLoading(true);
    api.metaAds(clientSlug)
      .then(data => { setKpis(data.kpis); setCampaigns(data.campaigns ?? []); })
      .finally(() => setLoading(false));
  }, [clientSlug]);

  if (loading) return <div className="p-8 text-slate-400 animate-pulse">Cargando datos...</div>;
  if (!kpis) return <div className="p-8 text-slate-500">No hay datos disponibles</div>;

  const filtered = campaigns.filter(c =>
    c.segment.toLowerCase().includes(search.toLowerCase()) || c.type.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div className="py-12 max-w-7xl mx-auto space-y-8 relative z-10">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-slate-200 pb-6">
        <div className="flex items-center gap-2 text-sm text-slate-500 font-medium">
          <span className="hover:text-slate-900 cursor-pointer">{currentClient.name}</span>
          <span>/</span>
          <span className="text-slate-900">Meta Ads</span>
        </div>
        <button className="bg-white border border-slate-200 shadow-sm rounded-lg px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 transition-colors">
          Filtro de fechas
        </button>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-6 gap-4">
        <SmallKpiCard title="Inversión" value={formatCurrency(kpis.spend.value)}          delta={kpis.spend.delta}              inverseDelta />
        <SmallKpiCard title="Compras"   value={formatNumber(kpis.purchases?.value ?? 0)}  delta={kpis.purchases?.delta ?? 0} />
        <SmallKpiCard title="Ingresos"  value={formatCurrency(kpis.revenue.value)}         delta={kpis.revenue.delta} />
        <SmallKpiCard title="CPA"       value={formatCurrency(kpis.cpa?.value ?? 0)}       delta={kpis.cpa?.delta ?? 0}          inverseDelta />
        <SmallKpiCard title="ROAS"      value={`${kpis.roas.value.toFixed(2)}x`}           delta={kpis.roas.delta} />
        <SmallKpiCard title="AOV"       value={formatCurrency(kpis.aov?.value ?? 0)}       delta={kpis.aov?.delta ?? 0} />
      </div>

      <div className="pt-4">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-bold text-slate-900 tracking-tight">Campañas recientes</h3>
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={14} />
            <input
              type="text"
              placeholder="Buscar campañas..."
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
                  <th className="px-5 py-4 font-semibold">Segmento / Nombre</th>
                  <th className="px-5 py-4 font-semibold">Tipo</th>
                  <th className="px-5 py-4 font-semibold text-right">Inversión</th>
                  <th className="px-5 py-4 font-semibold text-right">Alcance</th>
                  <th className="px-5 py-4 font-semibold text-right">Compras</th>
                  <th className="px-5 py-4 font-semibold text-right">CPA</th>
                  <th className="px-5 py-4 font-semibold text-right">Ingresos</th>
                  <th className="px-5 py-4 font-semibold text-right">ROAS</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 bg-white">
                {filtered.map(camp => (
                  <tr key={camp.id} className="hover:bg-slate-50 transition-colors">
                    <td className="px-5 py-4 font-medium text-slate-900">{camp.segment}</td>
                    <td className="px-5 py-4 text-slate-500">{camp.type}</td>
                    <td className="px-5 py-4 text-right tabular-nums text-slate-600">{formatCurrency(camp.spend)}</td>
                    <td className="px-5 py-4 text-right tabular-nums text-slate-600">{formatNumber(camp.reach)}</td>
                    <td className="px-5 py-4 text-right tabular-nums text-slate-600">{formatNumber(camp.purchases)}</td>
                    <td className="px-5 py-4 text-right tabular-nums text-slate-600">{formatCurrency(camp.cpa)}</td>
                    <td className="px-5 py-4 text-right tabular-nums font-semibold text-slate-900">{formatCurrency(camp.revenue)}</td>
                    <td className="px-5 py-4 text-right tabular-nums font-bold text-[#009960]">{camp.roas > 0 ? `${camp.roas.toFixed(2)}x` : '-'}</td>
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

function SmallKpiCard({ title, value, delta, inverseDelta = false }: { title: string; value: string; delta: number; inverseDelta?: boolean }) {
  const isPositive = delta > 0;
  const isGood = inverseDelta ? !isPositive : isPositive;
  return (
    <Card className="hover:shadow-[0_8px_30px_-12px_rgba(0,0,0,0.12)] transition-shadow duration-300">
      <CardContent className="p-5 flex flex-col justify-between h-full">
        <p className="text-[13px] font-semibold text-slate-500 tracking-tight mb-2">{title}</p>
        <h4 className="text-xl font-bold font-sans tracking-tight text-slate-900">{value}</h4>
        <div className="flex items-center gap-1 mt-2 text-xs font-semibold">
          <span className={cn("flex items-center", isGood ? "text-[#009960]" : "text-orange-600")}>
            {isPositive ? <ArrowUpRight size={12} strokeWidth={3} /> : <ArrowDownRight size={12} strokeWidth={3} />}
            {Math.abs(delta * 100).toFixed(1)}%
          </span>
        </div>
      </CardContent>
    </Card>
  );
}
