/**
 * keepalive.js — Empêche l'hébergeur de tuer le process
 *
 * Render, Bot-Hosting et autres hébergeurs détectent l'inactivité de deux façons :
 *  1. Pas de stdout pendant X secondes → kill
 *  2. Pas de serveur HTTP qui répond   → marqué "offline"
 *
 * Ce module démarre le serveur Express UNE SEULE FOIS via initServer(),
 * puis gère uniquement le heartbeat stdout via startKeepalive / stopKeepalive.
 *
 * ⚠️ Le code d'appairage WhatsApp s'affiche dans la console / les logs du serveur.
 *    Sur Render : Dashboard → Service → Logs
 *    Sur VPS    : stdout / journalctl
 */

import { config }          from '../config.js';
import { startApiServer }  from './api/index.js';

let heartbeatTimer = null;

// ── Démarre le serveur Express une seule fois au lancement ────────────────────
export async function initServer() {
  const PORT = parseInt(process.env.PORT ?? config.port ?? '3000', 10);
  try {
    await startApiServer(PORT);
  } catch {
    // Port déjà utilisé — le heartbeat seul suffit au keepalive.
  }
}

// ── Démarre / met à jour le heartbeat stdout ──────────────────────────────────
export function startKeepalive(label = '⏳ En attente de connexion WhatsApp…') {
  // Réinitialiser le timer si un label différent est demandé
  if (heartbeatTimer) {
    clearInterval(heartbeatTimer);
    heartbeatTimer = null;
  }

  heartbeatTimer = setInterval(() => {
    process.stdout.write(`\r${label}  [${new Date().toLocaleTimeString('fr-FR')}]   `);
  }, 20_000);
}

// ── Arrête uniquement le heartbeat (le serveur HTTP reste actif) ───────────────
export function stopKeepalive() {
  if (heartbeatTimer) {
    clearInterval(heartbeatTimer);
    heartbeatTimer = null;
    process.stdout.write('\n');
  }
}
