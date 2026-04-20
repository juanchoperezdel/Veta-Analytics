import { useParams } from 'react-router-dom';
import { AlertCircle, CheckCircle2, Clock } from 'lucide-react';
import { format } from 'date-fns';
import { es } from 'date-fns/locale';
import { mockData } from '@/data/mockData';
import { Badge } from '@/components/ui/Badge';
import { cn } from '@/lib/utils';

export default function Alerts() {
  const { clientSlug } = useParams();
  const data = mockData[(clientSlug as keyof typeof mockData) || 'saas-b2b'];

  if (!data) return <div className="p-8">No data found</div>;

  const activeAlerts = data.alerts?.filter(a => a.status === 'active') || [];
  const resolvedAlerts = data.alerts?.filter(a => a.status === 'resolved') || [];

  return (
    <div className="p-8 max-w-5xl mx-auto space-y-8">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Centro de Alertas</h1>
          <p className="text-sm text-muted mt-1">Notificaciones y anomalías en tus campañas</p>
        </div>
        
        <div className="flex items-center gap-2">
          <Badge variant="outline" className="px-3 py-1 bg-white/5 border-veta/50 cursor-pointer hover:bg-white/10 transition-colors">
            Activas ({activeAlerts.length})
          </Badge>
          <Badge variant="outline" className="px-3 py-1 cursor-pointer hover:bg-white/10 transition-colors text-muted">
            Resueltas ({resolvedAlerts.length})
          </Badge>
        </div>
      </div>

      <div className="space-y-4">
        {data.alerts?.length === 0 ? (
          <div className="text-center py-12 border border-dashed border-veta/30 rounded-xl">
            <CheckCircle2 className="mx-auto h-12 w-12 text-veta/50 mb-3" />
            <h3 className="text-lg font-medium text-foreground">Todo en orden</h3>
            <p className="text-muted text-sm mt-1">No hay alertas activas en este momento.</p>
          </div>
        ) : (
          data.alerts?.map(alert => (
            <div 
              key={alert.id} 
              className={cn(
                "flex items-start md:items-center justify-between p-5 rounded-xl border bg-[#0A0A0A] hover:bg-white/5 transition-colors cursor-pointer group",
                alert.status === 'active' ? "border-veta" : "border-veta/20 opacity-70"
              )}
            >
              <div className="flex items-start gap-4">
                <div className="mt-1">
                  {alert.status === 'active' ? (
                    <AlertCircle className={cn(
                      "h-5 w-5",
                      alert.severity === 'critical' ? "text-danger" : alert.severity === 'high' ? "text-warning" : "text-veta"
                    )} />
                  ) : (
                    <CheckCircle2 className="h-5 w-5 text-muted" />
                  )}
                </div>
                <div>
                  <div className="flex items-center gap-3 mb-1">
                    <Badge variant={
                      alert.status === 'resolved' ? 'secondary' :
                      alert.severity === 'critical' ? 'critical' : 
                      alert.severity === 'high' ? 'high' : 'warning'
                    }>
                      {alert.severity.toUpperCase()}
                    </Badge>
                    <span className="text-xs text-muted font-mono flex items-center gap-1">
                      <Clock size={12} />
                      {format(new Date(alert.createdAt), "dd MMM HH:mm", { locale: es })}
                    </span>
                  </div>
                  <h4 className={cn("font-medium", alert.status === 'resolved' ? 'text-muted' : 'text-foreground')}>
                    {alert.type}: {alert.message}
                  </h4>
                  {alert.campaignName && (
                    <p className="text-sm text-muted mt-1">Campaña afectada: <span className="text-foreground/80">{alert.campaignName}</span></p>
                  )}
                </div>
              </div>
              
              {alert.status === 'active' && (
                <button className="hidden md:block px-4 py-2 text-sm rounded-lg border border-veta/50 text-foreground hover:bg-white/10 transition-colors opacity-0 group-hover:opacity-100">
                  Ver detalle
                </button>
              )}
            </div>
          ))
        )}
      </div>
    </div>
  );
}
