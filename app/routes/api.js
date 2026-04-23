/**
 * Routes API principales
 * POST /api/connect         — démarrer la connexion WA (retourne pairing code)
 * GET  /api/connect/:phone  — vérifier si connexion établie (polling SSE-friendly)
 * POST /api/send/text       — envoyer message texte
 * POST /api/send/image      — envoyer image
 * POST /api/send/document   — envoyer document
 * GET  /api/sessions        — lister les sessions actives
 * DELETE /api/sessions/:phone — supprimer une session
 * GET  /api/key/:phone      — récupérer la clé API
 */

import { Router }    from 'express';
import path          from 'path';
import fs            from 'fs';
import { fileURLToPath } from 'url';

import {
  connectWithPairingCode,
  reconnectExistingSession,
  getSocket,
  sendTextMessage,
  sendImage,
  sendDocument,
  clearSession,
} from '../whatsapp/index.js';

import {
  generateApiKey,
  saveApiKey,
  loadApiKey,
  listSessions,
  sessionExists,
} from '../apikey/index.js';

import { generateGuidePDF } from '../pdf/index.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT      = path.resolve(__dirname, '../..');

export const router = Router();

// ── État en mémoire des connexions en cours ───────────────────────────────────
// phone → { status, pairingCode, error }
const connectionState = new Map();

// ── Middleware auth par clé API ───────────────────────────────────────────────
function requireApiKey(req, res, next) {
  const key  = req.headers['x-api-key'] || req.headers['authorization']?.replace('Bearer ', '');
  const phone = req.body?.from || req.query?.from;

  if (!key) return res.status(401).json({ error: 'Clé API manquante (header X-Api-Key)' });

  if (phone) {
    const data = loadApiKey(phone);
    if (!data || data.apiKey !== key) {
      return res.status(401).json({ error: 'Clé API invalide pour ce numéro' });
    }
  }
  next();
}

// ────────────────────────────────────────────────────────────────────────────
// POST /api/connect
// Body: { phone: "2250712345678" }
// ────────────────────────────────────────────────────────────────────────────
router.post('/connect', async (req, res) => {
  const { phone } = req.body;

  if (!phone || !/^\d{7,15}$/.test(phone)) {
    return res.status(400).json({
      error: 'Numéro invalide. Format : chiffres uniquement, sans +. Ex: 2250712345678',
    });
  }

  // Si déjà connecté
  const existing = loadApiKey(phone);
  const sock     = getSocket(phone);
  if (existing && sock) {
    return res.json({
      status:  'already_connected',
      phone,
      apiKey:  existing.apiKey,
      message: 'Session déjà active.',
    });
  }

  // Connexion en cours ?
  const inProgress = connectionState.get(phone);
  if (inProgress?.status === 'connecting') {
    return res.json({ status: 'connecting', phone, message: 'Connexion déjà en cours…' });
  }

  // Démarrer la connexion en arrière-plan
  connectionState.set(phone, { status: 'connecting', pairingCode: null, error: null });

  connectWithPairingCode(
    phone,

    // onPairingCode
    (code) => {
      console.log(`[CONNECT] Code appairage pour ${phone} : ${code}`);
      connectionState.set(phone, { status: 'awaiting_validation', pairingCode: code, error: null });
    },

    // onConnected (backup callback si 'open' arrive hors-promesse)
    async ({ socket, jid }) => {
      await handleConnected(phone, socket);
    }
  )
  .then(async ({ socket, jid }) => {
    await handleConnected(phone, socket);
  })
  .catch((err) => {
    console.error(`[CONNECT] Erreur ${phone} :`, err.message);
    connectionState.set(phone, { status: 'error', pairingCode: null, error: err.message });
  });

  res.json({ status: 'connecting', phone, message: 'Connexion initiée, appelez GET /api/connect/:phone pour le code.' });
});

async function handleConnected(phone, socket) {
  // Éviter le double-appel
  const current = connectionState.get(phone);
  if (current?.status === 'connected') return;

  const apiKey = generateApiKey();
  saveApiKey(phone, apiKey);
  connectionState.set(phone, { status: 'connected', pairingCode: null, error: null, apiKey });

  console.log(`[CONNECT] ✅ ${phone} connecté. Clé : ${apiKey}`);

  // Onboarding WhatsApp (image + PDF) en arrière-plan
  sendOnboarding(phone, socket, apiKey).catch(err =>
    console.error('[ONBOARDING]', err.message)
  );
}

async function sendOnboarding(phone, socket, apiKey) {
  const date    = new Date().toLocaleDateString('fr-FR', { day: '2-digit', month: 'long', year: 'numeric' });
  const logoPath = path.join(ROOT, 'assets', 'logo.png');

  let pdfPath;
  try {
    pdfPath = await generateGuidePDF(phone, apiKey, date);
  } catch (err) {
    console.error('[PDF]', err.message);
    return;
  }

  const caption =
    `✅ Connexion WhatsApp réussie\n\n` +
    `🔐 Votre clé API :\n\n${apiKey}\n\n` +
    `⚠️ Gardez cette clé privée.\n\n` +
    `📄 Le guide d'intégration suit.`;

  await new Promise(r => setTimeout(r, 2000));

  try {
    await sendImage(socket, phone, logoPath, caption);
    await new Promise(r => setTimeout(r, 1500));
    await sendDocument(socket, phone, pdfPath, `Guide_${phone}.pdf`,
      "📘 Guide d'intégration WhatsApp API 🚀");
  } catch (err) {
    console.error('[ONBOARDING SEND]', err.message);
  }
}

