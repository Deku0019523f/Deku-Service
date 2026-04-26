// src/whatsapp/manager.js
import makeWASocket, {
  useMultiFileAuthState,
  DisconnectReason,
  fetchLatestBaileysVersion,
  makeCacheableSignalKeyStore,
} from '@whiskeysockets/baileys';
import { Boom } from '@hapi/boom';
import fs from 'fs';
import NodeCache from 'node-cache';
import pino from 'pino';
import { waDB } from '../database/db.js';
import { getSessionPath, sleep, NETWORK_DELAYS, ERROR_DELAYS } from '../utils/helpers.js';
import logger from '../utils/logger.js';
import { handleWhatsAppMessage } from './handler.js';

// Silence Baileys internal logs
const baileysLogger = pino({ level: 'silent' });

// ── Session Store (in-memory) ─────────────────────────────────────────────────
// Key: `${telegramId}_${accountIndex}` → socket instance
const activeSessions = new Map();

// Cache for message store (to avoid duplicate processing)
const msgRetryCache = new NodeCache();

// ── Reconnection trackers ─────────────────────────────────────────────────────
const reconnectAttempts = new Map(); // key → attempt count

// ── Telegram bot reference (set after init) ───────────────────────────────────
let _bot = null;
export function setBot(bot) {
  _bot = bot;
}

function sendTelegramNotif(telegramId, text) {
  if (_bot) {
    _bot.sendMessage(telegramId, text, { parse_mode: 'HTML' }).catch(() => {});
  }
}

// ── Session Key ───────────────────────────────────────────────────────────────
function sessionKey(telegramId, accountIndex) {
  return `${telegramId}_${accountIndex}`;
}

// ── Create / Connect a WhatsApp Session ──────────────────────────────────────
/**
 * Connect a WhatsApp account using pairing code (no QR)
 * @param {Object} options
 * @param {number} options.telegramId
 * @param {number} options.accountIndex
 * @param {string} options.phoneNumber  - digits only
 * @param {Function} options.onPairingCode  - called with pairing code string
 * @param {Function} options.onConnected    - called when connected
 * @param {Function} options.onDisconnected - called when disconnected
 */
export async function connectSession({
  telegramId,
  accountIndex,
  phoneNumber,
  onPairingCode,
  onConnected,
  onDisconnected,
}) {
  const key = sessionKey(telegramId, accountIndex);
  const sessionPath = getSessionPath(telegramId, accountIndex);

  // Ensure directory exists
  fs.mkdirSync(sessionPath, { recursive: true });

  const { state, saveCreds } = await useMultiFileAuthState(sessionPath);
  const { version } = await fetchLatestBaileysVersion();

  const sock = makeWASocket({
    version,
    logger: baileysLogger,
    auth: {
      creds: state.creds,
      keys: makeCacheableSignalKeyStore(state.keys, baileysLogger),
    },
    msgRetryCounterCache: msgRetryCache,
    generateHighQualityLinkPreview: false,
    syncFullHistory: false,
    markOnlineOnConnect: false,
    connectTimeoutMs: 30_000,
    defaultQueryTimeoutMs: 20_000,
    browser: ['WhatsApp SaaS', 'Chrome', '120.0.0'],
    printQRInTerminal: false,
  });

  activeSessions.set(key, sock);

  // ── Request pairing code ──────────────────────────────────────────────────
  if (!state.creds.registered) {
    // Wait for WS to open before requesting pairing code
    await sleep(3000);
    try {
      const code = await sock.requestPairingCode(phoneNumber);
      onPairingCode?.(code);
    } catch (err) {
      logger.warn({ err }, 'Pairing code request failed, retrying...');
      await sleep(2000);
      try {
        const code = await sock.requestPairingCode(phoneNumber);
        onPairingCode?.(code);
      } catch (retryErr) {
        logger.error({ retryErr }, 'Pairing code retry failed');
        onDisconnected?.('pairing_failed');
        return null;
      }
    }
  }

  // ── Connection events ─────────────────────────────────────────────────────
  sock.ev.on('connection.update', async (update) => {
    const { connection, lastDisconnect, qr } = update;

    if (connection === 'open') {
      logger.info({ telegramId, accountIndex }, 'WhatsApp connected');
      reconnectAttempts.delete(key);

      waDB.setStatus.run('connected', telegramId, accountIndex);
      onConnected?.();
    }

    if (connection === 'close') {
      const statusCode = lastDisconnect?.error?.output?.statusCode;
      const reason = DisconnectReason[statusCode] || 'unknown';
      logger.warn({ telegramId, accountIndex, statusCode, reason }, 'WhatsApp disconnected');

      waDB.setStatus.run('disconnected', telegramId, accountIndex);
      activeSessions.delete(key);

      // Decide whether to reconnect
      if (statusCode === DisconnectReason.loggedOut) {
        // Logged out: delete session files
        logger.info({ telegramId }, 'Session logged out, clearing files');
        fs.rmSync(sessionPath, { recursive: true, force: true });
        waDB.delete.run(telegramId, accountIndex);
        sendTelegramNotif(telegramId, `⚠️ Compte WhatsApp #${accountIndex} déconnecté (session expirée). Reconnectez-vous.`);
        onDisconnected?.('logged_out');
        return;
      }

      if (statusCode === DisconnectReason.multideviceMismatch) {
        fs.rmSync(sessionPath, { recursive: true, force: true });
        waDB.delete.run(telegramId, accountIndex);
        sendTelegramNotif(telegramId, `⚠️ Erreur multi-device sur le compte #${accountIndex}. Reconnectez-vous.`);
        onDisconnected?.('multidevice_mismatch');
        return;
      }

      // Network / timeout errors → retry with backoff
      const isNetworkError = [408, 503, 502, 500, undefined].includes(statusCode);
      const delays = isNetworkError ? NETWORK_DELAYS : ERROR_DELAYS;
      const attempt = reconnectAttempts.get(key) || 0;

      if (attempt < 5) {
        const delay = delays[attempt] || delays[delays.length - 1];
        reconnectAttempts.set(key, attempt + 1);

        logger.info({ telegramId, accountIndex, attempt, delay }, 'Scheduling reconnect');
        sendTelegramNotif(
          telegramId,
          `🔄 Reconnexion compte #${accountIndex} dans ${delay / 1000}s... (tentative ${attempt + 1}/5)`
        );

        setTimeout(() => {
          connectSession({ telegramId, accountIndex, phoneNumber, onPairingCode, onConnected, onDisconnected });
        }, delay);
      } else {
        reconnectAttempts.delete(key);
        sendTelegramNotif(
          telegramId,
          `❌ Impossible de reconnecter le compte WhatsApp #${accountIndex} après 5 tentatives.\nReconnectez-vous manuellement.`
        );
        onDisconnected?.('max_retries');
      }
    }
  });

  // ── Save credentials on update ────────────────────────────────────────────
  sock.ev.on('creds.update', saveCreds);

  // ── Incoming messages ─────────────────────────────────────────────────────
  sock.ev.on('messages.upsert', async ({ messages, type }) => {
    if (type !== 'notify') return;

    for (const msg of messages) {
      try {
        await handleWhatsAppMessage({ sock, msg, telegramId, accountIndex });
      } catch (err) {
        logger.error({ err, telegramId }, 'Error handling WhatsApp message');
      }
    }
  });

  return sock;
}

