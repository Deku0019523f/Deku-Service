// src/ai/groq.js
import Groq from 'groq-sdk';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { sleep } from '../utils/helpers.js';
import logger from '../utils/logger.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

// ── Model Pool (random per request) ──────────────────────────────────────────
const MODELS = [
  'llama-3.3-70b-versatile',
  'llama-3.1-8b-instant',
  'openai/gpt-oss-120b',
  'meta-llama/llama-4-scout-17b-16e-instruct',
  'openai/gpt-oss-safeguard-20b',
];

function pickModel() {
  return MODELS[Math.floor(Math.random() * MODELS.length)];
}

// ── System Prompt Builder ─────────────────────────────────────────────────────
function buildSystemPrompt(customPrompt, products) {
  const base = customPrompt?.trim()
    ? customPrompt.trim()
    : `Tu es un assistant commercial WhatsApp professionnel. Réponds de façon courte, naturelle et utile. 
Ne réponds jamais en dehors du sujet commercial. Sois chaleureux mais efficace.`;

  let productSection = '';
  if (products && products.length > 0) {
    try {
      const parsed = typeof products === 'string' ? JSON.parse(products) : products;
      if (Array.isArray(parsed) && parsed.length > 0) {
        productSection = `\n\n📦 CATALOGUE PRODUITS :\n${JSON.stringify(parsed, null, 2)}`;
      }
    } catch {
      // ignore malformed JSON
    }
  }

  return `${base}${productSection}

RÈGLES :
- Réponses courtes (max 3 phrases)
- Ton WhatsApp naturel, pas formel
- Utilise les infos produits si pertinent
- Ne mentionne jamais que tu es une IA`;
}

// ── Chat Completion ───────────────────────────────────────────────────────────

/**
 * Generate an AI response
 * @param {Object} options
 * @param {string} options.customPrompt - Custom system prompt from user
 * @param {string|Array} options.products - Products JSON
 * @param {Array} options.history - Chat history [{role, content}]
 * @param {string} options.message - Current user message
 * @returns {Promise<string>} AI response text
 */
export async function generateResponse({ customPrompt, products, history = [], message }) {
  const model = pickModel();
  const systemPrompt = buildSystemPrompt(customPrompt, products);

  // Build messages: system + last 50 history + current
  const trimmedHistory = history.slice(-48); // leave room for system + new msg
  const messages = [
    { role: 'system', content: systemPrompt },
    ...trimmedHistory,
    { role: 'user', content: message },
  ];

  try {
    const response = await groq.chat.completions.create({
      model,
      messages,
      max_tokens: 500,
      temperature: 0.7,
    });

    const text = response.choices?.[0]?.message?.content?.trim();
    if (!text) throw new Error('Empty response from Groq');

    logger.debug({ model, tokens: response.usage?.total_tokens }, 'Groq response');
    return text;
  } catch (err) {
    logger.error({ err, model }, 'Groq chat error');
    // Fallback: try another model once
    if (err.status === 429 || err.status === 503) {
      await sleep(2000);
      const fallbackModel = MODELS.find((m) => m !== model) || MODELS[0];
      const fallback = await groq.chat.completions.create({
        model: fallbackModel,
        messages,
        max_tokens: 500,
        temperature: 0.7,
      });
      return fallback.choices?.[0]?.message?.content?.trim() || '...';
    }
    throw err;
  }
}

// ── Format Products via AI ────────────────────────────────────────────────────

/**
 * Takes raw user JSON and asks AI to normalize/structure it for storage
 */
export async function formatProductsWithAI(rawContent) {
  const model = pickModel();

  const response = await groq.chat.completions.create({
    model,
    messages: [
      {
        role: 'system',
        content: `Tu es un assistant qui structure des données produits en JSON propre.
Retourne UNIQUEMENT un tableau JSON valide d'objets produits avec les champs : 
name, description, price, category (si disponible).
Aucun texte avant ou après. Juste le JSON.`,
      },
      {
        role: 'user',
        content: `Voici les données brutes à structurer :\n\n${rawContent}`,
      },
    ],
    max_tokens: 2000,
    temperature: 0.3,
  });

  const raw = response.choices?.[0]?.message?.content?.trim() || '[]';

  // Strip markdown code fences if present
  const cleaned = raw.replace(/^```(?:json)?\n?/i, '').replace(/\n?```$/i, '').trim();

  try {
    const parsed = JSON.parse(cleaned);
    return Array.isArray(parsed) ? parsed : [parsed];
  } catch {
    logger.warn({ raw }, 'Failed to parse AI-formatted products');
    return [];
  }
}

// ── Whisper Transcription ─────────────────────────────────────────────────────

/**
 * Transcribe an audio file using Groq Whisper
 * @param {string} filePath - Local file path
 * @returns {Promise<string>} Transcription text
 */
export async function transcribeAudio(filePath) {
  if (!fs.existsSync(filePath)) {
    throw new Error(`Audio file not found: ${filePath}`);
  }

  const stream = fs.createReadStream(filePath);

  try {
    const result = await groq.audio.transcriptions.create({
      file: stream,
      model: 'whisper-large-v3',
      response_format: 'text',
    });

    return typeof result === 'string' ? result.trim() : result?.text?.trim() || '';
  } finally {
    // Always clean up temp file
    try {
      fs.unlinkSync(filePath);
    } catch {
      // ignore cleanup errors
    }
  }
}
