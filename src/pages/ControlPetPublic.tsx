import { useEffect, useState, Fragment, type ReactNode } from 'react';
import {
  TrendingDown, Target, Trophy, AlertTriangle, Users, Loader2,
  Eye, MousePointerClick, MapPin, ExternalLink, LineChart as LineChartIcon,
} from 'lucide-react';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell } from 'recharts';
import { Card } from '@/components/ui/Card';
import { DateRangePicker, type DateRange } from '@/components/ui/DateRangePicker';
import { formatCurrency, formatNumber, formatPercent, cn } from '@/lib/utils';

// Ruta relativa: bajo `netlify dev` (cualquier puerto) y en producción es same-origin.
const BASE = '/.netlify/functions';

function initialRange(): DateRange {
  const end = new Date().toISOString().split('T')[0];
  const s = new Date(); s.setDate(s.getDate() - 29);
  return { start: s.toISOString().split('T')[0], end, label: 'Últimos 30 días' };
}

// ─── Tipos ───────────────────────────────────────────────────────────────────
// Sin etapa "visitas": toda la pauta es Instant Form, el lead se completa dentro de Meta.
type Funnel = {
  spend: number; impressions: number; clicks: number; leads: number;
  ctr: number; cpm: number; cpc: number; cpl: number; frequency: number;
  clickRate: number; leadRate: number;
};
type Ad = { adId: string; adName: string; campaignName?: string; zone?: string; variants?: number; thumbnailUrl: string | null; previewLink?: string | null; spend: number; impressions?: number; clicks?: number; leads: number; ctr: number; cpl: number };
type Zone = Funnel & { name: string; adCount: number; ads: Ad[] };
type DailyPoint = { date: string; spend: number; impressions: number; clicks: number; leads: number; cpl: number; partial: boolean };
type Campaign = { name: string; zone: string; spend: number; clicks: number; impressions: number; leads: number; cpl: number };
type Demo = { value: string; spend: number; leads: number; cpl: number; ctr: number };
type GoogleData = Funnel & { hasData: boolean; isPmax: boolean; campaigns: { name: string; spend: number; clicks: number; impressions: number; leads: number; cpl: number }[] };
type Data = {
  config: { name: string; currency: string; period: { start: string; end: string }; firstDataDate: string | null; generatedAt: string; dataUpdatedAt: string | null; metaUpdatedAt: string | null; googleUpdatedAt: string | null };
  overall: Funnel;
  daily: DailyPoint[];
  zones: Zone[];
  campaigns: Campaign[];
  ads: { best: Ad[]; worst: Ad[] };
  google: GoogleData;
  demographics: Record<string, Demo[]>;
  leadQuality: null;
};

const DEMO_LABELS: Record<string, string> = { age: 'Edad', gender: 'Género', region: 'Región', publisher_platform: 'Placement' };
const GENDER_ES: Record<string, string> = { male: 'Hombres', female: 'Mujeres', unknown: 'Sin dato' };
// Meta devuelve los placements en minuscula ('instagram') -> se muestran con el nombre real.
const PLACEMENT_ES: Record<string, string> = { instagram: 'Instagram', facebook: 'Facebook', messenger: 'Messenger', audience_network: 'Audience Network', threads: 'Threads', whatsapp: 'WhatsApp' };
// Color de los graficos: turquesa de ControlPet, un paso mas saturado para que pase
// las validaciones de croma y contraste (>=3:1 sobre superficie clara).
const CHART_COLOR = '#0A9396';
// Paleta de la marca ControlPet: navy + turquesa (del logo).
const ZONE_COLOR: Record<string, string> = { 'Córdoba': '#18243C', 'Mendoza': '#54A8A8', 'Remarketing': '#7c3aed', 'General': '#64748b' };

// Etiqueta corta para el eje X: 21/08
function fmtShort(d: string) {
  const [, m, day] = d.split('-');
  return `${day}/${m}`;
}

function fmtDay(d: string) {
  const [y, m, day] = d.split('-');
  return `${day}/${m}/${y.slice(2)}`;
}

