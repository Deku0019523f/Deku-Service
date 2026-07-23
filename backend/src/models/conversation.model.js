const { v4: uuid } = require('uuid');
const db = require('../config/database');

// --- Clients ---
function trouverOuCreerClient(numeroWhatsapp, nom) {
  let client = db.prepare(`SELECT * FROM clients WHERE numero_whatsapp = ?`).get(numeroWhatsapp);
  if (!client) {
    const id = uuid();
    db.prepare(`INSERT INTO clients (id, numero_whatsapp, nom) VALUES (?, ?, ?)`).run(id, numeroWhatsapp, nom || null);
    client = db.prepare(`SELECT * FROM clients WHERE id = ?`).get(id);
  }
  return client;
}

// --- Conversations ---
function trouverOuCreerConversation(vendeurId, clientId) {
  let conv = db.prepare(`SELECT * FROM conversations WHERE vendeur_id = ? AND client_id = ?`).get(vendeurId, clientId);
  if (!conv) {
    const id = uuid();
    db.prepare(
      `INSERT INTO conversations (id, vendeur_id, client_id) VALUES (?, ?, ?)`
    ).run(id, vendeurId, clientId);
    conv = db.prepare(`SELECT * FROM conversations WHERE id = ?`).get(id);
  }
  return conv;
}

function listerConversations(vendeurId) {
  return db.prepare(`
    SELECT c.*, cl.numero_whatsapp, cl.nom AS nom_client
    FROM conversations c
    JOIN clients cl ON cl.id = c.client_id
    WHERE c.vendeur_id = ?
    ORDER BY c.derniere_activite DESC
  `).all(vendeurId);
}

function majStatutConversation(id, vendeurId, statut) {
  db.prepare(`UPDATE conversations SET statut = ?, derniere_activite = datetime('now') WHERE id = ? AND vendeur_id = ?`)
    .run(statut, id, vendeurId);
}

function majPriseEnCharge(id, vendeurId, priseEnCharge) {
  db.prepare(`UPDATE conversations SET prise_en_charge = ? WHERE id = ? AND vendeur_id = ?`)
    .run(priseEnCharge, id, vendeurId);
}

function toucherConversation(id) {
  db.prepare(`UPDATE conversations SET derniere_activite = datetime('now') WHERE id = ?`).run(id);
}

// --- Messages ---
function ajouterMessage(conversationId, expediteur, contenu) {
  const id = uuid();
  db.prepare(
    `INSERT INTO messages (id, conversation_id, expediteur, contenu) VALUES (?, ?, ?, ?)`
  ).run(id, conversationId, expediteur, contenu);
  toucherConversation(conversationId);
  return db.prepare(`SELECT * FROM messages WHERE id = ?`).get(id);
}

function listerMessages(conversationId, limite = 50) {
  return db.prepare(
    `SELECT * FROM messages WHERE conversation_id = ? ORDER BY created_at ASC LIMIT ?`
  ).all(conversationId, limite);
}

function historiqueRecent(conversationId, limite = 12) {
  const rows = db.prepare(
    `SELECT * FROM messages WHERE conversation_id = ? ORDER BY created_at DESC LIMIT ?`
  ).all(conversationId, limite);
  return rows.reverse();
}

// --- Commandes ---
function creerCommande(conversationId, produitId, quantite) {
  const id = uuid();
  db.prepare(
    `INSERT INTO commandes (id, conversation_id, produit_id, quantite) VALUES (?, ?, ?, ?)`
  ).run(id, conversationId, produitId, quantite || 1);
  return db.prepare(`SELECT * FROM commandes WHERE id = ?`).get(id);
}

function listerCommandes(vendeurId) {
  return db.prepare(`
    SELECT co.*, c.id AS conversation_id, cl.nom AS nom_client, cl.numero_whatsapp, p.nom AS nom_produit
    FROM commandes co
    JOIN conversations c ON c.id = co.conversation_id
    JOIN clients cl ON cl.id = c.client_id
    LEFT JOIN produits p ON p.id = co.produit_id
    WHERE c.vendeur_id = ?
    ORDER BY co.created_at DESC
  `).all(vendeurId);
}

module.exports = {
  trouverOuCreerClient,
  trouverOuCreerConversation,
  listerConversations,
  majStatutConversation,
  majPriseEnCharge,
  ajouterMessage,
  listerMessages,
  historiqueRecent,
  creerCommande,
  listerCommandes,
};
