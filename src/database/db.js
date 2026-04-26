// src/database/db.js
import Database from 'better-sqlite3';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, '../../data');
const DB_PATH = path.join(DATA_DIR, 'saas.db');

if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

const db = new Database(DB_PATH);

// Performance pragmas
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');
db.pragma('synchronous = NORMAL');

// ── Schema ────────────────────────────────────────────────────────────────────
db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    telegram_id INTEGER UNIQUE NOT NULL,
    username TEXT,
    first_name TEXT,
    is_blocked INTEGER DEFAULT 0,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS subscriptions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    telegram_id INTEGER UNIQUE NOT NULL,
    plan TEXT DEFAULT 'free' CHECK(plan IN ('free','pro','premium')),
    messages_today INTEGER DEFAULT 0,
    messages_month INTEGER DEFAULT 0,
    last_reset_day TEXT DEFAULT (date('now')),
    last_reset_month TEXT DEFAULT (strftime('%Y-%m', 'now')),
    expires_at TEXT,
    FOREIGN KEY (telegram_id) REFERENCES users(telegram_id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS whatsapp_sessions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    telegram_id INTEGER NOT NULL,
    account_index INTEGER NOT NULL DEFAULT 1,
    phone_number TEXT,
    status TEXT DEFAULT 'disconnected',
    agent_enabled INTEGER DEFAULT 1,
    agent_paused INTEGER DEFAULT 0,
    custom_prompt TEXT DEFAULT '',
    response_delay INTEGER DEFAULT 30,
    products_json TEXT DEFAULT '[]',
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now')),
    UNIQUE(telegram_id, account_index),
    FOREIGN KEY (telegram_id) REFERENCES users(telegram_id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS stats (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    telegram_id INTEGER NOT NULL,
    session_id INTEGER,
    event_type TEXT NOT NULL,
    metadata TEXT DEFAULT '{}',
    created_at TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS api_keys (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    telegram_id INTEGER UNIQUE NOT NULL,
    api_key TEXT UNIQUE NOT NULL,
    total_requests INTEGER DEFAULT 0,
    created_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (telegram_id) REFERENCES users(telegram_id) ON DELETE CASCADE
  );

  CREATE INDEX IF NOT EXISTS idx_stats_telegram_id ON stats(telegram_id);
  CREATE INDEX IF NOT EXISTS idx_stats_event_type ON stats(event_type);
  CREATE INDEX IF NOT EXISTS idx_stats_created_at ON stats(created_at);
  CREATE INDEX IF NOT EXISTS idx_wa_sessions_telegram ON whatsapp_sessions(telegram_id);
`);

// ── User Queries ──────────────────────────────────────────────────────────────
export const userDB = {
  upsert: db.prepare(`
    INSERT INTO users (telegram_id, username, first_name)
    VALUES (@telegram_id, @username, @first_name)
    ON CONFLICT(telegram_id) DO UPDATE SET
      username = excluded.username,
      first_name = excluded.first_name,
      updated_at = datetime('now')
  `),

  get: db.prepare(`SELECT * FROM users WHERE telegram_id = ?`),

  getAll: db.prepare(`
    SELECT u.*, s.plan, s.messages_today, s.messages_month
    FROM users u
    LEFT JOIN subscriptions s ON u.telegram_id = s.telegram_id
    ORDER BY u.created_at DESC
    LIMIT ? OFFSET ?
  `),

  count: db.prepare(`SELECT COUNT(*) as count FROM users`),

  setBlocked: db.prepare(`
    UPDATE users SET is_blocked = ?, updated_at = datetime('now')
    WHERE telegram_id = ?
  `),
};

// ── Subscription Queries ──────────────────────────────────────────────────────
export const subDB = {
  upsert: db.prepare(`
    INSERT INTO subscriptions (telegram_id)
    VALUES (?)
    ON CONFLICT(telegram_id) DO NOTHING
  `),

  get: db.prepare(`SELECT * FROM subscriptions WHERE telegram_id = ?`),

  setPlan: db.prepare(`
    UPDATE subscriptions SET plan = ?, expires_at = ?
    WHERE telegram_id = ?
  `),

  resetDailyIfNeeded: db.prepare(`
    UPDATE subscriptions
    SET messages_today = 0, last_reset_day = date('now')
    WHERE telegram_id = ? AND last_reset_day < date('now')
  `),

  resetMonthlyIfNeeded: db.prepare(`
    UPDATE subscriptions
    SET messages_month = 0, last_reset_month = strftime('%Y-%m', 'now')
    WHERE telegram_id = ? AND last_reset_month < strftime('%Y-%m', 'now')
  `),

  increment: db.prepare(`
    UPDATE subscriptions
    SET messages_today = messages_today + 1, messages_month = messages_month + 1
    WHERE telegram_id = ?
  `),

  countByPlan: db.prepare(`
    SELECT plan, COUNT(*) as count FROM subscriptions GROUP BY plan
  `),

  totalMessages: db.prepare(`
    SELECT SUM(messages_today) as today, SUM(messages_month) as month
    FROM subscriptions
  `),

  findExpired: db.prepare(`
    SELECT s.*, u.telegram_id FROM subscriptions s
    JOIN users u ON s.telegram_id = u.telegram_id
    WHERE s.plan != 'free'
      AND s.expires_at IS NOT NULL
      AND s.expires_at < datetime('now')
  `),
};

// ── WhatsApp Session Queries ──────────────────────────────────────────────────
export const waDB = {
  upsert: db.prepare(`
    INSERT INTO whatsapp_sessions (telegram_id, account_index, phone_number)
    VALUES (@telegram_id, @account_index, @phone_number)
    ON CONFLICT(telegram_id, account_index) DO UPDATE SET
      phone_number = excluded.phone_number,
      updated_at = datetime('now')
  `),

  get: db.prepare(`
    SELECT * FROM whatsapp_sessions
    WHERE telegram_id = ? AND account_index = ?
  `),

  getAll: db.prepare(`
    SELECT * FROM whatsapp_sessions WHERE telegram_id = ?
    ORDER BY account_index ASC
  `),

  setStatus: db.prepare(`
    UPDATE whatsapp_sessions SET status = ?, updated_at = datetime('now')
    WHERE telegram_id = ? AND account_index = ?
  `),

  setAgentEnabled: db.prepare(`
    UPDATE whatsapp_sessions SET agent_enabled = ?
    WHERE telegram_id = ? AND account_index = ?
  `),

  setAgentPaused: db.prepare(`
    UPDATE whatsapp_sessions SET agent_paused = ?
    WHERE telegram_id = ? AND account_index = ?
  `),

  setPrompt: db.prepare(`
    UPDATE whatsapp_sessions SET custom_prompt = ?
    WHERE telegram_id = ? AND account_index = ?
  `),

  setDelay: db.prepare(`
    UPDATE whatsapp_sessions SET response_delay = ?
    WHERE telegram_id = ? AND account_index = ?
  `),

  setProducts: db.prepare(`
    UPDATE whatsapp_sessions SET products_json = ?
    WHERE telegram_id = ? AND account_index = ?
  `),

  countConnected: db.prepare(`
    SELECT COUNT(*) as count FROM whatsapp_sessions WHERE status = 'connected'
  `),

  delete: db.prepare(`
    DELETE FROM whatsapp_sessions WHERE telegram_id = ? AND account_index = ?
  `),
};

// ── Stats Queries ─────────────────────────────────────────────────────────────
export const statsDB = {
  insert: db.prepare(`
    INSERT INTO stats (telegram_id, session_id, event_type, metadata)
    VALUES (@telegram_id, @session_id, @event_type, @metadata)
  `),

  todayMessages: db.prepare(`
    SELECT COUNT(*) as count FROM stats
    WHERE event_type = 'ai_response' AND date(created_at) = date('now')
  `),
};

// ── API Key Queries ───────────────────────────────────────────────────────────
export const apiDB = {
  upsert: db.prepare(`
    INSERT INTO api_keys (telegram_id, api_key)
    VALUES (@telegram_id, @api_key)
    ON CONFLICT(telegram_id) DO UPDATE SET api_key = excluded.api_key
  `),

  get: db.prepare(`SELECT * FROM api_keys WHERE telegram_id = ?`),

  getByKey: db.prepare(`SELECT * FROM api_keys WHERE api_key = ?`),

  incrementRequests: db.prepare(`
    UPDATE api_keys SET total_requests = total_requests + 1 WHERE api_key = ?
  `),
};

export default db;
