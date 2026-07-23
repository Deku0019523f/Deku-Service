const { v4: uuid } = require('uuid');
const db = require('../config/database');

function creer({ nomBoutique, email, motDePasseHash, telephone }) {
  const id = uuid();
  db.prepare(
    `INSERT INTO vendeurs (id, nom_boutique, email, mot_de_passe, telephone) VALUES (?, ?, ?, ?, ?)`
  ).run(id, nomBoutique, email, motDePasseHash, telephone || null);
  return trouverParId(id);
}

function trouverParEmail(email) {
  return db.prepare(`SELECT * FROM vendeurs WHERE email = ?`).get(email);
}

function trouverParId(id) {
  return db.prepare(`SELECT id, nom_boutique, email, telephone, created_at FROM vendeurs WHERE id = ?`).get(id);
}

module.exports = { creer, trouverParEmail, trouverParId };
