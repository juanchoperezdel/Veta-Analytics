import { useParams } from 'react-router-dom';
import { Sparkles, Calendar } from 'lucide-react';
import { format } from 'date-fns';
import { es } from 'date-fns/locale';
import { mockData } from '@/data/mockData';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/Card';

export default function Insights() {
  const { clientSlug } = useParams();
  const data = mockData[(clientSlug as keyof typeof mockData) || 'saas-b2b'];

  if (!data) return <div className="p-8">No data found</div>;

  return (
    <div className="p-8 max-w-4xl mx-auto space-y-8">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Historial de Insights</h1>
        <p className="text-sm text-muted mt-1">Análisis automatizados de performance generados por IA</p>
      </div>

      <div className="space-y-6 relative before:absolute before:inset-y-0 before:left-[19px] before:w-[2px] before:bg-veta/20">
        {data.insights.map((insight) => (
          <div key={insight.id} className="relative pl-12">
            <div className="absolute left-0 top-1.5 w-10 h-10 rounded-full bg-[#111] border-2 border-veta flex items-center justify-center text-veta z-10 shadow-[0_0_15px_rgba(0,208,132,0.2)]">
              <Sparkles size={18} />
            </div>
            
            <Card className="bg-gradient-to-br from-[#0A0A0A] to-[#0d1f16]/30 border-veta/30">
              <CardHeader className="pb-3 border-b border-veta/10">
                <div className="flex items-center justify-between">
                  <CardTitle className="text-xl">{insight.title}</CardTitle>
                  <div className="flex items-center gap-2 text-sm text-muted">
                    <Calendar size={14} />
                    {format(new Date(insight.date), "d 'de' MMMM, yyyy", { locale: es })}
                  </div>
                </div>
              </CardHeader>
              <CardContent className="pt-4 space-y-4">
                <p className="text-foreground/90 leading-relaxed text-sm">
                  {insight.summary}
                </p>
                <div className="bg-veta/5 rounded-lg p-4 border border-veta/10">
                  <h4 className="text-xs font-semibold uppercase tracking-wider text-muted mb-3">Hallazgos Clave</h4>
                  <ul className="space-y-2">
                    {insight.findings.map((finding, idx) => (
                      <li key={idx} className="flex items-start gap-2 text-sm">
                        <div className="h-1.5 w-1.5 rounded-full bg-veta mt-1.5 shrink-0" />
                        <span className="text-foreground/80">{finding}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              </CardContent>
            </Card>
          </div>
        ))}
      </div>
    </div>
  );
}
