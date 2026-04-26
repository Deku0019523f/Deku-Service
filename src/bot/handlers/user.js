// src/bot/handlers/user.js
import fs from 'fs';
import path from 'path';
import { userDB, subDB, waDB, apiDB } from '../../database/db.js';
import {
  PLANS,
  cleanPhone,
  validatePhone,
  generateApiKey,
  getSessionPath,
  ASSETS_DIR,
  formatNumber,
  sleep,
} from '../../utils/helpers.js';
import { connectSession, disconnectSession, isSessionRegistered, getSocket } from '../../whatsapp/manager.js';
import { formatProductsWithAI } from '../../ai/groq.js';
import logger from '../../utils/logger.js';

// ── In-memory state for multi-step flows ──────────────────────────────────────
// telegramId → { step, data }
const userState = new Map();

function setState(telegramId, state) {
  userState.set(telegramId, state);
}

function getState(telegramId) {
  return userState.get(telegramId) || null;
}

function clearState(telegramId) {
  userState.delete(telegramId);
}

// ── Ensure user exists in DB ──────────────────────────────────────────────────
function ensureUser(from) {
  userDB.upsert.run({
    telegram_id: from.id,
    username: from.username || null,
    first_name: from.first_name || null,
  });
  subDB.upsert.run(from.id);
}

// ── Main Menu ─────────────────────────────────────────────────────────────────
function getMainMenuKeyboard(telegramId) {
  const sessions = waDB.getAll.all(telegramId);
  const hasActive = sessions.some((s) => s.status === 'connected');

  return {
    inline_keyboard: [
      [
        { text: '📱 Connecter WhatsApp', callback_data: 'user_connect_wa' },
        { text: '🧠 Configurer IA', callback_data: 'user_config_ai' },
      ],
      [
        { text: '📦 Produits JSON', callback_data: 'user_products' },
        { text: '🔑 Mon API', callback_data: 'user_api' },
      ],
      [
        { text: '📊 Mon abonnement', callback_data: 'user_subscription' },
        { text: '⚙️ Paramètres', callback_data: 'user_settings' },
      ],
      [
        hasActive
          ? { text: '⏸️ Pause bot', callback_data: 'user_pause' }
          : { text: '▶️ Activer bot', callback_data: 'user_resume' },
      ],
    ],
  };
}

function buildWelcome(from, sub) {
  const plan = sub?.plan || 'free';
  const planInfo = PLANS[plan];
  const name = from.first_name || from.username || 'utilisateur';

  return (
    `👋 Bonjour <b>${name}</b>!\n\n` +
    `🤖 <b>WhatsApp AI Bot</b>\n\n` +
    `💳 Plan: <b>${planInfo.label}</b>\n` +
    `💬 Msgs aujourd'hui: ${sub?.messages_today || 0}/${formatNumber(planInfo.daily_limit)}\n` +
    `📅 Ce mois: ${sub?.messages_month || 0}/${formatNumber(planInfo.monthly_limit)}`
  );
}

// ── Subscription Panel ────────────────────────────────────────────────────────
function buildSubscriptionPanel(telegramId) {
  const sub = subDB.get.get(telegramId);
  const plan = sub?.plan || 'free';
  const planInfo = PLANS[plan];

  let text =
    `📊 <b>Mon Abonnement</b>\n\n` +
    `💳 Plan actuel: <b>${planInfo.label}</b>\n` +
    `💬 Messages aujourd'hui: ${sub?.messages_today || 0} / ${formatNumber(planInfo.daily_limit)}\n` +
    `📅 Messages ce mois: ${sub?.messages_month || 0} / ${formatNumber(planInfo.monthly_limit)}\n` +
    `📱 Comptes WA max: ${planInfo.max_accounts}\n` +
    `🔑 Accès API: ${planInfo.api_access ? '✅' : '❌'}\n\n` +
    `📦 <b>Plans disponibles</b>:\n` +
    `🆓 Free — 10/j, 30/mois\n` +
    `⭐ Pro — 100/j, 500/mois + API\n` +
    `👑 Premium — Illimité + Multi + API`;

  return text;
}

