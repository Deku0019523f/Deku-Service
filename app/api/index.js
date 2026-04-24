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

// GET / — Page d'accueil HTML
app.get('/', (req, res) => {
  const sessions = listSessions();
  const status   = sessions.length > 0 ? '🟢 Connecté' : '🔴 Non connecté';
  const baseUrl  = process.env.RENDER_EXTERNAL_URL
                ?? process.env.SERVICE_URL
                ?? `http://localhost:${process.env.PORT ?? '3000'}`;

  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.send(`<!DOCTYPE html>
<html lang="fr">
<head>
  <meta charset="UTF-8"/>
  <meta name="viewport" content="width=device-width, initial-scale=1.0"/>
  <title>WhatsApp API Agent v2</title>
  <style>
    *{box-sizing:border-box;margin:0;padding:0}
    body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;background:#0f172a;color:#e2e8f0;min-height:100vh}
    header{background:linear-gradient(135deg,#075E54,#128C7E);padding:48px 24px;text-align:center}
    header h1{font-size:2rem;color:#fff;margin-bottom:8px}
    header p{color:#d1fae5;font-size:1rem}
    .status{display:inline-block;background:rgba(255,255,255,.15);border-radius:999px;padding:6px 16px;font-size:.9rem;margin-top:16px;color:#fff}
    main{max-width:800px;margin:0 auto;padding:32px 16px}
    .card{background:#1e293b;border:1px solid #334155;border-radius:12px;padding:24px;margin-bottom:20px}
    .card h2{font-size:1.1rem;color:#7dd3fc;margin-bottom:16px;display:flex;align-items:center;gap:8px}
    table{width:100%;border-collapse:collapse;font-size:.875rem}
    th{text-align:left;padding:8px 12px;background:#0f172a;color:#94a3b8;font-weight:600;text-transform:uppercase;font-size:.75rem;letter-spacing:.05em}
    td{padding:10px 12px;border-top:1px solid #334155;vertical-align:top}
    .method{font-family:monospace;font-weight:700;font-size:.8rem;padding:3px 8px;border-radius:4px;display:inline-block}
    .get{background:#166534;color:#86efac}.post{background:#1e3a8a;color:#93c5fd}
    .route{font-family:monospace;color:#e2e8f0;font-size:.85rem}
    .auth{font-size:.75rem;padding:2px 8px;border-radius:4px;background:#7c2d12;color:#fdba74;font-weight:600}
    pre{background:#0f172a;border:1px solid #334155;border-radius:8px;padding:16px;overflow-x:auto;font-size:.8rem;line-height:1.6;color:#7dd3fc;margin-top:12px}
    .key-box{background:#0f172a;border:1px solid #475569;border-radius:8px;padding:12px 16px;font-family:monospace;color:#fbbf24;font-size:.85rem;margin-top:8px;word-break:break-all}
    .pill{display:inline-block;background:#0f172a;border:1px solid #475569;border-radius:6px;padding:4px 10px;font-size:.75rem;font-family:monospace;color:#94a3b8;margin:2px}
    footer{text-align:center;padding:32px;color:#475569;font-size:.8rem}
    .badge{display:inline-block;background:#25D366;color:#fff;font-size:.7rem;font-weight:700;padding:2px 8px;border-radius:999px;vertical-align:middle;margin-left:8px}
  </style>
</head>
<body>
<header>
  <h1>🤖 WhatsApp API Agent <span class="badge">v2</span></h1>
  <p>Transformez votre WhatsApp en API personnelle d'envoi de messages</p>
  <div class="status">${status} &nbsp;•&nbsp; ${sessions.length} session(s)</div>
</header>
<main>

  <div class="card">
    <h2>🔐 Authentification</h2>
    <p style="color:#94a3b8;font-size:.9rem;margin-bottom:12px">
      Toutes les routes <code style="color:#fbbf24">/api/send/*</code> nécessitent ce header :
    </p>
    <div class="key-box">x-api-key: &lt;votre-clé-uuid&gt;</div>
    <p style="color:#64748b;font-size:.8rem;margin-top:8px">Votre clé est dans <code>sessions/&lt;numéro&gt;/api-key.json</code></p>
  </div>

  <div class="card">
    <h2>📡 Routes disponibles</h2>
    <table>
      <tr><th>Méthode</th><th>Route</th><th>Auth</th><th>Description</th></tr>
      <tr>
        <td><span class="method get">GET</span></td>
        <td class="route">/health</td><td>—</td>
        <td style="color:#94a3b8;font-size:.85rem">Santé du service</td>
      </tr>
      <tr>
        <td><span class="method get">GET</span></td>
        <td class="route">/api/status</td><td>—</td>
        <td style="color:#94a3b8;font-size:.85rem">État des sessions WhatsApp</td>
      </tr>
      <tr>
        <td><span class="method post">POST</span></td>
        <td class="route">/api/send/text</td>
        <td><span class="auth">x-api-key</span></td>
        <td style="color:#94a3b8;font-size:.85rem">Envoyer un message texte</td>
      </tr>
      <tr>
        <td><span class="method post">POST</span></td>
        <td class="route">/api/send/image</td>
        <td><span class="auth">x-api-key</span></td>
        <td style="color:#94a3b8;font-size:.85rem">Envoyer une image (URL ou base64)</td>
      </tr>
      <tr>
        <td><span class="method post">POST</span></td>
        <td class="route">/api/send/document</td>
        <td><span class="auth">x-api-key</span></td>
        <td style="color:#94a3b8;font-size:.85rem">Envoyer un fichier (URL)</td>
      </tr>
      <tr>
        <td><span class="method post">POST</span></td>
        <td class="route">/api/send/bulk</td>
        <td><span class="auth">x-api-key</span></td>
        <td style="color:#94a3b8;font-size:.85rem">Envoi groupé (max 50 destinataires)</td>
      </tr>
    </table>
  </div>

  <div class="card">
    <h2>⚡ Exemple rapide</h2>
    <p style="color:#94a3b8;font-size:.85rem;margin-bottom:4px">Envoyer un message texte :</p>
<pre>curl -X POST ${baseUrl}/api/send/text \\
  -H "Content-Type: application/json" \\
  -H "x-api-key: VOTRE_CLE" \\
  -d '{ "to": "2250712345678", "message": "Bonjour !" }'</pre>
  </div>

  <div class="card">
    <h2>📦 Corps JSON attendu par route</h2>
    <p style="color:#94a3b8;font-size:.8rem;margin-bottom:12px">Champs requis pour chaque endpoint :</p>
    <div style="display:flex;flex-wrap:wrap;gap:8px;font-size:.8rem">
      <div style="flex:1;min-width:200px">
        <div style="color:#7dd3fc;font-weight:600;margin-bottom:6px">/api/send/text</div>
        <span class="pill">to</span><span class="pill">message</span>
      </div>
      <div style="flex:1;min-width:200px">
        <div style="color:#7dd3fc;font-weight:600;margin-bottom:6px">/api/send/image</div>
        <span class="pill">to</span><span class="pill">imageUrl</span> ou <span class="pill">imageBase64</span><span class="pill">caption?</span>
      </div>
      <div style="flex:1;min-width:200px">
        <div style="color:#7dd3fc;font-weight:600;margin-bottom:6px">/api/send/document</div>
        <span class="pill">to</span><span class="pill">documentUrl</span><span class="pill">filename</span><span class="pill">caption?</span>
      </div>
      <div style="flex:1;min-width:200px">
        <div style="color:#7dd3fc;font-weight:600;margin-bottom:6px">/api/send/bulk</div>
        <span class="pill">recipients[]</span><span class="pill">message</span><span class="pill">delayMs?</span>
      </div>
    </div>
  </div>

</main>
<footer>WhatsApp API Agent v2 &nbsp;•&nbsp; ${new Date().toLocaleDateString('fr-FR')}</footer>
</body>
</html>`);
});

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
  // Si le client accepte du HTML (navigateur), rediriger vers la page d'accueil
  if (req.headers.accept?.includes('text/html')) {
    return res.redirect('/');
  }
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
