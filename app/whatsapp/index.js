// ─────────────────────────────────────────────────────────────────────────────
//  app/whatsapp/index.js  —  Connexion & handler de messages
//
//  Commandes reconnues (envoyées sur ton propre numéro) :
//    .agent on/off        → activer/désactiver l'agent IA
//    .prompt <texte>      → définir le prompt système
//    .temps <Ns>          → délai avant réponse (ex: .temps 20s)
//    .statut              → état du serveur avec logo
// ─────────────────────────────────────────────────────────────────────────────

import {
  default as makeWASocket,
  DisconnectReason,
  useMultiFileAuthState,
  fetchLatestBaileysVersion,
  makeCacheableSignalKeyStore,
  downloadMediaMessage,
} from '@whiskeysockets/baileys';
import pino from 'pino';
import path from 'path';
import fs   from 'fs';
import { log } from '../cli/index.js';
import {
  isAgentEnabled,
  setAgentEnabled,
  setAgentPrompt,
  setAgentDelay,
  getAgentState,
  generateReply,
  transcribeAudio,
} from '../agent/index.js';
import { getPingStats } from '../ping/index.js';

const SESSIONS_DIR = './sessions';
const LOGO_PATH    = './assets/logo.png';

const activeSockets     = new Map();
const reconnectAttempts = new Map();
const MAX_RECONNECT     = 5;

// ── Numéro propriétaire ───────────────────────────────────────────────────────
let ownerNumber = null;
export function setOwnerNumber(n) { ownerNumber = String(n).replace(/\D/g, ''); }

// ── Nettoyage session ─────────────────────────────────────────────────────────
export function clearSession(phoneNumber) {
  const dir = path.join(SESSIONS_DIR, phoneNumber);
  if (fs.existsSync(dir)) {
    fs.rmSync(dir, { recursive: true, force: true });
    log('info', 'Session précédente supprimée.');
  }
}

// ── Création socket ───────────────────────────────────────────────────────────
async function createSocket(phoneNumber) {
  const sessionDir = path.join(SESSIONS_DIR, phoneNumber);
  fs.mkdirSync(sessionDir, { recursive: true });

  const { state, saveCreds } = await useMultiFileAuthState(sessionDir);
  const { version }          = await fetchLatestBaileysVersion();
  const baileysLogger        = pino({ level: 'silent' });

  const sock = makeWASocket({
    version,
    auth: {
      creds: state.creds,
      keys:  makeCacheableSignalKeyStore(state.keys, baileysLogger),
    },
    logger:                baileysLogger,
    printQRInTerminal:     false,
    browser:               ['Ubuntu', 'Chrome', '22.04.4'],
    syncFullHistory:       false,
    markOnlineOnConnect:   false,
    connectTimeoutMs:      60_000,
    defaultQueryTimeoutMs: 20_000,
  });

  sock.ev.on('creds.update', saveCreds);
  return sock;
}

