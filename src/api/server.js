// src/api/server.js
import express from 'express';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import fs from 'fs';
import path from 'path';
import os from 'os';
import axios from 'axios';
import { apiDB, userDB, subDB, waDB, statsDB } from '../database/db.js';
import { getSocket } from '../whatsapp/manager.js';
import { toWhatsAppJid, cleanPhone } from '../utils/helpers.js';
import logger from '../utils/logger.js';

let _bot = null;
export function setApiBot(bot) {
  _bot = bot;
}

// ── Rate Limiting ─────────────────────────────────────────────────────────────
const limiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 60,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests, please slow down.' },
});

// ── Zod Schemas ───────────────────────────────────────────────────────────────
const TextSchema = z.object({
  to: z.string().min(7).max(20),
  message: z.string().min(1).max(4096),
});

const ImageSchema = z.object({
  to: z.string().min(7).max(20),
  url: z.string().url(),
  caption: z.string().max(1024).optional(),
});

const AudioSchema = z.object({
  to: z.string().min(7).max(20),
  url: z.string().url(),
});

const FileSchema = z.object({
  to: z.string().min(7).max(20),
  url: z.string().url(),
  filename: z.string().max(255).optional(),
  mimetype: z.string().optional(),
});

// ── Auth Middleware ───────────────────────────────────────────────────────────
async function authMiddleware(req, res, next) {
  const apiKey = req.headers['x-api-key'];

  if (!apiKey) {
    return res.status(401).json({ error: 'Missing x-api-key header' });
  }

  const keyRecord = apiDB.getByKey.get(apiKey);
  if (!keyRecord) {
    return res.status(401).json({ error: 'Invalid API key' });
  }

  const user = userDB.get.get(keyRecord.telegram_id);
  if (!user || user.is_blocked) {
    return res.status(403).json({ error: 'Account suspended' });
  }

  const sub = subDB.get.get(keyRecord.telegram_id);
  if (!sub || (sub.plan !== 'pro' && sub.plan !== 'premium')) {
    return res.status(403).json({ error: 'API access requires Pro or Premium plan' });
  }

  req.telegramId = keyRecord.telegram_id;
  req.apiKey = apiKey;
  req.plan = sub.plan;

  next();
}

// ── Get connected socket for user ─────────────────────────────────────────────
function getUserSocket(telegramId) {
  const sessions = waDB.getAll.all(telegramId);
  for (const s of sessions) {
    if (s.status === 'connected') {
      const sock = getSocket(telegramId, s.account_index);
      if (sock) return { sock, session: s };
    }
  }
  return null;
}

// ── Telegram API Log ──────────────────────────────────────────────────────────
function logToTelegram(telegramId, type, to, preview, status) {
  if (!_bot) return;
  const emoji = status === 'SUCCESS' ? '✅' : '❌';
  const msg =
    `📡 <b>API REQUEST</b>\n\n` +
    `👤 User: <code>${telegramId}</code>\n` +
    `📦 Type: <b>${type}</b>\n` +
    `📱 To: <code>${to}</code>\n` +
    `💬 Preview: ${preview}\n` +
    `📊 Status: ${emoji} <b>${status}</b>`;

  _bot.sendMessage(telegramId, msg, { parse_mode: 'HTML' }).catch(() => {});
}

// ── Download URL to tmp file ──────────────────────────────────────────────────
async function downloadToTmp(url, ext) {
  const tmpPath = path.join(os.tmpdir(), `api_media_${Date.now()}.${ext}`);
  const response = await axios.get(url, { responseType: 'arraybuffer', timeout: 15000 });
  fs.writeFileSync(tmpPath, Buffer.from(response.data));
  return tmpPath;
}

// ── Stat logging ──────────────────────────────────────────────────────────────
function logStat(telegramId, eventType, meta) {
  statsDB.insert.run({
    telegram_id: telegramId,
    session_id: null,
    event_type: eventType,
    metadata: JSON.stringify(meta),
  });
  apiDB.incrementRequests.run(telegramId);
}

