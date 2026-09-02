import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import type { ReactNode } from 'react';
import AppLayout from './components/layout/AppLayout';
import Dashboard from './pages/Dashboard';
import GoogleAds from './pages/GoogleAds';
import MetaAds from './pages/MetaAds';
import Products from './pages/Products';
import YouTube from './pages/YouTube';
import Evolutivo from './pages/Evolutivo';
import Login from './pages/Login';
import Pulse from './pages/Pulse';
import Funnel from './pages/Funnel';
import Seasonality from './pages/Seasonality';
import SmartwayPublic from './pages/SmartwayPublic';
import GribaPublic from './pages/GribaPublic';
import ControlPetPublic from './pages/ControlPetPublic';
import { getToken } from './lib/api';

function RequireAuth({ children }: { children: ReactNode }) {
  return getToken() ? <>{children}</> : <Navigate to="/login" replace />;
}

export default function App() {
  return (
    <Router>
      <Routes>
        <Route path="/login" element={<Login />} />
        {/* Reporte público de Smartway — link secreto sin login (gate por oscuridad).
            Para revocar acceso, cambiar este path y redeployar. */}
        <Route path="/smartway" element={<SmartwayPublic />} />
        {/* El link largo ya se compartio: se mantiene como redirect para no romperlo. */}
        <Route path="/smartway-reporte-2026" element={<Navigate to="/smartway" replace />} />
        {/* Reporte público de Griba en /griba (link limpio para el cliente, sin login).
            Ruta estática → gana sobre la dinámica /:clientSlug de más abajo. */}
        <Route path="/griba" element={<GribaPublic />} />
        <Route path="/griba-reporte-2026" element={<Navigate to="/griba" replace />} />
        {/* Reporte público de ControlPet, sin login. Ruta estática → gana sobre la
            dinámica /:clientSlug, pero solo en el path exacto: /controlpet/pulse y las
            demás subrutas siguen yendo al panel interno autenticado. */}
        <Route path="/controlpet" element={<ControlPetPublic />} />
        {/* La raíz NO debe exponer el reporte de ningún cliente → va al login interno. */}
        <Route path="/" element={<Navigate to="/login" replace />} />

        <Route path="/:clientSlug" element={<RequireAuth><AppLayout /></RequireAuth>}>
          <Route index element={<Navigate to="pulse" replace />} />
          <Route path="pulse"      element={<Pulse />} />
          <Route path="dashboard"  element={<Dashboard />} />
          <Route path="google-ads" element={<GoogleAds />} />
          <Route path="meta-ads"   element={<MetaAds />} />
          <Route path="products"   element={<Products />} />
          <Route path="evolutivo"  element={<Evolutivo />} />
          <Route path="funnel"     element={<Funnel />} />
          <Route path="seasonality" element={<Seasonality />} />
          <Route path="youtube"    element={<YouTube />} />
        </Route>
      </Routes>
    </Router>
  );
}
