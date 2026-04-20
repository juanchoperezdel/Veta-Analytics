import { useState, useRef, useEffect } from 'react';
import { CalendarDays, ChevronDown } from 'lucide-react';
import { cn } from '@/lib/utils';

export type DateRange = { start: string; end: string; label: string };

const PRESETS: DateRange[] = [
  { label: 'Últimos 7 días',  start: daysAgo(6),  end: today() },
  { label: 'Últimos 30 días', start: daysAgo(29), end: today() },
  { label: 'Últimos 90 días', start: daysAgo(89), end: today() },
];

export function defaultRange(): DateRange { return PRESETS[1]; }

function today() { return new Date().toISOString().split('T')[0]; }
function daysAgo(n: number) {
  const d = new Date(); d.setDate(d.getDate() - n);
  return d.toISOString().split('T')[0];
}

export function DateRangePicker({ value, onChange }: { value: DateRange; onChange: (r: DateRange) => void }) {
  const [open, setOpen] = useState(false);
  const [customStart, setCustomStart] = useState(value.start);
  const [customEnd, setCustomEnd] = useState(value.end);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, []);

  function applyCustom() {
    if (!customStart || !customEnd || customStart > customEnd) return;
    onChange({ start: customStart, end: customEnd, label: `${customStart} → ${customEnd}` });
    setOpen(false);
  }

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen(o => !o)}
        className="bg-white border border-slate-200 shadow-sm rounded-lg px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 transition-colors flex items-center gap-2"
      >
        <CalendarDays size={14} className="text-slate-400" />
        {value.label}
        <ChevronDown size={14} className={cn('transition-transform text-slate-400', open && 'rotate-180')} />
      </button>

      {open && (
        <div className="absolute right-0 top-full mt-1 bg-white border border-slate-200 rounded-xl shadow-lg z-50 w-64 py-2">
          {/* Presets */}
          <div className="px-2 pb-2 border-b border-slate-100">
            {PRESETS.map(preset => (
              <button
                key={preset.label}
                onClick={() => { onChange(preset); setCustomStart(preset.start); setCustomEnd(preset.end); setOpen(false); }}
                className={cn(
                  'w-full text-left px-3 py-2 text-sm rounded-lg hover:bg-slate-50 transition-colors',
                  value.label === preset.label ? 'text-[#009960] font-semibold bg-green-50' : 'text-slate-700'
                )}
              >
                {preset.label}
              </button>
            ))}
          </div>

          {/* Custom range */}
          <div className="px-3 pt-3 pb-2 space-y-2">
            <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide">Rango personalizado</p>
            <div className="flex flex-col gap-2">
              <div>
                <label className="text-xs text-slate-500 mb-1 block">Desde</label>
                <input
                  type="date"
                  value={customStart}
                  max={customEnd || today()}
                  onChange={e => setCustomStart(e.target.value)}
                  className="w-full border border-slate-200 rounded-lg px-3 py-1.5 text-sm text-slate-700 focus:outline-none focus:ring-2 focus:ring-[#00D084]"
                />
              </div>
              <div>
                <label className="text-xs text-slate-500 mb-1 block">Hasta</label>
                <input
                  type="date"
                  value={customEnd}
                  min={customStart}
                  max={today()}
                  onChange={e => setCustomEnd(e.target.value)}
                  className="w-full border border-slate-200 rounded-lg px-3 py-1.5 text-sm text-slate-700 focus:outline-none focus:ring-2 focus:ring-[#00D084]"
                />
              </div>
            </div>
            <button
              onClick={applyCustom}
              disabled={!customStart || !customEnd || customStart > customEnd}
              className="w-full py-2 rounded-lg bg-[#00D084] text-white text-sm font-medium hover:bg-[#009960] transition-colors disabled:opacity-40"
            >
              Aplicar
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
