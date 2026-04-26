// src/index.js
import 'dotenv/config';
import { fileURLToPath } from 'url';
import path from 'path';
import fs from 'fs';
import logger from './utils/logger.js';

// ── Validate required env vars ────────────────────────────────────────────────
const REQUIRED_ENV = ['TELEGRAM_BOT_TOKEN', 'ADMIN_TELEGRAM_ID', 'GROQ_API_KEY'];
for (const key of REQUIRED_ENV) {
  if (!process.env[key]) {
    logger.error(`Missing required env var: ${key}`);
    process.exit(1);
  }
}

// ── Ensure directories ────────────────────────────────────────────────────────
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');

for (const dir of ['data', 'sessions', 'assets', 'logs']) {
  fs.mkdirSync(path.join(ROOT, dir), { recursive: true });
}

// ── Anti-crash handlers ───────────────────────────────────────────────────────
process.on('uncaughtException', (err) => {
  logger.error({ err }, '💥 Uncaught Exception');
});

process.on('unhandledRejection', (reason, promise) => {
  logger.error({ reason }, '💥 Unhandled Rejection');
});

process.on('SIGTERM', () => {
  logger.info('SIGTERM received, shutting down gracefully...');
  process.exit(0);
});

process.on('SIGINT', () => {
  logger.info('SIGINT received, shutting down...');
  process.exit(0);
});

// ── Bootstrap ─────────────────────────────────────────────────────────────────
async function main() {
  logger.info('🚀 Starting WhatsApp SaaS Bot...');

  // 1. Initialize database (auto-creates tables)
  const db = await import('./database/db.js');
  logger.info('✅ Database initialized');

  // 2. Start Telegram bot
  const { createTelegramBot } = await import('./bot/telegram.js');
  const bot = createTelegramBot();
  logger.info('✅ Telegram bot started');

  // 3. Wire bot into WhatsApp manager (for notifications)
  const { setBot } = await import('./whatsapp/manager.js');
  setBot(bot);

  // 4. Start REST API server
  const { startApiServer, setApiBot } = await import('./api/server.js');
  setApiBot(bot);
  startApiServer();
  logger.info('✅ API server started');

  // 5. Restore existing WhatsApp sessions
  const { restoreAllSessions } = await import('./whatsapp/manager.js');
  await restoreAllSessions();
  logger.info('✅ WhatsApp sessions restored');

  // 6. Start scheduler (expiry checks, daily reports, cleanup)
  const { startScheduler, setSchedulerBot } = await import('./utils/scheduler.js');
  setSchedulerBot(bot);
  startScheduler();
  logger.info('✅ Scheduler started');

  // Notify admin on startup
  const adminId = parseInt(process.env.ADMIN_TELEGRAM_ID);
  bot.sendMessage(
    adminId,
    `🟢 <b>Bot démarré</b>\n\n⏰ ${new Date().toLocaleString('fr-FR')}\n\n/admin pour le panel`,
    { parse_mode: 'HTML' }
  ).catch(() => {});

  logger.info('✅ WhatsApp SaaS Bot is fully operational');
}

main().catch((err) => {
  logger.error({ err }, 'Fatal error during startup');
  process.exit(1);
});
