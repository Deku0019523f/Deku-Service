// src/whatsapp/handler.js
import fs from 'fs';
import path from 'path';
import os from 'os';
import { waDB, subDB, statsDB } from '../database/db.js';
import { generateResponse, transcribeAudio } from '../ai/groq.js';
import { checkAndConsumeLimit, sleep, randInt, truncate } from '../utils/helpers.js';
import {
  isInCooldown, setCooldown,
  isProcessing, setProcessing, releaseProcessing,
} from '../utils/rateLimit.js';
import logger from '../utils/logger.js';

// ── Chat Memory Store ─────────────────────────────────────────────────────────
const chatMemory = new Map();
const MAX_HISTORY = 50;

function getMemory(telegramId, accountIndex, jid) {
  const key = `${telegramId}_${accountIndex}_${jid}`;
  if (!chatMemory.has(key)) chatMemory.set(key, []);
  return chatMemory.get(key);
}

function pushMemory(telegramId, accountIndex, jid, role, content) {
  const mem = getMemory(telegramId, accountIndex, jid);
  mem.push({ role, content });
  while (mem.length > MAX_HISTORY) mem.shift();
}

// ── Extract text from message ─────────────────────────────────────────────────
function extractText(msg) {
  const m = msg.message;
  if (!m) return null;
  return (
    m.conversation ||
    m.extendedTextMessage?.text ||
    m.imageMessage?.caption ||
    m.videoMessage?.caption ||
    null
  );
}

function isAudioMessage(msg) {
  const m = msg.message;
  if (!m) return false;
  return !!(m.audioMessage || m.voiceNote || m.pttMessage);
}

// ── Download audio to temp file ───────────────────────────────────────────────
async function downloadAudio(sock, msg) {
  const tmpPath = path.join(os.tmpdir(), `wa_audio_${Date.now()}.ogg`);
  try {
    const buffer = await sock.downloadMediaMessage(msg, 'buffer');
    fs.writeFileSync(tmpPath, buffer);
    return tmpPath;
  } catch (err) {
    logger.error({ err }, 'Audio download failed');
    return null;
  }
}

// ── Owner commands ────────────────────────────────────────────────────────────
async function handleOwnerCommand(sock, msg, telegramId, accountIndex, text) {
  const jid = msg.key.remoteJid;
  const cmd = text.trim().toLowerCase();
  const reply = (content) => sock.sendMessage(jid, { text: content }, { quoted: msg });

  if (cmd === '.agent on') {
    waDB.setAgentEnabled.run(1, telegramId, accountIndex);
    waDB.setAgentPaused.run(0, telegramId, accountIndex);
    return reply('✅ Agent IA activé.');
  }
  if (cmd === '.agent off') {
    waDB.setAgentEnabled.run(0, telegramId, accountIndex);
    return reply('⏸️ Agent IA désactivé.');
  }
  if (cmd === '.statut') {
    const session = waDB.get.get(telegramId, accountIndex);
    const sub = subDB.get.get(telegramId);
    return reply(
      `📊 *Statut Agent*\n` +
      `• Activé: ${session?.agent_enabled ? '✅' : '❌'}\n` +
      `• Pausé: ${session?.agent_paused ? '⏸️' : '▶️'}\n` +
      `• Délai: ${session?.response_delay || 30}s\n` +
      `• Plan: ${sub?.plan || 'free'}\n` +
      `• Msgs aujourd'hui: ${sub?.messages_today || 0}`
    );
  }
  if (cmd.startsWith('.prompt ')) {
    const newPrompt = text.slice(8).trim();
    if (!newPrompt) return reply('❌ Fournissez un prompt. Ex: .prompt Tu es un vendeur de...');
    waDB.setPrompt.run(newPrompt, telegramId, accountIndex);
    return reply('✅ Prompt mis à jour.');
  }
  const tempsMatch = cmd.match(/^\.temps (\d+)s?$/);
  if (tempsMatch) {
    const delay = parseInt(tempsMatch[1]);
    if (delay < 5 || delay > 120) return reply('❌ Délai entre 5 et 120 secondes.');
    waDB.setDelay.run(delay, telegramId, accountIndex);
    return reply(`✅ Délai de réponse: ${delay}s`);
  }
}

