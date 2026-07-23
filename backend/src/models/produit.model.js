const { v4: uuid } = require('uuid');
const db = require('../config/database');

function lister(vendeurId) {
  return db.prepare(`SELECT * FROM produits WHERE vendeur_id = ? ORDER BY created_at DESC`).all(vendeurId);
}

function listerActifs(vendeurId) {
  return db.prepare(`SELECT * FROM produits WHERE vendeur_id = ? AND actif = 1`).all(vendeurId);
}

function creer(vendeurId, { nom, description, prix, stock }) {
  const id = uuid();
  db.prepare(
    `INSERT INTO produits (id, vendeur_id, nom, description, prix, stock) VALUES (?, ?, ?, ?, ?, ?)`
  ).run(id, vendeurId, nom, description || null, prix || 0, stock || 0);
  return db.prepare(`SELECT * FROM produits WHERE id = ?`).get(id);
}

function modifier(id, vendeurId, champs) {
  const existant = db.prepare(`SELECT * FROM produits WHERE id = ? AND vendeur_id = ?`).get(id, vendeurId);
  if (!existant) return null;
  const fusion = { ...existant, ...champs };
  db.prepare(
    `UPDATE produits SET nom = ?, description = ?, prix = ?, stock = ?, actif = ? WHERE id = ?`
  ).run(fusion.nom, fusion.description, fusion.prix, fusion.stock, fusion.actif ? 1 : 0, id);
  return db.prepare(`SELECT * FROM produits WHERE id = ?`).get(id);
}

function supprimer(id, vendeurId) {
  const res = db.prepare(`DELETE FROM produits WHERE id = ? AND vendeur_id = ?`).run(id, vendeurId);
  return res.changes > 0;
}

module.exports = { lister, listerActifs, creer, modifier, supprimer };
