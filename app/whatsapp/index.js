import {
  default as makeWASocket,
  DisconnectReason,
  useMultiFileAuthState,
  fetchLatestBaileysVersion,
  makeCacheableSignalKeyStore,
} from '@whiskeysockets/baileys';
import pino from 'pino';
import path from 'path';
import fs from 'fs';


const SESSIONS_DIR = './sessions';

// Map globale — le socket référencé ici ne sera jamais GC
const activeSockets     = new Map();
const reconnectAttempts = new Map();
const MAX_RECONNECT     = 5;

export function clearSession(phoneNumber) {
  const dir = path.join(SESSIONS_DIR, phoneNumber);
  if (fs.existsSync(dir)) {
    fs.rmSync(dir, { recursive: true, force: true });
    console.log('[WA]', 'Session précédente supprimée.');
  }
}

// ── Création socket — copie exacte du pattern client.js ────────────────────
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
    logger:               baileysLogger,
    printQRInTerminal:    false,
    browser:              ['Ubuntu', 'Chrome', '22.04.4'],
    syncFullHistory:      false,
    markOnlineOnConnect:  false,
    connectTimeoutMs:     60_000,
    defaultQueryTimeoutMs: 20_000,
  });

  sock.ev.on('creds.update', saveCreds);
  return sock;
}

// ── Connexion via pairing code — même séquence que client.js ───────────────
//
//  1. createSocket()
//  2. activeSockets.set()         ← avant tout
//  3. attachHandlers()            ← avant tout
//  4. await setTimeout(3000)      ← laisser le WS s'établir
//  5. requestPairingCode()        ← appel direct, pas dans un listener
//
export function connectWithPairingCode(phoneNumber, onPairingCode, onConnected) {
  return new Promise(async (resolve, reject) => {

    clearSession(phoneNumber);

    let sock;
    try {
      sock = await createSocket(phoneNumber);
    } catch (err) {
      return reject(err);
    }

    // ÉTAPE 2 : stocker dans la Map IMMÉDIATEMENT
    activeSockets.set(phoneNumber, sock);

    // ÉTAPE 3 : attacher tous les handlers AVANT d'attendre ou demander le code
    attachHandlers(phoneNumber, sock, resolve, reject, onConnected);

    // ÉTAPE 4 : attendre 3 s (WS établi)
    await new Promise(r => setTimeout(r, 3000));

    // Déjà enregistré ? (session reconnectée)
    if (sock.authState?.creds?.registered) {
      console.log('[WA]', 'Session déjà enregistrée, pas de pairing code nécessaire.');
      return;
    }

    // ÉTAPE 5 : demander le code — appel direct comme dans client.js
    let pairingCode;
    try {
      pairingCode = await sock.requestPairingCode(phoneNumber);
    } catch (err) {
      console.warn('[WA ⚠]', `Retry pairing code : ${err.message}`);
      await new Promise(r => setTimeout(r, 2000));
      try {
        pairingCode = await sock.requestPairingCode(phoneNumber);
      } catch (err2) {
        activeSockets.delete(phoneNumber);
        return reject(new Error(`Pairing impossible : ${err2.message}`));
      }
    }

    if (!pairingCode) {
      activeSockets.delete(phoneNumber);
      return reject(new Error('Pairing code vide reçu'));
    }

    const formatted = pairingCode.match(/.{1,4}/g)?.join('-') ?? pairingCode;
    onPairingCode(formatted);
    // La promesse se résout dans attachHandlers sur connection='open'
  });
}

// ── Handlers — copie de attachSocketHandlers dans client.js ────────────────
function attachHandlers(phoneNumber, sock, resolve, reject, onConnected) {

  sock.ev.on('connection.update', async (update) => {
    const { connection, lastDisconnect } = update;
    if (connection) console.log('[WA]', `État connexion : ${connection}`);

    if (connection === 'open') {
      console.log('[WA ✅]', 'Connexion WhatsApp établie !');
      reconnectAttempts.delete(phoneNumber);
      const jid = sock.user?.id ?? `${phoneNumber}@s.whatsapp.net`;
      if (resolve) resolve({ socket: sock, jid });
      if (onConnected) onConnected({ socket: sock, jid });
    }

    if (connection === 'close') {
      const code = lastDisconnect?.error?.output?.statusCode;
      console.warn('[WA ⚠]', `Connexion fermée (code ${code})`);

      if (code === DisconnectReason.loggedOut) {
        activeSockets.delete(phoneNumber);
        clearSession(phoneNumber);
        if (reject) reject(new Error('SESSION_REVOKED'));
        return;
      }

      // Reconnexion automatique avec backoff — identique à client.js
      const attempts = (reconnectAttempts.get(phoneNumber) || 0) + 1;
      reconnectAttempts.set(phoneNumber, attempts);

      if (attempts >= MAX_RECONNECT) {
        reconnectAttempts.delete(phoneNumber);
        activeSockets.delete(phoneNumber);
        console.error('[WA ❌]', `Max tentatives de reconnexion atteint.`);
        if (reject) reject(new Error(`MAX_RECONNECT_REACHED`));
        return;
      }

      const wait = Math.min(5000 * attempts, 30000);
      console.log('[WA]', `Reconnexion dans ${wait / 1000} s (tentative ${attempts}/${MAX_RECONNECT})…`);
      setTimeout(() => reconnectAccount(phoneNumber, resolve, reject, onConnected), wait);
    }
  });

  // Listener messages — maintient la boucle d'événements Node.js active
  sock.ev.on('messages.upsert', () => {});
}

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
    console.log('[WA]', 'Socket recréé pour reconnexion.');
  } catch (err) {
    console.error('[WA ❌]', `Échec reconnexion : ${err.message}`);
    if (reject) reject(new Error(`RECONNECT_FAILED: ${err.message}`));
  }
}

export function reconnectExistingSession(phoneNumber) {
  return new Promise(async (resolve, reject) => {
    try {
      const sock = await createSocket(phoneNumber);
      activeSockets.set(phoneNumber, sock);
      attachHandlers(phoneNumber, sock, resolve, reject, null);
    } catch (err) {
      reject(err);
    }
  });
}

export function getSocket(phoneNumber) {
  return activeSockets.get(phoneNumber) ?? null;
}

export async function sendImage(socket, to, imagePath, caption) {
  await socket.sendMessage(normalizeJid(to), {
    image: fs.readFileSync(imagePath), caption,
  });
  console.log('[WA ✅]', `Image envoyée à ${to}`);
}

export async function sendDocument(socket, to, docPath, filename, caption = '') {
  await socket.sendMessage(normalizeJid(to), {
    document: fs.readFileSync(docPath),
    fileName: filename,
    mimetype: 'application/pdf',
    caption,
  });
  console.log('[WA ✅]', `Document "${filename}" envoyé à ${to}`);
}

export async function sendTextMessage(socket, to, text) {
  await socket.sendMessage(normalizeJid(to), { text });
  console.log('[WA ✅]', `Message envoyé à ${to}`);
}

function normalizeJid(number) {
  const clean = number.replace(/@.*$/, '').replace(/\D/g, '');
  return `${clean}@s.whatsapp.net`;
}
