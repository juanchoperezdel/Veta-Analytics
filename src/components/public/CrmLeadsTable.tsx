import { useState } from 'react';
import { Card } from '@/components/ui/Card';
import { cn } from '@/lib/utils';

// De qué anuncio vino cada lead. Los datos salen del CRM del cliente (GoHighLevel), que
// guarda la atribución al anuncio de Meta en cada contacto. La página es pública: acá no
// se muestra nombre, teléfono ni email del lead, solo día, anuncio, campaña y estado.

export type CrmLeadRow = {
  date: string; adId: string | null; adName: string | null; campaign: string | null;
  vertical: string | null; quality: string; origin: string; thumbnail: string | null;
};
export type CrmAdRow = {
  adId: string | null; adName: string | null; campaign: string | null; vertical: string | null;
  thumbnail: string | null; leads: number; qualified: number; meeting: number; lastDate: string;
};
export type CrmLeads = { updatedAt: string | null; total: number; fromAds: number; rows: CrmLeadRow[]; byAd: CrmAdRow[] };

const QUALITY: Record<string, { label: string; cls: string }> = {
  meeting:      { label: 'Reunión',        cls: 'bg-emerald-50 text-emerald-700 ring-emerald-200' },
  qualified:    { label: 'Calificado',     cls: 'bg-sky-50 text-sky-700 ring-sky-200' },
  unqualified:  { label: 'No calificado',  cls: 'bg-slate-100 text-slate-600 ring-slate-200' },
  no_response:  { label: 'Sin respuesta',  cls: 'bg-amber-50 text-amber-700 ring-amber-200' },
  unclassified: { label: 'Sin clasificar', cls: 'bg-white text-slate-400 ring-slate-200' },
};

const PAGE = 40;

function fmtDay(d: string) {
  const [y, m, dd] = d.split('-').map(Number);
  return new Date(y, m - 1, dd).toLocaleDateString('es-AR', { weekday: 'short', day: '2-digit', month: '2-digit' });
}

function Thumb({ src }: { src: string | null }) {
  return src
    ? <img src={src} alt="" className="w-9 h-9 rounded-md object-cover bg-slate-100 shrink-0" onError={e => { (e.currentTarget as HTMLImageElement).style.visibility = 'hidden'; }} />
    : <span className="w-9 h-9 rounded-md bg-slate-100 shrink-0" />;
}

