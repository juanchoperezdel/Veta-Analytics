/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import AppLayout from './components/layout/AppLayout';
import Dashboard from './pages/Dashboard';
import GoogleAds from './pages/GoogleAds';
import MetaAds from './pages/MetaAds';
import Products from './pages/Products';
import YouTube from './pages/YouTube';

export default function App() {
  return (
    <Router>
      <Routes>
        <Route path="/" element={<Navigate to="/andesmar/dashboard" replace />} />
        
        <Route path="/:clientSlug" element={<AppLayout />}>
          <Route index element={<Navigate to="dashboard" replace />} />
          <Route path="dashboard" element={<Dashboard />} />
          <Route path="google-ads" element={<GoogleAds />} />
          <Route path="meta-ads" element={<MetaAds />} />
          <Route path="products" element={<Products />} />
          <Route path="youtube" element={<YouTube />} />
        </Route>
      </Routes>
    </Router>
  );
}
