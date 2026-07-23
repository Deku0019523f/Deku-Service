# Déploiement

Le backend a besoin d'un **disque persistant** (sessions WhatsApp + base
SQLite) et d'une **seule instance en cours d'exécution**. Ça oriente le choix
d'hébergement.

## Option 1 — VPS (recommandé, plus simple pour Baileys)

Un VPS classique (Hetzner, Contabo, DigitalOcean, un VPS local en Côte
d'Ivoire/Sénégal, etc.) convient très bien : disque persistant par défaut,
process long-running natif.

```bash
# Sur le VPS (Ubuntu/Debian)
sudo apt update && sudo apt install -y nodejs npm nginx
sudo npm install -g pm2

git clone <ton-repo> vendeur-whatsapp-ia
cd vendeur-whatsapp-ia/backend
cp .env.example .env
nano .env   # renseigne JWT_SECRET, GROQ_API_KEY, FRONTEND_ORIGIN
npm install

pm2 start server.js --name whatsapp-ia
pm2 save
pm2 startup   # suit l'instruction affichée pour démarrer pm2 au boot
```

**Nginx en reverse proxy** (`/etc/nginx/sites-available/whatsapp-ia`) :

```nginx
server {
    listen 80;
    server_name api.tonboutique.com;

    location / {
        proxy_pass http://localhost:4000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;   # requis pour Socket.io
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
    }
}
```

```bash
sudo ln -s /etc/nginx/sites-available/whatsapp-ia /etc/nginx/sites-enabled/
sudo certbot --nginx -d api.tonboutique.com   # HTTPS gratuit (Let's Encrypt)
sudo systemctl reload nginx
```

Le frontend (`frontend/`) peut être servi par le même Nginx (fichiers
statiques) ou déployé séparément (Netlify, Vercel, ou un dossier statique sur
le même VPS).

## Option 2 — Render

Possible, avec deux points d'attention :

1. **Ajoute un disque persistant** (Render → ton service → "Disks") monté sur
   `/opt/render/project/src/backend/data`, sinon les sessions WhatsApp et la
   base SQLite disparaissent à chaque redéploiement.
2. Render peut mettre le service en veille sur le plan gratuit : une
   connexion WhatsApp active a besoin que le process tourne en continu →
   plan payant "Web Service" (pas de mise en veille) requis en production.

Configuration du service Render :
- **Build command** : `cd backend && npm install`
- **Start command** : `cd backend && node server.js`
- Variables d'environnement : copie celles de `backend/.env.example`
- Ajoute un disque persistant pointant vers `backend/data`

## Variables d'environnement à définir en production

| Variable | Description |
|---|---|
| `PORT` | Port d'écoute (Render le fournit automatiquement) |
| `JWT_SECRET` | Chaîne aléatoire longue et secrète |
| `GROQ_API_KEY` | Clé API Groq pour les réponses IA |
| `GROQ_MODEL` | Modèle Groq utilisé (ex. `llama-3.3-70b-versatile`) |
| `FRONTEND_ORIGIN` | URL exacte du frontend déployé (CORS + Socket.io) |

## Frontend

`frontend/` ne nécessite aucun build : ce sont des fichiers statiques
(HTML/CSS/JS). Avant de déployer, dans `frontend/js/api.js`, adapte
`API_BASE`/`API_SOCKET_URL` si le backend n'est pas sur le même domaine que
le frontend en production.