// ── Handler messages entrants ─────────────────────────────────────────────────
async function handleIncomingMessages(sock, { messages }) {
  for (const msg of messages) {
    if (!msg.message || msg.key.fromMe) continue;

    const jid     = msg.key.remoteJid;
    const sender  = jid?.replace(/@.*$/, '');
    const isOwner = ownerNumber && sender === ownerNumber;

    const textContent =
      msg.message?.conversation ||
      msg.message?.extendedTextMessage?.text || '';

    const isVoice = !!msg.message?.audioMessage;
    const trimmed = textContent.trim();

    // ── Commandes propriétaire ────────────────────────────────────────────────
    if (isOwner && trimmed.startsWith('.')) {
      await handleCommand(sock, jid, trimmed);
      continue;
    }

    // ── Agent IA ──────────────────────────────────────────────────────────────
    if (!isAgentEnabled()) continue;

    if (isVoice) {
      try {
        await sock.sendMessage(jid, { text: '🎙️ _Transcription en cours…_' }, { quoted: msg });
        const buffer   = await downloadMediaMessage(msg, 'buffer', {});
        const mimeType = msg.message.audioMessage?.mimetype || 'audio/ogg';
        const text     = await transcribeAudio(buffer, mimeType);

        if (!text) {
          await sock.sendMessage(jid, { text: '❌ Impossible de transcrire ce message vocal.' });
          continue;
        }

        log('info', `[Whisper] "${text}"`);
        const { reply, model } = await generateReply(text, jid);
        await sock.sendMessage(jid, { text: `📝 _"${text}"_\n\n${reply}` }, { quoted: msg });
        log('success', `[Agent/Vocal] Réponse envoyée (${model})`);
      } catch (err) {
        log('error', `[Agent/Vocal] ${err.message}`);
        await sock.sendMessage(jid, { text: `❌ Erreur : ${err.message}` });
      }
      continue;
    }

    if (trimmed) {
      try {
        const { reply, model } = await generateReply(trimmed, jid);
        await sock.sendMessage(jid, { text: reply }, { quoted: msg });
        log('success', `[Agent/Texte] Réponse envoyée (${model})`);
      } catch (err) {
        log('error', `[Agent/Texte] ${err.message}`);
        await sock.sendMessage(jid, { text: `❌ Erreur agent : ${err.message}` });
      }
    }
  }
}

// ── Traitement des commandes ──────────────────────────────────────────────────
async function handleCommand(sock, jid, text) {
  const lower = text.toLowerCase().trim();

  // .agent on
  if (lower === '.agent on') {
    setAgentEnabled(true);
    await sock.sendMessage(jid, {
      text: '🤖 *Agent IA activé* ✅\nJe réponds maintenant à tous les messages automatiquement.',
    });
    return;
  }

  // .agent off
  if (lower === '.agent off') {
    setAgentEnabled(false);
    await sock.sendMessage(jid, {
      text: '⏸️ *Agent IA désactivé*\nLes réponses automatiques sont suspendues.',
    });
    return;
  }

  // .prompt <texte>
  if (lower.startsWith('.prompt ')) {
    const newPrompt = text.slice(8).trim();
    if (!newPrompt) {
      await sock.sendMessage(jid, { text: '⚠️ Usage : `.prompt <ton prompt système>`' });
      return;
    }
    setAgentPrompt(newPrompt);
    await sock.sendMessage(jid, {
      text: `✅ *Prompt système mis à jour :*\n\n_${newPrompt}_`,
    });
    return;
  }

  // .temps <Ns>
  if (lower.startsWith('.temps ')) {
    const arg = text.slice(7).trim();
    const ms  = setAgentDelay(arg);
    if (ms === -1) {
      await sock.sendMessage(jid, {
        text: '⚠️ Usage : `.temps 20s` (en secondes)\nExemples : `.temps 0s`, `.temps 5s`, `.temps 30s`',
      });
      return;
    }
    const sec = ms / 1000;
    await sock.sendMessage(jid, {
      text: sec === 0
        ? '⚡ *Délai de réponse :* immédiat (0s)'
        : `⏱️ *Délai de réponse :* ${sec}s\nL'agent attendra ${sec} seconde${sec > 1 ? 's' : ''} avant de répondre.`,
    });
    return;
  }

  // .statut
  if (lower === '.statut') {
    await sendStatut(sock, jid);
    return;
  }

  // Commande inconnue
  await sock.sendMessage(jid, {
    text:
      '❓ *Commandes disponibles :*\n\n' +
      '• `.agent on` — Activer l\'agent IA 🟢\n' +
      '• `.agent off` — Désactiver l\'agent IA 🔴\n' +
      '• `.prompt <texte>` — Définir le prompt système\n' +
      '• `.temps <Ns>` — Délai de réponse (ex: `.temps 10s`)\n' +
      '• `.statut` — État du serveur',
  });
}

