// ─────────────────────────────────────────────────────────────────────────────
//  app/api/index.js  —  Serveur Express REST
//
//  Routes disponibles :
//    GET  /health                    → Santé du service (sans auth)
//    GET  /api/status                → État de la session WhatsApp (sans auth)
//    POST /api/send/text             → Envoyer un message texte
//    POST /api/send/image            → Envoyer une image (URL ou base64)
//    POST /api/send/document         → Envoyer un fichier (URL)
//    POST /api/send/bulk             → Envoyer à plusieurs destinataires
//
//  Authentification : header  x-api-key: <votre-clé>
// ─────────────────────────────────────────────────────────────────────────────

import express    from 'express';
import fs         from 'fs';
import path       from 'path';
import { log }    from '../cli/index.js';
import { loadApiKey, listSessions } from '../apikey/index.js';
import {
  getSocket,
  sendTextMessage,
  sendImage,
  sendDocument,
} from '../whatsapp/index.js';

// ─── App Express ─────────────────────────────────────────────────────────────

const app    = express();
let   server = null;

app.use(express.json({ limit: '10mb' }));

// ─── Middleware d'authentification ───────────────────────────────────────────

function auth(req, res, next) {
  const apiKey = req.headers['x-api-key'];

  if (!apiKey) {
    return res.status(401).json({
      success: false,
      error:   'Clé API manquante — ajoutez le header : x-api-key: <votre-clé>',
    });
  }

  // Chercher la session correspondant à cette clé
  const sessions = listSessions();
  let matched    = null;

  for (const phoneNumber of sessions) {
    const data = loadApiKey(phoneNumber);
    if (data && data.apiKey === apiKey && data.status === 'active') {
      matched = { phoneNumber, ...data };
      break;
    }
  }

  if (!matched) {
    return res.status(403).json({
      success: false,
      error:   'Clé API invalide ou inactive',
    });
  }

  req.waSession = matched;   // disponible dans tous les handlers
  next();
}

// ─── Helper : récupérer socket actif ─────────────────────────────────────────

function requireSocket(phoneNumber, res) {
  const socket = getSocket(phoneNumber);
  if (!socket) {
    res.status(503).json({
      success: false,
      error:   'Session WhatsApp non connectée — vérifiez les logs du serveur',
    });
    return null;
  }
  return socket;
}

// ─── Helper : télécharger une URL dans un fichier tmp ────────────────────────

async function fetchToTmp(url, suffix = '') {
  const res    = await fetch(url);
  if (!res.ok) throw new Error(`Impossible de télécharger : ${url} (${res.status})`);
  const buffer = Buffer.from(await res.arrayBuffer());
  const tmp    = path.join('/tmp', `wa_${Date.now()}${suffix}`);
  fs.writeFileSync(tmp, buffer);
  return tmp;
}

// ─────────────────────────────────────────────────────────────────────────────
//  ROUTES PUBLIQUES (sans auth)
// ─────────────────────────────────────────────────────────────────────────────

// GET /health
app.get('/health', (req, res) => {
  res.json({
    success:   true,
    service:   'WhatsApp API Agent v2',
    timestamp: new Date().toISOString(),
  });
});

// GET /api/status
app.get('/api/status', (req, res) => {
  const sessions = listSessions();
  const details  = sessions.map(phoneNumber => {
    const keyData = loadApiKey(phoneNumber);
    const socket  = getSocket(phoneNumber);
    return {
      phoneNumber,
      connected: !!socket,
      hasApiKey: !!keyData,
      createdAt: keyData?.createdAt ?? null,
    };
  });

  res.json({
    success:      true,
    totalSessions: sessions.length,
    sessions:     details,
  });
});

// ─────────────────────────────────────────────────────────────────────────────
//  ROUTES PROTÉGÉES (x-api-key requis)
// ─────────────────────────────────────────────────────────────────────────────

// ── POST /api/send/text ───────────────────────────────────────────────────────
//
//  Body JSON :
//    { "to": "2250712345678", "message": "Bonjour !" }
//
app.post('/api/send/text', auth, async (req, res) => {
  const { to, message } = req.body;

  if (!to || !message) {
    return res.status(400).json({
      success: false,
      error:   'Champs requis : "to" (numéro WhatsApp) et "message" (texte)',
    });
  }

  const socket = requireSocket(req.waSession.phoneNumber, res);
  if (!socket) return;

  try {
    await sendTextMessage(socket, to, message);
    log('success', `[API] Texte envoyé à ${to}`);
    res.json({ success: true, to, message });
  } catch (err) {
    log('error', `[API] Erreur envoi texte : ${err.message}`);
    res.status(500).json({ success: false, error: err.message });
  }
});

