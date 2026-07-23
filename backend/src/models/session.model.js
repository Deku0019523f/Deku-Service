const { v4: uuid } = require('uuid');
const db = require('../config/database');

function trouverParVendeur(vendeurId) {
  return db.prepare(`SELECT * FROM whatsapp_sessions WHERE vendeur_id = ?`).get(vendeurId);
}

function creer(vendeurId, sessionPath) {
  const id = uuid();
  db.prepare(
    `INSERT INTO whatsapp_sessions (id, vendeur_id, session_path, statut) VALUES (?, ?, ?, 'en_attente_scan')`
  ).run(id, vendeurId, sessionPath);
  return trouverParVendeur(vendeurId);
}

function majStatut(vendeurId, statut, numeroWhatsapp) {
  if (statut === 'connecte') {
    db.prepare(
      `UPDATE whatsapp_sessions SET statut = ?, numero_whatsapp = ?, connected_at = datetime('now'), last_seen_at = datetime('now') WHERE vendeur_id = ?`
    ).run(statut, numeroWhatsapp || null, vendeurId);
  } else {
    db.prepare(
      `UPDATE whatsapp_sessions SET statut = ?, last_seen_at = datetime('now') WHERE vendeur_id = ?`
    ).run(statut, vendeurId);
  }
}

function supprimer(vendeurId) {
  db.prepare(`DELETE FROM whatsapp_sessions WHERE vendeur_id = ?`).run(vendeurId);
}

module.exports = { trouverParVendeur, creer, majStatut, supprimer };
