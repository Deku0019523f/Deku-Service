const path = require('path');
const fs = require('fs');
const qrcode = require('qrcode');
const {
  default: makeWASocket,
  useMultiFileAuthState,
  DisconnectReason,
  fetchLatestBaileysVersion,
} = require('@whiskeysockets/baileys');

const logger = require('../utils/logger');
const sessionModel = require('../models/session.model');
const vendeurModel = require('../models/vendeur.model');
const produitModel = require('../models/produit.model');
const conversationModel = require('../models/conversation.model');
const aiService = require('./aiService');

// vendeurId -> { socket, statut }
const sockets = new Map();
let io = null;

function initSocketIo(ioInstance) {
  io = ioInstance;
}

function emettreVersVendeur(vendeurId, event, data) {
  if (io) io.to(`vendeur:${vendeurId}`).emit(event, data);
}

function sessionsDir(vendeurId) {
  return path.join(__dirname, '..', '..', 'data', 'sessions', vendeurId);
}

/**
 * Démarre (ou redémarre) la connexion WhatsApp d'un vendeur.
 * mode: 'qr' | 'pairing'
 * numeroTelephone: requis seulement en mode pairing (format international sans +)
 */
async function connecterVendeur(vendeurId, { mode = 'qr', numeroTelephone } = {}) {
  const dir = sessionsDir(vendeurId);
  fs.mkdirSync(dir, { recursive: true });

  // Toujours écrire le chemin de session en DB dès la création de la socket,
  // même avant que la connexion soit établie (évite l'orphelinage du pairing).
  if (!sessionModel.trouverParVendeur(vendeurId)) {
    sessionModel.creer(vendeurId, dir);
  } else {
    sessionModel.majStatut(vendeurId, 'en_attente_scan');
  }

  const { state, saveCreds } = await useMultiFileAuthState(dir);
  const { version } = await fetchLatestBaileysVersion();

  const socket = makeWASocket({
    version,
    auth: state,
    printQRInTerminal: false,
    logger: logger.child({ module: 'baileys', vendeurId }),
  });

  sockets.set(vendeurId, { socket, statut: 'en_attente_scan' });

  // Pairing code : demandé une seule fois, juste après la création de la socket,
  // et uniquement si pas déjà enregistré.
  if (mode === 'pairing' && numeroTelephone && !socket.authState.creds.registered) {
    try {
      const code = await socket.requestPairingCode(numeroTelephone.replace(/\D/g, ''));
      emettreVersVendeur(vendeurId, 'whatsapp:pairing_code', { code });
    } catch (err) {
      logger.error({ err }, 'Erreur génération pairing code');
    }
  }

  socket.ev.on('creds.update', saveCreds);

  socket.ev.on('connection.update', async (update) => {
    const { connection, lastDisconnect, qr } = update;

    if (qr && mode === 'qr') {
      const qrDataUrl = await qrcode.toDataURL(qr);
      emettreVersVendeur(vendeurId, 'whatsapp:qr', { qr: qrDataUrl });
    }

    if (connection === 'open') {
      const numero = socket.user?.id?.split(':')[0] || null;
      sessionModel.majStatut(vendeurId, 'connecte', numero);
      sockets.set(vendeurId, { socket, statut: 'connecte' });
      emettreVersVendeur(vendeurId, 'whatsapp:statut', { statut: 'connecte', numero });
      logger.info({ vendeurId, numero }, 'WhatsApp connecté');
    }

    if (connection === 'close') {
      const codeErreur = lastDisconnect?.error?.output?.statusCode;
      const dejaDeconnecte = codeErreur === DisconnectReason.loggedOut;

      if (dejaDeconnecte) {
        sessionModel.majStatut(vendeurId, 'deconnecte');
        sockets.delete(vendeurId);
        fs.rmSync(dir, { recursive: true, force: true });
        emettreVersVendeur(vendeurId, 'whatsapp:statut', { statut: 'deconnecte' });
        logger.warn({ vendeurId }, 'Vendeur déconnecté (logout) — session supprimée');
      } else {
        // Reconnexion réseau normale : on relance. Ne pas confondre avec le
        // restartRequired qui suit la génération du pairing code (pas une vraie coupure).
        logger.info({ vendeurId, codeErreur }, 'Reconnexion WhatsApp en cours...');
        setTimeout(() => connecterVendeur(vendeurId, { mode }), 3000);
      }
    }
  });

  // --- Réception des messages clients ---
  socket.ev.on('messages.upsert', async ({ messages: msgs, type }) => {
    if (type !== 'notify') return;

    for (const m of msgs) {
      if (!m.message || m.key.fromMe) continue;

      const jidClient = m.key.remoteJid;
      if (!jidClient || jidClient.endsWith('@g.us')) continue; // ignorer les groupes

      const texte =
        m.message.conversation ||
        m.message.extendedTextMessage?.text ||
        m.message.imageMessage?.caption ||
        null;
      if (!texte) continue;

      await traiterMessageClient(vendeurId, socket, jidClient, texte);
    }
  });

  return socket;
}

async function traiterMessageClient(vendeurId, socket, jidClient, texte) {
  const vendeur = vendeurModel.trouverParId(vendeurId);
  if (!vendeur) return;

  const numeroClient = jidClient.split('@')[0];
  const client = conversationModel.trouverOuCreerClient(numeroClient);
  const conversation = conversationModel.trouverOuCreerConversation(vendeurId, client.id);

  const messageEnregistre = conversationModel.ajouterMessage(conversation.id, 'client', texte);
  emettreVersVendeur(vendeurId, 'conversation:message', {
    conversationId: conversation.id,
    message: messageEnregistre,
  });

  // Si un humain a repris la main, l'IA ne répond pas
  if (conversation.prise_en_charge === 'humain') return;

  const produitsActifs = produitModel.listerActifs(vendeurId);
  const historique = conversationModel.historiqueRecent(conversation.id);

  const reponseIA = await aiService.genererReponse({
    vendeur,
    produitsActifs,
    historique,
    messageClient: texte,
  });

  await socket.sendMessage(jidClient, { text: reponseIA });

  const messageIA = conversationModel.ajouterMessage(conversation.id, 'ia', reponseIA);
  emettreVersVendeur(vendeurId, 'conversation:message', {
    conversationId: conversation.id,
    message: messageIA,
  });
}

function statutVendeur(vendeurId) {
  return sockets.get(vendeurId)?.statut || sessionModel.trouverParVendeur(vendeurId)?.statut || 'deconnecte';
}

async function deconnecterVendeur(vendeurId) {
  const entree = sockets.get(vendeurId);
  if (entree) {
    try {
      await entree.socket.logout();
    } catch (_) {
      /* ignoré : la session peut déjà être invalide */
    }
    sockets.delete(vendeurId);
  }
  sessionModel.majStatut(vendeurId, 'deconnecte');
  fs.rmSync(sessionsDir(vendeurId), { recursive: true, force: true });
}

/** Permet au vendeur de reprendre la main manuellement sur une conversation */
function envoyerMessageVendeur(vendeurId, jidClient, texte) {
  const entree = sockets.get(vendeurId);
  if (!entree || entree.statut !== 'connecte') throw new Error('WhatsApp non connecté pour ce vendeur');
  return entree.socket.sendMessage(jidClient, { text: texte });
}

module.exports = {
  initSocketIo,
  connecterVendeur,
  deconnecterVendeur,
  statutVendeur,
  envoyerMessageVendeur,
};
