#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
//  WhatsApp API Agent  —  v2
//  Point d'entrée principal
//  Le numéro WhatsApp est lu depuis config.js (plus de saisie interactive).
// ─────────────────────────────────────────────────────────────────────────────

import chalk from 'chalk';
import fs from 'fs';

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
} from './app/whatsapp/index.js';

import { generateGuidePDF } from './app/pdf/index.js';
import { initServer, startKeepalive, stopKeepalive } from './app/keepalive.js';

// ─────────────────────────────────────────────────────────────────────────────

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function formatDate() {
  return new Date().toLocaleDateString('fr-FR', {
    day: '2-digit', month: 'long', year: 'numeric',
  });
}

// ── Validation du numéro configuré ───────────────────────────────────────────
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
      `"${phoneNumber}" — Format attendu : chiffres uniquement, sans +, sans espaces.\nExemple CI : 2250712345678`,
    );
    process.exit(1);
  }

  return phoneNumber;
}

// ── Onboarding : envoi du PDF + clé API sur WhatsApp ─────────────────────────
async function runOnboarding(socket, phoneNumber, apiKey) {
  const date    = formatDate();
  const logoPath = './assets/logo.png';
  const PORT    = parseInt(process.env.PORT ?? config.port ?? '3000', 10);
  const baseUrl = process.env.RENDER_EXTERNAL_URL
               ?? process.env.SERVICE_URL
               ?? `http://localhost:${PORT}`;

  // Placeholder logo si absent
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
    `✅ Connexion WhatsApp réussie !\n\n` +
    `🔐 Votre clé API :\n\n${apiKey}\n\n` +
    `⚠️ Gardez cette clé privée.\n\n` +
    `📄 Le guide d'intégration est envoyé juste après.`;

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

// ── Nouvelle session ──────────────────────────────────────────────────────────
async function startNewSession(phoneNumber) {
  log('info', `Numéro configuré : ${phoneNumber}`);
  log('info', 'Initialisation de la connexion WhatsApp…');

  try {
    const { socket, jid } = await connectWithPairingCode(
      phoneNumber,

      // Callback : affichage du code d'appairage
      (code) => {
        stopKeepalive();
        displayPairingCode(code);
        // Keepalive pendant que l'utilisateur entre le code dans WhatsApp
        startKeepalive('⏳ En attente — entrez le code dans WhatsApp');
      },

      null,
    );

    stopKeepalive();

    const apiKey = generateApiKey();
    saveApiKey(phoneNumber, apiKey);
    displayApiKey(apiKey);
    log('info', `Clé sauvegardée : sessions/${phoneNumber}/api-key.json`);

    await runOnboarding(socket, phoneNumber, apiKey);

    startKeepalive('✅ WhatsApp API connecté');
    console.log(chalk.gray('\nServeur actif. Ctrl+C pour quitter.\n'));
    process.on('SIGINT', () => { stopKeepalive(); socket.end(); process.exit(0); });

  } catch (err) {
    stopKeepalive();

    if (err.message === 'SESSION_REVOKED') {
      log('error', 'Session révoquée. Relancez le programme.');
    } else if (err.message?.startsWith('CONNECTION_CLOSED')) {
      const code = err.message.split('_').pop();
      log('error', `Connexion fermée (code ${code}).`);
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

  // 1. Valider config.js
  const phoneNumber = validateConfig();

  await initServer();
  startKeepalive('⏳ Démarrage…');

  // 2. Session existante ?
  const sessions = listSessions();

  if (sessions.includes(phoneNumber)) {
    const apiKeyData = loadApiKey(phoneNumber);

    log('info', `Session existante détectée pour : ${phoneNumber}`);
    if (apiKeyData) displayApiKey(apiKeyData.apiKey);
    log('info', 'Reconnexion en cours…');

    try {
      const { socket, jid } = await reconnectExistingSession(phoneNumber);
      stopKeepalive();
      log('success', `Reconnecté : ${jid}`);
      startKeepalive('✅ WhatsApp API connecté');
      console.log(chalk.gray('\nServeur actif. Ctrl+C pour quitter.\n'));
      process.on('SIGINT', () => { stopKeepalive(); socket.end(); process.exit(0); });
    } catch (err) {
      log('error', `Reconnexion échouée : ${err.message}`);
      log('info', 'Démarrage nouvelle session…');
      await startNewSession(phoneNumber);
    }
    return;
  }

  // 3. Nouvelle session
  await startNewSession(phoneNumber);
}

main().catch((err) => {
  stopKeepalive();
  console.error(chalk.red('\n💥 Erreur fatale :'), err.message);
  process.exit(1);
});