// ── API Panel ─────────────────────────────────────────────────────────────────
async function sendApiPanel(bot, chatId, telegramId) {
  const sub = subDB.get.get(telegramId);
  const plan = sub?.plan || 'free';

  if (plan !== 'pro' && plan !== 'premium') {
    await bot.sendMessage(
      chatId,
      `🔑 <b>Mon API</b>\n\n❌ Fonction réservée aux abonnés <b>Pro</b> et <b>Premium</b>.\n\nContactez l'admin pour upgrader.`,
      { parse_mode: 'HTML', reply_markup: { inline_keyboard: [[{ text: '🔙 Menu', callback_data: 'user_menu' }]] } }
    );
    return;
  }

  // Get or create API key
  let keyRecord = apiDB.get.get(telegramId);
  if (!keyRecord) {
    const newKey = generateApiKey();
    apiDB.upsert.run({ telegram_id: telegramId, api_key: newKey });
    keyRecord = apiDB.get.get(telegramId);
  }

  const port = process.env.API_PORT || 3000;
  const text =
    `🔑 <b>Votre API Key</b>\n\n` +
    `<code>${keyRecord.api_key}</code>\n\n` +
    `📌 <b>Endpoints</b>:\n` +
    `<code>POST /api/send/text</code>\n` +
    `<code>POST /api/send/image</code>\n` +
    `<code>POST /api/send/audio</code>\n` +
    `<code>POST /api/send/file</code>\n\n` +
    `📡 Requêtes totales: ${keyRecord.total_requests}\n\n` +
    `⚠️ Header obligatoire: <code>x-api-key: ${keyRecord.api_key}</code>`;

  await bot.sendMessage(chatId, text, {
    parse_mode: 'HTML',
    reply_markup: {
      inline_keyboard: [
        [{ text: '🔄 Régénérer la clé', callback_data: 'user_api_regen' }],
        [{ text: '🔙 Menu', callback_data: 'user_menu' }],
      ],
    },
  });

  // Send PDF doc if it exists
  const docPath = path.join(ASSETS_DIR, 'api-doc.pdf');
  if (fs.existsSync(docPath)) {
    await bot.sendDocument(chatId, docPath, { caption: '📄 Documentation API complète' });
  }
}

// ── Sessions Panel ────────────────────────────────────────────────────────────
function buildSessionsList(telegramId) {
  const sessions = waDB.getAll.all(telegramId);
  const sub = subDB.get.get(telegramId);
  const plan = sub?.plan || 'free';
  const maxAccounts = PLANS[plan].max_accounts;

  const buttons = [];

  for (const s of sessions) {
    const statusEmoji = s.status === 'connected' ? '✅' : '❌';
    const phone = s.phone_number || 'N/A';
    buttons.push([
      {
        text: `${statusEmoji} Compte #${s.account_index} — ${phone}`,
        callback_data: `user_wa_detail_${s.account_index}`,
      },
    ]);
  }

  if (sessions.length < maxAccounts) {
    buttons.push([{ text: '➕ Ajouter un compte', callback_data: 'user_wa_add' }]);
  }

  buttons.push([{ text: '🔙 Menu', callback_data: 'user_menu' }]);

  const text =
    `📱 <b>Mes Comptes WhatsApp</b>\n\n` +
    `📊 ${sessions.length}/${maxAccounts} compte(s) utilisé(s)`;

  return { text, keyboard: { inline_keyboard: buttons } };
}