// ────────────────────────────────────────────────────────────────────────────
// GET /api/connect/:phone  — polling (appelé par le frontend toutes les 2 s)
// ────────────────────────────────────────────────────────────────────────────
router.get('/connect/:phone', (req, res) => {
  const { phone } = req.params;
  const state     = connectionState.get(phone);

  if (!state) {
    // Peut-être une session persistée
    const data = loadApiKey(phone);
    if (data) {
      return res.json({ status: 'connected', phone, apiKey: data.apiKey });
    }
    return res.status(404).json({ status: 'not_started', phone });
  }

  res.json({ ...state, phone });
});

// ────────────────────────────────────────────────────────────────────────────
// POST /api/send/text
// Headers: X-Api-Key
// Body: { from, to, message }
// ────────────────────────────────────────────────────────────────────────────
router.post('/send/text', requireApiKey, async (req, res) => {
  const { from, to, message } = req.body;
  if (!from || !to || !message) {
    return res.status(400).json({ error: 'Champs requis : from, to, message' });
  }
  if (!/^\d{7,15}$/.test(to)) {
    return res.status(400).json({ error: 'Numéro "to" invalide (chiffres uniquement, sans +)' });
  }

  const socket = getSocket(from);
  if (!socket) {
    return res.status(503).json({ error: 'Session WhatsApp non connectée pour ce numéro' });
  }

  try {
    await sendTextMessage(socket, to, message);
    res.json({ success: true, from, to, message });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ────────────────────────────────────────────────────────────────────────────
// POST /api/send/image
// Body: { from, to, url, caption? }
// ────────────────────────────────────────────────────────────────────────────
router.post('/send/image', requireApiKey, async (req, res) => {
  const { from, to, url, caption = '' } = req.body;
  if (!from || !to || !url) {
    return res.status(400).json({ error: 'Champs requis : from, to, url' });
  }

  const socket = getSocket(from);
  if (!socket) return res.status(503).json({ error: 'Session non connectée' });

  try {
    // Télécharger l'image temporairement
    const { default: https } = await import('https');
    const { default: http  } = await import('http');
    const tmpPath = path.join(ROOT, 'output', `tmp_${Date.now()}.jpg`);

    await new Promise((resolve, reject) => {
      const client = url.startsWith('https') ? https : http;
      const file   = fs.createWriteStream(tmpPath);
      client.get(url, r => { r.pipe(file); file.on('finish', resolve); }).on('error', reject);
    });

    await sendImage(socket, to, tmpPath, caption);
    fs.unlinkSync(tmpPath);
    res.json({ success: true, from, to, url, caption });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ────────────────────────────────────────────────────────────────────────────
// POST /api/send/document
// Body: { from, to, url, filename, caption? }
// ────────────────────────────────────────────────────────────────────────────
router.post('/send/document', requireApiKey, async (req, res) => {
  const { from, to, url, filename = 'document.pdf', caption = '' } = req.body;
  if (!from || !to || !url) {
    return res.status(400).json({ error: 'Champs requis : from, to, url' });
  }

  const socket = getSocket(from);
  if (!socket) return res.status(503).json({ error: 'Session non connectée' });

  try {
    const { default: https } = await import('https');
    const { default: http  } = await import('http');
    const tmpPath = path.join(ROOT, 'output', `tmp_${Date.now()}.pdf`);

    await new Promise((resolve, reject) => {
      const client = url.startsWith('https') ? https : http;
      const file   = fs.createWriteStream(tmpPath);
      client.get(url, r => { r.pipe(file); file.on('finish', resolve); }).on('error', reject);
    });

    await sendDocument(socket, to, tmpPath, filename, caption);
    fs.unlinkSync(tmpPath);
    res.json({ success: true, from, to, filename });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ────────────────────────────────────────────────────────────────────────────
// GET /api/sessions  — liste toutes les sessions
// ────────────────────────────────────────────────────────────────────────────
router.get('/sessions', (req, res) => {
  const sessions = listSessions().map(phone => {
    const data   = loadApiKey(phone);
    const active = !!getSocket(phone);
    return { phone, apiKey: data?.apiKey, createdAt: data?.createdAt, active };
  });
  res.json({ sessions });
});

// ────────────────────────────────────────────────────────────────────────────
// DELETE /api/sessions/:phone
// ────────────────────────────────────────────────────────────────────────────
router.delete('/sessions/:phone', (req, res) => {
  const { phone } = req.params;
  const sock = getSocket(phone);
  if (sock) { try { sock.end(); } catch {} }
  clearSession(phone);
  connectionState.delete(phone);
  res.json({ success: true, message: `Session ${phone} supprimée.` });
});

// ────────────────────────────────────────────────────────────────────────────
// GET /api/key/:phone  — retourner la clé API d'un numéro
// ────────────────────────────────────────────────────────────────────────────
router.get('/key/:phone', (req, res) => {
  const data = loadApiKey(req.params.phone);
  if (!data) return res.status(404).json({ error: 'Aucune clé pour ce numéro' });
  res.json(data);
});

// ── Restauration des sessions au démarrage ────────────────────────────────────
export async function restoreSessionsOnBoot() {
  const phones = listSessions();
  console.log(`[BOOT] ${phones.length} session(s) à restaurer…`);
  for (const phone of phones) {
    try {
      console.log(`[BOOT] Restauration ${phone}…`);
      const { socket } = await reconnectExistingSession(phone);
      const data = loadApiKey(phone);
      connectionState.set(phone, { status: 'connected', pairingCode: null, error: null, apiKey: data?.apiKey });
      console.log(`[BOOT] ✅ ${phone} reconnecté`);
    } catch (err) {
      console.warn(`[BOOT] ⚠ Échec restauration ${phone} : ${err.message}`);
      connectionState.set(phone, { status: 'error', error: err.message });
    }
    await new Promise(r => setTimeout(r, 1000));
  }
}
