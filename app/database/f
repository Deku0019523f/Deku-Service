import chalk from 'chalk';

// ─────────────────────────────────────────────────────────────────────────────
//  CLI helpers  —  affichage terminal
// ─────────────────────────────────────────────────────────────────────────────

export function displayBanner() {
  console.clear();
  console.log(chalk.cyan(`
╔══════════════════════════════════════════════════════════════╗
║                                                              ║
║       🤖  WHATSAPP API AGENT  v2  —  Deku Service           ║
║                                                              ║
║   Transformez votre WhatsApp en API personnelle              ║
║   d'envoi de messages en quelques secondes.                  ║
║                                                              ║
╚══════════════════════════════════════════════════════════════╝
`));
}

// ── Erreur de configuration (config.js mal renseigné) ────────────────────────
export function displayConfigError(title, details) {
  console.log(chalk.red(`
╔══════════════════════════════════════════════════════════════╗
║  ❌  ERREUR DE CONFIGURATION                                 ║
╚══════════════════════════════════════════════════════════════╝
`));
  console.log(chalk.red(`  ▸ ${title}\n`));
  console.log(chalk.yellow(`  ${details.replace(/\n/g, '\n  ')}\n`));
  console.log(chalk.gray('  Fichier à modifier : config.js\n'));
}

// ── Code d'appairage ─────────────────────────────────────────────────────────
export function displayPairingCode(code) {
  console.log(chalk.green('\n╔══════════════════════════════════════════════════╗'));
  console.log(chalk.green('║   🔗  CODE D\'APPAIRAGE WHATSAPP                  ║'));
  console.log(chalk.green('╠══════════════════════════════════════════════════╣'));
  console.log(chalk.yellow(`║         ${chalk.bold.white(code.padEnd(40))}║`));
  console.log(chalk.green('╚══════════════════════════════════════════════════╝'));
  console.log(chalk.gray('\n👆 Dans WhatsApp :'));
  console.log(chalk.gray('   Paramètres → Appareils connectés → Connecter un appareil'));
  console.log(chalk.gray('   → Connecter avec numéro de téléphone\n'));
}

// ── Clé API ──────────────────────────────────────────────────────────────────
export function displayApiKey(apiKey) {
  console.log(chalk.green('\n✅ Connexion réussie !'));
  console.log(chalk.cyan('\n🔑 Votre clé API :'));
  console.log(chalk.bold.yellow(`\n   ${apiKey}\n`));
}

// ── Logger universel ─────────────────────────────────────────────────────────
export function log(level, message) {
  const timestamp = new Date().toLocaleTimeString('fr-FR');
  const prefix = {
    info:    chalk.blue(`[${timestamp}] ℹ️  `),
    success: chalk.green(`[${timestamp}] ✅ `),
    warn:    chalk.yellow(`[${timestamp}] ⚠️  `),
    error:   chalk.red(`[${timestamp}] ❌ `),
  }[level] || chalk.white(`[${timestamp}] `);
  console.log(prefix + message);
}
