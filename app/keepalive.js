/**
 * keepalive.js — Empêche l'hébergeur de tuer le process
 *
 * Bot-Hosting (et d'autres hébergeurs) détectent l'inactivité de deux façons :
 *  1. Pas de stdout pendant X secondes → kill
 *  2. Pas de serveur HTTP qui répond → marqué "offline"
 *
 * Ce module fait les deux :
 *  - Ouvre un serveur HTTP minimal sur le port défini par $PORT (ou 3000)
 *  - Affiche un heartbeat dans stdout toutes les 20 s
 */

import http from 'http';

let heartbeatTimer = null;
let server         = null;

export function startKeepalive(label = '⏳ En attente de connexion WhatsApp…') {
  // ── 1. Serveur HTTP ──────────────────────────────────────────────────
  const PORT = parseInt(process.env.PORT ?? '3000', 10);

  server = http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end('WhatsApp API Agent — running\n');
  });

  server.listen(PORT, () => {
    // Silencieux — on ne log que si on veut debugger
  });

  server.on('error', () => {
    // Port déjà occupé ? Pas grave, le heartbeat suffit.
  });

  // ── 2. Heartbeat stdout ──────────────────────────────────────────────
  heartbeatTimer = setInterval(() => {
    process.stdout.write(`\r${label}  [${new Date().toLocaleTimeString('fr-FR')}]   `);
  }, 20_000);
}

export function stopKeepalive() {
  if (heartbeatTimer) {
    clearInterval(heartbeatTimer);
    heartbeatTimer = null;
    process.stdout.write('\n'); // nettoyer la ligne du heartbeat
  }
  if (server) {
    server.close();
    server = null;
  }
}
