const API_BASE = window.location.hostname === 'localhost'
  ? 'http://localhost:4000/api'
  : '/api'; // en prod, adapte si le backend est sur un autre domaine

const API_SOCKET_URL = window.location.hostname === 'localhost'
  ? 'http://localhost:4000'
  : window.location.origin;

function getToken() {
  return localStorage.getItem('token');
}

async function apiFetch(chemin, { method = 'GET', body, sansAuth = false } = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (!sansAuth) headers['Authorization'] = `Bearer ${getToken()}`;

  const res = await fetch(`${API_BASE}${chemin}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.erreur || `Erreur ${res.status}`);
  return data;
}
