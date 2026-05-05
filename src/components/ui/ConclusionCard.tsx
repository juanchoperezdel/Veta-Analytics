// Componente reusable para mostrar conclusiones estratégicas auto-generadas.
// Usado por Rutas, Estacionalidad, Google Ads, Meta Ads, Embudo, Evolutivo.

import { Lightbulb, TrendingUp, TrendingDown, Activity, Sparkles, Scale, Compass,
         Search, Image as ImageIcon, Users, Clock, Calendar, Filter,
         AlertTriangle, Target, Brain } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Card } from '@/components/ui/Card';

// Categorías que pueden venir de cualquier endpoint
export type ConclusionCategory =
  | 'yoy' | 'mom' | 'momentum' | 'forecast' | 'efficiency' | 'demand'
  | 'creative' | 'audience' | 'placement' | 'query' | 'competition'
  | 'funnel_stage' | 'seasonality' | 'time_pattern' | 'streak' | 'milestone';

export type ConclusionSeverity = 'success' | 'warning' | 'info' | 'critical';
export type ConclusionConfidence = 'alta' | 'media' | 'baja';

export type Conclusion = {
  id: string;
  category: ConclusionCategory;
  severity: ConclusionSeverity;
  route?: string;          // opcional — solo aplica a Rutas
  headline: string;
  detail: string;
  recommendation: string;
  confidence: ConclusionConfidence;
  metric?: { label: string; value: string };
};

const SEVERITY_STYLES: Record<ConclusionSeverity, { bg: string; iconBg: string; accent: string }> = {
  success:  { bg: 'bg-emerald-50/40 border-emerald-200', iconBg: 'bg-emerald-100 text-emerald-700', accent: 'text-emerald-700' },
  warning:  { bg: 'bg-amber-50/40 border-amber-200',     iconBg: 'bg-amber-100 text-amber-700',     accent: 'text-amber-700'   },
  info:     { bg: 'bg-blue-50/40 border-blue-200',       iconBg: 'bg-blue-100 text-blue-700',       accent: 'text-blue-700'    },
  critical: { bg: 'bg-red-50/40 border-red-200',         iconBg: 'bg-red-100 text-red-700',         accent: 'text-red-700'     },
};

const CATEGORY_ICON: Record<ConclusionCategory, any> = {
  yoy:          TrendingUp,
  mom:          TrendingUp,
  momentum:     Activity,
  forecast:     Sparkles,
  efficiency:   Scale,
  demand:       Compass,
  creative:     ImageIcon,
  audience:     Users,
  placement:    Filter,
  query:        Search,
  competition:  AlertTriangle,
  funnel_stage: Target,
  seasonality:  Calendar,
  time_pattern: Clock,
  streak:       Activity,
  milestone:    Sparkles,
};

const CATEGORY_LABEL: Record<ConclusionCategory, string> = {
  yoy:          'Año a año',
  mom:          'Mes a mes',
  momentum:     'Tendencia',
  forecast:     'Próximo mes',
  efficiency:   'Eficiencia',
  demand:       'Demanda',
  creative:     'Creatives',
  audience:     'Audiencia',
  placement:    'Placement',
  query:        'Search query',
  competition:  'Competencia',
  funnel_stage: 'Embudo',
  seasonality:  'Estacionalidad',
  time_pattern: 'Día / hora',
  streak:       'Racha',
  milestone:    'Hito',
};

const CONFIDENCE_LABEL: Record<ConclusionConfidence, { label: string; color: string }> = {
  alta:  { label: 'Alta confianza',  color: 'text-emerald-600' },
  media: { label: 'Media confianza', color: 'text-amber-600'   },
  baja:  { label: 'Baja confianza',  color: 'text-orange-600'  },
};

export function ConclusionCard({ conclusion }: { conclusion: Conclusion; key?: any }) {
  const styles = SEVERITY_STYLES[conclusion.severity];
  const Icon = CATEGORY_ICON[conclusion.category] ?? Lightbulb;
  const categoryLabel = CATEGORY_LABEL[conclusion.category] ?? conclusion.category;
  const confidence = CONFIDENCE_LABEL[conclusion.confidence];

  return (
    <Card className={cn("p-5 flex flex-col", styles.bg)}>
      <div className="flex items-center gap-2 mb-3">
        <div className={cn("p-1.5 rounded-lg shrink-0", styles.iconBg)}>
          <Icon size={16} strokeWidth={2.5} />
        </div>
        <span className={cn("text-[10px] font-bold uppercase tracking-wider", styles.accent)}>
          {categoryLabel}
        </span>
        {conclusion.metric && (
          <span className="ml-auto text-[10px] font-medium text-slate-500">
            {conclusion.metric.label}: <strong className="text-slate-900">{conclusion.metric.value}</strong>
          </span>
        )}
      </div>

      <h3 className="text-base font-bold text-slate-900 leading-snug mb-1.5">
        {conclusion.headline}
      </h3>

      <p className="text-sm text-slate-600 leading-relaxed mb-4">
        {conclusion.detail}
      </p>

      <div className="mt-auto pt-3 border-t border-slate-200/70">
        <div className="flex items-start gap-2">
          <Lightbulb size={14} className="text-slate-500 shrink-0 mt-0.5" />
          <p className="text-xs text-slate-700 italic leading-relaxed">
            {conclusion.recommendation}
          </p>
        </div>
        <div className="flex items-center justify-between mt-2 text-[10px]">
          <span className={cn("font-semibold", confidence.color)}>● {confidence.label}</span>
        </div>
      </div>
    </Card>
  );
}

// Sección completa con header + grid de cards
export function ConclusionsSection({
  conclusions,
  title = 'Conclusiones estratégicas',
  subtitle = 'Lo que los números están diciendo · auto-generado',
}: {
  conclusions: Conclusion[];
  title?: string;
  subtitle?: string;
}) {
  if (!conclusions || conclusions.length === 0) return null;
  return (
    <section className="space-y-4">
      <div className="flex items-center gap-3">
        <div className="bg-violet-100 text-violet-700 p-2 rounded-lg">
          <Brain size={18} strokeWidth={2.5} />
        </div>
        <div>
          <h2 className="text-xl font-bold text-slate-900 tracking-tight">{title}</h2>
          <p className="text-xs text-slate-500 font-medium">{subtitle}</p>
        </div>
        <span className="ml-auto text-[10px] font-medium text-slate-400">
          {conclusions.length} hallazgo{conclusions.length === 1 ? '' : 's'}
        </span>
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {conclusions.map(c => <ConclusionCard key={c.id} conclusion={c} />)}
      </div>
    </section>
  );
}
