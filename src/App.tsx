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
        <Route path="/smartway-reporte-2026" element={<SmartwayPublic />} />
        <Route path="/" element={<Navigate to="/smartway-reporte-2026" replace />} />

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
