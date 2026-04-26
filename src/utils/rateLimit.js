// src/utils/rateLimit.js
/**
 * Per-contact in-memory rate limiter for WhatsApp AI responses.
 * Prevents the bot from replying too quickly to the same contact
 * if multiple messages arrive in rapid succession (debounce).
 *
 * Also tracks "currently processing" to avoid duplicate concurrent responses.
 */
import NodeCache from 'node-cache';

// TTL = 5 minutes for "cooldown" keys
const cooldownCache = new NodeCache({ stdTTL: 300, checkperiod: 60 });

// Currently processing set (avoid concurrent duplicate replies)
const processingSet = new Set();

/**
 * Check if a contact is in cooldown (was just replied to)
 * @param {string} key - unique key e.g. `${telegramId}_${jid}`
 * @param {number} ttlSeconds - how long the cooldown lasts (default 10s)
 */
export function isInCooldown(key, ttlSeconds = 10) {
  return cooldownCache.has(key);
}

/**
 * Set a contact into cooldown after a reply was sent
 */
export function setCooldown(key, ttlSeconds = 10) {
  cooldownCache.set(key, true, ttlSeconds);
}

/**
 * Check if a message for this contact is already being processed
 */
export function isProcessing(key) {
  return processingSet.has(key);
}

/**
 * Mark a contact as being processed
 */
export function setProcessing(key) {
  processingSet.add(key);
}

/**
 * Release the processing lock
 */
export function releaseProcessing(key) {
  processingSet.delete(key);
}

/**
 * API key rate limiting: track requests per minute per api key
 * Returns true if allowed, false if limit exceeded
 */
const apiRateCache = new NodeCache({ stdTTL: 60, checkperiod: 10 });

export function checkApiRate(apiKey, limitPerMinute = 60) {
  const current = apiRateCache.get(apiKey) || 0;
  if (current >= limitPerMinute) return false;
  apiRateCache.set(apiKey, current + 1, undefined); // keep existing TTL
  return true;
}
