import { CheckCircle2 } from 'lucide-react';

export default function Alerts() {
  return (
    <div className="p-12 max-w-3xl mx-auto">
      <div className="text-center border border-dashed border-slate-300 rounded-2xl py-16 bg-white">
        <CheckCircle2 className="mx-auto h-10 w-10 text-slate-400 mb-4" />
        <h1 className="text-2xl font-bold tracking-tight text-slate-900">Centro de alertas</h1>
        <p className="text-sm text-slate-500 mt-2 max-w-md mx-auto">
          Pronto vas a recibir notificaciones cuando CPA, ROAS u otras métricas salgan fuera de los umbrales.
        </p>
      </div>
    </div>
  );
}
