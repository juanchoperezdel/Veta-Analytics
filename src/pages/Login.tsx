import { useState, FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, setToken, setClients } from '../lib/api';

export default function Login() {
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const data = await api.login(email, password);
      if (data.error) { setError('Email o contraseña incorrectos'); return; }
      setToken(data.token);
      setClients(data.clients);
      const firstSlug = data.clients?.[0]?.slug ?? 'andesmar';
      navigate(`/${firstSlug}/dashboard`, { replace: true });
    } catch {
      setError('Error de conexión');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50">
      <div className="bg-white rounded-3xl shadow-sm border border-gray-100 p-10 w-full max-w-sm">
        <div className="mb-8 text-center">
          <span className="inline-flex items-center justify-center w-12 h-12 rounded-2xl bg-[#00D084] text-white font-bold text-xl mb-4">V</span>
          <h1 className="text-xl font-semibold text-gray-900">Veta Analytics</h1>
          <p className="text-sm text-gray-500 mt-1">Ingresá a tu cuenta</p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Email</label>
            <input
              type="email"
              required
              value={email}
              onChange={e => setEmail(e.target.value)}
              className="w-full px-4 py-2.5 rounded-xl border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-[#00D084] focus:border-transparent"
              placeholder="tu@email.com"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Contraseña</label>
            <input
              type="password"
              required
              value={password}
              onChange={e => setPassword(e.target.value)}
              className="w-full px-4 py-2.5 rounded-xl border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-[#00D084] focus:border-transparent"
              placeholder="••••••••"
            />
          </div>

          {error && <p className="text-sm text-red-500">{error}</p>}

          <button
            type="submit"
            disabled={loading}
            className="w-full py-2.5 rounded-xl bg-[#00D084] text-white font-medium text-sm hover:bg-[#009960] transition-colors disabled:opacity-60"
          >
            {loading ? 'Ingresando...' : 'Ingresar'}
          </button>
        </form>
      </div>
    </div>
  );
}
