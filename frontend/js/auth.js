document.querySelectorAll('.tab').forEach((tab) => {
  tab.addEventListener('click', () => {
    document.querySelectorAll('.tab').forEach((t) => t.classList.remove('active'));
    document.querySelectorAll('.tab-panel').forEach((p) => p.classList.remove('active'));
    tab.classList.add('active');
    document.getElementById(`form-${tab.dataset.tab}`).classList.add('active');
  });
});

if (getToken()) window.location.href = 'dashboard.html';

document.getElementById('form-connexion').addEventListener('submit', async (e) => {
  e.preventDefault();
  const erreurEl = document.getElementById('erreur-connexion');
  erreurEl.textContent = '';
  const donnees = Object.fromEntries(new FormData(e.target));
  try {
    const { token } = await apiFetch('/auth/connexion', { method: 'POST', body: donnees, sansAuth: true });
    localStorage.setItem('token', token);
    window.location.href = 'dashboard.html';
  } catch (err) {
    erreurEl.textContent = err.message;
  }
});

document.getElementById('form-inscription').addEventListener('submit', async (e) => {
  e.preventDefault();
  const erreurEl = document.getElementById('erreur-inscription');
  erreurEl.textContent = '';
  const donnees = Object.fromEntries(new FormData(e.target));
  try {
    const { token } = await apiFetch('/auth/inscription', { method: 'POST', body: donnees, sansAuth: true });
    localStorage.setItem('token', token);
    window.location.href = 'dashboard.html';
  } catch (err) {
    erreurEl.textContent = err.message;
  }
});
