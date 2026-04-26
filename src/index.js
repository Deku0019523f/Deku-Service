// ─────────────────────────────────────────────────────────────────────────────
//  WhatsApp SaaS Bot — Point d'entrée principal
//  Lance dans l'ordre : DB → Telegram → WhatsApp → API → Scheduler
// ─────────────────────────────────────────────────────────────────────────────
import 'dotenv/config';
import fs   from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT      = path.join(__dirname, '..');

// ── 1. Logger (en premier, avant tout) ───────────────────────────────────────
import logger from './utils/logger.js';

// ── 2. Validation des variables d'environnement ───────────────────────────────
const REQUIRED = ['TELEGRAM_BOT_TOKEN', 'ADMIN_TELEGRAM_ID', 'GROQ_API_KEY'];
const missing  = REQUIRED.filter(k => !process.env[k]);

if (missing.length) {
  console.error(`\n❌ Variables manquantes dans .env : ${missing.join(', ')}\n`);
  process.exit(1);
}

// ── 3. Création des dossiers nécessaires ─────────────────────────────────────
for (const dir of ['data', 'sessions', 'assets', 'logs']) {
  fs.mkdirSync(path.join(ROOT, dir), { recursive: true });
}

// ── 4. Gestionnaires anti-crash ───────────────────────────────────────────────
process.on('uncaughtException',  (err)    => logger.error({ err },    '💥 uncaughtException'));
process.on('unhandledRejection', (reason) => logger.error({ reason }, '💥 unhandledRejection'));
process.on('SIGTERM', () => { logger.info('SIGTERM — arrêt propre'); process.exit(0); });
process.on('SIGINT',  () => { logger.info('SIGINT  — arrêt propre'); process.exit(0); });

// ─────────────────────────────────────────────────────────────────────────────
//  DÉMARRAGE
// ─────────────────────────────────────────────────────────────────────────────
async function main() {
  const startTime = Date.now();
  logger.info('━━━ WhatsApp SaaS Bot — Démarrage ━━━');

  // ── ÉTAPE 1 : Base de données ─────────────────────────────────────────────
  logger.info('[1/5] Initialisation de la base de données...');
  await import('./database/db.js');
  logger.info('      ✅ SQLite prêt');

  // ── ÉTAPE 2 : Bot Telegram ────────────────────────────────────────────────
  logger.info('[2/5] Démarrage du bot Telegram...');
  const { createTelegramBot } = await import('./bot/telegram.js');
  const bot = createTelegramBot();
  logger.info('      ✅ Bot Telegram en ligne');

  // ── ÉTAPE 3 : Gestionnaire WhatsApp ──────────────────────────────────────
  logger.info('[3/5] Initialisation du gestionnaire WhatsApp...');
  const { setBot, restoreAllSessions } = await import('./whatsapp/manager.js');
  setBot(bot);
  await restoreAllSessions();
  logger.info('      ✅ Sessions WhatsApp restaurées');

  // ── ÉTAPE 4 : Serveur API REST ────────────────────────────────────────────
  logger.info('[4/5] Démarrage du serveur API...');
  const { startApiServer, setApiBot } = await import('./api/server.js');
  setApiBot(bot);
  startApiServer();
  const port = process.env.API_PORT || 3000;
  logger.info(`      ✅ API REST en écoute sur le port ${port}`);

  // ── ÉTAPE 5 : Scheduler ───────────────────────────────────────────────────
  logger.info('[5/5] Démarrage du scheduler...');
  const { startScheduler, setSchedulerBot } = await import('./utils/scheduler.js');
  setSchedulerBot(bot);
  startScheduler();
  logger.info('      ✅ Scheduler actif (expiry: 1h | rapport: minuit | cleanup: 6h)');

  // ── Résumé final ──────────────────────────────────────────────────────────
  const elapsed = ((Date.now() - startTime) / 1000).toFixed(2);
  logger.info(`━━━ Bot opérationnel en ${elapsed}s ━━━`);

  // Notification Telegram à l'admin
  const adminId = parseInt(process.env.ADMIN_TELEGRAM_ID);
  bot.sendMessage(
    adminId,
    `🟢 <b>Bot démarré</b>\n\n` +
    `⏰ ${new Date().toLocaleString('fr-FR')}\n` +
    `⚡ Démarré en ${elapsed}s\n` +
    `🌐 API: port ${port}\n\n` +
    `/admin → panel complet`,
    { parse_mode: 'HTML' }
  ).catch(() => {});
}

main().catch(err => {
  logger.error({ err }, '❌ Erreur fatale au démarrage');
  process.exit(1);
});
