const Database = require('better-sqlite3');
const path = require('path');

const dbPath = path.join(__dirname, '..', '..', 'data', 'app.db');
const db = new Database(dbPath);

db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

// --- Schéma ---
db.exec(`
CREATE TABLE IF NOT EXISTS vendeurs (
  id            TEXT PRIMARY KEY,
  nom_boutique  TEXT NOT NULL,
  email         TEXT UNIQUE NOT NULL,
  mot_de_passe  TEXT NOT NULL,
  telephone     TEXT,
  created_at    TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS whatsapp_sessions (
  id              TEXT PRIMARY KEY,
  vendeur_id      TEXT NOT NULL REFERENCES vendeurs(id) ON DELETE CASCADE,
  numero_whatsapp TEXT,
  statut          TEXT NOT NULL DEFAULT 'deconnecte', -- deconnecte | en_attente_scan | connecte
  session_path    TEXT NOT NULL,
  connected_at    TEXT,
  last_seen_at    TEXT,
  created_at      TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS produits (
  id          TEXT PRIMARY KEY,
  vendeur_id  TEXT NOT NULL REFERENCES vendeurs(id) ON DELETE CASCADE,
  nom         TEXT NOT NULL,
  description TEXT,
  prix        REAL NOT NULL DEFAULT 0,
  stock       INTEGER NOT NULL DEFAULT 0,
  actif       INTEGER NOT NULL DEFAULT 1,
  created_at  TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS clients (
  id              TEXT PRIMARY KEY,
  numero_whatsapp TEXT UNIQUE NOT NULL,
  nom             TEXT,
  created_at      TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS conversations (
  id                TEXT PRIMARY KEY,
  vendeur_id        TEXT NOT NULL REFERENCES vendeurs(id) ON DELETE CASCADE,
  client_id         TEXT NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  statut            TEXT NOT NULL DEFAULT 'en_discussion', -- en_discussion | interesse | commande_passee | sans_suite
  produit_id        TEXT REFERENCES produits(id),
  prise_en_charge   TEXT NOT NULL DEFAULT 'ia', -- ia | humain
  derniere_activite TEXT DEFAULT (datetime('now')),
  created_at        TEXT DEFAULT (datetime('now')),
  UNIQUE(vendeur_id, client_id)
);

CREATE TABLE IF NOT EXISTS messages (
  id              TEXT PRIMARY KEY,
  conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  expediteur      TEXT NOT NULL, -- client | ia | vendeur
  contenu         TEXT NOT NULL,
  created_at      TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS commandes (
  id              TEXT PRIMARY KEY,
  conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  produit_id      TEXT REFERENCES produits(id),
  quantite        INTEGER NOT NULL DEFAULT 1,
  statut          TEXT NOT NULL DEFAULT 'en_attente', -- en_attente | confirmee | annulee
  created_at      TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_sessions_vendeur ON whatsapp_sessions(vendeur_id);
CREATE INDEX IF NOT EXISTS idx_produits_vendeur ON produits(vendeur_id);
CREATE INDEX IF NOT EXISTS idx_conversations_vendeur ON conversations(vendeur_id);
CREATE INDEX IF NOT EXISTS idx_messages_conversation ON messages(conversation_id);
`);

module.exports = db;
