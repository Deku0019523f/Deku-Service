#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
//  Deku-Service  —  v3
//  WhatsApp API Agent avec IA Groq + Keep-alive 24h/7j
// ─────────────────────────────────────────────────────────────────────────────

import chalk from 'chalk';
import fs    from 'fs';

import { config } from './config.js';

import {
  displayBanner,
  displayPairingCode,
  displayApiKey,
  displayConfigError,
  log,
} from './app/cli/index.js';

import {
  generateApiKey,
  saveApiKey,
  loadApiKey,
  listSessions,
} from './app/apikey/index.js';

import {
  connectWithPairingCode,
  reconnectExistingSession,
  sendImage,
  sendDocument,
  setOwnerNumber,
} from './app/whatsapp/index.js';

import { generateGuidePDF }              from './app/pdf/index.js';
import { initServer, startKeepalive, stopKeepalive } from './app/keepalive.js';
import { startPing, stopPing }           from './app/ping/index.js';

// ─────────────────────────────────────────────────────────────────────────────

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function formatDate() {
  return new Date().toLocaleDateString('fr-FR', {
    day: '2-digit', month: 'long', year: 'numeric',
  });
}

// ── Validation config ─────────────────────────────────────────────────────────
function validateConfig() {
  const { phoneNumber } = config;

  if (!phoneNumber || phoneNumber === '2250000000000') {
    displayConfigError(
      'Numéro non configuré',
      'Ouvrez config.js et remplacez "2250000000000" par votre vrai numéro WhatsApp.',
    );
    process.exit(1);
  }

  if (!/^\d{7,15}$/.test(phoneNumber)) {
    displayConfigError(
      'Numéro invalide dans config.js',
      `"${phoneNumber}" — Format : chiffres uniquement, sans +, sans espaces.\nExemple CI : 2250712345678`,
    );
    process.exit(1);
  }

  // Vérifier GROQ_API_KEY
  if (!process.env.GROQ_API_KEY) {
    log('warn', '⚠️  GROQ_API_KEY non définie dans .env — l\'agent IA sera non fonctionnel.');
  }

  return phoneNumber;
}

// ── Onboarding ────────────────────────────────────────────────────────────────
async function runOnboarding(socket, phoneNumber, apiKey) {
  const date     = formatDate();
  const logoPath = './assets/logo.png';
  const PORT     = parseInt(process.env.PORT ?? config.port ?? '3000', 10);
  const baseUrl  = process.env.RENDER_EXTERNAL_URL
                ?? process.env.SERVICE_URL
                ?? `http://localhost:${PORT}`;

  if (!fs.existsSync(logoPath)) {
    const px = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
    fs.writeFileSync(logoPath, Buffer.from(px, 'base64'));
  }

  log('info', 'Génération du guide PDF…');
  let pdfPath;
  try {
    pdfPath = await generateGuidePDF(phoneNumber, apiKey, date, baseUrl);
    log('success', `PDF généré : ${pdfPath}`);
  } catch (err) {
    log('error', `Erreur génération PDF : ${err.message}`);
    return;
  }

  await sleep(2000);

  const caption =
    `✅ *Connexion WhatsApp réussie !*\n\n` +
    `🔐 *Votre clé API :*\n\n${apiKey}\n\n` +
    `⚠️ Gardez cette clé privée.\n\n` +
    `📄 Le guide d'intégration est envoyé juste après.\n\n` +
    `🤖 *Commandes disponibles :*\n` +
    `• \`.agent on\` — Activer l'agent IA\n` +
    `• \`.agent off\` — Désactiver l'agent IA\n` +
    `• \`.prompt <texte>\` — Définir le prompt\n` +
    `• \`.temps <Ns>\` — Délai de réponse\n` +
    `• \`.statut\` — État du serveur`;

  try {
    log('info', 'Envoi image + clé API…');
    await sendImage(socket, phoneNumber, logoPath, caption);
    await sleep(1500);
  } catch (err) {
    log('error', `Erreur envoi image : ${err.message}`);
  }

  try {
    log('info', 'Envoi du guide PDF…');
    await sendDocument(
      socket, phoneNumber, pdfPath,
      `Guide_Integration_${phoneNumber}.pdf`,
      "📘 Voici votre guide d'intégration WhatsApp API. Bonne intégration ! 🚀",
    );
  } catch (err) {
    log('error', `Erreur envoi PDF : ${err.message}`);
  }

  log('success', '🎉 Onboarding terminé ! Vérifiez votre WhatsApp.');
}

