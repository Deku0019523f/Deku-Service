# 🤖 WhatsApp SaaS Bot

Plateforme SaaS complète : Telegram comme dashboard, WhatsApp comme canal de communication, API REST pour l'automatisation.

## ⚡ Stack

| Composant | Technologie |
|-----------|-------------|
| Bot Telegram | node-telegram-bot-api |
| WhatsApp | Baileys (pairing code) |
| IA | Groq (5 modèles random) |
| Audio | Whisper Large v3 |
| DB | SQLite (better-sqlite3) |
| API | Express + Zod + rate-limit |
| Logs | Pino |

---

## 🚀 Installation

```bash
# 1. Clone / dézipper le projet
npm run setup         # Crée les dossiers, copie .env.example → .env

# 2. Éditer .env
nano .env

# 3. Installer les dépendances
npm install

# 4. (Optionnel) Générer la doc PDF
npm run gen-pdf

# 5. Démarrer
npm start
```

---

## ⚙️ Variables .env

```env
TELEGRAM_BOT_TOKEN=   # Via @BotFather
ADMIN_TELEGRAM_ID=    # Via @userinfobot
GROQ_API_KEY=         # console.groq.com
API_PORT=3000
NODE_ENV=production
LOG_LEVEL=info
```

---

## 📁 Structure

```
whatsapp-saas/
├── src/
│   ├── index.js              # Bootstrap
│   ├── ai/
│   │   └── groq.js           # Chat + Whisper + formatProducts
│   ├── api/
│   │   └── server.js         # API REST Express
│   ├── bot/
│   │   ├── telegram.js       # Init bot
│   │   └── handlers/
│   │       ├── admin.js      # Panel admin complet
│   │       ├── adminCommands.js # /setsub /resetapi /stats /bc
│   │       └── user.js       # Panel utilisateur complet
│   ├── database/
│   │   └── db.js             # SQLite + toutes les queries
│   ├── utils/
│   │   ├── helpers.js        # Phone, plans, limits, sleep
│   │   ├── logger.js         # Pino
│   │   ├── rateLimit.js      # NodeCache rate limiting
│   │   └── scheduler.js      # Expiry, daily report, cleanup
│   └── whatsapp/
│       ├── manager.js        # Sessions multi-comptes, reconnexion
│       └── handler.js        # Messages, commandes, IA, audio
├── scripts/
│   ├── setup.js              # Script d'installation
│   └── generate-api-doc.js  # Génère assets/api-doc.pdf
├── assets/
│   └── api-doc.pdf           # Doc envoyée aux utilisateurs PRO
├── data/
│   └── saas.db               # Base SQLite (auto-créée)
├── sessions/
│   └── user_123/acc_1/       # Sessions Baileys
├── ecosystem.config.cjs      # Config PM2
└── .env
```

---

## 🎮 Commandes Telegram — Utilisateurs

| Bouton | Action |
|--------|--------|
| 📱 Connecter WhatsApp | Connexion via pairing code |
| 🧠 Configurer IA | Prompt personnalisé + délai |
| 📦 Produits JSON | Upload catalogue (structuré par IA) |
| 🔑 Mon API | API key + doc PDF (Pro/Premium) |
| 📊 Mon abonnement | Limites + plan |
| ⏸️ Pause / ▶️ Activer | Toggle agent IA |

---

## 👑 Commandes Admin

### Telegram
```
/admin          → Panel admin (dashboard, users, stats)
/user <id>      → Détail utilisateur
/setsub <id> <plan> [jours]  → Changer abonnement
/resetapi <id>  → Régénérer clé API
/stats          → Statistiques rapides
/bc <message>   → Broadcast immédiat
```

### Panel interactif
- 📊 Dashboard en temps réel
- 👥 Liste paginée des utilisateurs
- 💳 Résumé abonnements
- 📱 Sessions WhatsApp actives
- 🔍 Recherche par ID ou nom
- 🚫 Bloquer / 🔓 Débloquer
- ⭐ Changer plan directement
- 📢 Broadcast avec confirmation

---

## 🤖 Commandes WhatsApp (Owner)

Envoyez ces commandes depuis votre téléphone lié :

```
.agent on       → Activer l'agent IA
.agent off      → Désactiver l'agent IA
.prompt <texte> → Changer le prompt système
.temps <Ns>     → Changer le délai (ex: .temps 45s)
.statut         → Voir l'état de l'agent
```

---

## 📡 API REST

### Authentification
```
Header: x-api-key: VOTRE_CLE
Header: Content-Type: application/json
```

### Endpoints
```
POST /api/send/text   → { to, message }
POST /api/send/image  → { to, url, caption? }
POST /api/send/audio  → { to, url }
POST /api/send/file   → { to, url, filename?, mimetype? }
GET  /health          → Status check
```

### Rate limit
60 requêtes/minute par clé API.

---

## 💳 Plans

| Plan | Msgs/jour | Msgs/mois | API | Comptes WA |
|------|-----------|-----------|-----|------------|
| 🆓 Free | 10 | 30 | ❌ | 1 |
| ⭐ Pro | 100 | 500 | ✅ | 3 |
| 👑 Premium | ∞ | ∞ | ✅ | 10 |

---

## 🔁 Reconnexion automatique

**Erreurs réseau** : 5s → 10s → 15s → 20s → 25s  
**Autres erreurs** : 15s → 30s → 45s → 60s → 60s  
**Max 5 tentatives** → notification Telegram + arrêt

---

## 🗄️ Base de données

Tables SQLite :
- `users` — Profils Telegram
- `subscriptions` — Plans + compteurs quotidiens/mensuels
- `whatsapp_sessions` — Config par session (prompt, produits, délai...)
- `stats` — Logs d'événements
- `api_keys` — Clés API avec compteur de requêtes

---

## 📦 Production (PM2)

```bash
npm install -g pm2
pm2 start ecosystem.config.cjs
pm2 save
pm2 startup
```

## 📦 Production (Pterodactyl)

- **Egg** : Node.js
- **Node version** : ≥ 18
- **Start command** : `npm start`
- **Variables** : définir dans l'onglet Startup

---

## ⏰ Tâches automatiques

| Tâche | Fréquence |
|-------|-----------|
| Vérification expiry abonnements | Toutes les heures |
| Rapport quotidien admin | Minuit |
| Nettoyage sessions orphelines | Toutes les 6h |
