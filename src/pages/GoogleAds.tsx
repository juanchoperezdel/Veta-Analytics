import { useParams } from 'react-router-dom';
import { useState, useEffect } from 'react';
import { ArrowUpRight, ArrowDownRight, Search, Sparkles, AlertCircle } from 'lucide-react';
import { formatCurrency, formatNumber, formatPercent, cn } from '@/lib/utils';
import { Card, CardContent } from '@/components/ui/Card';
import { api, getClients } from '@/lib/api';
import { DateRangePicker, defaultRange } from '@/components/ui/DateRangePicker';
import type { DateRange } from '@/components/ui/DateRangePicker';
import type { GoogleAdsCampaign, PlatformKPIs } from '@/data/types';

type SearchTerm = {
  term: string; route: string | null;
  clicks: number; impressions: number; cost: number; conversions: number;
  convValue: number; cpa: number; roas: number;
};
type SearchTermsData = {
  topConverters: SearchTerm[];
  wastedSpend: SearchTerm[];
  topByVolume: SearchTerm[];
  demand: { route: string; clicks: number; impressions: number; cost: number; conversions: number }[];
  totalUniqueTerms: number;
};

export default function GoogleAds() {
  const { clientSlug } = useParams();
  const [kpis, setKpis] = useState<PlatformKPIs | null>(null);
  const [campaigns, setCampaigns] = useState<GoogleAdsCampaign[]>([]);
  const [searchTerms, setSearchTerms] = useState<SearchTermsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [range, setRange] = useState<DateRange>(defaultRange());

  const allClients = getClients();
  const currentClient = allClients.find(c => c.slug === clientSlug) ?? { name: clientSlug ?? '' };

  useEffect(() => {
    if (!clientSlug) return;
    setLoading(true);
    Promise.all([
      api.googleAds(clientSlug, range.start, range.end),
      api.searchTerms(clientSlug, range.start, range.end),
    ]).then(([gads, st]) => {
      setKpis(gads.kpis);
      setCampaigns(gads.campaigns ?? []);
      setSearchTerms(st);
    }).finally(() => setLoading(false));
  }, [clientSlug, range]);

  if (loading) return <div className="p-8 text-slate-400 animate-pulse">Cargando datos...</div>;
  if (!kpis) return <div className="p-8 text-slate-500">No hay datos disponibles</div>;

  const filtered = campaigns.filter(c => c.name.toLowerCase().includes(search.toLowerCase()));

  return (
    <div className="py-12 max-w-7xl mx-auto space-y-8 relative z-10">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-slate-200 pb-6">
        <div className="flex items-center gap-2 text-sm text-slate-500 font-medium">
          <span className="hover:text-slate-900 cursor-pointer">{currentClient.name}</span>
          <span>/</span>
          <span className="text-slate-900">Google Ads</span>
        </div>
        <DateRangePicker value={range} onChange={setRange} />
      </div>

      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
        <SmallKpiCard title="Inversión"  value={formatCurrency(kpis.spend.value)}        delta={kpis.spend.delta}           inverseDelta />
        <SmallKpiCard title="Ingresos"   value={formatCurrency(kpis.revenue.value)}       delta={kpis.revenue.delta} />
        <SmallKpiCard title="ROAS"       value={`${kpis.roas.value.toFixed(2)}x`}         delta={kpis.roas.delta} />
        <SmallKpiCard title="CPA"        value={formatCurrency(kpis.cpa?.value ?? 0)}     delta={kpis.cpa?.delta ?? 0}       inverseDelta />
        <SmallKpiCard title="Carritos"   value={formatNumber(kpis.carts?.value ?? 0)}     delta={kpis.carts?.delta ?? 0} />
        <SmallKpiCard title="AOV"        value={formatCurrency(kpis.aov?.value ?? 0)}     delta={kpis.aov?.delta ?? 0} />
      </div>

      {/* Search Terms: 3 secciones */}
      {searchTerms && searchTerms.totalUniqueTerms > 0 && (
        <div className="pt-4 space-y-4">
          <h3 className="text-lg font-bold text-slate-900 tracking-tight">
            Search Terms <span className="text-sm font-medium text-slate-400">· {formatNumber(searchTerms.totalUniqueTerms)} queries únicas</span>
          </h3>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <SearchTermsTable
              title="Top conversores"
              icon={<Sparkles size={16} />}
              color="emerald"
              terms={searchTerms.topConverters}
              showRoas
            />
            <SearchTermsTable
              title="Gasto sin conversión"
              subtitle="Candidatos a negative keyword"
              icon={<AlertCircle size={16} />}
              color="orange"
              terms={searchTerms.wastedSpend}
              showRoas={false}
            />
          </div>
          {searchTerms.demand.length > 0 && (
            <Card className="p-5">
              <h4 className="text-sm font-bold text-slate-900 mb-3">Demanda por destino <span className="text-xs font-medium text-slate-400 ml-1">(según search terms)</span></h4>
              <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-3">
                {searchTerms.demand.slice(0, 10).map(d => (
                  <div key={d.route} className="bg-slate-50 rounded-xl p-3">
                    <div className="text-xs font-semibold text-slate-900">{d.route}</div>
                    <div className="text-lg font-bold tabular-nums text-slate-900 mt-1">{formatNumber(d.clicks)}</div>
                    <div className="text-[10px] text-slate-500">clicks · {formatNumber(d.impressions)} imp.</div>
                  </div>
                ))}
              </div>
            </Card>
          )}
        </div>
      )}

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
                  <th className="px-5 py-4 font-semibold">Campaña</th>
                  <th className="px-5 py-4 font-semibold text-right">Inversión</th>
                  <th className="px-5 py-4 font-semibold text-right">Impresiones</th>
                  <th className="px-5 py-4 font-semibold text-right">Clics</th>
                  <th className="px-5 py-4 font-semibold text-right">CTR</th>
                  <th className="px-5 py-4 font-semibold text-right">CPC</th>
                  <th className="px-5 py-4 font-semibold text-right">Ingresos</th>
                  <th className="px-5 py-4 font-semibold text-right">ROAS</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 bg-white">
                {filtered.map(camp => (
                  <tr key={camp.id} className="hover:bg-slate-50 transition-colors">
                    <td className="px-5 py-4 font-medium text-slate-900">{camp.name}</td>
                    <td className="px-5 py-4 text-right tabular-nums text-slate-600">{formatCurrency(camp.spend)}</td>
                    <td className="px-5 py-4 text-right tabular-nums text-slate-600">{formatNumber(camp.impressions)}</td>
                    <td className="px-5 py-4 text-right tabular-nums text-slate-600">{formatNumber(camp.clicks)}</td>
                    <td className="px-5 py-4 text-right tabular-nums text-slate-600">{formatPercent(camp.ctr)}</td>
                    <td className="px-5 py-4 text-right tabular-nums text-slate-600">{formatCurrency(camp.cpc)}</td>
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

function SearchTermsTable({ title, subtitle, icon, color, terms, showRoas }: {
  title: string;
  subtitle?: string;
  icon: any;
  color: 'emerald' | 'orange';
  terms: SearchTerm[];
  showRoas: boolean;
}) {
  const colorMap = {
    emerald: { bg: 'bg-emerald-50', text: 'text-emerald-600' },
    orange:  { bg: 'bg-orange-50',  text: 'text-orange-600'  },
  }[color];
  return (
    <Card className="p-5">
      <div className="flex items-center gap-2 mb-3">
        <div className={cn("p-1.5 rounded-lg", colorMap.bg, colorMap.text)}>{icon}</div>
        <div>
          <h4 className="text-sm font-bold text-slate-900">{title}</h4>
          {subtitle && <p className="text-[10px] text-slate-400 font-medium">{subtitle}</p>}
        </div>
      </div>
      {terms.length === 0 ? (
        <div className="text-xs text-slate-400 py-4">Sin queries en esta categoría.</div>
      ) : (
        <div className="overflow-x-auto -mx-2">
          <table className="w-full text-xs">
            <thead className="text-slate-400">
              <tr>
                <th className="px-2 py-1.5 text-left font-semibold">Query</th>
                <th className="px-2 py-1.5 text-right font-semibold">Clicks</th>
                <th className="px-2 py-1.5 text-right font-semibold">Costo</th>
                {showRoas && <th className="px-2 py-1.5 text-right font-semibold">ROAS</th>}
                {!showRoas && <th className="px-2 py-1.5 text-right font-semibold">Conv.</th>}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {terms.slice(0, 10).map((t, i) => (
                <tr key={t.term + i} className="hover:bg-slate-50">
                  <td className="px-2 py-1.5 text-slate-900 truncate max-w-[180px]" title={t.term}>{t.term}</td>
                  <td className="px-2 py-1.5 text-right tabular-nums text-slate-600">{formatNumber(t.clicks)}</td>
                  <td className="px-2 py-1.5 text-right tabular-nums text-slate-600">{formatCurrency(t.cost)}</td>
                  {showRoas && (
                    <td className={cn("px-2 py-1.5 text-right tabular-nums font-bold",
                      t.roas >= 3 ? "text-emerald-600" : t.roas >= 1.5 ? "text-amber-600" : "text-orange-600"
                    )}>
                      {t.roas > 0 ? `${t.roas.toFixed(1)}x` : '—'}
                    </td>
                  )}
                  {!showRoas && (
                    <td className="px-2 py-1.5 text-right tabular-nums text-slate-500">{t.conversions.toFixed(1)}</td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
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
