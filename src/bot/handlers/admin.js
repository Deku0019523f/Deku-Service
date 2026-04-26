// src/bot/handlers/admin.js
import { userDB, subDB, waDB, statsDB, apiDB } from '../../database/db.js';
import { PLANS, formatNumber } from '../../utils/helpers.js';
import logger from '../../utils/logger.js';

const ADMIN_ID = parseInt(process.env.ADMIN_TELEGRAM_ID || '0');

// ── Check if admin ────────────────────────────────────────────────────────────
export function isAdmin(telegramId) {
  return telegramId === ADMIN_ID;
}

// ── Admin Main Menu ───────────────────────────────────────────────────────────
export function getAdminMenuKeyboard() {
  return {
    inline_keyboard: [
      [
        { text: '📊 Dashboard', callback_data: 'admin_dashboard' },
        { text: '👥 Utilisateurs', callback_data: 'admin_users_0' },
      ],
      [
        { text: '💳 Abonnements', callback_data: 'admin_subs' },
        { text: '📱 WhatsApp', callback_data: 'admin_whatsapp' },
      ],
      [
        { text: '📈 Statistiques', callback_data: 'admin_stats' },
        { text: '🔍 Chercher user', callback_data: 'admin_search' },
      ],
      [
        { text: '📢 Broadcast', callback_data: 'admin_broadcast' },
      ],
    ],
  };
}

// ── Dashboard ─────────────────────────────────────────────────────────────────
export function buildDashboard() {
  const totalUsers = userDB.count.get().count;
  const connectedWA = waDB.countConnected.get().count;
  const msgStats = subDB.totalMessages.get();
  const planCounts = subDB.countByPlan.all();
  const todayMsgs = statsDB.todayMessages.get().count;

  const planMap = {};
  for (const p of planCounts) planMap[p.plan] = p.count;

  return (
    `📊 <b>Dashboard Admin</b>\n\n` +
    `👥 <b>Utilisateurs</b>: ${totalUsers}\n` +
    `📱 <b>WA Connectés</b>: ${connectedWA}\n` +
    `💬 <b>Msgs aujourd'hui</b>: ${todayMsgs}\n` +
    `📅 <b>Msgs ce mois</b>: ${formatNumber(msgStats?.month || 0)}\n\n` +
    `📦 <b>Abonnements</b>:\n` +
    `  🆓 Free: ${planMap.free || 0}\n` +
    `  ⭐ Pro: ${planMap.pro || 0}\n` +
    `  👑 Premium: ${planMap.premium || 0}`
  );
}

// ── Users List ────────────────────────────────────────────────────────────────
export function buildUsersList(page = 0) {
  const limit = 10;
  const offset = page * limit;
  const users = userDB.getAll.all(limit, offset);
  const total = userDB.count.get().count;

  if (users.length === 0) {
    return { text: '👥 Aucun utilisateur trouvé.', keyboard: getAdminMenuKeyboard() };
  }

  let text = `👥 <b>Utilisateurs</b> (page ${page + 1})\n\n`;
  for (const u of users) {
    const blocked = u.is_blocked ? ' 🚫' : '';
    const name = u.first_name || u.username || `User`;
    text += `• <code>${u.telegram_id}</code> — ${name}${blocked} [${u.plan || 'free'}]\n`;
  }

  const buttons = [];
  const nav = [];
  if (page > 0) nav.push({ text: '◀️ Précédent', callback_data: `admin_users_${page - 1}` });
  if (offset + limit < total) nav.push({ text: 'Suivant ▶️', callback_data: `admin_users_${page + 1}` });
  if (nav.length) buttons.push(nav);
  buttons.push([{ text: '🔙 Menu Admin', callback_data: 'admin_menu' }]);

  return { text, keyboard: { inline_keyboard: buttons } };
}