// ── Register User Handlers ────────────────────────────────────────────────────
export function registerUserHandlers(bot) {

  // ── /start ────────────────────────────────────────────────────────────────
  bot.onText(/^\/start$/, async (msg) => {
    const { from, chat } = msg;
    ensureUser(from);

    const sub = subDB.get.get(from.id);
    const user = userDB.get.get(from.id);

    if (user.is_blocked) {
      return bot.sendMessage(chat.id, '🚫 Votre compte est suspendu. Contactez le support.');
    }

    await bot.sendMessage(chat.id, buildWelcome(from, sub), {
      parse_mode: 'HTML',
      reply_markup: getMainMenuKeyboard(from.id),
    });
  });

  // ── /menu ─────────────────────────────────────────────────────────────────
  bot.onText(/^\/menu$/, async (msg) => {
    const { from, chat } = msg;
    ensureUser(from);
    const sub = subDB.get.get(from.id);
    await bot.sendMessage(chat.id, buildWelcome(from, sub), {
      parse_mode: 'HTML',
      reply_markup: getMainMenuKeyboard(from.id),
    });
  });

  // ── Text input handler (for multi-step flows) ─────────────────────────────
  bot.on('message', async (msg) => {
    if (!msg.text || msg.text.startsWith('/')) return;

    const telegramId = msg.from.id;
    const chatId = msg.chat.id;
    const text = msg.text.trim();
    const state = getState(telegramId);

    if (!state) return;

    try {
      // ── Awaiting phone number for WhatsApp connect ──────────────────────
      if (state.step === 'await_phone') {
        clearState(telegramId);
        const digits = cleanPhone(text);

        if (!digits || digits.length < 7) {
          return bot.sendMessage(chatId, '❌ Numéro invalide. Réessayez avec /menu');
        }

        const accountIndex = state.accountIndex || 1;
        const sub = subDB.get.get(telegramId);
        const plan = sub?.plan || 'free';

        // Check if already registered
        if (isSessionRegistered(telegramId, accountIndex)) {
          return bot.sendMessage(chatId, '⚠️ Ce compte est déjà enregistré (ALREADY_REGISTERED). Déconnectez d\'abord.');
        }

        // Store in DB
        waDB.upsert.run({ telegram_id: telegramId, account_index: accountIndex, phone_number: digits });

        const waitMsg = await bot.sendMessage(chatId, '⏳ Connexion en cours, veuillez patienter...');

        connectSession({
          telegramId,
          accountIndex,
          phoneNumber: digits,
          onPairingCode: async (code) => {
            const formatted = code.match(/.{1,4}/g)?.join('-') || code;
            await bot.sendMessage(
              chatId,
              `📱 <b>Code de jumelage</b>\n\n` +
              `<code>${formatted}</code>\n\n` +
              `1. Ouvrez WhatsApp sur votre téléphone\n` +
              `2. Appareils liés → Lier un appareil\n` +
              `3. Entrez ce code`,
              { parse_mode: 'HTML' }
            );
          },
          onConnected: async () => {
            await bot.sendMessage(
              chatId,
              `✅ <b>WhatsApp connecté avec succès!</b>\n\nCompte #${accountIndex} actif.`,
              { parse_mode: 'HTML', reply_markup: getMainMenuKeyboard(telegramId) }
            );
          },
          onDisconnected: async (reason) => {
            if (reason === 'pairing_failed') {
              await bot.sendMessage(chatId, '❌ Échec de la connexion. Réessayez via le menu.');
            }
          },
        }).catch((err) => {
          logger.error({ err, telegramId }, 'connectSession error');
          bot.sendMessage(chatId, '❌ Erreur de connexion. Réessayez.');
        });

        try { await bot.deleteMessage(chatId, waitMsg.message_id); } catch {}

      // ── Awaiting AI prompt ────────────────────────────────────────────────
      } else if (state.step === 'await_prompt') {
        clearState(telegramId);
        const accountIndex = state.accountIndex || 1;
        waDB.setPrompt.run(text, telegramId, accountIndex);
        await bot.sendMessage(
          chatId,
          `✅ Prompt mis à jour!\n\n<i>${text.substring(0, 200)}</i>`,
          { parse_mode: 'HTML', reply_markup: getMainMenuKeyboard(telegramId) }
        );

      // ── Awaiting response delay ───────────────────────────────────────────
      } else if (state.step === 'await_delay') {
        clearState(telegramId);
        const delay = parseInt(text);
        if (isNaN(delay) || delay < 5 || delay > 120) {
          return bot.sendMessage(chatId, '❌ Valeur invalide (5-120 secondes).');
        }
        const accountIndex = state.accountIndex || 1;
        waDB.setDelay.run(delay, telegramId, accountIndex);
        await bot.sendMessage(chatId, `✅ Délai de réponse: ${delay}s`, {
          reply_markup: getMainMenuKeyboard(telegramId),
        });

      // ── Awaiting products JSON ────────────────────────────────────────────
      } else if (state.step === 'await_products') {
        clearState(telegramId);
        const accountIndex = state.accountIndex || 1;
        const processingMsg = await bot.sendMessage(chatId, '⏳ Traitement des produits avec l\'IA...');

        try {
          const formatted = await formatProductsWithAI(text);
          const jsonString = JSON.stringify(formatted, null, 2);
          waDB.setProducts.run(jsonString, telegramId, accountIndex);

          await bot.deleteMessage(chatId, processingMsg.message_id).catch(() => {});
          await bot.sendMessage(
            chatId,
            `✅ <b>${formatted.length} produit(s) enregistrés</b>\n\n<pre>${jsonString.substring(0, 400)}</pre>`,
            { parse_mode: 'HTML', reply_markup: getMainMenuKeyboard(telegramId) }
          );
        } catch (err) {
          await bot.deleteMessage(chatId, processingMsg.message_id).catch(() => {});
          await bot.sendMessage(chatId, '❌ Erreur lors du traitement. Vérifiez votre contenu.');
        }
      }
    } catch (err) {
      logger.error({ err, telegramId, step: state?.step }, 'State handler error');
      clearState(telegramId);
    }
  });

  // ── Callback Queries ──────────────────────────────────────────────────────
  bot.on('callback_query', async (query) => {
    const { from, message, data } = query;
    const telegramId = from.id;
    const chatId = message.chat.id;
    const msgId = message.message_id;

    ensureUser(from);

    const user = userDB.get.get(telegramId);
    if (user.is_blocked) {
      return bot.answerCallbackQuery(query.id, { text: '🚫 Compte suspendu' });
    }

    // Skip admin callbacks
    if (data.startsWith('admin_')) return;

    const answer = (text) => bot.answerCallbackQuery(query.id, { text }).catch(() => {});
    const edit = (text, keyboard) =>
      bot.editMessageText(text, {
        chat_id: chatId,
        message_id: msgId,
        parse_mode: 'HTML',
        reply_markup: keyboard || getMainMenuKeyboard(telegramId),
      }).catch(() => {});

    try {
      // ── user_menu ─────────────────────────────────────────────────────────
      if (data === 'user_menu') {
        const sub = subDB.get.get(telegramId);
        await edit(buildWelcome(from, sub), getMainMenuKeyboard(telegramId));

      // ── user_connect_wa ───────────────────────────────────────────────────
      } else if (data === 'user_connect_wa') {
        const { text, keyboard } = buildSessionsList(telegramId);
        await edit(text, keyboard);

      // ── user_wa_add ───────────────────────────────────────────────────────
      } else if (data === 'user_wa_add') {
        const sub = subDB.get.get(telegramId);
        const plan = sub?.plan || 'free';
        const sessions = waDB.getAll.all(telegramId);
        const maxAccounts = PLANS[plan].max_accounts;

        if (sessions.length >= maxAccounts) {
          await answer(`❌ Limite atteinte (${maxAccounts} comptes pour plan ${plan})`);
          return;
        }

        const nextIndex = sessions.length + 1;
        setState(telegramId, { step: 'await_phone', accountIndex: nextIndex });
        await bot.sendMessage(
          chatId,
          `📱 <b>Ajouter un compte WhatsApp</b>\n\nEnvoyez votre numéro avec indicatif pays:\n<code>+33612345678</code>`,
          { parse_mode: 'HTML', reply_markup: { inline_keyboard: [[{ text: '❌ Annuler', callback_data: 'user_menu' }]] } }
        );

      // ── user_wa_detail_N ──────────────────────────────────────────────────
      } else if (data.startsWith('user_wa_detail_')) {
        const accountIndex = parseInt(data.split('_')[3]);
        const session = waDB.get.get(telegramId, accountIndex);
        if (!session) return answer('❌ Session introuvable');

        const statusEmoji = session.status === 'connected' ? '✅' : '❌';
        const agentState = session.agent_paused
          ? '⏸️ Pausé'
          : session.agent_enabled
          ? '▶️ Actif'
          : '🔴 Désactivé';

        const text =
          `📱 <b>Compte WhatsApp #${accountIndex}</b>\n\n` +
          `📞 Numéro: <code>${session.phone_number || 'N/A'}</code>\n` +
          `🔗 Statut: ${statusEmoji} ${session.status}\n` +
          `🤖 Agent: ${agentState}\n` +
          `⏱️ Délai: ${session.response_delay}s\n` +
          `📦 Produits: ${JSON.parse(session.products_json || '[]').length} enregistrés`;

        await edit(text, {
          inline_keyboard: [
            [
              { text: '🧠 Modifier prompt', callback_data: `user_ai_prompt_${accountIndex}` },
              { text: '⏱️ Délai', callback_data: `user_ai_delay_${accountIndex}` },
            ],
            [
              { text: '⏸️ Pause', callback_data: `user_pause_${accountIndex}` },
              { text: '▶️ Reprendre', callback_data: `user_resume_${accountIndex}` },
            ],
            [
              { text: '🔌 Déconnecter', callback_data: `user_wa_disconnect_${accountIndex}` },
            ],
            [{ text: '🔙 Mes comptes', callback_data: 'user_connect_wa' }],
          ],
        });

      // ── user_wa_disconnect_N ──────────────────────────────────────────────
      } else if (data.startsWith('user_wa_disconnect_')) {
        const accountIndex = parseInt(data.split('_')[3]);
        await edit('⏳ Déconnexion en cours...');
        await disconnectSession(telegramId, accountIndex);
        await answer('✅ Déconnecté');
        const { text, keyboard } = buildSessionsList(telegramId);
        await edit(text, keyboard);

      // ── user_config_ai ────────────────────────────────────────────────────
      } else if (data === 'user_config_ai') {
        const sessions = waDB.getAll.all(telegramId);
        if (sessions.length === 0) {
          return edit('❌ Connectez d\'abord un compte WhatsApp.', {
            inline_keyboard: [[{ text: '🔙 Menu', callback_data: 'user_menu' }]],
          });
        }

        const buttons = sessions.map((s) => [
          { text: `⚙️ Compte #${s.account_index} — ${s.phone_number || 'N/A'}`, callback_data: `user_ai_config_${s.account_index}` },
        ]);
        buttons.push([{ text: '🔙 Menu', callback_data: 'user_menu' }]);
        await edit('🧠 <b>Configurer l\'IA</b>\n\nChoisissez un compte:', { inline_keyboard: buttons });

      // ── user_ai_config_N ──────────────────────────────────────────────────
      } else if (data.startsWith('user_ai_config_')) {
        const accountIndex = parseInt(data.split('_')[3]);
        const session = waDB.get.get(telegramId, accountIndex);
        const promptPreview = session?.custom_prompt
          ? session.custom_prompt.substring(0, 80) + '...'
          : 'Aucun (prompt par défaut)';

        await edit(
          `🧠 <b>Config IA — Compte #${accountIndex}</b>\n\n📝 Prompt: <i>${promptPreview}</i>`,
          {
            inline_keyboard: [
              [{ text: '✏️ Modifier le prompt', callback_data: `user_ai_prompt_${accountIndex}` }],
              [{ text: '⏱️ Modifier le délai', callback_data: `user_ai_delay_${accountIndex}` }],
              [{ text: '🔙 Config IA', callback_data: 'user_config_ai' }],
            ],
          }
        );

      // ── user_ai_prompt_N ──────────────────────────────────────────────────
      } else if (data.startsWith('user_ai_prompt_')) {
        const accountIndex = parseInt(data.split('_')[3]);
        setState(telegramId, { step: 'await_prompt', accountIndex });
        await bot.sendMessage(chatId, '✏️ Envoyez votre nouveau prompt système:', {
          reply_markup: { inline_keyboard: [[{ text: '❌ Annuler', callback_data: 'user_menu' }]] },
        });

      // ── user_ai_delay_N ───────────────────────────────────────────────────
      } else if (data.startsWith('user_ai_delay_')) {
        const accountIndex = parseInt(data.split('_')[3]);
        setState(telegramId, { step: 'await_delay', accountIndex });
        await bot.sendMessage(chatId, '⏱️ Envoyez le délai de réponse (5-120 secondes):', {
          reply_markup: { inline_keyboard: [[{ text: '❌ Annuler', callback_data: 'user_menu' }]] },
        });

      // ── user_products ─────────────────────────────────────────────────────
      } else if (data === 'user_products') {
        const sessions = waDB.getAll.all(telegramId);
        if (sessions.length === 0) {
          return edit('❌ Connectez d\'abord un compte WhatsApp.', {
            inline_keyboard: [[{ text: '🔙 Menu', callback_data: 'user_menu' }]],
          });
        }

        const accountIndex = sessions[0].account_index;
        setState(telegramId, { step: 'await_products', accountIndex });

        await bot.sendMessage(
          chatId,
          '📦 <b>Produits JSON</b>\n\nEnvoyez votre catalogue produits dans n\'importe quel format.\nL\'IA va le structurer automatiquement:\n\n' +
          '<i>Exemple: "Produit A - 25€, description courte\nProduit B - 50€, description"</i>',
          {
            parse_mode: 'HTML',
            reply_markup: { inline_keyboard: [[{ text: '❌ Annuler', callback_data: 'user_menu' }]] },
          }
        );

      // ── user_api ──────────────────────────────────────────────────────────
      } else if (data === 'user_api') {
        await sendApiPanel(bot, chatId, telegramId);

      // ── user_api_regen ────────────────────────────────────────────────────
      } else if (data === 'user_api_regen') {
        const newKey = generateApiKey();
        apiDB.upsert.run({ telegram_id: telegramId, api_key: newKey });
        await answer('✅ Nouvelle clé générée');
        await sendApiPanel(bot, chatId, telegramId);

      // ── user_subscription ─────────────────────────────────────────────────
      } else if (data === 'user_subscription') {
        await edit(buildSubscriptionPanel(telegramId), {
          inline_keyboard: [[{ text: '🔙 Menu', callback_data: 'user_menu' }]],
        });

      // ── user_settings ─────────────────────────────────────────────────────
      } else if (data === 'user_settings') {
        const sessions = waDB.getAll.all(telegramId);
        const sub = subDB.get.get(telegramId);

        const text =
          `⚙️ <b>Paramètres</b>\n\n` +
          `👤 ID: <code>${telegramId}</code>\n` +
          `💳 Plan: ${PLANS[sub?.plan || 'free'].label}\n` +
          `📱 Comptes WA: ${sessions.length}\n\n` +
          `Contactez @admin pour modifier votre plan.`;

        await edit(text, { inline_keyboard: [[{ text: '🔙 Menu', callback_data: 'user_menu' }]] });

      // ── user_pause / user_pause_N ─────────────────────────────────────────
      } else if (data === 'user_pause' || data.startsWith('user_pause_')) {
        const accountIndex = data === 'user_pause' ? null : parseInt(data.split('_')[2]);
        const sessions = accountIndex
          ? [waDB.get.get(telegramId, accountIndex)].filter(Boolean)
          : waDB.getAll.all(telegramId);

        for (const s of sessions) {
          waDB.setAgentPaused.run(1, telegramId, s.account_index);
        }
        await answer('⏸️ Bot mis en pause');
        const sub = subDB.get.get(telegramId);
        await edit(buildWelcome(from, sub), getMainMenuKeyboard(telegramId));

      // ── user_resume / user_resume_N ───────────────────────────────────────
      } else if (data === 'user_resume' || data.startsWith('user_resume_')) {
        const accountIndex = data === 'user_resume' ? null : parseInt(data.split('_')[2]);
        const sessions = accountIndex
          ? [waDB.get.get(telegramId, accountIndex)].filter(Boolean)
          : waDB.getAll.all(telegramId);

        for (const s of sessions) {
          waDB.setAgentPaused.run(0, telegramId, s.account_index);
          waDB.setAgentEnabled.run(1, telegramId, s.account_index);
        }
        await answer('▶️ Bot activé');
        const sub = subDB.get.get(telegramId);
        await edit(buildWelcome(from, sub), getMainMenuKeyboard(telegramId));
      }

    } catch (err) {
      logger.error({ err, data, telegramId }, 'User callback error');
      bot.answerCallbackQuery(query.id, { text: '❌ Erreur' }).catch(() => {});
    }
  });
}