// ── Main handler ──────────────────────────────────────────────────────────────
export async function handleWhatsAppMessage({ sock, msg, telegramId, accountIndex }) {
  if (msg.key.remoteJid === 'status@broadcast') return;

  // Handle owner commands sent from the linked device
  if (msg.key.fromMe) {
    const text = extractText(msg);
    if (text?.startsWith('.')) {
      await handleOwnerCommand(sock, msg, telegramId, accountIndex, text);
    }
    return;
  }

  const jid = msg.key.remoteJid;
  if (jid.endsWith('@g.us')) return; // DMs only

  // ── Load session & guards ─────────────────────────────────────────────────
  const session = waDB.get.get(telegramId, accountIndex);
  if (!session || !session.agent_enabled || session.agent_paused) return;

  const sub = subDB.get.get(telegramId);
  if (!sub || sub.is_blocked) return;

  // ── Extract content ───────────────────────────────────────────────────────
  let messageText = extractText(msg);
  let isVoice = false;

  if (!messageText && isAudioMessage(msg)) {
    isVoice = true;
    const audioPath = await downloadAudio(sock, msg);
    if (!audioPath) return;
    try {
      await sock.sendMessage(jid, { text: '🎤 Transcription en cours...' });
      messageText = await transcribeAudio(audioPath);
      logger.info({ telegramId, jid, preview: truncate(messageText, 60) }, 'Audio transcribed');
    } catch (err) {
      logger.error({ err }, 'Transcription error');
      return;
    }
  }

  if (!messageText?.trim()) return;

  // ── Concurrency & cooldown guards ─────────────────────────────────────────
  const rateKey = `${telegramId}_${accountIndex}_${jid}`;
  if (isProcessing(rateKey)) return; // duplicate message in-flight
  if (isInCooldown(rateKey)) return; // post-reply cooldown

  setProcessing(rateKey);

  try {
    // ── Usage limits ──────────────────────────────────────────────────────
    const { allowed } = checkAndConsumeLimit(telegramId, sub.plan);
    if (!allowed) return;

    // ── Human-like typing delay ───────────────────────────────────────────
    const baseDelay = (session.response_delay || 30);
    const jitter = randInt(-10, 10);
    const delayMs = Math.max(5000, (baseDelay + jitter) * 1000);

    await sock.sendPresenceUpdate('composing', jid);
    await sleep(delayMs);
    await sock.sendPresenceUpdate('paused', jid);

    // ── AI response ───────────────────────────────────────────────────────
    const history = getMemory(telegramId, accountIndex, jid);
    pushMemory(telegramId, accountIndex, jid, 'user', messageText);

    let aiResponse;
    try {
      aiResponse = await generateResponse({
        customPrompt: session.custom_prompt,
        products: session.products_json,
        history,
        message: messageText,
      });
    } catch (err) {
      logger.error({ err, telegramId }, 'AI error — skipping reply');
      return;
    }

    // ── Send & log ────────────────────────────────────────────────────────
    await sock.sendMessage(jid, { text: aiResponse });
    pushMemory(telegramId, accountIndex, jid, 'assistant', aiResponse);
    setCooldown(rateKey, 15); // 15s post-reply cooldown

    statsDB.insert.run({
      telegram_id: telegramId,
      session_id: session.id,
      event_type: 'ai_response',
      metadata: JSON.stringify({ jid, is_voice: isVoice, in: messageText.length, out: aiResponse.length }),
    });

    logger.debug({ telegramId, accountIndex, jid, isVoice }, 'AI reply sent ✓');

  } catch (err) {
    logger.error({ err, telegramId, jid }, 'Handler unhandled error');
  } finally {
    releaseProcessing(rateKey);
  }
}
