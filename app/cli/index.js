import readlineSync from 'readline-sync';
import chalk from 'chalk';

export function displayBanner() {
  console.clear();
  console.log(chalk.cyan(`
╔══════════════════════════════════════════════════════════════╗
║                                                              ║
║        🤖  WHATSAPP API AGENT  —  Onboarding CLI            ║
║                                                              ║
║   Transformez votre WhatsApp en API personnelle              ║
║   d'envoi de messages en quelques secondes.                  ║
║                                                              ║
╚══════════════════════════════════════════════════════════════╝
`));
}

export function askPhoneNumber() {
  console.log(chalk.yellow('\n📱 Entrez votre numéro WhatsApp :'));
  console.log(chalk.gray('   Format attendu : 2250712345678 (sans +, sans espaces)'));
  console.log(chalk.gray('   Exemple CI      : 2250712345678\n'));

  const input = readlineSync.question(chalk.white('> Numéro : '));
  return input.trim();
}

export function validatePhoneNumber(number) {
  // Must be digits only, no +, no spaces, no special chars
  const regex = /^\d{7,15}$/;
  if (!regex.test(number)) {
    console.log(chalk.red('\n❌ Numéro invalide !'));
    console.log(chalk.red('   • Ne doit contenir que des chiffres'));
    console.log(chalk.red('   • Pas de "+" au début'));
    console.log(chalk.red('   • Pas d\'espaces ou tirets'));
    console.log(chalk.red('   • Exemple valide : 2250712345678\n'));
    return false;
  }
  return true;
}

export function displayPairingCode(code) {
  console.log(chalk.green('\n╔══════════════════════════════════════╗'));
  console.log(chalk.green('║   🔗  CODE D\'APPAIRAGE WHATSAPP       ║'));
  console.log(chalk.green('╠══════════════════════════════════════╣'));
  console.log(chalk.yellow(`║         ${chalk.bold.white(code.padEnd(28))}║`));
  console.log(chalk.green('╚══════════════════════════════════════╝'));
  console.log(chalk.gray('\n👆 Dans WhatsApp :'));
  console.log(chalk.gray('   Paramètres → Appareils connectés → Connecter un appareil'));
  console.log(chalk.gray('   → Connecter avec numéro de téléphone\n'));
}

export function displayApiKey(apiKey) {
  console.log(chalk.green('\n✅ Connexion réussie !'));
  console.log(chalk.cyan('\n🔑 Votre clé API :'));
  console.log(chalk.bold.yellow(`\n   ${apiKey}\n`));
}

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
