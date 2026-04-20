import { useState } from 'react';
import { ChevronDown } from 'lucide-react';
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

  return (
    <div className="relative">
      <button
        onClick={() => setOpen(o => !o)}
        className="bg-white border border-slate-200 shadow-sm rounded-lg px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 transition-colors flex items-center gap-2"
      >
        {value.label}
        <ChevronDown size={14} className={cn('transition-transform', open && 'rotate-180')} />
      </button>

      {open && (
        <div className="absolute right-0 top-full mt-1 bg-white border border-slate-200 rounded-xl shadow-lg z-50 min-w-[180px] py-1">
          {PRESETS.map(preset => (
            <button
              key={preset.label}
              onClick={() => { onChange(preset); setOpen(false); }}
              className={cn(
                'w-full text-left px-4 py-2.5 text-sm hover:bg-slate-50 transition-colors',
                value.label === preset.label ? 'text-[#009960] font-semibold' : 'text-slate-700'
              )}
            >
              {preset.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
