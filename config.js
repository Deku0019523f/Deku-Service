// ─────────────────────────────────────────────────────────────────────────────
//  config.js  —  Configuration du WhatsApp API Agent v2
//  👉 C'est le SEUL fichier que vous devez modifier avant de déployer.
// ─────────────────────────────────────────────────────────────────────────────

export const config = {
  // ── 📱 Numéro WhatsApp ──────────────────────────────────────────────────────
  //  Format : indicatif pays + numéro, SANS "+", SANS espaces, SANS tirets
  //  Exemples :
  //    Côte d'Ivoire  → "2250712345678"
  //    France         → "33612345678"
  //    Sénégal        → "221771234567"
  phoneNumber: "2250718623773",

  // ── ⚙️ Options avancées ─────────────────────────────────────────────────────
  //  Port HTTP (keepalive). Render/Heroku injectent automatiquement $PORT.
  //  Laissez null pour utiliser la variable d'environnement $PORT (recommandé).
  port: null,

  //  Langue des logs dans le terminal ("fr" ou "en")
  lang: "fr",

  //  Nom affiché dans les messages WhatsApp envoyés à l'utilisateur
  agentName: "WhatsApp API Agent",
};