// ── Commande .statut ──────────────────────────────────────────────────────────
async function sendStatut(sock, jid) {
  const state = getAgentState();
  const ping  = getPingStats();
  const now   = new Date().toLocaleString('fr-FR', { timeZone: 'Africa/Abidjan' });

  const TEXT_MODELS = [
    'meta-llama/llama-4-scout-17b-16e-instruct',
    'llama-3.1-8b-instant',
    'llama-3.3-70b-versatile',
  ];
  const currentModel = TEXT_MODELS[state.modelIndex % TEXT_MODELS.length];
  const delayText    = state.replyDelayMs > 0 ? `${state.replyDelayMs / 1000}s` : 'Immédiat ⚡';

  const statusText =
    `━━━━━━━━━━━━━━━━━━━━━\n` +
    `🤖 *DEKU-SERVICE STATUS*\n` +
    `━━━━━━━━━━━━━━━━━━━━━\n\n` +
    `📡 *Serveur :* 🟢 En ligne\n` +
    `🕐 *Heure CI :* ${now}\n` +
    `⏱️ *Uptime :* ${ping.uptime}\n\n` +
    `🤖 *Agent IA :* ${state.enabled ? '🟢 Activé' : '🔴 Désactivé'}\n` +
    `🧠 *Modèle actuel :* \`${currentModel}\`\n` +
    `⏱️ *Délai réponse :* ${delayText}\n` +
    `🎙️ *Vocal :* whisper-large-v3\n\n` +
    `💬 *Prompt :*\n_${state.systemPrompt.slice(0, 150)}${state.systemPrompt.length > 150 ? '…' : ''}_\n\n` +
    `📬 *Ping horaire :* ${ping.active ? '🟢 Actif' : '🔴 Inactif'} (${ping.count} envoyés)\n\n` +
    `━━━━━━━━━━━━━━━━━━━━━`;

  try {
    if (fs.existsSync(LOGO_PATH)) {
      await sock.sendMessage(jid, { image: fs.readFileSync(LOGO_PATH), caption: statusText });
    } else {
      await sock.sendMessage(jid, { text: statusText });
    }
  } catch (err) {
    log('error', `[.statut] ${err.message}`);
    await sock.sendMessage(jid, { text: statusText });
  }
}

// ── Handlers socket ───────────────────────────────────────────────────────────
function attachHandlers(phoneNumber, sock, resolve, reject, onConnected) {
  sock.ev.on('connection.update', async (update) => {
    const { connection, lastDisconnect } = update;
    if (connection) log('info', `État connexion : ${connection}`);

    if (connection === 'open') {
      log('success', 'Connexion WhatsApp établie !');
      reconnectAttempts.delete(phoneNumber);
      const jid = sock.user?.id ?? `${phoneNumber}@s.whatsapp.net`;
      if (resolve)     resolve({ socket: sock, jid });
      if (onConnected) onConnected({ socket: sock, jid });
    }

    if (connection === 'close') {
      const code = lastDisconnect?.error?.output?.statusCode;
      log('warn', `Connexion fermée (code ${code})`);

      if (code === DisconnectReason.loggedOut) {
        activeSockets.delete(phoneNumber);
        clearSession(phoneNumber);
        if (reject) reject(new Error('SESSION_REVOKED'));
        return;
      }

      const attempts = (reconnectAttempts.get(phoneNumber) || 0) + 1;
      reconnectAttempts.set(phoneNumber, attempts);

      if (attempts >= MAX_RECONNECT) {
        reconnectAttempts.delete(phoneNumber);
        activeSockets.delete(phoneNumber);
        log('error', 'Max tentatives de reconnexion atteint.');
        if (reject) reject(new Error('MAX_RECONNECT_REACHED'));
        return;
      }

      const wait = Math.min(5000 * attempts, 30000);
      log('info', `Reconnexion dans ${wait / 1000}s (tentative ${attempts}/${MAX_RECONNECT})…`);
      setTimeout(() => reconnectAccount(phoneNumber, resolve, reject, onConnected), wait);
    }
  });

  sock.ev.on('messages.upsert', (upsert) => {
    if (upsert.type === 'notify') {
      handleIncomingMessages(sock, upsert).catch(err =>
        log('error', `[messages.upsert] ${err.message}`)
      );
    }
  });
}

