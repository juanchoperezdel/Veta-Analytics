import { useState } from 'react';
import { Outlet, NavLink, useParams, useNavigate } from 'react-router-dom';
import {
  LayoutDashboard,
  Map,
  Youtube,
  PanelLeftClose,
  PanelLeftOpen,
  ChevronDown,
  MonitorPlay,
  TrendingUp,
  LineChart,
  BarChart3,
  Activity,
  Filter
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { getClients } from '@/lib/api';

export default function AppLayout() {
  const { clientSlug } = useParams();
  const navigate = useNavigate();
  const [collapsed, setCollapsed] = useState(false);
  const [clientDropdownOpen, setClientDropdownOpen] = useState(false);

  const clients = getClients();
  const currentClient = clients.find(c => c.slug === clientSlug)
    ?? clients[0]
    ?? { id: '', slug: clientSlug ?? '', name: clientSlug ?? '', logoInitial: (clientSlug ?? '?')[0].toUpperCase() };

  const navItems = [
    { icon: Activity, label: 'Pulso', path: 'pulse' },
    { icon: LayoutDashboard, label: 'Dashboard', path: 'dashboard' },
    { icon: TrendingUp, label: 'Google Ads', path: 'google-ads' },
    { icon: LineChart, label: 'Meta Ads', path: 'meta-ads' },
    { icon: BarChart3, label: 'Evolutivo', path: 'evolutivo' },
    { icon: Map, label: 'Rutas / Destinos', path: 'products' },
    { icon: Filter, label: 'Embudo', path: 'funnel' },
    { icon: MonitorPlay, label: 'YouTube', path: 'youtube' },
  ];

  return (
    <div className="flex h-screen w-full bg-background overflow-hidden relative font-sans text-foreground">
      <aside 
        className={cn(
          "flex flex-col border-r border-slate-200 bg-[#FCFCFD] transition-all duration-300 z-20",
          collapsed ? "w-[80px]" : "w-[280px]"
        )}
      >
        <div className="h-16 flex items-center px-5 border-b border-slate-100 shrink-0 justify-between">
          {!collapsed && (
            <div className="flex items-center gap-2">
              <div className="bg-[#111827] text-white p-1.5 rounded-lg flex items-center justify-center">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="text-[#FFD028]"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"></polygon></svg>
              </div>
              <span className="font-bold text-[15px] tracking-tight text-slate-900">Veta Analytics</span>
            </div>
          )}
          {collapsed && (
            <div className="mx-auto bg-[#111827] text-white p-1.5 rounded-lg flex items-center justify-center">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="text-[#FFD028]"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"></polygon></svg>
            </div>
          )}
          <button 
            onClick={() => setCollapsed(!collapsed)}
            className="text-slate-400 hover:text-slate-800 transition-colors"
          >
            {collapsed ? <PanelLeftOpen size={16} /> : <PanelLeftClose size={16} />}
          </button>
        </div>

        <nav className="flex-1 py-6 flex flex-col gap-1 px-4 overflow-y-auto">
          <div className="px-3 pb-2 text-[11px] font-semibold text-slate-400 uppercase tracking-wider">
            {!collapsed && "Menú Principal"}
          </div>
          {navItems.map((item) => (
            <NavLink
              key={item.path}
              to={`/${currentClient.slug}/${item.path}`}
              className={({ isActive }) => cn(
                "flex items-center gap-3 px-3 py-2.5 rounded-[12px] transition-all duration-200 text-[14px]",
                isActive 
                  ? "bg-slate-100 text-slate-900 font-semibold" 
                  : "text-slate-500 hover:text-slate-900 hover:bg-slate-50 font-medium"
              )}
            >
              {({ isActive }) => (
                <>
                  <item.icon size={18} strokeWidth={isActive ? 2.5 : 2} className={cn("shrink-0", isActive ? "text-slate-900" : "text-slate-400", collapsed && "mx-auto")} />
                  {!collapsed && <span>{item.label}</span>}
                </>
              )}
            </NavLink>
          ))}
        </nav>

        {!collapsed && (
          <div className="px-4 pb-4">
            <div className="bg-gradient-to-br from-[#E2F5B6] to-[#ABF54C] rounded-[16px] p-4 text-slate-800 shadow-sm relative overflow-hidden">
               <div className="absolute -right-4 -top-4 opacity-50">
                  <svg width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1" strokeLinecap="round" strokeLinejoin="round"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"></polygon></svg>
               </div>
               <p className="font-bold text-sm tracking-tight mb-1 relative z-10">Instala la extensión</p>
               <a href="#" className="text-xs font-semibold underline relative z-10 hover:text-slate-900/70">Instalar ahora</a>
            </div>
          </div>
        )}

        <div className="p-4 border-t border-slate-100 relative bg-[#FCFCFD]">
          <div 
            className="flex items-center gap-3 cursor-pointer p-2 rounded-[12px] hover:bg-slate-50 transition-colors border border-transparent"
            onClick={() => setClientDropdownOpen(!clientDropdownOpen)}
          >
            <div className="h-8 w-8 rounded-full bg-slate-900 text-white flex items-center justify-center font-semibold shrink-0 text-sm shadow-sm ring-2 ring-slate-100">
              {currentClient.logoInitial}
            </div>
            {!collapsed && (
              <div className="flex-1 min-w-0">
                <p className="text-[13px] font-semibold truncate text-slate-900">{currentClient.name}</p>
                <p className="text-[11px] font-medium text-slate-500 truncate">Espacio de trabajo</p>
              </div>
            )}
            {!collapsed && <ChevronDown size={14} className="text-slate-400 shrink-0" />}
          </div>

          {clientDropdownOpen && (
            <div className="absolute bottom-[calc(100%+8px)] left-4 mb-2 w-[calc(100%-32px)] bg-white border border-slate-200 rounded-xl shadow-xl py-1 z-50 overflow-hidden">
              <div className="px-3 py-2 text-[10px] font-bold text-slate-400 uppercase tracking-wider">Cambiar entorno</div>
              {clients.map(c => (
                <button
                  key={c.id}
                  className={cn(
                    "w-full text-left px-3 py-2.5 text-[13px] font-medium hover:bg-slate-50 transition-colors flex items-center gap-2",
                    c.id === currentClient.id && "bg-slate-50 font-semibold text-slate-900"
                  )}
                  onClick={() => {
                    setClientDropdownOpen(false);
                    const currentPath = window.location.pathname.split('/').slice(2).join('/') || 'dashboard';
                    navigate(`/${c.slug}/${currentPath}`);
                  }}
                >
                  <div className="h-5 w-5 rounded-full bg-slate-100 flex items-center justify-center text-[10px] font-bold text-slate-600 border border-slate-200">
                    {c.logoInitial}
                  </div>
                  <span className="truncate">{c.name}</span>
                </button>
              ))}
            </div>
          )}
        </div>
      </aside>

      <main className="flex-1 overflow-auto bg-background relative px-4 md:px-8 shadow-[inset_1px_0_0_rgb(226,232,240)]">
        {/* Soft background light gradients a la Vercel/Linear light mode */}
        <div className="absolute top-[-20%] right-[-10%] w-[50%] h-[50%] rounded-full bg-purple-500/5 blur-[120px] pointer-events-none" />
        <div className="absolute bottom-[-20%] left-[-10%] w-[40%] h-[40%] rounded-full bg-pink-500/5 blur-[120px] pointer-events-none" />
        <Outlet />
      </main>
      
      {clientDropdownOpen && (
        <div 
          className="fixed inset-0 z-40 bg-transparent" 
          onClick={() => setClientDropdownOpen(false)}
        />
      )}
    </div>
  );
}