export function CrmLeadsTable({ data, vertColor }: { data: CrmLeads; vertColor: (v: string) => string }) {
  const [view, setView] = useState<'leads' | 'ads'>('leads');
  const [shown, setShown] = useState(PAGE);
  const other = data.total - data.fromAds;
  const updated = data.updatedAt
    ? new Date(data.updatedAt).toLocaleString('es-AR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false })
    : null;

  if (data.total === 0) {
    return <Card className="p-5 text-[13px] text-slate-500">No entraron leads al CRM en este período. Probá con un rango de fechas más amplio.</Card>;
  }

  return (
    <Card className="p-0 overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 border-b border-slate-100">
        <p className="text-[13px] text-slate-600">
          <b className="text-slate-900 tabular-nums">{data.total}</b> leads en el CRM ·{' '}
          <b className="text-slate-900 tabular-nums">{data.fromAds}</b> con el anuncio identificado
          {other > 0 && <> · <span className="tabular-nums">{other}</span> llegaron por otra vía</>}
        </p>
        <div className="inline-flex rounded-lg bg-slate-100 p-0.5 text-[12px] font-bold">
          {([['leads', 'Lead por lead'], ['ads', 'Por anuncio']] as const).map(([k, l]) => (
            <button key={k} onClick={() => setView(k)}
              className={cn('px-3 py-1.5 rounded-md transition-colors', view === k ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-700')}>
              {l}
            </button>
          ))}
        </div>
      </div>

      <div className="overflow-x-auto">
        {view === 'leads' ? (
          <table className="w-full text-[13px]">
            <thead className="bg-slate-50 text-[11px] uppercase tracking-wide text-slate-400">
              <tr>
                <th className="text-left font-bold px-4 py-2.5">Día</th>
                <th className="text-left font-bold px-3 py-2.5">Anuncio</th>
                <th className="text-left font-bold px-3 py-2.5 hidden md:table-cell">Campaña</th>
                <th className="text-right font-bold px-4 py-2.5">Estado</th>
              </tr>
            </thead>
            <tbody>
              {data.rows.slice(0, shown).map((r, i) => {
                const q = QUALITY[r.quality] ?? QUALITY.unclassified;
                return (
                  <tr key={i} className="border-t border-slate-100">
                    <td className="px-4 py-2.5 whitespace-nowrap text-slate-500 tabular-nums capitalize">{fmtDay(r.date)}</td>
                    <td className="px-3 py-2.5">
                      {r.adName ? (
                        <span className="flex items-center gap-2.5 min-w-0">
                          <Thumb src={r.thumbnail} />
                          <span className="min-w-0">
                            <span className="block font-semibold truncate max-w-[240px]">{r.adName}</span>
                            {r.vertical && (
                              <span className="inline-flex items-center gap-1.5 text-[11px] text-slate-400">
                                <span className="w-1.5 h-1.5 rounded-full" style={{ background: vertColor(r.vertical) }} />{r.vertical}
                              </span>
                            )}
                          </span>
                        </span>
                      ) : <span className="text-slate-400">Sin anuncio · {r.origin}</span>}
                    </td>
                    <td className="px-3 py-2.5 text-slate-500 hidden md:table-cell truncate max-w-[220px]">{r.campaign ?? '—'}</td>
                    <td className="px-4 py-2.5 text-right">
                      <span className={cn('inline-block rounded-full px-2 py-0.5 text-[11px] font-bold ring-1 whitespace-nowrap', q.cls)}>{q.label}</span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        ) : (
          <table className="w-full text-[13px]">
            <thead className="bg-slate-50 text-[11px] uppercase tracking-wide text-slate-400">
              <tr>
                <th className="text-left font-bold px-4 py-2.5">Anuncio</th>
                <th className="text-right font-bold px-3 py-2.5">Leads</th>
                <th className="text-right font-bold px-3 py-2.5 hidden sm:table-cell">Calificados</th>
                <th className="text-right font-bold px-3 py-2.5 hidden sm:table-cell">Reuniones</th>
                <th className="text-right font-bold px-4 py-2.5">Último lead</th>
              </tr>
            </thead>
            <tbody>
              {data.byAd.map((a, i) => (
                <tr key={a.adId ?? a.adName ?? i} className="border-t border-slate-100">
                  <td className="px-4 py-2.5">
                    <span className="flex items-center gap-2.5 min-w-0">
                      <Thumb src={a.thumbnail} />
                      <span className="min-w-0">
                        <span className="block font-semibold truncate max-w-[260px]">{a.adName ?? a.adId}</span>
                        <span className="block text-[11px] text-slate-400 truncate max-w-[260px]">{a.campaign ?? ''}</span>
                      </span>
                    </span>
                  </td>
                  <td className="px-3 py-2.5 text-right tabular-nums font-bold">{a.leads}</td>
                  <td className="px-3 py-2.5 text-right tabular-nums hidden sm:table-cell">{a.qualified || <span className="text-slate-300">—</span>}</td>
                  <td className="px-3 py-2.5 text-right tabular-nums hidden sm:table-cell">{a.meeting || <span className="text-slate-300">—</span>}</td>
                  <td className="px-4 py-2.5 text-right text-slate-500 tabular-nums whitespace-nowrap capitalize">{fmtDay(a.lastDate)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {view === 'leads' && data.rows.length > shown && (
        <button onClick={() => setShown(s => s + PAGE)} className="w-full border-t border-slate-100 py-2.5 text-[12px] font-bold text-slate-500 hover:bg-slate-50">
          Ver {Math.min(PAGE, data.rows.length - shown)} más
        </button>
      )}
      <p className="border-t border-slate-100 px-4 py-2.5 text-[11px] text-slate-400">
        Fuente: CRM (GoHighLevel){updated && <> · actualizado {updated}</>}. El estado sale de las etiquetas que el equipo carga en el CRM; si un lead no tiene etiqueta figura "Sin clasificar".
      </p>
    </Card>
  );
}
