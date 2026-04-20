import { useParams } from 'react-router-dom';
import { Clock, ArrowUpRight, ArrowDownRight, MoreHorizontal } from 'lucide-react';
import { formatCurrency, formatNumber, formatPercent, cn } from '@/lib/utils';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/Card';
import { clients, mockData } from '@/data/mockData';
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, PieChart, Pie, Cell } from 'recharts';

export default function Dashboard() {
  const { clientSlug } = useParams();
  const data = mockData[clientSlug as keyof typeof mockData] || mockData['andesmar'];
  const currentClient = clients.find(c => c.slug === clientSlug) || clients[0];

  if (!data) return <div className="p-8 text-slate-500">No hay datos disponibles</div>;

  const kpis = data.businessKpis;

  // Mock mini sparkline data 
  const spark1 = [2,4,3,5,4,6,5,7,6,8,7];
  const spark2 = [8,7,8,6,7,5,6,3,6,8,9];
  const spark3 = [1,2,2,3,4,3,5,6,8,7,9];

  // New Dashboard Additions
  const users = kpis.users.value;
  const carts = kpis.carts.value;
  const purchases = kpis.purchases?.value || kpis.tickets.value;
  const cartRate = (carts / users) * 100;
  const purchaseRate = (purchases / users) * 100;

  const channelData = [
    { name: 'Google Ads', value: kpis.revenue.value * 0.45, color: '#3b82f6' },
    { name: 'Meta Ads', value: kpis.revenue.value * 0.30, color: '#8b5cf6' },
    { name: 'Orgánico', value: kpis.revenue.value * 0.15, color: '#10b981' },
    { name: 'Directo', value: kpis.revenue.value * 0.10, color: '#f59e0b' }
  ];

  // @ts-ignore
  const topRoutes = data.products?.routes?.slice(0, 3) || [
    { route: 'Mendoza - Retiro', revenue: 1545000, purchases: 450 },
    { route: 'Córdoba - Rosario', revenue: 852000, purchases: 210 },
    { route: 'Salta - Tucumán', revenue: 420000, purchases: 130 }
  ];

  return (
    <div className="py-12 max-w-7xl mx-auto space-y-12 relative z-10">
      
      {/* Header breadcrumbs & Controls - Clean light theme */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-slate-200 pb-6">
        <div className="flex items-center gap-2 text-sm text-slate-500 font-medium">
          <span className="hover:text-slate-900 cursor-pointer">{currentClient.name}</span>
          <span>/</span>
          <span className="text-slate-900">Analítica</span>
        </div>
        
        <div className="flex items-center gap-2">
          <button className="bg-white border border-slate-200 shadow-sm rounded-lg px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 transition-colors flex items-center gap-2">
            <Clock size={14} />
            <span>Fechas</span>
          </button>
          <button className="bg-white border border-slate-200 shadow-sm rounded-lg px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 transition-colors flex items-center gap-2">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3"></polygon></svg>
            <span>Filtros</span>
          </button>
        </div>
      </div>

      {/* Hero Section: Jumbo revenue stat */}
      <div className="space-y-6">
        <div>
          <h2 className="text-2xl font-bold tracking-tight text-slate-900">Ingresos totales</h2>
          <h1 className="text-5xl sm:text-6xl font-bold tracking-tighter mt-2 bg-gradient-to-r from-[#9b51e0] to-[#f2c94c] bg-clip-text text-transparent w-max">
            {formatCurrency(kpis.revenue.value)}
          </h1>
        </div>

        {/* Primary 3 Cards Hero (Reference specific) */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          <HeroKpiCard 
            title="Sesiones Totales" 
            value={formatNumber(kpis.sessions.value)} 
            delta={kpis.sessions.delta} 
            sparklineData={spark1} 
            color="#8b5cf6" 
          />
          <HeroKpiCard 
            title="Compras Totales" 
            value={formatNumber(kpis.purchases?.value || kpis.tickets.value)} 
            delta={kpis.purchases?.delta || kpis.tickets.delta} 
            sparklineData={spark2} 
            color="#f59e0b" 
          />
          <HeroKpiCard 
            title="Ticket Promedio" 
            value={formatCurrency(kpis.aov.value)} 
            delta={kpis.aov.delta} 
            sparklineData={spark3} 
            color="#8b5cf6" 
          />
        </div>
      </div>

      {/* Secondary Metrics Section */}
      <div className="pt-6">
        <div className="flex items-center justify-between mb-6">
          <h3 className="text-xl font-bold text-slate-900 tracking-tight">Resumen de Adquisición</h3>
          <button className="text-sm font-semibold text-slate-900 underline hover:text-slate-600 transition-colors">
            Ver detalles
          </button>
        </div>
        
        <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-5 gap-4">
          <SmallKpiCard title="Usuarios Totales" value={formatNumber(kpis.users.value)} delta={kpis.users.delta} />
          <SmallKpiCard title="Tiempo Promedio" value={kpis.avgSessionDuration.value} delta={kpis.avgSessionDuration.delta} />
          <SmallKpiCard title="Tasa de Conv." value={formatPercent(kpis.conversionRate.value)} delta={kpis.conversionRate.delta} />
          <SmallKpiCard title="Carritos" value={formatNumber(kpis.carts.value)} delta={kpis.carts.delta} />
          <SmallKpiCard title="Boletos" value={formatNumber(kpis.tickets.value)} delta={kpis.tickets.delta} />
        </div>
      </div>

      {/* NEW WIDGETS: Channel Distribution, Funnel, Top Products */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 pt-4">
        
        {/* 1. Ingresos por Canal (Donut) */}
        <Card className="hover:shadow-[0_8px_30px_-12px_rgba(0,0,0,0.12)] transition-shadow duration-300">
          <CardContent className="p-6">
            <h3 className="text-[15px] font-bold text-slate-900 tracking-tight mb-1">Ingresos por Canal</h3>
            <p className="text-xs text-slate-500 mb-6 font-medium">Distribución estimada del ROAS blended</p>
            <div className="h-[180px] w-full">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={channelData}
                    cx="50%"
                    cy="50%"
                    innerRadius={60}
                    outerRadius={80}
                    paddingAngle={2}
                    dataKey="value"
                    stroke="none"
                  >
                    {channelData.map((entry, index) => (
                      <Cell key={`cell-${index}`} fill={entry.color} />
                    ))}
                  </Pie>
                  <Tooltip 
                    formatter={(value: number) => formatCurrency(value)}
                    contentStyle={{ borderRadius: '12px', border: '1px solid #f1f5f9', boxShadow: '0 10px 15px -3px rgb(0 0 0 / 0.1), 0 4px 6px -4px rgb(0 0 0 / 0.1)' }}
                    itemStyle={{ color: '#0f172a', fontWeight: '600' }}
                  />
                </PieChart>
              </ResponsiveContainer>
            </div>
            <div className="grid grid-cols-2 gap-3 mt-4">
              {channelData.map((item, i) => (
                <div key={i} className="flex items-center gap-2">
                  <div className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: item.color }} />
                  <span className="text-xs font-semibold text-slate-600">{item.name}</span>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>

        {/* 2. Embudo de Conversión */}
        <Card className="hover:shadow-[0_8px_30px_-12px_rgba(0,0,0,0.12)] transition-shadow duration-300">
          <CardContent className="p-6">
            <h3 className="text-[15px] font-bold text-slate-900 tracking-tight mb-1">Embudo de Conversión</h3>
            <p className="text-xs text-slate-500 mb-6 font-medium">Rendimiento del tráfico en la web</p>
            <div className="space-y-5">
              <div className="relative">
                <div className="flex justify-between text-xs mb-1.5">
                  <span className="font-semibold text-slate-500">Usuarios Totales</span>
                  <span className="font-bold text-slate-900">{formatNumber(users)}</span>
                </div>
                <div className="w-full bg-slate-100 h-6 rounded-md overflow-hidden">
                  <div className="bg-[#3b82f6] opacity-30 h-full rounded-md" style={{ width: '100%' }}></div>
                </div>
              </div>
              <div className="relative">
                <div className="flex justify-between text-xs mb-1.5">
                  <span className="font-semibold text-slate-500">Añadidos al Carrito ({(cartRate).toFixed(1)}%)</span>
                  <span className="font-bold text-slate-900">{formatNumber(carts)}</span>
                </div>
                <div className="w-full bg-slate-100 h-6 rounded-md overflow-hidden">
                  <div className="bg-[#8b5cf6] opacity-60 h-full rounded-md transition-all duration-1000" style={{ width: `${cartRate}%` }}></div>
                </div>
              </div>
              <div className="relative">
                <div className="flex justify-between text-xs mb-1.5">
                  <span className="font-semibold text-slate-500">Compras Realizadas ({(purchaseRate).toFixed(1)}%)</span>
                  <span className="font-bold text-slate-900">{formatNumber(purchases)}</span>
                </div>
                <div className="w-full bg-slate-100 h-6 rounded-md overflow-hidden">
                  <div className="bg-[#10b981] h-full rounded-md transition-all duration-1000" style={{ width: `${Math.max(purchaseRate, 2)}%` }}></div>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* 3. Top 3 Rutas/Productos */}
        <Card className="hover:shadow-[0_8px_30px_-12px_rgba(0,0,0,0.12)] transition-shadow duration-300">
          <CardContent className="p-6 flex flex-col h-full">
            <div>
              <h3 className="text-[15px] font-bold text-slate-900 tracking-tight mb-1">Top 3 Rutas</h3>
              <p className="text-xs text-slate-500 mb-6 font-medium">Mayor rendimiento comercial del mes</p>
            </div>
            <div className="space-y-3 flex-1">
              {topRoutes.map((route: any, i: number) => (
                <div key={i} className="flex items-center justify-between p-3 rounded-[12px] bg-slate-50/80 border border-slate-100 hover:bg-slate-100 transition-colors">
                   <div className="flex items-center gap-3 min-w-0">
                     <div className={cn(
                       "h-8 w-8 rounded-full flex items-center justify-center font-bold text-xs ring-2 ring-white shadow-sm shrink-0",
                       i === 0 ? 'bg-gradient-to-br from-amber-200 to-amber-400 text-amber-900' : 
                       i === 1 ? 'bg-gradient-to-br from-slate-200 to-slate-300 text-slate-700' : 
                       'bg-gradient-to-br from-orange-200 to-orange-300 text-orange-800'
                     )}>
                       #{i + 1}
                     </div>
                     <div className="min-w-0 pr-2">
                       <p className="font-semibold text-[13px] text-slate-900 truncate">{route.route || route.name}</p>
                       <p className="text-[11px] font-medium text-slate-500 mt-0.5">{formatNumber(route.purchases || route.tickets)} ventas</p>
                     </div>
                   </div>
                   <div className="font-bold text-sm text-slate-900 shrink-0">
                     {formatCurrency(route.revenue)}
                   </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>

      </div>
    </div>
  );
}

// Hero card matching the reference design layout
function HeroKpiCard({ title, value, delta, sparklineData, color }: { title: string; value: string; delta: number; sparklineData: number[]; color: string }) {
  const isPositive = delta > 0;
  
  // Create array of objects for recharts
  const chartData = sparklineData.map((val, i) => ({ val, index: i }));
  
  return (
    <Card className="hover:shadow-[0_8px_30px_-12px_rgba(0,0,0,0.12)] transition-shadow duration-300 pointer-events-auto">
      <CardContent className="p-6">
        <div className="flex justify-between items-start mb-6">
          <h3 className="text-[15px] font-medium text-slate-700">{title}</h3>
          <button className="text-slate-400 hover:text-slate-800"><MoreHorizontal size={18}/></button>
        </div>
        
        <div className="flex items-end justify-between">
          <div>
            <div className="flex items-center gap-3">
              <h4 className="text-3xl font-bold text-slate-900 tracking-tight font-sans">{value}</h4>
              <span className={cn(
                "px-2 py-0.5 rounded-md text-xs font-bold flex items-center gap-0.5",
                isPositive ? "bg-green-100 text-[#009960]" : "bg-orange-100 text-orange-600"
              )}>
                {isPositive ? <ArrowUpRight size={12} strokeWidth={3} /> : <ArrowDownRight size={12} strokeWidth={3} />}
                {Math.abs(delta * 100).toFixed(0)}%
              </span>
            </div>
            <p className="text-xs text-slate-500 font-medium mt-1">vs. la semana pasada</p>
          </div>
          
          <div className="w-[100px] h-[40px]">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={chartData}>
                <defs>
                   <linearGradient id={`color-${color}`} x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor={color} stopOpacity={0.2}/>
                    <stop offset="95%" stopColor={color} stopOpacity={0}/>
                  </linearGradient>
                </defs>
                <Area 
                  type="monotone" 
                  dataKey="val" 
                  stroke={color} 
                  strokeWidth={2}
                  fill={`url(#color-${color})`} 
                  isAnimationActive={false}
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

// Smaller secondary metric cards
function SmallKpiCard({ title, value, delta }: { title: string; value: string; delta: number; }) {
  const isPositive = delta > 0;
  
  return (
    <Card className="hover:shadow-[0_8px_30px_-12px_rgba(0,0,0,0.12)] transition-shadow duration-300">
      <CardContent className="p-5 flex flex-col justify-between h-full">
        <div>
          <p className="text-[13px] font-semibold text-slate-500 tracking-tight mb-2">{title}</p>
          <div className="flex items-baseline gap-2">
             <h4 className="text-xl font-bold font-sans tracking-tight text-slate-900">{value}</h4>
          </div>
          <div className="flex items-center gap-1 mt-2 text-xs font-semibold">
            <span className={cn(
              "flex items-center",
              isPositive ? "text-[#009960]" : "text-orange-600"
            )}>
              {isPositive ? <ArrowUpRight size={12} strokeWidth={3} /> : <ArrowDownRight size={12} strokeWidth={3} />}
              {Math.abs(delta * 100).toFixed(1)}%
            </span>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
