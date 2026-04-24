import express        from 'express';
import cors           from 'cors';
import helmet         from 'helmet';
import rateLimit      from 'express-rate-limit';
import path           from 'path';
import fs             from 'fs';
import { fileURLToPath } from 'url';

import { router as apiRouter, restoreSessionsOnBoot } from './app/routes/api.js';
import { router as statusRouter } from './app/routes/status.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

['sessions', 'output', 'assets', 'logs'].forEach(d =>
  fs.mkdirSync(path.join(__dirname, d), { recursive: true })
);

const logoPath = path.join(__dirname, 'assets', 'logo.png');
if (!fs.existsSync(logoPath)) {
  const px = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
  fs.writeFileSync(logoPath, Buffer.from(px, 'base64'));
}

const app  = express();
const PORT = parseInt(process.env.PORT || '3000', 10);
const SELF = process.env.RENDER_EXTERNAL_URL || 'https://deku-service.onrender.com';

// Render proxy trust
app.set('trust proxy', 1);

// ── CORS — AVANT helmet et tout le reste ─────────────────────────────────────
app.use(cors({
  origin: true,        // autoriser toutes les origines (le service est public)
  credentials: true,
  methods: ['GET', 'POST', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Api-Key'],
}));
app.options('*', cors()); // pré-vol OPTIONS

// ── Helmet — CSP permissif pour une SPA self-hosted ──────────────────────────
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc:  ["'self'", "'unsafe-inline'"],
      styleSrc:   ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
      fontSrc:    ["'self'", 'https://fonts.gstatic.com'],
      imgSrc:     ["'self'", 'data:', 'blob:'],
      // connectSrc DOIT inclure le domaine Render pour que fetch() fonctionne
      connectSrc: ["'self'", SELF],
    },
  },
  crossOriginEmbedderPolicy: false, // évite des blocages sur certains navigateurs
}));

// ── Rate limit — séparé par route, genereux pour le polling ──────────────────
app.use('/api/send', rateLimit({
  windowMs: 60_000, max: 60, standardHeaders: true, legacyHeaders: false,
  validate: { trustProxy: false },
  message: { error: 'Trop de requêtes.' },
}));
app.use('/api/connect', rateLimit({
  windowMs: 60_000, max: 200,  // polling 2s = ~30/min, 200 = très large marge
  standardHeaders: true, legacyHeaders: false,
  validate: { trustProxy: false },
  message: { error: 'Trop de requêtes.' },
}));

// ── Body / Static / Routes ────────────────────────────────────────────────────
app.use(express.json());
app.use(express.urlencoded({ extended: false }));
app.use(express.static(path.join(__dirname, 'public')));

app.use('/api', apiRouter);
app.use('/api/status', statusRouter);

// Health check — Render ping ce endpoint pour vérifier la santé du service
app.get('/health', (_req, res) => {
  res.json({ status: 'ok', uptime: Math.round(process.uptime()), port: PORT });
});

// SPA fallback
app.get('*', (_req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// ── Démarrage ─────────────────────────────────────────────────────────────────
app.listen(PORT, '0.0.0.0', async () => {
  console.log(`✅ WhatsApp API Agent V2 — port ${PORT}`);
  console.log(`   URL : ${SELF}`);
  await restoreSessionsOnBoot();
});

process.on('uncaughtException',  err => console.error('[uncaughtException]',  err.message));
process.on('unhandledRejection', err => console.error('[unhandledRejection]', err));

// Auto-ping anti-sleep Render free tier (dort après 15 min d'inactivité)
setInterval(async () => {
  try {
    const mod = SELF.startsWith('https') ? (await import('https')).default : (await import('http')).default;
    mod.get(`${SELF}/health`, r => r.resume()).on('error', () => {});
  } catch {}
}, 14 * 60 * 1000);
