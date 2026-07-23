if (!getToken()) window.location.href = 'index.html';

// --- Navigation ---
document.querySelectorAll('.nav-item').forEach((item) => {
  item.addEventListener('click', () => {
    document.querySelectorAll('.nav-item').forEach((i) => i.classList.remove('active'));
    document.querySelectorAll('.vue').forEach((v) => v.classList.remove('active'));
    item.classList.add('active');
    document.getElementById(`vue-${item.dataset.vue}`).classList.add('active');
    if (item.dataset.vue === 'conversations') chargerConversations();
    if (item.dataset.vue === 'produits') chargerProduits();
    if (item.dataset.vue === 'commandes') chargerCommandes();
  });
});

document.getElementById('btn-deconnexion').addEventListener('click', () => {
  localStorage.removeItem('token');
  window.location.href = 'index.html';
});

// --- Socket.io temps réel ---
const socket = io(API_SOCKET_URL, { auth: { token: getToken() } });

socket.on('whatsapp:qr', ({ qr }) => {
  document.getElementById('zone-qr').innerHTML = `<img src="${qr}" alt="QR code WhatsApp" />`;
});

socket.on('whatsapp:pairing_code', ({ code }) => {
  document.getElementById('zone-pairing').textContent = code;
});

socket.on('whatsapp:statut', ({ statut }) => {
  majBadgeStatut(statut);
  if (statut === 'connecte') {
    document.getElementById('zone-qr').innerHTML = '';
    document.getElementById('zone-pairing').textContent = '';
  }
});

socket.on('conversation:message', ({ conversationId, message }) => {
  if (conversationActiveId === conversationId) afficherMessage(message);
  chargerConversations(); // rafraîchit l'ordre / aperçu de la liste
});

// --- WhatsApp ---
function majBadgeStatut(statut) {
  const badge = document.getElementById('statut-whatsapp');
  const libelles = { connecte: 'Connecté ✓', en_attente_scan: 'En attente de scan…', deconnecte: 'Déconnecté' };
  badge.textContent = libelles[statut] || statut;
  badge.className = `statut-badge ${statut}`;
}

async function chargerStatutWhatsapp() {
  try {
    const { statut } = await apiFetch('/whatsapp/statut');
    majBadgeStatut(statut);
  } catch (err) { console.error(err); }
}
chargerStatutWhatsapp();

document.getElementById('btn-qr').addEventListener('click', async () => {
  await apiFetch('/whatsapp/connecter', { method: 'POST', body: { mode: 'qr' } });
});

document.getElementById('btn-pairing').addEventListener('click', async () => {
  const numeroTelephone = document.getElementById('input-numero').value;
  if (!numeroTelephone) return alert('Entre un numéro de téléphone');
  await apiFetch('/whatsapp/connecter', { method: 'POST', body: { mode: 'pairing', numeroTelephone } });
});

document.getElementById('btn-deconnecter-wa').addEventListener('click', async () => {
  await apiFetch('/whatsapp/deconnecter', { method: 'POST' });
  majBadgeStatut('deconnecte');
});

// --- Conversations ---
let conversationActiveId = null;
let conversationsCache = [];

async function chargerConversations() {
  conversationsCache = await apiFetch('/conversations');
  const liste = document.getElementById('conv-liste');
  liste.innerHTML = conversationsCache.map((c) => `
    <div class="conv-item ${c.id === conversationActiveId ? 'active' : ''}" data-id="${c.id}">
      <div class="num">${c.nom_client || c.numero_whatsapp}</div>
      <div class="statut-mini">${c.statut.replace('_', ' ')} · ${c.prise_en_charge}</div>
    </div>
  `).join('') || '<p class="muted" style="padding:14px">Aucune conversation pour le moment.</p>';

  liste.querySelectorAll('.conv-item').forEach((el) => {
    el.addEventListener('click', () => ouvrirConversation(el.dataset.id));
  });
}

