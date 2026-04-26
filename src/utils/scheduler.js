// src/utils/scheduler.js
import { subDB, userDB, waDB, statsDB } from '../database/db.js';
import { PLANS, formatNumber } from './helpers.js';
import logger from './logger.js';

let _bot = null;
let _intervals = [];

export function setSchedulerBot(bot) {
  _bot = bot;
}

// ── Notify admin ──────────────────────────────────────────────────────────────
function notifyAdmin(text) {
  const adminId = parseInt(process.env.ADMIN_TELEGRAM_ID || '0');
  if (_bot && adminId) {
    _bot.sendMessage(adminId, text, { parse_mode: 'HTML' }).catch(() => {});
  }
}

// ── Check and downgrade expired subscriptions ─────────────────────────────────
function checkSubscriptionExpiry() {
  try {
    // Find all pro/premium users where expires_at is set and has passed
    const expired = subDB.findExpired?.all?.() || [];

    for (const sub of expired) {
      subDB.setPlan.run('free', null, sub.telegram_id);
      logger.info({ telegramId: sub.telegram_id }, 'Subscription expired → downgraded to free');

      if (_bot) {
        _bot.sendMessage(
          sub.telegram_id,
          `⚠️ <b>Abonnement expiré</b>\n\nVotre abonnement <b>${sub.plan}</b> a expiré.\nVous êtes repassé en plan Free.\n\nContactez l'admin pour renouveler.`,
          { parse_mode: 'HTML' }
        ).catch(() => {});
      }
    }

    if (expired.length > 0) {
      notifyAdmin(`⚠️ <b>${expired.length} abonnement(s) expiré(s)</b> et downgraded to Free.`);
    }
  } catch (err) {
    logger.error({ err }, 'Subscription expiry check error');
  }
}

// ── Daily report to admin at midnight ────────────────────────────────────────
function sendDailyReport() {
  try {
    const totalUsers = userDB.count.get().count;
    const connected = waDB.countConnected.get().count;
    const todayMsgs = statsDB.todayMessages.get().count;
    const planCounts = subDB.countByPlan.all();
    const planMap = {};
    for (const p of planCounts) planMap[p.plan] = p.count;

    const report =
      `📊 <b>Rapport Quotidien</b>\n` +
      `📅 ${new Date().toLocaleDateString('fr-FR')}\n\n` +
      `👥 Users total: ${totalUsers}\n` +
      `📱 WA connectés: ${connected}\n` +
      `💬 Messages IA aujourd'hui: ${todayMsgs}\n\n` +
      `💳 Abonnements:\n` +
      `  🆓 Free: ${planMap.free || 0}\n` +
      `  ⭐ Pro: ${planMap.pro || 0}\n` +
      `  👑 Premium: ${planMap.premium || 0}`;

    notifyAdmin(report);
    logger.info('Daily report sent to admin');
  } catch (err) {
    logger.error({ err }, 'Daily report error');
  }
}

// ── Purge orphaned session directories ───────────────────────────────────────
async function cleanOrphanedSessions() {
  try {
    const fs = await import('fs');
    const path = await import('path');
    const { fileURLToPath } = await import('url');

    const __dirname = path.dirname(fileURLToPath(import.meta.url));
    const sessionsRoot = path.join(__dirname, '../../sessions');

    if (!fs.existsSync(sessionsRoot)) return;

    const userDirs = fs.readdirSync(sessionsRoot);

    for (const dir of userDirs) {
      // dir format: user_<telegramId>
      const match = dir.match(/^user_(\d+)$/);
      if (!match) continue;

      const telegramId = parseInt(match[1]);
      const user = userDB.get.get(telegramId);

      if (!user) {
        // User no longer exists — remove entire user session dir
        const fullPath = path.join(sessionsRoot, dir);
        fs.rmSync(fullPath, { recursive: true, force: true });
        logger.info({ telegramId, dir }, 'Purged orphaned session directory');
      }
    }
  } catch (err) {
    logger.error({ err }, 'Session cleanup error');
  }
}

// ── ms until next midnight ────────────────────────────────────────────────────
function msUntilMidnight() {
  const now = new Date();
  const midnight = new Date(now);
  midnight.setHours(24, 0, 0, 0);
  return midnight.getTime() - now.getTime();
}

// ── Start all scheduled tasks ─────────────────────────────────────────────────
export function startScheduler() {
  logger.info('⏰ Starting scheduler...');

  // 1. Check subscription expiry every hour
  const expiryInterval = setInterval(checkSubscriptionExpiry, 60 * 60 * 1000);
  _intervals.push(expiryInterval);
  // Run once immediately
  checkSubscriptionExpiry();

  // 2. Daily report at midnight
  const timeToMidnight = msUntilMidnight();
  setTimeout(() => {
    sendDailyReport();
    // Then every 24h
    const dailyInterval = setInterval(sendDailyReport, 24 * 60 * 60 * 1000);
    _intervals.push(dailyInterval);
  }, timeToMidnight);

  logger.info({ nextMidnight: `${Math.round(timeToMidnight / 1000 / 60)} min` }, 'Daily report scheduled');

  // 3. Orphaned session cleanup every 6 hours
  const cleanupInterval = setInterval(cleanOrphanedSessions, 6 * 60 * 60 * 1000);
  _intervals.push(cleanupInterval);

  logger.info('✅ Scheduler started (expiry: 1h, report: daily, cleanup: 6h)');
}

// ── Stop all tasks on shutdown ────────────────────────────────────────────────
export function stopScheduler() {
  for (const interval of _intervals) clearInterval(interval);
  _intervals = [];
  logger.info('Scheduler stopped');
}
