#!/usr/bin/env node
// scripts/setup.js — Run once after cloning: node scripts/setup.js
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { execSync } from 'child_process';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');

const GREEN  = '\x1b[32m';
const YELLOW = '\x1b[33m';
const RED    = '\x1b[31m';
const RESET  = '\x1b[0m';
const BOLD   = '\x1b[1m';

function ok(msg)   { console.log(`${GREEN}✓${RESET} ${msg}`); }
function warn(msg) { console.log(`${YELLOW}⚠${RESET} ${msg}`); }
function fail(msg) { console.log(`${RED}✗${RESET} ${msg}`); }
function title(msg){ console.log(`\n${BOLD}${msg}${RESET}`); }

let errors = 0;

title('━━━ WhatsApp SaaS Bot — Setup ━━━');

// ── 1. Node version ───────────────────────────────────────────────────────────
title('1. Checking Node.js version...');
const nodeVer = process.versions.node.split('.').map(Number);
if (nodeVer[0] >= 18) {
  ok(`Node.js ${process.versions.node}`);
} else {
  fail(`Node.js >= 18 required (found ${process.versions.node})`);
  errors++;
}

// ── 2. Create directories ─────────────────────────────────────────────────────
title('2. Creating directories...');
const dirs = ['data', 'sessions', 'assets', 'logs'];
for (const dir of dirs) {
  const fullPath = path.join(ROOT, dir);
  if (!fs.existsSync(fullPath)) {
    fs.mkdirSync(fullPath, { recursive: true });
    ok(`Created ${dir}/`);
  } else {
    ok(`${dir}/ already exists`);
  }
}

// ── 3. .env file ──────────────────────────────────────────────────────────────
title('3. Checking .env...');
const envPath = path.join(ROOT, '.env');
const envExamplePath = path.join(ROOT, '.env.example');

if (!fs.existsSync(envPath)) {
  if (fs.existsSync(envExamplePath)) {
    fs.copyFileSync(envExamplePath, envPath);
    warn('.env created from .env.example — EDIT IT with your credentials before starting!');
  } else {
    fail('.env not found and no .env.example to copy from');
    errors++;
  }
} else {
  ok('.env exists');
  // Check required vars
  const envContent = fs.readFileSync(envPath, 'utf8');
  const required = ['TELEGRAM_BOT_TOKEN', 'ADMIN_TELEGRAM_ID', 'GROQ_API_KEY'];
  for (const key of required) {
    if (!envContent.includes(`${key}=`) || envContent.includes(`${key}=your_`)) {
      warn(`${key} is not configured in .env`);
    } else {
      ok(`${key} ✓`);
    }
  }
}

// ── 4. Check assets/api-doc.pdf ───────────────────────────────────────────────
title('4. Checking assets...');
const pdfPath = path.join(ROOT, 'assets', 'api-doc.pdf');
if (fs.existsSync(pdfPath)) {
  ok('assets/api-doc.pdf exists');
} else {
  warn('assets/api-doc.pdf missing — API documentation PDF will not be sent to users');
  warn('Run: node scripts/generate-api-doc.js to auto-generate it');
}

// ── 5. node_modules ───────────────────────────────────────────────────────────
title('5. Checking dependencies...');
const nmPath = path.join(ROOT, 'node_modules');
if (fs.existsSync(nmPath)) {
  ok('node_modules exists');
} else {
  warn('node_modules not found — running npm install...');
  try {
    execSync('npm install', { cwd: ROOT, stdio: 'inherit' });
    ok('npm install completed');
  } catch {
    fail('npm install failed — run it manually');
    errors++;
  }
}

// ── Summary ───────────────────────────────────────────────────────────────────
console.log('\n' + '━'.repeat(40));
if (errors === 0) {
  console.log(`${GREEN}${BOLD}✅ Setup complete!${RESET}\n`);
  console.log('Next steps:');
  console.log('  1. Edit .env with your credentials');
  console.log('  2. node scripts/generate-api-doc.js  (optional PDF)');
  console.log('  3. npm start');
} else {
  console.log(`${RED}${BOLD}❌ Setup completed with ${errors} error(s)${RESET}`);
  console.log('Fix the issues above then try again.');
}
