#!/usr/bin/env node
import chalk from 'chalk';
import fs from 'fs';

import {
  displayBanner,
  askPhoneNumber,
  validatePhoneNumber,
  displayPairingCode,
  displayApiKey,
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
import { startKeepalive, stopKeepalive } from './app/keepalive.js';

// ─────────────────────────────────────────────────────────────────────────────

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function formatDate() {
  return new Date().toLocaleDateString('fr-FR', {
    day: '2-digit', month: 'long', year: 'numeric',
  });
}

async function ensureLogoExists() {
  const logoPath = './assets/logo.png';
  if (!fs.existsSync(logoPath)) {
    const px = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
    fs.writeFileSync(logoPath, Buffer.from(px, 'base64'));
  }
  return logoPath;
}

async function runOnboarding(socket, phoneNumber, apiKey) {
  const date     = formatDate();
  const logoPath = await ensureLogoExists();

  log('info', 'Génération du guide PDF…');
  let pdfPath;
  try {
    pdfPath = await generateGuidePDF(phoneNumber, apiKey, date);
    log('success', `PDF généré : ${pdfPath}`);
  } catch (err) {
    log('error', `Erreur génération PDF : ${err.message}`);
    return;
  }

  await sleep(2000);

  const caption =
    `✅ Connexion WhatsApp réussie\n\n` +
    `🔐 Voici votre clé API :\n\n${apiKey}\n\n` +
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
      "📘 Voici votre guide d'intégration WhatsApp API. Bonne intégration ! 🚀"
    );
  } catch (err) {
    log('error', `Erreur envoi PDF : ${err.message}`);
  }

  log('success', '🎉 Onboarding terminé ! Vérifiez votre WhatsApp.');
}

// ── Flow principal ────────────────────────────────────────────────────────────

async function main() {
  displayBanner();
  startKeepalive('⏳ Démarrage…');

  const sessions = listSessions();

  if (sessions.length > 0) {
    const phoneNumber = sessions[0];
    const apiKeyData  = loadApiKey(phoneNumber);

    log('info', `Session existante détectée : ${phoneNumber}`);
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
      await startNewSession();
    }
    return;
  }

  await startNewSession();
}

async function startNewSession() {
  let phoneNumber = '';
  while (true) {
    phoneNumber = askPhoneNumber();
    if (validatePhoneNumber(phoneNumber)) break;
  }

  log('info', `Numéro validé : ${phoneNumber}`);
  log('info', 'Initialisation de la connexion WhatsApp…');

  try {
    // connectWithPairingCode prend 3 callbacks :
    //  1. onPairingCode  — afficher le code
    //  2. onConnected    — appelé sur connection='open' (peut arriver après reconnexion auto)
    // La promesse se résout aussi sur 'open' (whichever comes first)
    const { socket, jid } = await connectWithPairingCode(
      phoneNumber,

      // onPairingCode
      (code) => {
        stopKeepalive();
        displayPairingCode(code);
        // Keepalive pendant que l'utilisateur saisit le code dans WhatsApp
        startKeepalive('⏳ Saisissez le code dans WhatsApp → Paramètres → Appareils connectés');
      },

      // onConnected (appelé si 'open' survient après une reconnexion auto)
      null
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
      log('error', 'Session révoquée. Relancez le script.');
    } else if (err.message?.startsWith('CONNECTION_CLOSED')) {
      const code = err.message.split('_').pop();
      log('error', `Connexion fermée (code ${code}).`);
      console.log(chalk.yellow('\n💡 Attendez 5 min et relancez : node index.js'));
    } else if (err.message?.includes('Pairing impossible') || err.message?.includes('MAX_RECONNECT')) {
      log('error', err.message);
      console.log(chalk.yellow('\n💡 Vérifiez le numéro et relancez dans 5 min'));
    } else {
      log('error', `Erreur : ${err.message}`);
      console.error(err);
    }
    process.exit(1);
  }
}

main().catch((err) => {
  stopKeepalive();
  console.error(chalk.red('\n💥 Erreur fatale :'), err.message);
  process.exit(1);
});
