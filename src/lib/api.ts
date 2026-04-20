const BASE = import.meta.env.DEV ? 'http://localhost:8888/.netlify/functions' : '/.netlify/functions';

export function getToken(): string | null {
  return localStorage.getItem('veta_token');
}

export function setToken(token: string) {
  localStorage.setItem('veta_token', token);
}

export function clearToken() {
  localStorage.removeItem('veta_token');
  localStorage.removeItem('veta_clients');
}

export function getClients(): { id: string; slug: string; name: string; logoInitial: string }[] {
  try { return JSON.parse(localStorage.getItem('veta_clients') ?? '[]'); } catch { return []; }
}

export function setClients(clients: unknown[]) {
  localStorage.setItem('veta_clients', JSON.stringify(clients));
}

async function apiFetch(path: string, options: RequestInit = {}) {
  const token = getToken();
  const res = await fetch(`${BASE}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...options.headers,
    },
  });
  if (res.status === 401) {
    clearToken();
    window.location.href = '/login';
    throw new Error('Unauthorized');
  }
  return res.json();
}

function rangeParams(start?: string, end?: string) {
  if (!start || !end) return '';
  return `&start=${start}&end=${end}`;
}

export const api = {
  login: (email: string, password: string) =>
    apiFetch('/login', { method: 'POST', body: JSON.stringify({ email, password }) }),

  dashboard: (slug: string, start?: string, end?: string) => apiFetch(`/dashboard?slug=${slug}${rangeParams(start, end)}`),
  googleAds: (slug: string, start?: string, end?: string) => apiFetch(`/google-ads?slug=${slug}${rangeParams(start, end)}`),
  metaAds:   (slug: string, start?: string, end?: string) => apiFetch(`/meta-ads?slug=${slug}${rangeParams(start, end)}`),
  products:  (slug: string, start?: string, end?: string) => apiFetch(`/products?slug=${slug}${rangeParams(start, end)}`),
  youtube:   (slug: string, start?: string, end?: string) => apiFetch(`/youtube?slug=${slug}${rangeParams(start, end)}`),
  evolutivo: (slug: string) => apiFetch(`/evolutivo?slug=${slug}`),
};
