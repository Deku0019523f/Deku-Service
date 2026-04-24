/**
 * keepalive.js — Empêche l'hébergeur de tuer le process
 *
 * Render, Bot-Hosting et autres hébergeurs détectent l'inactivité de deux façons :
 *  1. Pas de stdout pendant X secondes → kill
 *  2. Pas de serveur HTTP qui répond   → marqué "offline"
 *
 * Ce module fait les deux :
 *  - Ouvre un serveur HTTP minimal sur le port $PORT (ou config.port ou 3000)
 *  - Affiche un heartbeat dans stdout toutes les 20 s
 *
 * ⚠️ Le code d'appairage WhatsApp s'affiche dans la console / les logs du serveur.
 *    Sur Render : Dashboard → Service → Logs
 *    Sur VPS    : stdout / journalctl
 */

import http from 'http';
import { config } from '../config.js';

let heartbeatTimer = null;
let server         = null;

export function startKeepalive(label = '⏳ En attente de connexion WhatsApp…') {
  // ── 1. Serveur HTTP ──────────────────────────────────────────────────
  const PORT = parseInt(process.env.PORT ?? config.port ?? '3000', 10);

  if (!server) {
    server = http.createServer((req, res) => {
      res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('WhatsApp API Agent v2 — running ✅\n');
    });

    server.listen(PORT, () => {
      // Silencieux en prod
    });

    server.on('error', () => {
      // Port déjà occupé ? Le heartbeat suffit.
    });
  }

  // ── 2. Heartbeat stdout ──────────────────────────────────────────────
  if (!heartbeatTimer) {
    heartbeatTimer = setInterval(() => {
      process.stdout.write(`\r${label}  [${new Date().toLocaleTimeString('fr-FR')}]   `);
    }, 20_000);
  }
}

export function stopKeepalive() {
  if (heartbeatTimer) {
    clearInterval(heartbeatTimer);
    heartbeatTimer = null;
    process.stdout.write('\n');
  }
  if (server) {
    server.close();
    server = null;
  }
}