// ── POST /api/send/image ──────────────────────────────────────────────────────
//
//  Body JSON (choisir l'une des deux sources) :
//    { "to": "2250712345678", "imageUrl": "https://...", "caption": "..." }
//    { "to": "2250712345678", "imageBase64": "data:image/png;base64,...", "caption": "..." }
//
app.post('/api/send/image', auth, async (req, res) => {
  const { to, imageUrl, imageBase64, caption = '' } = req.body;

  if (!to || (!imageUrl && !imageBase64)) {
    return res.status(400).json({
      success: false,
      error:   'Champs requis : "to" + ("imageUrl" ou "imageBase64")',
    });
  }

  const socket = requireSocket(req.waSession.phoneNumber, res);
  if (!socket) return;

  let tmpPath = null;
  try {
    if (imageUrl) {
      tmpPath = await fetchToTmp(imageUrl, '_img.jpg');
    } else {
      // base64 : "data:image/png;base64,xxxx" ou juste "xxxx"
      const raw     = imageBase64.replace(/^data:[^;]+;base64,/, '');
      const ext     = imageBase64.startsWith('data:image/png') ? '.png' : '.jpg';
      tmpPath       = path.join('/tmp', `wa_${Date.now()}_img${ext}`);
      fs.writeFileSync(tmpPath, Buffer.from(raw, 'base64'));
    }

    await sendImage(socket, to, tmpPath, caption);
    log('success', `[API] Image envoyée à ${to}`);
    res.json({ success: true, to, caption });
  } catch (err) {
    log('error', `[API] Erreur envoi image : ${err.message}`);
    res.status(500).json({ success: false, error: err.message });
  } finally {
    if (tmpPath && fs.existsSync(tmpPath)) fs.unlinkSync(tmpPath);
  }
});

// ── POST /api/send/document ───────────────────────────────────────────────────
//
//  Body JSON :
//    { "to": "2250712345678", "documentUrl": "https://...", "filename": "rapport.pdf", "caption": "..." }
//
app.post('/api/send/document', auth, async (req, res) => {
  const { to, documentUrl, filename, caption = '' } = req.body;

  if (!to || !documentUrl || !filename) {
    return res.status(400).json({
      success: false,
      error:   'Champs requis : "to", "documentUrl" et "filename"',
    });
  }

  const socket = requireSocket(req.waSession.phoneNumber, res);
  if (!socket) return;

  let tmpPath = null;
  try {
    const ext  = path.extname(filename) || '';
    tmpPath    = await fetchToTmp(documentUrl, ext);

    await sendDocument(socket, to, tmpPath, filename, caption);
    log('success', `[API] Document "${filename}" envoyé à ${to}`);
    res.json({ success: true, to, filename });
  } catch (err) {
    log('error', `[API] Erreur envoi document : ${err.message}`);
    res.status(500).json({ success: false, error: err.message });
  } finally {
    if (tmpPath && fs.existsSync(tmpPath)) fs.unlinkSync(tmpPath);
  }
});

// ── POST /api/send/bulk ───────────────────────────────────────────────────────
//
//  Envoi à plusieurs destinataires avec délai anti-ban.
//  Body JSON :
//    {
//      "recipients": ["2250712345678", "2250798765432"],
//      "message":    "Bonjour à tous !",
//      "delayMs":    1500    ← délai entre chaque envoi (défaut : 1500 ms)
//    }
//
app.post('/api/send/bulk', auth, async (req, res) => {
  const { recipients, message, delayMs = 1500 } = req.body;

  if (!Array.isArray(recipients) || recipients.length === 0 || !message) {
    return res.status(400).json({
      success: false,
      error:   'Champs requis : "recipients" (tableau) et "message"',
    });
  }

  if (recipients.length > 50) {
    return res.status(400).json({
      success: false,
      error:   'Maximum 50 destinataires par requête',
    });
  }

  const socket = requireSocket(req.waSession.phoneNumber, res);
  if (!socket) return;

  const results = [];

  for (const to of recipients) {
    try {
      await sendTextMessage(socket, to, message);
      results.push({ to, status: 'sent' });
      log('success', `[API/bulk] Texte envoyé à ${to}`);
    } catch (err) {
      results.push({ to, status: 'failed', error: err.message });
      log('error', `[API/bulk] Échec pour ${to} : ${err.message}`);
    }
    // Délai anti-ban entre chaque message
    await new Promise(r => setTimeout(r, delayMs));
  }

  const sent   = results.filter(r => r.status === 'sent').length;
  const failed = results.filter(r => r.status === 'failed').length;

  res.json({ success: true, sent, failed, results });
});

// ─── 404 pour les routes inconnues ───────────────────────────────────────────

app.use((req, res) => {
  res.status(404).json({
    success: false,
    error:   `Route inconnue : ${req.method} ${req.path}`,
    routes: [
      'GET  /health',
      'GET  /api/status',
      'POST /api/send/text',
      'POST /api/send/image',
      'POST /api/send/document',
      'POST /api/send/bulk',
    ],
  });
});

// ─── Démarrer le serveur Express ─────────────────────────────────────────────

export function startApiServer(PORT) {
  return new Promise((resolve, reject) => {
    server = app.listen(PORT, () => {
      log('success', `🌐 API REST démarrée → http://localhost:${PORT}`);
      log('info',    `   Routes : /health  /api/status  /api/send/text  /api/send/image  /api/send/document  /api/send/bulk`);
      resolve(server);
    });
    server.on('error', reject);
  });
}

export function stopApiServer() {
  if (server) {
    server.close();
    server = null;
  }
}

export { app };