async function ouvrirConversation(id) {
  conversationActiveId = id;
  const conv = conversationsCache.find((c) => c.id === id);
  const messages = await apiFetch(`/conversations/${id}/messages`);

  const detail = document.getElementById('conv-detail');
  detail.innerHTML = `
    <div class="conv-entete">
      <strong>${conv.nom_client || conv.numero_whatsapp}</strong>
      <select id="select-prise-en-charge">
        <option value="ia" ${conv.prise_en_charge === 'ia' ? 'selected' : ''}>IA répond</option>
        <option value="humain" ${conv.prise_en_charge === 'humain' ? 'selected' : ''}>Je réponds moi-même</option>
      </select>
    </div>
    <div class="msg-liste" id="msg-liste"></div>
    <form class="conv-actions" id="form-envoi-manuel">
      <input type="text" placeholder="Écrire un message…" name="texte" />
      <button type="submit" class="btn-primary">Envoyer</button>
    </form>
  `;

  messages.forEach(afficherMessage);
  document.getElementById('select-prise-en-charge').addEventListener('change', async (e) => {
    await apiFetch(`/conversations/${id}/prise-en-charge`, { method: 'PATCH', body: { priseEnCharge: e.target.value } });
  });

  document.getElementById('form-envoi-manuel').addEventListener('submit', async (e) => {
    e.preventDefault();
    const texte = e.target.texte.value.trim();
    if (!texte) return;
    const jidClient = `${conv.numero_whatsapp}@s.whatsapp.net`;
    await apiFetch(`/conversations/${id}/messages`, { method: 'POST', body: { texte, jidClient } });
    e.target.texte.value = '';
  });

  document.querySelectorAll('.conv-item').forEach((el) => el.classList.toggle('active', el.dataset.id === id));
}

function afficherMessage(m) {
  const liste = document.getElementById('msg-liste');
  if (!liste) return;
  const div = document.createElement('div');
  div.className = `msg ${m.expediteur}`;
  div.textContent = m.contenu;
  liste.appendChild(div);
  liste.scrollTop = liste.scrollHeight;
}

// --- Produits ---
async function chargerProduits() {
  const produits = await apiFetch('/produits');
  const tbody = document.querySelector('#table-produits tbody');
  tbody.innerHTML = produits.map((p) => `
    <tr>
      <td>${p.nom}</td>
      <td>${p.prix} FCFA</td>
      <td>${p.stock}</td>
      <td>${p.actif ? 'Oui' : 'Non'}</td>
      <td><button class="lien-supprimer" data-id="${p.id}">Supprimer</button></td>
    </tr>
  `).join('') || '<tr><td colspan="5" class="muted">Aucun produit pour le moment.</td></tr>';

  tbody.querySelectorAll('.lien-supprimer').forEach((btn) => {
    btn.addEventListener('click', async () => {
      await apiFetch(`/produits/${btn.dataset.id}`, { method: 'DELETE' });
      chargerProduits();
    });
  });
}

document.getElementById('form-produit').addEventListener('submit', async (e) => {
  e.preventDefault();
  const donnees = Object.fromEntries(new FormData(e.target));
  await apiFetch('/produits', { method: 'POST', body: donnees });
  e.target.reset();
  chargerProduits();
});

// --- Commandes ---
async function chargerCommandes() {
  const commandes = await apiFetch('/conversations/commandes');
  const tbody = document.querySelector('#table-commandes tbody');
  tbody.innerHTML = commandes.map((c) => `
    <tr>
      <td>${c.nom_client || c.numero_whatsapp}</td>
      <td>${c.nom_produit || '—'}</td>
      <td>${c.quantite}</td>
      <td>${c.statut}</td>
      <td>${new Date(c.created_at).toLocaleString('fr-FR')}</td>
    </tr>
  `).join('') || '<tr><td colspan="5" class="muted">Aucune commande détectée pour le moment.</td></tr>';
}