// ── Get Active Socket ─────────────────────────────────────────────────────────
export function getSocket(telegramId, accountIndex) {
  return activeSessions.get(sessionKey(telegramId, accountIndex)) || null;
}

// ── Disconnect a Session ──────────────────────────────────────────────────────
export async function disconnectSession(telegramId, accountIndex) {
  const key = sessionKey(telegramId, accountIndex);
  const sock = activeSessions.get(key);

  if (sock) {
    try {
      await sock.logout();
    } catch {}
    activeSessions.delete(key);
  }

  const sessionPath = getSessionPath(telegramId, accountIndex);
  fs.rmSync(sessionPath, { recursive: true, force: true });
  waDB.setStatus.run('disconnected', telegramId, accountIndex);
  waDB.delete.run(telegramId, accountIndex);
}

// ── Restore Sessions on Startup ───────────────────────────────────────────────
export async function restoreAllSessions() {
  const { userDB } = await import('../database/db.js');
  const allUsers = userDB.getAll.all(1000, 0);

  for (const user of allUsers) {
    const sessions = waDB.getAll.all(user.telegram_id);

    for (const session of sessions) {
      const sessionPath = getSessionPath(user.telegram_id, session.account_index);

      // Only restore if auth files exist
      if (!fs.existsSync(sessionPath)) continue;
      const credsFile = `${sessionPath}/creds.json`;
      if (!fs.existsSync(credsFile)) continue;

      logger.info(
        { telegramId: user.telegram_id, accountIndex: session.account_index },
        'Restoring session'
      );

      connectSession({
        telegramId: user.telegram_id,
        accountIndex: session.account_index,
        phoneNumber: session.phone_number,
        onConnected: () => {
          sendTelegramNotif(
            user.telegram_id,
            `✅ Compte WhatsApp #${session.account_index} reconnecté automatiquement.`
          );
        },
        onDisconnected: (reason) => {
          logger.warn({ telegramId: user.telegram_id, reason }, 'Session restore failed');
        },
      }).catch((err) => logger.error({ err }, 'Session restore error'));
    }
  }
}

// ── Check if session already registered ──────────────────────────────────────
export function isSessionRegistered(telegramId, accountIndex) {
  const sessionPath = getSessionPath(telegramId, accountIndex);
  const credsFile = `${sessionPath}/creds.json`;
  if (!fs.existsSync(credsFile)) return false;

  try {
    const creds = JSON.parse(fs.readFileSync(credsFile, 'utf8'));
    return creds.registered === true;
  } catch {
    return false;
  }
}

export { activeSessions };
