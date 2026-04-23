import express        from 'express';
import cors           from 'cors';
import helmet         from 'helmet';
import rateLimit      from 'express-rate-limit';
import path           from 'path';
import fs             from 'fs';
import { fileURLToPath } from 'url';

import { router as apiRouter, restoreSessionsOnBoot } from './app/routes/api.js';
import { router as statusRouter }  from './app/routes/status.js';

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

app.set('trust proxy', 1);

// CORS — IPs Render : 74.220.48.0/24 et 74.220.56.0/24
const ALLOWED_ORIGINS = [
  'https://deku-service.onrender.com',
  'http://localhost:3000',
  'http://localhost:5173',
];

app.use(cors({
  origin: (origin, cb) => {
    if (!origin) return cb(null, true);
    if (ALLOWED_ORIGINS.includes(origin)) return cb(null, true);
    cb(new Error(`CORS bloqué : ${origin}`));
  },
  credentials: true,
}));

app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc:  ["'self'", "'unsafe-inline'"],
      styleSrc:   ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
      fontSrc:    ["'self'", 'https://fonts.gstatic.com'],
      imgSrc:     ["'self'", 'data:', 'blob:'],
      connectSrc: ["'self'"],
    },
  },
}));

app.use('/api/', rateLimit({
  windowMs: 60_000, max: 30,
  standardHeaders: true, legacyHeaders: false,
  message: { error: 'Trop de requêtes, réessayez dans une minute.' },
}));

app.use(express.json());
app.use(express.urlencoded({ extended: false }));
app.use(express.static(path.join(__dirname, 'public')));

app.use('/api', apiRouter);
app.use('/api/status', statusRouter);

// Health check — Render ping ce endpoint
app.get('/health', (_req, res) => {
  res.json({ status: 'ok', uptime: process.uptime(), ts: Date.now() });
});

// SPA fallback
app.get('*', (_req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, '0.0.0.0', async () => {
  console.log(`✅ WhatsApp API Agent V2 — https://deku-service.onrender.com`);
  console.log(`   Local : http://localhost:${PORT}`);
  await restoreSessionsOnBoot();
});

process.on('uncaughtException',  err => console.error('[uncaughtException]',  err.message));
process.on('unhandledRejection', err => console.error('[unhandledRejection]', err));

// Auto-ping pour éviter le sleep Render free tier (sleep après 15 min)
const RENDER_URL = process.env.RENDER_EXTERNAL_URL || 'https://deku-service.onrender.com';
setInterval(async () => {
  try {
    const { default: https } = await import('https');
    https.get(`${RENDER_URL}/health`, () => {}).on('error', () => {});
  } catch {}
}, 14 * 60 * 1000);
