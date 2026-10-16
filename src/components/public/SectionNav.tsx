import { useEffect, useState, type MouseEvent } from 'react';
import { cn } from '@/lib/utils';

// Menú de secciones del reporte público (pedido del equipo: ir directo a una sección y
// poder compartir el link que abre justo ahí, ej. /smartway#leads).
// En escritorio es una columna fija a la izquierda; en celular, una tira deslizable.

export type NavItem = { id: string; label: string; highlight?: boolean };

function goTo(id: string) {
  const el = document.getElementById(id);
  if (!el) return;
  el.scrollIntoView({ behavior: 'smooth', block: 'start' });
  // Conserva ?k= y cualquier otro parámetro: solo cambia el #.
  history.replaceState(null, '', `${window.location.pathname}${window.location.search}#${id}`);
}

// Abre la sección del link (#id) una vez que el reporte terminó de cargar.
export function useScrollToHash(ready: boolean) {
  useEffect(() => {
    if (!ready) return;
    const id = decodeURIComponent(window.location.hash.slice(1));
    if (!id) return;
    const t = setTimeout(() => document.getElementById(id)?.scrollIntoView({ block: 'start' }), 150);
    return () => clearTimeout(t);
  }, [ready]);
}

function useActive(ids: string[]) {
  const [active, setActive] = useState<string | null>(null);
  useEffect(() => {
    const els = ids.map(id => document.getElementById(id)).filter(Boolean) as HTMLElement[];
    if (els.length === 0) return;
    const obs = new IntersectionObserver(entries => {
      const vis = entries.filter(e => e.isIntersecting).sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);
      if (vis[0]) setActive(vis[0].target.id);
    }, { rootMargin: '-90px 0px -60% 0px' });
    els.forEach(el => obs.observe(el));
    return () => obs.disconnect();
  }, [ids.join('|')]);
  return active;
}

export function SectionNav({ items, accent }: { items: NavItem[]; accent: string }) {
  const active = useActive(items.map(i => i.id));
  const onClick = (e: MouseEvent, id: string) => { e.preventDefault(); goTo(id); };

  return (
    <>
      {/* Escritorio: columna fija */}
      <aside className="hidden lg:block w-52 shrink-0">
        <nav className="sticky top-24 py-6">
          <p className="px-3 mb-2 text-[10px] font-black uppercase tracking-[.14em] text-slate-400">Secciones</p>
          <ul className="space-y-0.5">
            {items.map(it => {
              const on = active === it.id;
              return (
                <li key={it.id}>
                  <a href={`#${it.id}`} onClick={e => onClick(e, it.id)}
                    className={cn('relative flex items-center gap-2 rounded-lg px-3 py-2 text-[13px] font-semibold transition-colors',
                      on ? 'bg-white text-slate-900 shadow-sm ring-1 ring-slate-200' : 'text-slate-500 hover:text-slate-800 hover:bg-white/60')}>
                    <span className="absolute left-0 top-2 bottom-2 w-[3px] rounded-full transition-opacity" style={{ background: accent, opacity: on ? 1 : 0 }} />
                    <span className="truncate">{it.label}</span>
                    {it.highlight && <span className="ml-auto w-1.5 h-1.5 rounded-full shrink-0" style={{ background: accent }} />}
                  </a>
                </li>
              );
            })}
          </ul>
        </nav>
      </aside>

      {/* Celular: tira deslizable arriba del contenido */}
      <nav className="lg:hidden -mx-5 px-5 overflow-x-auto [scrollbar-width:none]">
        <div className="flex gap-2 w-max pb-1">
          {items.map(it => (
            <a key={it.id} href={`#${it.id}`} onClick={e => onClick(e, it.id)}
              className={cn('whitespace-nowrap rounded-full px-3 py-1.5 text-[12px] font-bold ring-1 transition-colors',
                active === it.id ? 'bg-slate-900 text-white ring-slate-900' : 'bg-white text-slate-600 ring-slate-200')}>
              {it.label}
            </a>
          ))}
        </div>
      </nav>
    </>
  );
}
