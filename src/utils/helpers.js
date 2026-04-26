// src/utils/helpers.js
import { parsePhoneNumber, isValidPhoneNumber } from 'libphonenumber-js';
import { v4 as uuidv4 } from 'uuid';
import { subDB } from '../database/db.js';

// ── Plan Configuration ────────────────────────────────────────────────────────
export const PLANS = {
  free: {
    label: '🆓 Free',
    daily_limit: 10,
    monthly_limit: 30,
    max_accounts: 1,
    api_access: false,
  },
  pro: {
    label: '⭐ Pro',
    daily_limit: 100,
    monthly_limit: 500,
    max_accounts: 3,
    api_access: true,
  },
  premium: {
    label: '👑 Premium',
    daily_limit: Infinity,
    monthly_limit: Infinity,
    max_accounts: 10,
    api_access: true,
  },
};

// ── Phone Number Utilities ────────────────────────────────────────────────────

/**
 * Clean a phone number to digits only
 * Returns null if invalid
 */
export function cleanPhone(input) {
  if (!input) return null;
  // Remove everything except digits and leading +
  const cleaned = String(input).replace(/[^\d+]/g, '');
  return cleaned.replace(/\D/g, ''); // digits only
}

/**
 * Format phone for WhatsApp JID: digits + @s.whatsapp.net
 */
export function toWhatsAppJid(phone) {
  const digits = cleanPhone(phone);
  if (!digits) return null;
  return `${digits}@s.whatsapp.net`;
}

/**
 * Validate phone number with libphonenumber-js
 */
export function validatePhone(phone) {
  try {
    const cleaned = '+' + cleanPhone(phone);
    return isValidPhoneNumber(cleaned);
  } catch {
    return false;
  }
}

// ── API Key Generation ────────────────────────────────────────────────────────
export function generateApiKey() {
  return uuidv4().replace(/-/g, '').substring(0, 32);
}

// ── Usage / Limit Helpers ─────────────────────────────────────────────────────

/**
 * Reset daily/monthly counters if needed, then check limits.
 * Returns { allowed: boolean, reason: string }
 */
export function checkAndConsumeLimit(telegramId, plan) {
  // Reset counters if new day / new month
  subDB.resetDailyIfNeeded.run(telegramId);
  subDB.resetMonthlyIfNeeded.run(telegramId);

  const sub = subDB.get.get(telegramId);
  if (!sub) return { allowed: false, reason: 'no_subscription' };

  const limits = PLANS[plan] || PLANS.free;

  if (limits.daily_limit !== Infinity && sub.messages_today >= limits.daily_limit) {
    return { allowed: false, reason: 'daily_limit' };
  }

  if (limits.monthly_limit !== Infinity && sub.messages_month >= limits.monthly_limit) {
    return { allowed: false, reason: 'monthly_limit' };
  }

  // Consume
  subDB.increment.run(telegramId);
  return { allowed: true, reason: null };
}

// ── Delay Utilities ───────────────────────────────────────────────────────────

/**
 * Wait for ms milliseconds
 */
export function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Random int between min and max (inclusive)
 */
export function randInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

// ── Reconnection Delay Sequences ─────────────────────────────────────────────
export const NETWORK_DELAYS = [5000, 10000, 15000, 20000, 25000];
export const ERROR_DELAYS = [15000, 30000, 45000, 60000, 60000];

// ── String Helpers ────────────────────────────────────────────────────────────
export function truncate(str, len = 100) {
  if (!str) return '';
  return str.length > len ? str.substring(0, len) + '...' : str;
}

export function escapeMarkdown(text) {
  return String(text).replace(/[_*[\]()~`>#+\-=|{}.!]/g, '\\$&');
}

// ── Session Path ──────────────────────────────────────────────────────────────
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '../..');

export function getSessionPath(telegramId, accountIndex) {
  return path.join(ROOT, 'sessions', `user_${telegramId}`, `acc_${accountIndex}`);
}

export const ASSETS_DIR = path.join(ROOT, 'assets');

// ── Format helpers ────────────────────────────────────────────────────────────
export function formatNumber(n) {
  if (n === Infinity || n === null || n === undefined) return '∞';
  return n.toLocaleString();
}