// ── Reconnexion ───────────────────────────────────────────────────────────────
async function reconnectAccount(phoneNumber, resolve, reject, onConnected) {
  if (activeSockets.has(phoneNumber)) {
    try { activeSockets.get(phoneNumber).end(); } catch {}
    activeSockets.delete(phoneNumber);
    await new Promise(r => setTimeout(r, 500));
  }
  try {
    const sock = await createSocket(phoneNumber);
    activeSockets.set(phoneNumber, sock);
    attachHandlers(phoneNumber, sock, resolve, reject, onConnected);
    log('info', 'Socket recréé pour reconnexion.');
  } catch (err) {
    log('error', `Échec reconnexion : ${err.message}`);
    if (reject) reject(new Error(`RECONNECT_FAILED: ${err.message}`));
  }
}

// ── Exports publics ───────────────────────────────────────────────────────────
export function connectWithPairingCode(phoneNumber, onPairingCode, onConnected) {
  return new Promise(async (resolve, reject) => {
    clearSession(phoneNumber);
    let sock;
    try { sock = await createSocket(phoneNumber); }
    catch (err) { return reject(err); }

    activeSockets.set(phoneNumber, sock);
    attachHandlers(phoneNumber, sock, resolve, reject, onConnected);
    await new Promise(r => setTimeout(r, 3000));

    if (sock.authState?.creds?.registered) {
      log('info', 'Session déjà enregistrée.');
      return;
    }

    let pairingCode;
    try {
      pairingCode = await sock.requestPairingCode(phoneNumber);
    } catch (err) {
      log('warn', `Retry pairing code : ${err.message}`);
      await new Promise(r => setTimeout(r, 2000));
      try { pairingCode = await sock.requestPairingCode(phoneNumber); }
      catch (err2) {
        activeSockets.delete(phoneNumber);
        return reject(new Error(`Pairing impossible : ${err2.message}`));
      }
    }

    if (!pairingCode) {
      activeSockets.delete(phoneNumber);
      return reject(new Error('Pairing code vide reçu'));
    }

    onPairingCode(pairingCode.match(/.{1,4}/g)?.join('-') ?? pairingCode);
  });
}

export function reconnectExistingSession(phoneNumber) {
  return new Promise(async (resolve, reject) => {
    try {
      const sock = await createSocket(phoneNumber);
      activeSockets.set(phoneNumber, sock);
      attachHandlers(phoneNumber, sock, resolve, reject, null);
    } catch (err) { reject(err); }
  });
}

export function getSocket(phoneNumber) {
  return activeSockets.get(phoneNumber) ?? null;
}

export async function sendImage(socket, to, imagePath, caption) {
  await socket.sendMessage(normalizeJid(to), { image: fs.readFileSync(imagePath), caption });
  log('success', `Image envoyée à ${to}`);
}

export async function sendDocument(socket, to, docPath, filename, caption = '') {
  await socket.sendMessage(normalizeJid(to), {
    document: fs.readFileSync(docPath), fileName: filename,
    mimetype: 'application/pdf', caption,
  });
  log('success', `Document "${filename}" envoyé à ${to}`);
}

export async function sendTextMessage(socket, to, text) {
  await socket.sendMessage(normalizeJid(to), { text });
  log('success', `Message envoyé à ${to}`);
}

function normalizeJid(number) {
  return `${String(number).replace(/@.*$/, '').replace(/\D/g, '')}@s.whatsapp.net`;
}