// ── User Detail ───────────────────────────────────────────────────────────────
export function buildUserDetail(targetId) {
  const user = userDB.get.get(targetId);
  if (!user) return { text: '❌ Utilisateur introuvable.' };

  const sub = subDB.get.get(targetId);
  const sessions = waDB.getAll.all(targetId);
  const apiKey = apiDB.get.get(targetId);

  let text =
    `👤 <b>Utilisateur</b> <code>${targetId}</code>\n\n` +
    `📝 Nom: ${user.first_name || '-'}\n` +
    `🔖 Username: @${user.username || '-'}\n` +
    `🚫 Bloqué: ${user.is_blocked ? 'Oui' : 'Non'}\n` +
    `📅 Inscrit: ${user.created_at}\n\n` +
    `💳 Plan: <b>${sub?.plan || 'free'}</b>\n` +
    `💬 Msgs aujourd'hui: ${sub?.messages_today || 0}\n` +
    `📊 Msgs ce mois: ${sub?.messages_month || 0}\n\n` +
    `📱 Sessions WA: ${sessions.length}\n`;

  for (const s of sessions) {
    text += `  #${s.account_index} ${s.phone_number || '?'} — ${s.status}\n`;
  }

  if (apiKey) {
    text += `\n🔑 API Key: <code>${apiKey.api_key}</code>\n`;
    text += `📡 Requêtes API: ${apiKey.total_requests}`;
  }

  const keyboard = {
    inline_keyboard: [
      [
        { text: '⭐ Passer Pro', callback_data: `admin_setplan_${targetId}_pro` },
        { text: '👑 Passer Premium', callback_data: `admin_setplan_${targetId}_premium` },
      ],
      [
        { text: '🆓 Passer Free', callback_data: `admin_setplan_${targetId}_free` },
        user.is_blocked
          ? { text: '🔓 Débloquer', callback_data: `admin_unblock_${targetId}` }
          : { text: '🚫 Bloquer', callback_data: `admin_block_${targetId}` },
      ],
      [{ text: '🔙 Liste Users', callback_data: 'admin_users_0' }],
    ],
  };

  return { text, keyboard };
}

// ── Subscriptions Summary ─────────────────────────────────────────────────────
export function buildSubsSummary() {
  const planCounts = subDB.countByPlan.all();
  const planMap = {};
  for (const p of planCounts) planMap[p.plan] = p.count;

  return (
    `💳 <b>Abonnements</b>\n\n` +
    `🆓 Free: ${planMap.free || 0} users\n` +
    `⭐ Pro: ${planMap.pro || 0} users\n` +
    `👑 Premium: ${planMap.premium || 0} users\n\n` +
    `Total: ${(planMap.free || 0) + (planMap.pro || 0) + (planMap.premium || 0)}`
  );
}

// ── WhatsApp Overview ─────────────────────────────────────────────────────────
export function buildWhatsAppOverview() {
  const connected = waDB.countConnected.get().count;
  return (
    `📱 <b>WhatsApp Sessions</b>\n\n` +
    `✅ Connectées: ${connected}\n\n` +
    `Utilisez /user <id> pour voir les sessions d'un utilisateur.`
  );
}

// ── Stats Overview ────────────────────────────────────────────────────────────
export function buildStatsOverview() {
  const todayMsgs = statsDB.todayMessages.get().count;
  const totalUsers = userDB.count.get().count;
  const connected = waDB.countConnected.get().count;
  const msgs = subDB.totalMessages.get();

  return (
    `📈 <b>Statistiques Globales</b>\n\n` +
    `👥 Users total: ${totalUsers}\n` +
    `📱 WA connectés: ${connected}\n` +
    `💬 Msgs aujourd'hui: ${todayMsgs}\n` +
    `📅 Msgs ce mois: ${formatNumber(msgs?.month || 0)}`
  );
}

// ── Admin State (multi-step flows) ────────────────────────────────────────────
const adminState = new Map();

function setAdminState(telegramId, state) { adminState.set(telegramId, state); }
function getAdminState(telegramId) { return adminState.get(telegramId) || null; }
function clearAdminState(telegramId) { adminState.delete(telegramId); }

// ── Broadcast message to all users ────────────────────────────────────────────
async function broadcastMessage(bot, text) {
  const users = userDB.getAll.all(10000, 0);
  let sent = 0, failed = 0;

  for (const u of users) {
    try {
      await bot.sendMessage(u.telegram_id, `📢 <b>Message de l'équipe</b>\n\n${text}`, { parse_mode: 'HTML' });
      sent++;
      // Avoid Telegram flood limits
      await new Promise(r => setTimeout(r, 50));
    } catch {
      failed++;
    }
  }
  return { sent, failed, total: users.length };
}