// ── Démarrage après connexion réussie ─────────────────────────────────────────
function onConnected(socket, phoneNumber) {
  stopKeepalive();

  // Définir le propriétaire pour les commandes
  setOwnerNumber(phoneNumber);

  // Démarrer le ping horaire keep-alive
  startPing(socket, phoneNumber);

  startKeepalive('✅ Deku-Service connecté | Agent IA prêt');
  console.log(chalk.gray('\nServeur actif 24h/7j. Ctrl+C pour quitter.\n'));
  console.log(chalk.cyan('💡 Commandes : .agent on/off  .prompt <texte>  .temps <Ns>  .statut\n'));

  process.on('SIGINT', () => {
    stopKeepalive();
    stopPing();
    socket.end();
    process.exit(0);
  });
}

// ── Nouvelle session ──────────────────────────────────────────────────────────
async function startNewSession(phoneNumber) {
  log('info', `Numéro configuré : ${phoneNumber}`);
  log('info', 'Initialisation de la connexion WhatsApp…');

  try {
    const { socket, jid } = await connectWithPairingCode(
      phoneNumber,
      (code) => {
        stopKeepalive();
        displayPairingCode(code);
        startKeepalive('⏳ En attente — entrez le code dans WhatsApp');
      },
      // Callback déclenché dès que la connexion est ouverte (avant le resolve)
      ({ socket: s }) => {
        setOwnerNumber(phoneNumber);
        startPing(s, phoneNumber);
        startKeepalive('✅ Deku-Service connecté | Agent IA prêt');
      },
    );

    const apiKey = generateApiKey();
    saveApiKey(phoneNumber, apiKey);
    displayApiKey(apiKey);
    log('info', `Clé sauvegardée : sessions/${phoneNumber}/api-key.json`);

    await runOnboarding(socket, phoneNumber, apiKey);

  } catch (err) {
    stopKeepalive();

    if (err.message === 'SESSION_REVOKED') {
      log('error', 'Session révoquée. Relancez le programme.');
    } else if (err.message?.startsWith('CONNECTION_CLOSED')) {
      log('error', `Connexion fermée (code ${err.message.split('_').pop()}).`);
      console.log(chalk.yellow('\n💡 Attendez 5 min et relancez.'));
    } else if (err.message?.includes('Pairing impossible') || err.message?.includes('MAX_RECONNECT')) {
      log('error', err.message);
      console.log(chalk.yellow('\n💡 Vérifiez le numéro dans config.js et relancez dans 5 min.'));
    } else {
      log('error', `Erreur : ${err.message}`);
      console.error(err);
    }
    process.exit(1);
  }
}

// ── Flow principal ────────────────────────────────────────────────────────────
async function main() {
  displayBanner();

  const phoneNumber = validateConfig();

  await initServer();
  startKeepalive('⏳ Démarrage…');

  const sessions = listSessions();

  if (sessions.includes(phoneNumber)) {
    const apiKeyData = loadApiKey(phoneNumber);

    log('info', `Session existante détectée pour : ${phoneNumber}`);
    if (apiKeyData) displayApiKey(apiKeyData.apiKey);
    log('info', 'Reconnexion en cours…');

    try {
      const { socket, jid } = await reconnectExistingSession(phoneNumber);
      log('success', `Reconnecté : ${jid}`);
      setOwnerNumber(phoneNumber);
      startPing(socket, phoneNumber);
      startKeepalive('✅ Deku-Service reconnecté | Agent IA prêt');
      console.log(chalk.cyan('\n💡 Commandes : .agent on/off  .prompt <texte>  .temps <Ns>  .statut\n'));
    } catch (err) {
      log('error', `Reconnexion échouée : ${err.message}`);
      log('info', 'Démarrage nouvelle session…');
      await startNewSession(phoneNumber);
    }
    return;
  }

  await startNewSession(phoneNumber);
}

main().catch((err) => {
  stopKeepalive();
  stopPing();
  console.error(chalk.red('\n💥 Erreur fatale :'), err.message);
  process.exit(1);
});
