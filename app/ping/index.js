// ─────────────────────────────────────────────────────────────────────────────
//  app/ping/index.js  —  Ping horaire WhatsApp (keep-alive 24h/7j)
//
//  Envoie un message WhatsApp sur ton propre numéro toutes les heures
//  pour maintenir la connexion active et éviter la déconnexion.
// ─────────────────────────────────────────────────────────────────────────────

import { log } from '../cli/index.js';

let pingTimer  = null;
let pingSocket = null;
let pingNumber = null;
let pingCount  = 0;
const INTERVAL = 60 * 60 * 1000; // 1 heure

const startTime = Date.now();

function formatUptime(ms) {
  const totalSec = Math.floor(ms / 1000);
  const hours    = Math.floor(totalSec / 3600);
  const minutes  = Math.floor((totalSec % 3600) / 60);
  return `${hours}h ${minutes}min`;
}

async function sendPing() {
  if (!pingSocket || !pingNumber) return;
  pingCount++;

  const now    = new Date().toLocaleString('fr-FR', { timeZone: 'Africa/Abidjan' });
  const uptime = formatUptime(Date.now() - startTime);

  const text =
    `🟢 *Deku-Service* — Ping horaire #${pingCount}\n` +
    `🕐 *Heure :* ${now}\n` +
    `⏱️ *Uptime :* ${uptime}\n` +
    `📡 *Serveur actif 24h/7j*`;

  try {
    const jid = `${pingNumber.replace(/\D/g, '')}@s.whatsapp.net`;
    await pingSocket.sendMessage(jid, { text });
    log('success', `[Ping #${pingCount}] Envoyé à ${pingNumber}`);
  } catch (err) {
    log('error', `[Ping] Échec : ${err.message}`);
  }
}

export function startPing(socket, phoneNumber) {
  // Éviter le double démarrage si appelé plusieurs fois
  if (pingTimer) {
    clearInterval(pingTimer);
    pingTimer = null;
  }

  pingSocket = socket;
  pingNumber = phoneNumber;

  // Premier ping immédiat pour confirmer le démarrage
  sendPing();

  pingTimer = setInterval(sendPing, INTERVAL);
  log('success', `[Ping] Démarré — message toutes les heures sur ${phoneNumber}`);
}

export function stopPing() {
  if (pingTimer) {
    clearInterval(pingTimer);
    pingTimer = null;
  }
  log('warn', '[Ping] Arrêté');
}

export function getPingStats() {
  return {
    active:   !!pingTimer,
    count:    pingCount,
    uptime:   formatUptime(Date.now() - startTime),
    interval: '1h',
  };
}