// ── App Factory ───────────────────────────────────────────────────────────────
export function createApiServer() {
  const app = express();

  app.use(express.json({ limit: '5mb' }));
  app.use(limiter);

  // Health check (no auth)
  app.get('/health', (req, res) => {
    res.json({ status: 'ok', timestamp: new Date().toISOString() });
  });

  // ── POST /api/send/text ────────────────────────────────────────────────────
  app.post('/api/send/text', authMiddleware, async (req, res) => {
    const parse = TextSchema.safeParse(req.body);
    if (!parse.success) return res.status(400).json({ error: parse.error.flatten() });

    const { to, message } = parse.data;
    const jid = toWhatsAppJid(to);
    if (!jid) return res.status(400).json({ error: 'Invalid phone number' });

    const found = getUserSocket(req.telegramId);
    if (!found) return res.status(503).json({ error: 'No active WhatsApp session' });

    try {
      await found.sock.sendMessage(jid, { text: message });
      logStat(req.telegramId, 'api_send_text', { to, preview: message.substring(0, 50) });
      logToTelegram(req.telegramId, 'TEXT', to, message.substring(0, 50), 'SUCCESS');
      res.json({ success: true, to: jid });
    } catch (err) {
      logToTelegram(req.telegramId, 'TEXT', to, message.substring(0, 50), 'FAILED');
      logger.error({ err }, 'API send text error');
      res.status(500).json({ error: 'Failed to send message' });
    }
  });

  // ── POST /api/send/image ───────────────────────────────────────────────────
  app.post('/api/send/image', authMiddleware, async (req, res) => {
    const parse = ImageSchema.safeParse(req.body);
    if (!parse.success) return res.status(400).json({ error: parse.error.flatten() });

    const { to, url, caption } = parse.data;
    const jid = toWhatsAppJid(to);
    if (!jid) return res.status(400).json({ error: 'Invalid phone number' });

    const found = getUserSocket(req.telegramId);
    if (!found) return res.status(503).json({ error: 'No active WhatsApp session' });

    let tmpPath = null;
    try {
      tmpPath = await downloadToTmp(url, 'jpg');
      await found.sock.sendMessage(jid, {
        image: fs.readFileSync(tmpPath),
        caption: caption || '',
      });

      logStat(req.telegramId, 'api_send_image', { to, url });
      logToTelegram(req.telegramId, 'IMAGE', to, url.substring(0, 40), 'SUCCESS');
      res.json({ success: true, to: jid });
    } catch (err) {
      logToTelegram(req.telegramId, 'IMAGE', to, url.substring(0, 40), 'FAILED');
      logger.error({ err }, 'API send image error');
      res.status(500).json({ error: 'Failed to send image' });
    } finally {
      if (tmpPath) fs.rmSync(tmpPath, { force: true });
    }
  });

  // ── POST /api/send/audio ───────────────────────────────────────────────────
  app.post('/api/send/audio', authMiddleware, async (req, res) => {
    const parse = AudioSchema.safeParse(req.body);
    if (!parse.success) return res.status(400).json({ error: parse.error.flatten() });

    const { to, url } = parse.data;
    const jid = toWhatsAppJid(to);
    if (!jid) return res.status(400).json({ error: 'Invalid phone number' });

    const found = getUserSocket(req.telegramId);
    if (!found) return res.status(503).json({ error: 'No active WhatsApp session' });

    let tmpPath = null;
    try {
      tmpPath = await downloadToTmp(url, 'ogg');
      await found.sock.sendMessage(jid, {
        audio: fs.readFileSync(tmpPath),
        mimetype: 'audio/ogg; codecs=opus',
        ptt: true,
      });

      logStat(req.telegramId, 'api_send_audio', { to, url });
      logToTelegram(req.telegramId, 'AUDIO', to, url.substring(0, 40), 'SUCCESS');
      res.json({ success: true, to: jid });
    } catch (err) {
      logToTelegram(req.telegramId, 'AUDIO', to, url.substring(0, 40), 'FAILED');
      logger.error({ err }, 'API send audio error');
      res.status(500).json({ error: 'Failed to send audio' });
    } finally {
      if (tmpPath) fs.rmSync(tmpPath, { force: true });
    }
  });

  // ── POST /api/send/file ────────────────────────────────────────────────────
  app.post('/api/send/file', authMiddleware, async (req, res) => {
    const parse = FileSchema.safeParse(req.body);
    if (!parse.success) return res.status(400).json({ error: parse.error.flatten() });

    const { to, url, filename, mimetype } = parse.data;
    const jid = toWhatsAppJid(to);
    if (!jid) return res.status(400).json({ error: 'Invalid phone number' });

    const found = getUserSocket(req.telegramId);
    if (!found) return res.status(503).json({ error: 'No active WhatsApp session' });

    let tmpPath = null;
    try {
      const ext = filename?.split('.').pop() || 'bin';
      tmpPath = await downloadToTmp(url, ext);
      await found.sock.sendMessage(jid, {
        document: fs.readFileSync(tmpPath),
        mimetype: mimetype || 'application/octet-stream',
        fileName: filename || `file.${ext}`,
      });

      logStat(req.telegramId, 'api_send_file', { to, url, filename });
      logToTelegram(req.telegramId, 'FILE', to, filename || url.substring(0, 40), 'SUCCESS');
      res.json({ success: true, to: jid });
    } catch (err) {
      logToTelegram(req.telegramId, 'FILE', to, filename || url.substring(0, 40), 'FAILED');
      logger.error({ err }, 'API send file error');
      res.status(500).json({ error: 'Failed to send file' });
    } finally {
      if (tmpPath) fs.rmSync(tmpPath, { force: true });
    }
  });

  // 404 handler
  app.use((req, res) => {
    res.status(404).json({ error: 'Endpoint not found' });
  });

  // Error handler
  app.use((err, req, res, next) => {
    logger.error({ err }, 'Unhandled API error');
    res.status(500).json({ error: 'Internal server error' });
  });

  return app;
}

export function startApiServer() {
  const app = createApiServer();
  const port = parseInt(process.env.API_PORT || '3000');
  app.listen(port, () => {
    logger.info({ port }, '🚀 API server started');
  });
  return app;
}