// ── Register Admin Handlers ───────────────────────────────────────────────────
export function registerAdminHandlers(bot) {
  // /admin command
  bot.onText(/^\/admin$/, (msg) => {
    if (!isAdmin(msg.from.id)) return;
    bot.sendMessage(msg.chat.id, '👑 <b>Panel Admin</b>', {
      parse_mode: 'HTML',
      reply_markup: getAdminMenuKeyboard(),
    });
  });

  // /user <id> command (admin only)
  bot.onText(/^\/user (\d+)$/, (msg, match) => {
    if (!isAdmin(msg.from.id)) return;
    const targetId = parseInt(match[1]);
    const { text, keyboard } = buildUserDetail(targetId);
    bot.sendMessage(msg.chat.id, text, { parse_mode: 'HTML', reply_markup: keyboard });
  });

  // Admin text input handler (for search, broadcast, etc.)
  bot.on('message', async (msg) => {
    if (!isAdmin(msg.from.id)) return;
    if (!msg.text || msg.text.startsWith('/')) return;

    const telegramId = msg.from.id;
    const chatId = msg.chat.id;
    const state = getAdminState(telegramId);
    if (!state) return;

    clearAdminState(telegramId);

    // ── Admin search ────────────────────────────────────────────────────────
    if (state.step === 'await_search') {
      const query = msg.text.trim();
      const targetId = parseInt(query);

      let user = null;
      if (!isNaN(targetId)) {
        user = userDB.get.get(targetId);
      } else {
        // Search by username (scan — small DB assumption)
        const all = userDB.getAll.all(10000, 0);
        user = all.find(u =>
          u.username?.toLowerCase().includes(query.toLowerCase()) ||
          u.first_name?.toLowerCase().includes(query.toLowerCase())
        ) || null;
      }

      if (!user) {
        return bot.sendMessage(chatId, '❌ Aucun utilisateur trouvé.', {
          reply_markup: { inline_keyboard: [[{ text: '🔙 Admin', callback_data: 'admin_menu' }]] },
        });
      }

      const { text, keyboard } = buildUserDetail(user.telegram_id);
      bot.sendMessage(chatId, text, { parse_mode: 'HTML', reply_markup: keyboard });
    }

    // ── Broadcast ───────────────────────────────────────────────────────────
    if (state.step === 'await_broadcast') {
      const text = msg.text.trim();
      // Store message in state with a short key to avoid Telegram callback_data 64-byte limit
      const bcKey = `bc_${telegramId}_${Date.now()}`;
      setAdminState(telegramId, { step: null, bcKey, bcText: text });

      const confirmKeyboard = {
        inline_keyboard: [
          [
            { text: `✅ Envoyer à tous`, callback_data: `admin_bconfirm_${bcKey}` },
            { text: '❌ Annuler', callback_data: 'admin_menu' },
          ],
        ],
      };
      bot.sendMessage(
        chatId,
        `📢 <b>Aperçu du broadcast</b>\n\n${text}\n\n<i>Confirmer l'envoi ?</i>`,
        { parse_mode: 'HTML', reply_markup: confirmKeyboard }
      );
    }
  });

  // Callback queries
  bot.on('callback_query', async (query) => {
    if (!isAdmin(query.from.id)) return;
    const data = query.data;
    const chatId = query.message.chat.id;
    const msgId = query.message.message_id;

    const edit = (text, keyboard) =>
      bot.editMessageText(text, {
        chat_id: chatId,
        message_id: msgId,
        parse_mode: 'HTML',
        reply_markup: keyboard || getAdminMenuKeyboard(),
      });

    try {
      // ── admin_menu
      if (data === 'admin_menu') {
        await edit('👑 <b>Panel Admin</b>', getAdminMenuKeyboard());

      // ── admin_dashboard
      } else if (data === 'admin_dashboard') {
        await edit(buildDashboard(), { inline_keyboard: [[{ text: '🔙 Menu', callback_data: 'admin_menu' }]] });

      // ── admin_users_N
      } else if (data.startsWith('admin_users_')) {
        const page = parseInt(data.split('_')[2] || '0');
        const { text, keyboard } = buildUsersList(page);
        await edit(text, keyboard);

      // ── admin_subs
      } else if (data === 'admin_subs') {
        await edit(buildSubsSummary(), { inline_keyboard: [[{ text: '🔙 Menu', callback_data: 'admin_menu' }]] });

      // ── admin_whatsapp
      } else if (data === 'admin_whatsapp') {
        await edit(buildWhatsAppOverview(), { inline_keyboard: [[{ text: '🔙 Menu', callback_data: 'admin_menu' }]] });

      // ── admin_stats
      } else if (data === 'admin_stats') {
        await edit(buildStatsOverview(), { inline_keyboard: [[{ text: '🔙 Menu', callback_data: 'admin_menu' }]] });

      // ── admin_search
      } else if (data === 'admin_search') {
        setAdminState(query.from.id, { step: 'await_search' });
        await bot.answerCallbackQuery(query.id);
        await bot.sendMessage(chatId, '🔍 Entrez l\'ID Telegram ou le nom d\'utilisateur:', {
          reply_markup: { inline_keyboard: [[{ text: '❌ Annuler', callback_data: 'admin_menu' }]] },
        });

      // ── admin_broadcast
      } else if (data === 'admin_broadcast') {
        setAdminState(query.from.id, { step: 'await_broadcast' });
        const totalUsers = userDB.count.get().count;
        await bot.answerCallbackQuery(query.id);
        await bot.sendMessage(
          chatId,
          `📢 <b>Broadcast</b>\n\nCe message sera envoyé à <b>${totalUsers}</b> utilisateurs.\n\nRédigez votre message:`,
          { parse_mode: 'HTML', reply_markup: { inline_keyboard: [[{ text: '❌ Annuler', callback_data: 'admin_menu' }]] } }
        );

      // ── admin_broadcast_confirm
      } else if (data.startsWith('admin_bconfirm_')) {
        const bcKey = data.replace('admin_bconfirm_', '');
        // Retrieve stored broadcast text from admin state
        const bState = getAdminState(query.from.id);
        const text = bState?.bcText;

        if (!text) {
          await answer('❌ Message expiré. Relancez le broadcast.');
          return;
        }
        clearAdminState(query.from.id);
        await edit('⏳ Envoi du broadcast en cours...');
        const result = await broadcastMessage(bot, text);
        await edit(
          `📢 <b>Broadcast terminé</b>\n\n✅ Envoyés: ${result.sent}\n❌ Échecs: ${result.failed}\n👥 Total: ${result.total}`,
          { inline_keyboard: [[{ text: '🔙 Menu', callback_data: 'admin_menu' }]] }
        );

      // ── admin_setplan_<id>_<plan>
      } else if (data.startsWith('admin_setplan_')) {
        const parts = data.split('_');
        const targetId = parseInt(parts[2]);
        const plan = parts[3];
        subDB.setPlan.run(plan, null, targetId);
        await bot.answerCallbackQuery(query.id, { text: `✅ Plan mis à jour: ${plan}` });
        const { text, keyboard } = buildUserDetail(targetId);
        await edit(text, keyboard);

      // ── admin_block_<id>
      } else if (data.startsWith('admin_block_')) {
        const targetId = parseInt(data.split('_')[2]);
        userDB.setBlocked.run(1, targetId);
        await bot.answerCallbackQuery(query.id, { text: '🚫 Utilisateur bloqué' });
        const { text, keyboard } = buildUserDetail(targetId);
        await edit(text, keyboard);

      // ── admin_unblock_<id>
      } else if (data.startsWith('admin_unblock_')) {
        const targetId = parseInt(data.split('_')[2]);
        userDB.setBlocked.run(0, targetId);
        await bot.answerCallbackQuery(query.id, { text: '🔓 Utilisateur débloqué' });
        const { text, keyboard } = buildUserDetail(targetId);
        await edit(text, keyboard);
      }
    } catch (err) {
      logger.error({ err, data }, 'Admin callback error');
      bot.answerCallbackQuery(query.id, { text: '❌ Erreur' }).catch(() => {});
    }
  });
}
