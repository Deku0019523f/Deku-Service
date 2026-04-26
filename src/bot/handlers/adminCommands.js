// src/bot/handlers/adminCommands.js
// Extra admin text commands (not callback-based)
import { userDB, subDB, apiDB } from '../../database/db.js';
import { generateApiKey } from '../../utils/helpers.js';
import { isAdmin } from './admin.js';
import logger from '../../utils/logger.js';

export function registerAdminCommands(bot) {

  // /setsub <userId> <free|pro|premium> [days]
  // Example: /setsub 123456789 pro 30
  bot.onText(/^\/setsub (\d+) (free|pro|premium)(?: (\d+))?$/, (msg, match) => {
    if (!isAdmin(msg.from.id)) return;

    const targetId = parseInt(match[1]);
    const plan = match[2];
    const days = match[3] ? parseInt(match[3]) : null;

    const user = userDB.get.get(targetId);
    if (!user) {
      return bot.sendMessage(msg.chat.id, `❌ Utilisateur ${targetId} introuvable.`);
    }

    let expiresAt = null;
    if (days) {
      const expiry = new Date();
      expiry.setDate(expiry.getDate() + days);
      expiresAt = expiry.toISOString();
    }

    subDB.setPlan.run(plan, expiresAt, targetId);

    // Auto-generate API key for pro/premium users if they don't have one
    if ((plan === 'pro' || plan === 'premium') && !apiDB.get.get(targetId)) {
      const newKey = generateApiKey();
      apiDB.upsert.run({ telegram_id: targetId, api_key: newKey });
    }

    const expiryText = expiresAt
      ? `\n⏰ Expire le: ${new Date(expiresAt).toLocaleDateString('fr-FR')}`
      : '\n⏰ Sans expiration';

    // Notify admin
    bot.sendMessage(
      msg.chat.id,
      `✅ <b>Abonnement mis à jour</b>\n\n` +
      `👤 User: <code>${targetId}</code>\n` +
      `💳 Plan: <b>${plan}</b>${expiryText}`,
      { parse_mode: 'HTML' }
    );

    // Notify user
    const planEmoji = { free: '🆓', pro: '⭐', premium: '👑' }[plan];
    bot.sendMessage(
      targetId,
      `${planEmoji} <b>Votre abonnement a été mis à jour!</b>\n\n` +
      `💳 Nouveau plan: <b>${plan}</b>${expiryText}\n\n` +
      `Tapez /menu pour voir vos nouvelles fonctionnalités.`,
      { parse_mode: 'HTML' }
    ).catch(() => {});

    logger.info({ admin: msg.from.id, targetId, plan, days }, 'Admin set subscription');
  });

  // /resetapi <userId> — Force regenerate API key
  bot.onText(/^\/resetapi (\d+)$/, (msg, match) => {
    if (!isAdmin(msg.from.id)) return;

    const targetId = parseInt(match[1]);
    const user = userDB.get.get(targetId);
    if (!user) return bot.sendMessage(msg.chat.id, `❌ Utilisateur ${targetId} introuvable.`);

    const newKey = generateApiKey();
    apiDB.upsert.run({ telegram_id: targetId, api_key: newKey });

    bot.sendMessage(
      msg.chat.id,
      `✅ Nouvelle API key pour <code>${targetId}</code>:\n<code>${newKey}</code>`,
      { parse_mode: 'HTML' }
    );

    bot.sendMessage(
      targetId,
      `🔄 <b>Votre API Key a été réinitialisée</b>\n\n<code>${newKey}</code>`,
      { parse_mode: 'HTML' }
    ).catch(() => {});
  });

  // /stats — Quick stats for admin
  bot.onText(/^\/stats$/, async (msg) => {
    if (!isAdmin(msg.from.id)) return;
    const { buildStatsOverview } = await import('./admin.js');
    bot.sendMessage(msg.chat.id, buildStatsOverview(), { parse_mode: 'HTML' });
  });

  // /broadcast <message> — Quick broadcast (no confirm, use carefully)
  // Usage: /broadcast Hello everyone!
  bot.onText(/^\/bc (.+)$/s, async (msg, match) => {
    if (!isAdmin(msg.from.id)) return;
    const text = match[1].trim();
    const { userDB } = await import('../../database/db.js');

    const users = userDB.getAll.all(10000, 0);
    let sent = 0, failed = 0;

    const progressMsg = await bot.sendMessage(msg.chat.id, `⏳ Envoi broadcast à ${users.length} users...`);

    for (const u of users) {
      try {
        await bot.sendMessage(u.telegram_id, `📢 ${text}`, { parse_mode: 'HTML' });
        sent++;
        await new Promise(r => setTimeout(r, 50));
      } catch { failed++; }
    }

    bot.editMessageText(
      `📢 <b>Broadcast terminé</b>\n✅ ${sent} envoyés | ❌ ${failed} échecs`,
      { chat_id: msg.chat.id, message_id: progressMsg.message_id, parse_mode: 'HTML' }
    );
  });
}