export default function ControlPetPublic() {
  const [data, setData] = useState<Data | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [range, setRange] = useState<DateRange>(initialRange());

  // Título de pestaña + favicon con la marca ControlPet (solo esta página).
  useEffect(() => {
    const prevTitle = document.title;
    document.title = 'ControlPet · Reporte de pauta';
    let link = document.querySelector<HTMLLinkElement>("link[rel~='icon']");
    const prevHref = link?.href ?? '';
    if (!link) { link = document.createElement('link'); link.rel = 'icon'; document.head.appendChild(link); }
    link.href = '/controlpet-logo.png';
    return () => { document.title = prevTitle; if (link) link.href = prevHref; };
  }, []);

  useEffect(() => {
    setLoading(true);
    setError(null);
    // _t = cache-buster para que nunca devuelva una respuesta cacheada por el browser/CDN
    fetch(`${BASE}/public-controlpet?start=${range.start}&end=${range.end}&_t=${Date.now()}`, { cache: 'no-store' })
      .then(async r => {
        const json = await r.json();
        if (!r.ok || json.error) { setError(json.error ?? `HTTP ${r.status}`); return; }
        setData(json);
      })
      .catch(e => setError(e?.message ?? String(e)))
      .finally(() => setLoading(false));
  }, [range.start, range.end]);

  if (loading && !data) return <Status icon={<Loader2 className="animate-spin" />} title="Cargando el reporte de ControlPet…" />;
  if (error || !data) return <Status icon={<AlertTriangle />} title="No pudimos cargar el reporte" subtitle={error ?? ''} isError />;

  const { overall, daily, zones, campaigns, ads, google, demographics, config } = data;
  const metaSpend = overall.spend;
  const googleSpend = google.hasData ? google.spend : 0;
  const totalSpend = metaSpend + googleSpend;
  // Hora REAL del último sync de datos (no la del request)
  const dataUpd = config.dataUpdatedAt ? new Date(config.dataUpdatedAt) : null;
  const fmtTime = (d: Date) => d.toLocaleString('es-AR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
  // La cuenta arrancó hace poco: si el primer día con datos es posterior al inicio del
  // rango pedido, lo aclaramos en vez de dar a entender que son 30 días completos.
  const shortHistory = config.firstDataDate && config.firstDataDate > config.period.start;

  return (
    <div className="min-h-screen bg-[#f6f7f9] text-slate-900">
      <header className="sticky top-0 z-10 border-b border-slate-200 bg-white/80 backdrop-blur">
        <div className="mx-auto max-w-6xl px-5 py-4 flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <img src="/controlpet-logo.png" alt="ControlPet" className="w-10 h-10 rounded-xl shrink-0 object-contain" />
            <div>
              <h1 className="text-lg font-black leading-none">{config.name}</h1>
              <p className="text-xs text-slate-500 mt-0.5">Reporte de pauta · Meta + Google</p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <DateRangePicker value={range} onChange={setRange} />
            <p className="text-[11px] text-slate-400 text-right hidden sm:block">
              Datos al<br />{dataUpd ? `${fmtTime(dataUpd)} hs` : '—'}
            </p>
          </div>
        </div>
        {loading && <div className="h-0.5 bg-veta/60 animate-pulse" />}
      </header>

      <main className="mx-auto max-w-6xl px-5 py-6 space-y-9">
        {/* ── Lo importante de un vistazo ── */}
        <section>
          <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
            <Kpi label="Inversión total" value={formatCurrency(totalSpend)} sub="Meta + Google" highlight />
            <Kpi label="Inversión Meta" value={formatCurrency(metaSpend)} />
            <Kpi label="Inversión Google" value={googleSpend > 0 ? formatCurrency(googleSpend) : '—'} />
            <Kpi label="Leads" value={formatNumber(overall.leads)} sub="contactos generados en Meta" highlight />
            <Kpi label="Costo por lead" value={overall.cpl > 0 ? formatCurrency(overall.cpl) : '—'} sub="cuánto sale cada contacto" />
          </div>
          {shortHistory && (
            <p className="text-[12px] text-slate-500 mt-3 bg-slate-100/70 border border-slate-200 rounded-lg px-3 py-2">
              Los anuncios empezaron a correr el <b>{fmtDay(config.firstDataDate!)}</b>, así que los números de arriba
              son de esos días y no del mes completo.
            </p>
          )}
          <p className="text-[12px] text-slate-500 mt-3 leading-relaxed">
            De cada <b>100 personas</b> que ven un anuncio, algunas hacen click y unas pocas dejan sus datos.
            El <b>embudo</b> de abajo muestra dónde se van cayendo — así se ve en qué parte conviene trabajar.
            Acá el formulario se completa <b>dentro de Meta</b>: el contacto no pasa por la web.
          </p>
        </section>

        {/* ── Embudo general ── */}
        <section>
          <SectionTitle icon={<Target size={15} />} title="El embudo, paso a paso" hint="Meta · de la impresión al lead" />
          <Card className="p-5">
            <FunnelView f={overall} />
          </Card>
        </section>

        {/* ── Evolución diaria ── */}
        {daily.length > 1 && (
          <section>
            <SectionTitle icon={<LineChartIcon size={15} />} title="Cómo viene evolucionando" hint="Día a día · inversión y contactos" />
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              <DailyChart data={daily} metric="spend" title="Inversión por día" isCurrency />
              <DailyChart data={daily} metric="leads" title="Contactos por día" />
            </div>
            {daily.some(d => d.partial) && (
              <p className="text-[11px] text-slate-400 mt-2">
                La última barra es del día de hoy, que todavía está en curso — por eso queda más baja y en un tono más claro.
              </p>
            )}
          </section>
        )}

        {/* ── Por zona ── */}
        {zones.length > 0 && (
          <section>
            <SectionTitle icon={<MapPin size={15} />} title="Por zona" hint="Dónde se está invirtiendo y qué devuelve cada plaza" />
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 items-start">
              {zones.map(z => <Fragment key={z.name}><ZoneCard z={z} /></Fragment>)}
            </div>
          </section>
        )}

        {/* ── Mejores / peores anuncios (con miniatura) ── */}
        <section>
          <SectionTitle icon={<Trophy size={15} className="text-veta" />} title="Los anuncios que mejor funcionan" hint="Los que más contactos trajeron, y a qué costo" />
          {ads.best.length === 0 ? (
            <Card className="p-6 text-center text-sm text-slate-400">Todavía no hay anuncios con leads en el período.</Card>
          ) : (
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
              {ads.best.map(a => <Fragment key={a.adId}><AdCard ad={a} tone="good" /></Fragment>)}
            </div>
          )}
        </section>

        {ads.worst.length > 0 && (
          <section>
            <SectionTitle icon={<AlertTriangle size={15} className="text-amber-500" />} title="Anuncios para revisar" hint="Gastaron pero no trajeron leads" />
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
              {ads.worst.map(a => <Fragment key={a.adId}><AdCard ad={a} tone="bad" /></Fragment>)}
            </div>
          </section>
        )}

        {/* ── Campañas de Meta ── */}
        {campaigns.length > 0 && (
          <section>
            <SectionTitle icon={<Target size={15} />} title="Campañas de Meta" hint="Inversión y leads de cada una" />
            <Card className="p-5">
              <div className="space-y-0">
                {campaigns.map(c => (
                  <div key={c.name} className="flex items-center justify-between gap-3 py-2 text-sm border-b border-slate-50 last:border-0">
                    <div className="flex items-center gap-2 min-w-0">
                      <span className="w-2 h-2 rounded-full shrink-0" style={{ background: ZONE_COLOR[c.zone] ?? '#64748b' }} />
                      <span className="truncate font-medium" title={c.name}>{c.name}</span>
                    </div>
                    <span className="text-slate-400 tabular-nums shrink-0 text-[12px]">
                      {formatCurrency(c.spend)} · {formatNumber(c.leads)} lead{c.leads === 1 ? '' : 's'}
                      {c.leads > 0 && <span className="text-slate-300"> · CPL {formatCurrency(c.cpl)}</span>}
                    </span>
                  </div>
                ))}
              </div>
            </Card>
          </section>
        )}

        {/* ── Google ── */}
        <section>
          <SectionTitle icon={<MousePointerClick size={15} />} title="Google Ads" hint="Performance Max" />
          {google.hasData ? (
            <Card className="p-5 space-y-4">
              {google.leads === 0 ? (
                <p className="text-[12px] text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
                  ⚠ <span className="font-semibold">Sección en revisión.</span> Hay inversión y clicks, pero Google no está registrando conversiones en el período. Estamos validando si es un tema de <span className="font-semibold">medición (tracking)</span> o de <span className="font-semibold">volumen</span>. Por ahora tomá estos números como inversión y tráfico, no como resultados finales.
                </p>
              ) : google.isPmax && (
                <p className="text-[12px] text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
                  ⚠ <span className="font-semibold">Las conversiones de Google no son comparables con los leads de Meta.</span> Esta es una campaña <span className="font-semibold">Performance Max</span>, que cuenta en un mismo número acciones de distinto valor (formularios, clicks a WhatsApp, visitas a páginas clave). Estamos revisando la medición para poder separarlas; hasta entonces, mirá este bloque como <span className="font-semibold">inversión y tráfico</span>, no como leads comerciales.
                </p>
              )}
              <FunnelView f={google} leadLabel="Conversiones" />
              <div className="border-t border-slate-100 pt-3">
                {google.campaigns.slice(0, 8).map(c => (
                  <div key={c.name} className="flex items-center justify-between py-1.5 text-sm border-b border-slate-50 last:border-0">
                    <span className="truncate font-medium" title={c.name}>{c.name}</span>
                    <span className="text-slate-400 tabular-nums">{formatCurrency(c.spend)} · {formatNumber(c.leads)} conv.</span>
                  </div>
                ))}
              </div>
            </Card>
          ) : (
            <Card className="p-6 text-center text-sm text-slate-400">Sin datos de Google todavía — se completan en la próxima actualización automática.</Card>
          )}
        </section>

        {/* La seccion de calidad de leads (CRM) queda OCULTA por decision del owner
            hasta que se defina la fuente. El endpoint ya devuelve `leadQuality` y el
            cruce por ad_id esta listo: para reactivarla, portar el bloque de GribaPublic. */}

        {/* ── Demografía ── */}
        {Object.keys(demographics).some(k => (demographics[k] ?? []).length > 0) && (
          <section>
            <SectionTitle icon={<Users size={15} />} title="A quién le llegó la pauta" hint="Meta · cuánto se invirtió y CTR por segmento — no implica calidad del lead" />
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {(['age', 'gender', 'region', 'publisher_platform'] as const).map(dim =>
                (demographics[dim] ?? []).length
                  ? <Fragment key={dim}><DemoCard title={DEMO_LABELS[dim]} items={demographics[dim]} labels={dim === 'gender' ? GENDER_ES : dim === 'publisher_platform' ? PLACEMENT_ES : undefined} /></Fragment>
                  : null
              )}
            </div>
          </section>
        )}

        <footer className="pt-4 pb-8 text-center text-[11px] text-slate-400">
          Datos directos de Meta Ads y Google Ads · Actualización automática cada hora · Veta Analytics
        </footer>
      </main>
    </div>
  );
}

// ─── Funnel ────────────────────────────────────────────────────────────────────
// Tres etapas: Impresiones → Clicks → Leads. No hay "visitas a la landing" porque el
// formulario se completa dentro de Meta.
function FunnelView({ f, leadLabel }: { f: Funnel; leadLabel?: string }) {
  const stages = [
    { key: 'impr', label: 'Impresiones', icon: <Eye size={14} />, value: f.impressions, rate: null as number | null, cost: f.cpm, costLabel: 'CPM' },
    { key: 'clk', label: 'Clicks', icon: <MousePointerClick size={14} />, value: f.clicks, rate: f.clickRate, cost: f.cpc, costLabel: 'CPC' },
    { key: 'lead', label: leadLabel ?? 'Leads', icon: <Target size={14} />, value: f.leads, rate: f.leadRate, cost: f.cpl, costLabel: leadLabel ? 'Costo' : 'CPL' },
  ];
  const max = Math.max(f.impressions, 1);
  return (
    <div className="space-y-2">
      {stages.map((s, i) => {
        const w = Math.max(1.5, (s.value / max) * 100);
        const isLead = s.key === 'lead';
        return (
          <div key={s.key}>
            {i > 0 && s.rate !== null && (
              <div className="flex items-center gap-1 pl-1 py-0.5 text-[10px] text-slate-400">
                <TrendingDown size={10} /> {formatPercent(s.rate)} pasa de la etapa anterior
              </div>
            )}
            <div className="flex items-center gap-3">
              <div className="w-36 shrink-0 flex items-center gap-1.5 text-[12px] font-semibold text-slate-600">
                <span className="text-slate-400">{s.icon}</span>{s.label}
              </div>
              <div className="flex-1 h-8 rounded-lg bg-slate-100 overflow-hidden relative">
                <div className={cn('h-full rounded-lg flex items-center px-2', isLead ? 'bg-veta' : 'bg-sky-500/85')} style={{ width: `${w}%` }}>
                  <span className={cn('text-[12px] font-black tabular-nums', w > 12 ? 'text-white' : 'text-slate-700 absolute left-2')}>{formatNumber(s.value)}</span>
                </div>
              </div>
              <div className="w-28 shrink-0 text-right">
                <p className="text-[12px] font-bold tabular-nums">{s.value > 0 && s.cost > 0 ? formatCurrency(s.cost) : '—'}</p>
                <p className="text-[10px] text-slate-400">{s.costLabel}</p>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ─── Evolución diaria ──────────────────────────────────────────────────────────
// Small multiples: inversión y contactos tienen escalas distintas, así que van en DOS
// gráficos con el MISMO color (los distingue el título), nunca en un eje doble.
// El día en curso se dibuja más claro + se aclara con texto: el color solo no alcanza.
function DailyChart({ data, metric, title, isCurrency }: { data: DailyPoint[]; metric: 'spend' | 'leads'; title: string; isCurrency?: boolean }) {
  const rows = data.map(d => ({ ...d, label: fmtShort(d.date), value: metric === 'spend' ? d.spend : d.leads }));
  const fmt = (v: number) => (isCurrency ? formatCurrency(v) : formatNumber(v));
  const total = rows.reduce((acc, r) => acc + r.value, 0);
  return (
    <Card className="p-4">
      <div className="flex items-baseline justify-between mb-3">
        <h3 className="font-black text-sm">{title}</h3>
        <span className="text-[11px] text-slate-400 tabular-nums">{fmt(total)} en total</span>
      </div>
      <div style={{ width: '100%', height: 180 }}>
        <ResponsiveContainer>
          <BarChart data={rows} margin={{ top: 4, right: 4, bottom: 0, left: -12 }} barCategoryGap="18%">
            {/* grid recesivo: solo horizontal, sin líneas verticales que compitan con las barras */}
            <CartesianGrid vertical={false} stroke="#e9edf1" />
            <XAxis dataKey="label" tickLine={false} axisLine={false} tick={{ fontSize: 10, fill: '#94a3b8' }} interval="preserveStartEnd" />
            <YAxis tickLine={false} axisLine={false} tick={{ fontSize: 10, fill: '#94a3b8' }} width={48}
                   tickFormatter={(v: number) => (isCurrency ? `$${Math.round(v / 1000)}k` : String(v))} />
            <Tooltip
              cursor={{ fill: 'rgba(10,147,150,0.07)' }}
              contentStyle={{ borderRadius: 10, border: '1px solid #e2e8f0', fontSize: 12, boxShadow: '0 4px 14px rgba(15,23,42,.08)' }}
              labelFormatter={(l: string) => l}
              formatter={(v: number, _n: string, p: any) => [fmt(v) + (p?.payload?.partial ? ' (día en curso)' : ''), title]}
            />
            <Bar dataKey="value" radius={[4, 4, 0, 0]} isAnimationActive={false}>
              {rows.map(r => <Cell key={r.date} fill={CHART_COLOR} fillOpacity={r.partial ? 0.4 : 1} />)}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
    </Card>
  );
}

// ─── Zona (Córdoba / Mendoza / Remarketing) ────────────────────────────────────
function ZoneCard({ z }: { z: Zone }) {
  const color = ZONE_COLOR[z.name] ?? '#64748b';
  const steps = [
    { label: 'Impr.', value: z.impressions },
    { label: 'Clicks', value: z.clicks },
    { label: 'Leads', value: z.leads },
  ];
  return (
    <Card className="p-4">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <span className="w-2.5 h-2.5 rounded-full" style={{ background: color }} />
          <h3 className="font-black">{z.name}</h3>
          <span className="text-[11px] text-slate-400">{z.adCount} anuncio{z.adCount === 1 ? '' : 's'}</span>
        </div>
        <span className="text-[11px] text-slate-400">{formatCurrency(z.spend)}</span>
      </div>

      {/* mini funnel en línea */}
      <div className="flex items-stretch gap-1 mb-3">
        {steps.map((s, i) => (
          <div key={s.label} className="flex-1 text-center">
            <div className="rounded-md bg-slate-50 py-1.5">
              <p className="text-sm font-black tabular-nums leading-none">{formatNumber(s.value)}</p>
              <p className="text-[9px] text-slate-400 mt-0.5">{s.label}</p>
            </div>
            {i < steps.length - 1 && <span className="text-slate-300 text-[9px]">▼</span>}
          </div>
        ))}
      </div>

      <div className="grid grid-cols-3 gap-2 mb-3 text-center">
        <MiniStat label="Costo x lead" value={z.leads > 0 ? formatCurrency(z.cpl) : 'sin leads'} accent={color} />
        <MiniStat label="CTR" value={z.impressions > 0 ? formatPercent(z.ctr) : '—'} />
        <MiniStat label="CPC" value={z.clicks > 0 ? formatCurrency(z.cpc) : '—'} />
      </div>

      <div className="space-y-1.5">
        {z.ads.slice(0, 4).map(a => {
          const row = (
            <>
              <div className="w-8 h-8 rounded-md bg-slate-100 overflow-hidden shrink-0 grid place-items-center">
                {a.thumbnailUrl ? <img src={a.thumbnailUrl} alt="" className="w-full h-full object-cover" loading="lazy" /> : <span className="text-[8px] text-slate-300">—</span>}
              </div>
              <span className={cn('text-[11px] font-medium truncate flex-1', a.previewLink && 'group-hover:text-veta group-hover:underline')} title={a.adName}>{a.adName}</span>
              <span className="text-[11px] text-slate-400 tabular-nums shrink-0">{a.leads > 0 ? `${a.leads} lead${a.leads > 1 ? 's' : ''}` : formatPercent(a.ctr)}</span>
            </>
          );
          return a.previewLink
            ? <a key={a.adId} href={a.previewLink} target="_blank" rel="noopener noreferrer" className="group flex items-center gap-2" title="Ver el anuncio">{row}</a>
            : <div key={a.adId} className="flex items-center gap-2">{row}</div>;
        })}
        {z.ads.length === 0 && <p className="text-[11px] text-slate-400 text-center py-2">Sin anuncios</p>}
      </div>
    </Card>
  );
}

// ─── Subcomponentes ─────────────────────────────────────────────────────────────
function MiniStat({ label, value, accent }: { label: string; value: string; accent?: string }) {
  return (
    <div className="rounded-md bg-slate-50 py-1.5">
      <p className="text-[13px] font-black tabular-nums leading-none" style={accent ? { color: accent } : undefined}>{value}</p>
      <p className="text-[9px] text-slate-400 mt-0.5">{label}</p>
    </div>
  );
}

function SectionTitle({ icon, title, hint }: { icon: ReactNode; title: string; hint?: string }) {
  return (
    <div className="flex items-baseline gap-2 mb-3 flex-wrap">
      <span className="text-slate-600 self-center">{icon}</span>
      <h2 className="text-base font-black tracking-tight">{title}</h2>
      {hint && <span className="text-[11px] text-slate-400 font-medium">· {hint}</span>}
    </div>
  );
}

function Kpi({ label, value, sub, highlight }: { label: string; value: string; sub?: string; highlight?: boolean }) {
  return (
    <Card className={cn('p-4', highlight && 'ring-1 ring-veta/25 bg-veta/[0.03]')}>
      <p className="text-slate-400 text-[11px] font-bold uppercase tracking-wide">{label}</p>
      <p className="text-2xl font-black tabular-nums mt-1">{value}</p>
      {sub && <p className="text-[11px] text-slate-400 mt-0.5">{sub}</p>}
    </Card>
  );
}

function AdCard({ ad, tone }: { ad: Ad; tone: 'good' | 'bad' }) {
  // Los anuncios se llaman igual en las dos plazas (Ad3_Agosto está en Córdoba y en
  // Mendoza) → el badge de zona es lo único que los distingue de un vistazo.
  const badge = ad.zone;
  const media = (
    <div className="aspect-square bg-slate-100 overflow-hidden grid place-items-center relative group">
      {ad.thumbnailUrl
        ? <img src={ad.thumbnailUrl} alt={ad.adName} className="w-full h-full object-cover" loading="lazy" />
        : <span className="text-slate-300 text-xs">sin imagen</span>}
      {badge && <span className="absolute top-1 left-1 text-[9px] font-bold px-1.5 py-0.5 rounded bg-black/55 text-white">{badge}</span>}
      {ad.previewLink && (
        <span className="absolute inset-0 bg-black/0 group-hover:bg-black/45 transition-colors grid place-items-center opacity-0 group-hover:opacity-100">
          <span className="inline-flex items-center gap-1 text-white text-[11px] font-bold bg-black/40 px-2 py-1 rounded-lg"><ExternalLink size={12} /> Ver anuncio</span>
        </span>
      )}
    </div>
  );
  return (
    <Card className="p-0 overflow-hidden flex flex-col">
      {ad.previewLink
        ? <a href={ad.previewLink} target="_blank" rel="noopener noreferrer" title="Ver el anuncio">{media}</a>
        : media}
      <div className="p-2.5 flex flex-col gap-1">
        <p className="text-[12px] font-bold leading-tight line-clamp-2" title={ad.adName}>{ad.adName}</p>
        <div className="flex items-center justify-between text-[11px] mt-0.5">
          <span className="text-slate-400">{formatCurrency(ad.spend)}</span>
          {tone === 'good'
            ? <span className="font-bold text-veta">{ad.leads > 0 ? `${ad.leads} lead${ad.leads > 1 ? 's' : ''}` : `CTR ${formatPercent(ad.ctr)}`}</span>
            : <span className="font-bold text-danger">0 leads</span>}
        </div>
        {tone === 'good' && ad.leads > 0
          ? <p className="text-[10px] text-slate-400">CPL {formatCurrency(ad.cpl)} · CTR {formatPercent(ad.ctr)}</p>
          : <p className="text-[10px] text-slate-400">CTR {formatPercent(ad.ctr)}</p>}
      </div>
    </Card>
  );
}

function DemoCard({ title, items, labels }: { title: string; items: Demo[]; labels?: Record<string, string> }) {
  const max = Math.max(...items.map(i => i.spend), 1);
  return (
    <Card className="p-4">
      <p className="text-sm font-black mb-3">{title}</p>
      <div className="space-y-2">
        {items.map(i => {
          const label = labels?.[i.value] ?? i.value;
          return (
            <div key={i.value}>
              <div className="flex items-center justify-between text-[12px] mb-0.5 gap-2">
                <span className="font-semibold text-slate-700 truncate">{label}</span>
                <span className="text-slate-400 tabular-nums shrink-0">
                  {formatCurrency(i.spend)}
                  {i.ctr > 0 ? <span className="text-slate-300"> · CTR {formatPercent(i.ctr)}</span> : null}
                  {i.leads > 0 ? ` · ${i.leads} lead${i.leads > 1 ? 's' : ''}` : ''}
                </span>
              </div>
              <div className="h-1.5 rounded-full bg-slate-100 overflow-hidden">
                <div className="h-full rounded-full bg-veta/70" style={{ width: `${(i.spend / max) * 100}%` }} />
              </div>
            </div>
          );
        })}
      </div>
    </Card>
  );
}

function Status({ icon, title, subtitle, isError }: { icon: ReactNode; title: string; subtitle?: string; isError?: boolean }) {
  return (
    <div className="min-h-screen grid place-items-center bg-[#f6f7f9] px-6 text-center">
      <div>
        <div className={cn('mx-auto mb-3 w-10 h-10 grid place-items-center', isError ? 'text-danger' : 'text-veta')}>{icon}</div>
        <p className="font-black text-slate-800">{title}</p>
        {subtitle && <p className="text-sm text-slate-400 mt-1 max-w-md">{subtitle}</p>}
      </div>
    </div>
  );
}
