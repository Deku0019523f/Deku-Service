# Vendeur WhatsApp IA

Plateforme autonome permettant à des vendeurs de connecter leur compte WhatsApp
pour qu'une IA réponde automatiquement à leurs clients, avec suivi complet dans
un dashboard (conversations, produits, commandes détectées).

## Structure

```
backend/     API Node.js/Express + Baileys (WhatsApp) + Groq (IA) + Socket.io
frontend/    Dashboard HTML/CSS/JS (sans build) — login, connexion WhatsApp, conversations, produits
```

## Démarrage rapide (local)

```bash
cd backend
cp .env.example .env    # renseigne au minimum GROQ_API_KEY et JWT_SECRET
npm install
npm start
```

Puis ouvre `frontend/index.html` dans un navigateur (ou sers-le avec
`npx serve frontend`). Par défaut le frontend pointe vers
`http://localhost:4000` quand il tourne sur `localhost`.

## Documentation

- [`DEPLOIEMENT.md`](./DEPLOIEMENT.md) — héberger sur Render ou un VPS
- [`API.md`](./API.md) — référence complète de l'API + comment l'intégrer
  dans ton site/plateforme existante (façon Chariow)

## Points importants avant mise en production

- **Stockage persistant obligatoire** : les sessions WhatsApp (`backend/data/sessions/`)
  et la base SQLite (`backend/data/app.db`) doivent survivre aux redéploiements,
  sinon tous les vendeurs devront rescanner leur QR code à chaque déploiement.
- **Une seule instance à la fois** : Baileys maintient une connexion WebSocket
  persistante par vendeur. Ne fais pas tourner deux instances du backend en
  parallèle (pas de scaling horizontal simple) sans revoir l'architecture.
- **Clé Groq** : obligatoire pour que l'IA réponde (https://console.groq.com).
