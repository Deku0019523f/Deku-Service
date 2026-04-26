#!/usr/bin/env node
// scripts/generate-api-doc.js
// Generates assets/api-doc.pdf with the full API documentation.
// Uses puppeteer if available, otherwise writes a rich HTML file.

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');
const ASSETS_DIR = path.join(ROOT, 'assets');

if (!fs.existsSync(ASSETS_DIR)) fs.mkdirSync(ASSETS_DIR, { recursive: true });

// ── HTML content of the API doc ───────────────────────────────────────────────
const HTML = `<!DOCTYPE html>
<html lang="fr">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>WhatsApp SaaS Bot — API Documentation</title>
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: 'Segoe UI', Arial, sans-serif; color: #1a1a1a; background: #fff; padding: 40px; max-width: 800px; margin: 0 auto; }
  h1 { font-size: 28px; color: #25D366; border-bottom: 3px solid #25D366; padding-bottom: 12px; margin-bottom: 24px; }
  h2 { font-size: 20px; color: #128C7E; margin: 32px 0 12px; }
  h3 { font-size: 16px; color: #075E54; margin: 20px 0 8px; background: #f0fdf4; padding: 8px 12px; border-left: 4px solid #25D366; border-radius: 4px; }
  p { line-height: 1.7; margin-bottom: 10px; color: #333; }
  code { background: #f4f4f4; border: 1px solid #ddd; border-radius: 4px; padding: 2px 6px; font-family: 'Courier New', monospace; font-size: 13px; color: #c7254e; }
  pre { background: #1e1e1e; color: #d4d4d4; border-radius: 8px; padding: 16px; margin: 12px 0; overflow-x: auto; font-size: 13px; line-height: 1.6; }
  pre code { background: none; border: none; color: inherit; padding: 0; }
  .badge { display: inline-block; padding: 3px 10px; border-radius: 12px; font-size: 12px; font-weight: bold; margin-right: 6px; }
  .post { background: #dbeafe; color: #1d4ed8; }
  .auth { background: #fef9c3; color: #854d0e; }
  .pro  { background: #dcfce7; color: #166534; }
  table { width: 100%; border-collapse: collapse; margin: 12px 0; font-size: 14px; }
  th { background: #128C7E; color: white; padding: 10px 14px; text-align: left; }
  td { padding: 9px 14px; border-bottom: 1px solid #e5e7eb; }
  tr:nth-child(even) td { background: #f9fafb; }
  .section { margin-bottom: 40px; }
  footer { margin-top: 60px; padding-top: 20px; border-top: 1px solid #e5e7eb; color: #6b7280; font-size: 13px; text-align: center; }
</style>
</head>
<body>

<h1>🤖 WhatsApp SaaS Bot — API Documentation</h1>
<p>Cette API vous permet d'envoyer des messages WhatsApp automatiquement depuis votre application.</p>
<p><span class="badge pro">PRO & PREMIUM</span> Réservé aux abonnés Pro et Premium.</p>

<div class="section">
<h2>🔐 Authentification</h2>
<p>Toutes les requêtes nécessitent un header d'authentification :</p>
<pre><code>x-api-key: votre_cle_api_ici
Content-Type: application/json</code></pre>
<p>Récupérez votre clé API depuis le bot Telegram → <strong>🔑 Mon API</strong>.</p>
</div>

<div class="section">
<h2>📡 Endpoints</h2>

<h3><span class="badge post">POST</span> /api/send/text</h3>
<p>Envoyer un message texte.</p>
<table>
  <tr><th>Paramètre</th><th>Type</th><th>Requis</th><th>Description</th></tr>
  <tr><td><code>to</code></td><td>string</td><td>✅</td><td>Numéro de téléphone (avec indicatif, ex: 33612345678)</td></tr>
  <tr><td><code>message</code></td><td>string</td><td>✅</td><td>Texte à envoyer (max 4096 caractères)</td></tr>
</table>
<pre><code>curl -X POST https://votreserveur.com/api/send/text \\
  -H "x-api-key: VOTRE_CLE" \\
  -H "Content-Type: application/json" \\
  -d '{
    "to": "33612345678",
    "message": "Bonjour depuis l\\'API!"
  }'</code></pre>

<h3><span class="badge post">POST</span> /api/send/image</h3>
<p>Envoyer une image via URL.</p>
<table>
  <tr><th>Paramètre</th><th>Type</th><th>Requis</th><th>Description</th></tr>
  <tr><td><code>to</code></td><td>string</td><td>✅</td><td>Numéro destinataire</td></tr>
  <tr><td><code>url</code></td><td>string</td><td>✅</td><td>URL publique de l'image (JPG, PNG, WebP)</td></tr>
  <tr><td><code>caption</code></td><td>string</td><td>❌</td><td>Légende de l'image (max 1024 caractères)</td></tr>
</table>
<pre><code>curl -X POST https://votreserveur.com/api/send/image \\
  -H "x-api-key: VOTRE_CLE" \\
  -H "Content-Type: application/json" \\
  -d '{
    "to": "33612345678",
    "url": "https://exemple.com/image.jpg",
    "caption": "Votre produit du jour"
  }'</code></pre>

<h3><span class="badge post">POST</span> /api/send/audio</h3>
<p>Envoyer un message vocal (PTT).</p>
<table>
  <tr><th>Paramètre</th><th>Type</th><th>Requis</th><th>Description</th></tr>
  <tr><td><code>to</code></td><td>string</td><td>✅</td><td>Numéro destinataire</td></tr>
  <tr><td><code>url</code></td><td>string</td><td>✅</td><td>URL publique fichier audio (OGG recommandé)</td></tr>
</table>
<pre><code>curl -X POST https://votreserveur.com/api/send/audio \\
  -H "x-api-key: VOTRE_CLE" \\
  -H "Content-Type: application/json" \\
  -d '{"to": "33612345678", "url": "https://exemple.com/audio.ogg"}'</code></pre>

<h3><span class="badge post">POST</span> /api/send/file</h3>
<p>Envoyer un fichier / document.</p>
<table>
  <tr><th>Paramètre</th><th>Type</th><th>Requis</th><th>Description</th></tr>
  <tr><td><code>to</code></td><td>string</td><td>✅</td><td>Numéro destinataire</td></tr>
  <tr><td><code>url</code></td><td>string</td><td>✅</td><td>URL publique du fichier</td></tr>
  <tr><td><code>filename</code></td><td>string</td><td>❌</td><td>Nom d'affichage du fichier</td></tr>
  <tr><td><code>mimetype</code></td><td>string</td><td>❌</td><td>Type MIME (ex: application/pdf)</td></tr>
</table>
</div>

<div class="section">
<h2>📤 Format des réponses</h2>
<p><strong>Succès (200) :</strong></p>
<pre><code>{"success": true, "to": "33612345678@s.whatsapp.net"}</code></pre>
<p><strong>Erreur :</strong></p>
<pre><code>{"error": "Description de l'erreur"}</code></pre>
</div>

<div class="section">
<h2>⚠️ Codes d'erreur</h2>
<table>
  <tr><th>Code</th><th>Signification</th></tr>
  <tr><td><code>400</code></td><td>Paramètres invalides ou manquants</td></tr>
  <tr><td><code>401</code></td><td>API Key absente ou invalide</td></tr>
  <tr><td><code>403</code></td><td>Compte suspendu ou plan insuffisant</td></tr>
  <tr><td><code>429</code></td><td>Trop de requêtes (rate limit : 60/min)</td></tr>
  <tr><td><code>503</code></td><td>Session WhatsApp inactive</td></tr>
  <tr><td><code>500</code></td><td>Erreur serveur interne</td></tr>
</table>
</div>

<div class="section">
<h2>📊 Limites par plan</h2>
<table>
  <tr><th>Plan</th><th>Messages/jour IA</th><th>Messages/mois IA</th><th>API</th><th>Comptes WA</th></tr>
  <tr><td>🆓 Free</td><td>10</td><td>30</td><td>❌</td><td>1</td></tr>
  <tr><td>⭐ Pro</td><td>100</td><td>500</td><td>✅</td><td>3</td></tr>
  <tr><td>👑 Premium</td><td>Illimité</td><td>Illimité</td><td>✅</td><td>10</td></tr>
</table>
<p><em>Note: Les envois via API ne consomment pas les quotas IA. Ils sont illimités pour Pro et Premium.</em></p>
</div>

<footer>WhatsApp SaaS Bot — Powered by Baileys + Groq AI<br>Généré le ${new Date().toLocaleDateString('fr-FR')}</footer>
</body>
</html>`;

// ── Try puppeteer, fallback to HTML ───────────────────────────────────────────
async function generate() {
  const htmlPath = path.join(ASSETS_DIR, 'api-doc.html');
  fs.writeFileSync(htmlPath, HTML, 'utf8');
  console.log(`✅ HTML written: ${htmlPath}`);

  try {
    const { default: puppeteer } = await import('puppeteer');
    const browser = await puppeteer.launch({ args: ['--no-sandbox'] });
    const page = await browser.newPage();
    await page.setContent(HTML, { waitUntil: 'networkidle0' });
    const pdfPath = path.join(ASSETS_DIR, 'api-doc.pdf');
    await page.pdf({ path: pdfPath, format: 'A4', margin: { top: '20mm', bottom: '20mm', left: '15mm', right: '15mm' }, printBackground: true });
    await browser.close();
    console.log(`✅ PDF generated: ${pdfPath}`);
  } catch {
    console.log('⚠️  puppeteer not available — only HTML was generated.');
    console.log('   Install puppeteer: npm install puppeteer');
    console.log('   Or manually convert assets/api-doc.html to PDF');
    console.log('   The HTML version works fine as a standalone page.');
  }
}

generate().catch(console.error);
