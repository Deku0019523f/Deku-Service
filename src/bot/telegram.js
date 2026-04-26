// src/bot/telegram.js
import TelegramBot from 'node-telegram-bot-api';
import { registerUserHandlers } from './handlers/user.js';
import { registerAdminHandlers, isAdmin } from './handlers/admin.js';
import { registerAdminCommands } from './handlers/adminCommands.js';
import logger from '../utils/logger.js';

export function createTelegramBot() {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) throw new Error('TELEGRAM_BOT_TOKEN is not set');

  const bot = new TelegramBot(token, {
    polling: {
      interval: 300,
      autoStart: true,
      params: { timeout: 10 },
    },
  });

  // ── Global error handler ──────────────────────────────────────────────────
  bot.on('polling_error', (err) => {
    logger.error({ err: err.message }, 'Telegram polling error');
  });

  bot.on('error', (err) => {
    logger.error({ err: err.message }, 'Telegram bot error');
  });

  // ── Register handlers ─────────────────────────────────────────────────────
  registerUserHandlers(bot);
  registerAdminHandlers(bot);
  registerAdminCommands(bot);

  // ── /help command ─────────────────────────────────────────────────────────
  bot.onText(/^\/help$/, (msg) => {
    const adminSection = isAdmin(msg.from.id)
      ? '\n\n👑 <b>Admin</b>:\n/admin — Panel admin\n/user <id> — Détail utilisateur'
      : '';

    bot.sendMessage(
      msg.chat.id,
      `📖 <b>Aide</b>\n\n` +
      `/start — Menu principal\n` +
      `/menu — Ouvrir le menu\n` +
      `/help — Cette aide\n\n` +
      `🤖 <b>Commandes WhatsApp (owner)</b>:\n` +
      `.agent on/off — Activer/désactiver l'IA\n` +
      `.prompt <texte> — Modifier le prompt\n` +
      `.temps <Ns> — Délai de réponse\n` +
      `.statut — Voir l'état de l'agent` +
      adminSection,
      { parse_mode: 'HTML' }
    );
  });

  logger.info('✅ Telegram bot initialized');
  return bot;
}
