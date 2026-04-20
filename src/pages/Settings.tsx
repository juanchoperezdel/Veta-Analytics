import { useParams } from 'react-router-dom';
import { clients } from '@/data/mockData';
import { Card, CardHeader, CardTitle, CardContent, CardDescription } from '@/components/ui/Card';

export default function Settings() {
  const { clientSlug } = useParams();
  const currentClient = clients.find(c => c.slug === clientSlug) || clients[0];

  return (
    <div className="p-8 max-w-4xl mx-auto space-y-8">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Configuración</h1>
        <p className="text-sm text-muted mt-1">Administrá las integraciones y accesos de {currentClient.name}</p>
      </div>

      <div className="grid gap-6">
        <Card>
          <CardHeader>
            <CardTitle>Cuentas Publicitarias</CardTitle>
            <CardDescription>Orígenes de datos conectados para este cliente.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {[
              { id: 'meta_1', name: 'Meta Ads Account', status: 'Connected', lastSync: 'hace 2 horas' },
              { id: 'google_1', name: 'Google Ads MCC (Subaccount)', status: 'Connected', lastSync: 'hace 2 horas' },
              { id: 'ga4_1', name: 'GA4 Property', status: 'Connected', lastSync: 'hace 4 horas' },
            ].map(source => (
              <div key={source.id} className="flex flex-col md:flex-row md:items-center justify-between p-4 rounded-xl border border-veta/20 bg-[#111]">
                <div>
                  <p className="font-medium">{source.name}</p>
                  <p className="text-xs text-muted mt-1">ID: {source.id} • Última sync: {source.lastSync}</p>
                </div>
                <div className="mt-3 md:mt-0 flex items-center gap-3">
                  <div className="flex items-center gap-2 text-sm text-veta">
                    <span className="relative flex h-2 w-2">
                      <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-veta opacity-75"></span>
                      <span className="relative inline-flex rounded-full h-2 w-2 bg-veta"></span>
                    </span>
                    {source.status}
                  </div>
                  <button className="px-3 py-1.5 text-xs rounded-lg border border-veta/50 hover:bg-white/5 transition-colors">
                    Re-sync
                  </button>
                </div>
              </div>
            ))}
            <button className="w-full py-3 border border-dashed border-veta text-sm text-veta rounded-xl hover:bg-veta/5 transition-colors">
              + Conectar nueva fuente de datos
            </button>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Usuarios con Acceso</CardTitle>
            <CardDescription>Personas que pueden ver este dashboard.</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="h-8 w-8 rounded-full bg-veta/20 flex items-center justify-center font-medium text-veta">
                    A
                  </div>
                  <div>
                    <p className="text-sm font-medium">Admin Veta</p>
                    <p className="text-xs text-muted">admin@veta.agency</p>
                  </div>
                </div>
                <span className="text-xs px-2 py-1 bg-white/10 rounded">Owner</span>
              </div>
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="h-8 w-8 rounded-full bg-white/10 flex items-center justify-center font-medium">
                    {currentClient.logoInitial}
                  </div>
                  <div>
                    <p className="text-sm font-medium">Cliente Contact</p>
                    <p className="text-xs text-muted">contacto@{currentClient.slug}.com</p>
                  </div>
                </div>
                <span className="text-xs px-2 py-1 bg-white/10 rounded">Viewer</span>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
