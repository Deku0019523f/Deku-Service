/**
 * GET /api/status/stream/:phone
 * Server-Sent Events — le frontend reçoit les mises à jour en temps réel
 */

import { Router } from 'express';

export const router = Router();

// Map des clients SSE : phone → Set<res>
const sseClients = new Map();

export function notifyClients(phone, data) {
  const clients = sseClients.get(phone);
  if (!clients) return;
  const payload = `data: ${JSON.stringify(data)}\n\n`;
  clients.forEach(res => {
    try { res.write(payload); } catch {}
  });
}

router.get('/stream/:phone', (req, res) => {
  const { phone } = req.params;

  res.setHeader('Content-Type',  'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection',    'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no'); // Nginx / Render proxy
  res.flushHeaders();

  // Ajouter ce client
  if (!sseClients.has(phone)) sseClients.set(phone, new Set());
  sseClients.get(phone).add(res);

  // Ping toutes les 20 s pour garder la connexion ouverte
  const ping = setInterval(() => {
    try { res.write(': ping\n\n'); } catch {}
  }, 20_000);

  req.on('close', () => {
    clearInterval(ping);
    sseClients.get(phone)?.delete(res);
  });
});
