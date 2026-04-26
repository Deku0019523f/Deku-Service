// ─────────────────────────────────────────────────────────────────────────────
//  app/agent/index.js  —  Agent IA Groq
//
//  Commandes WhatsApp :
//    .agent on/off         → activer/désactiver l'agent
//    .prompt <texte>       → définir le prompt système
//    .statut               → état du serveur (logo + texte)
//    .temps <Ns>           → délai avant réponse (ex: .temps 20s)
//
//  Modèles texte (rotation à chaque message) :
//    meta-llama/llama-4-scout-17b-16e-instruct
//    llama-3.1-8b-instant
//    llama-3.3-70b-versatile
//
//  Modèle vocal : whisper-large-v3
// ─────────────────────────────────────────────────────────────────────────────

import fs   from 'fs';
import path from 'path';
import { log } from '../cli/index.js';

const STATE_FILE = './sessions/agent-state.json';

// ── Modèles texte en rotation ─────────────────────────────────────────────────
const TEXT_MODELS = [
  'meta-llama/llama-4-scout-17b-16e-instruct',
  'llama-3.1-8b-instant',
  'llama-3.3-70b-versatile',
];
const VOICE_MODEL = 'whisper-large-v3';

// ── État par défaut ───────────────────────────────────────────────────────────
const DEFAULT_STATE = {
  enabled:      false,
  modelIndex:   0,
  replyDelayMs: 0,
  systemPrompt: `Tu es un assistant WhatsApp intelligent et serviable. Réponds de façon concise, naturelle et utile. Utilise des emojis avec modération. Réponds dans la langue de l'utilisateur.`,
  startedAt:    null,
};

// ── Chargement / sauvegarde de l'état ────────────────────────────────────────
function loadState() {
  try {
    if (fs.existsSync(STATE_FILE)) {
      return { ...DEFAULT_STATE, ...JSON.parse(fs.readFileSync(STATE_FILE, 'utf8')) };
    }
  } catch {}
  return { ...DEFAULT_STATE };
}

function saveState(state) {
  try {
    fs.mkdirSync(path.dirname(STATE_FILE), { recursive: true });
    fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
  } catch (err) {
    log('error', `Erreur sauvegarde état agent : ${err.message}`);
  }
}

let agentState = loadState();

// ── Accesseurs publics ────────────────────────────────────────────────────────
export function isAgentEnabled()  { return agentState.enabled; }
export function getAgentPrompt()  { return agentState.systemPrompt; }
export function getAgentDelay()   { return agentState.replyDelayMs; }
export function getAgentState()   { return { ...agentState }; }

export function setAgentEnabled(enabled) {
  agentState.enabled   = enabled;
  agentState.startedAt = enabled ? new Date().toISOString() : null;
  saveState(agentState);
  log(enabled ? 'success' : 'warn', `Agent IA ${enabled ? 'activé' : 'désactivé'}`);
}

export function setAgentPrompt(prompt) {
  agentState.systemPrompt = prompt.trim();
  saveState(agentState);
  log('success', 'Prompt agent mis à jour');
}

/**
 * Définit le délai de réponse.
 * @param {string} input — ex: "20s", "5s", "0"
 * @returns {number} délai en ms, ou -1 si format invalide
 */
export function setAgentDelay(input) {
  const match = String(input).trim().match(/^(\d+)(s)?$/i);
  if (!match) return -1;
  const ms = parseInt(match[1], 10) * 1000;
  agentState.replyDelayMs = ms;
  saveState(agentState);
  log('success', `Délai de réponse mis à jour : ${match[1]}s`);
  return ms;
}

// ── Rotation du modèle ────────────────────────────────────────────────────────
function nextModel() {
  const model = TEXT_MODELS[agentState.modelIndex % TEXT_MODELS.length];
  agentState.modelIndex = (agentState.modelIndex + 1) % TEXT_MODELS.length;
  saveState(agentState);
  return model;
}

// ── Historique par conversation ───────────────────────────────────────────────
const conversationHistory = new Map();

function getHistory(jid) {
  if (!conversationHistory.has(jid)) conversationHistory.set(jid, []);
  return conversationHistory.get(jid);
}

function addToHistory(jid, role, content) {
  const hist = getHistory(jid);
  hist.push({ role, content });
  if (hist.length > 20) hist.splice(0, hist.length - 20);
}

// ── Transcription vocale (Whisper via Groq) ───────────────────────────────────
export async function transcribeAudio(audioBuffer, mimeType = 'audio/ogg') {
  const GROQ_API_KEY = process.env.GROQ_API_KEY;
  if (!GROQ_API_KEY) throw new Error('GROQ_API_KEY manquante dans .env');

  const extMap = {
    'audio/ogg':  'ogg',
    'audio/mpeg': 'mp3',
    'audio/mp4':  'm4a',
    'audio/webm': 'webm',
    'audio/wav':  'wav',
  };
  const ext     = extMap[mimeType] || 'ogg';
  const tmpFile = `/tmp/wa_voice_${Date.now()}.${ext}`;
  fs.writeFileSync(tmpFile, audioBuffer);

  try {
    const formData = new globalThis.FormData();
    const blob     = new globalThis.Blob([audioBuffer], { type: mimeType });
    formData.append('file', blob, `audio.${ext}`);
    formData.append('model', VOICE_MODEL);
    formData.append('response_format', 'json');

    const res = await fetch('https://api.groq.com/openai/v1/audio/transcriptions', {
      method:  'POST',
      headers: { Authorization: `Bearer ${GROQ_API_KEY}` },
      body:    formData,
    });

    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`Groq Whisper ${res.status}: ${errText}`);
    }

    const data = await res.json();
    return data.text?.trim() || '';
  } finally {
    if (fs.existsSync(tmpFile)) fs.unlinkSync(tmpFile);
  }
}

// ── Réponse texte via Groq (LLM) ─────────────────────────────────────────────
export async function generateReply(userMessage, jid = 'default') {
  const GROQ_API_KEY = process.env.GROQ_API_KEY;
  if (!GROQ_API_KEY) throw new Error('GROQ_API_KEY manquante dans .env');

  if (agentState.replyDelayMs > 0) {
    await new Promise(r => setTimeout(r, agentState.replyDelayMs));
  }

  const model   = nextModel();
  const history = getHistory(jid);

  log('info', `Agent IA → modèle : ${model}${agentState.replyDelayMs > 0 ? ` | délai : ${agentState.replyDelayMs / 1000}s` : ''}`);

  const messages = [
    { role: 'system', content: agentState.systemPrompt },
    ...history,
    { role: 'user', content: userMessage },
  ];

  const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
    method:  'POST',
    headers: {
      Authorization:  `Bearer ${GROQ_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ model, messages, max_tokens: 1024, temperature: 0.7 }),
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Groq API ${res.status}: ${errText}`);
  }

  const data  = await res.json();
  const reply = data.choices?.[0]?.message?.content?.trim() || '❌ Pas de réponse générée.';

  addToHistory(jid, 'user',      userMessage);
  addToHistory(jid, 'assistant', reply);

  return { reply, model };
}
