# 🤖 WhatsApp API Agent — v2

> Transformez votre compte WhatsApp en API personnelle d'envoi de messages.  
> Déployable en **1 minute** sur Render, Railway, un VPS ou en local.

---

## ✨ Nouveautés v2

| v1 | v2 |
|---|---|
| Saisie du numéro au lancement | ✅ Numéro défini dans `config.js` |
| Demande interactive en terminal | ✅ Zéro interaction — le code s'affiche automatiquement |
| Référence à `localhost:3000` | ✅ Fonctionne sur Render / VPS / local |
| README basique | ✅ Guide complet avec déploiement pas à pas |

---

## ⚡ Démarrage rapide

### 1. Cloner le projet

```bash
git clone https://github.com/Deku0019523f/Deku-Service.git
cd Deku-Service
```

### 2. Installer les dépendances

```bash
npm install
```

### 3. Configurer votre numéro

Ouvrez **`config.js`** et remplacez le numéro par le vôtre :

```js
// config.js
export const config = {
  phoneNumber: "2250712345678",  // ← votre numéro ici
  // ...
};
```

> **Format attendu :** indicatif pays + numéro, **sans `+`**, sans espaces, sans tirets.  
> Exemples : `2250712345678` (CI) · `33612345678` (FR) · `221771234567` (SN)

### 4. Lancer

```bash
npm start
```

---

## 🔗 Connexion WhatsApp (code d'appairage)

Au premier lancement, un **code d'appairage** s'affiche dans la console :

```
╔══════════════════════════════════════════════════════════════╗
║   🔗  CODE D'APPAIRAGE WHATSAPP                              ║
╠══════════════════════════════════════════════════════════════╣
║         ABCD-EFGH                                            ║
╚══════════════════════════════════════════════════════════════╝
```

**Dans WhatsApp sur votre téléphone :**

1. Paramètres → Appareils connectés
2. Connecter un appareil
3. → Connecter avec numéro de téléphone
4. Entrez le code affiché

✅ La connexion est établie. La clé API vous est envoyée directement sur WhatsApp.

> Lors des relances suivantes, la session est restaurée automatiquement — **aucun code à ressaisir**.

---

## 🚀 Déploiement sur Render (gratuit)

1. Poussez le projet sur GitHub
2. Sur [render.com](https://render.com) → **New** → **Web Service**
3. Connectez votre dépôt
4. Paramètres :

| Champ | Valeur |
|---|---|
| **Runtime** | `Node` |
| **Build Command** | `npm install` |
| **Start Command** | `npm start` |
| **Instance Type** | `Free` (suffisant) |

5. Cliquez **Deploy**
6. Allez dans l'onglet **Logs** pour voir le code d'appairage s'afficher

> Render injecte automatiquement `$PORT` — aucune configuration supplémentaire.

---

## 🖥️ Déploiement sur VPS

```bash
# Installer Node.js 18+ si nécessaire
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt-get install -y nodejs

# Cloner et installer
git clone https://github.com/Deku0019523f/Deku-Service.git
cd Deku-Service
npm install

# Configurer le numéro
nano config.js

# Lancer en arrière-plan avec PM2
npm install -g pm2
pm2 start index.js --name whatsapp-api
pm2 save
pm2 startup

# Voir les logs (et le code d'appairage)
pm2 logs whatsapp-api
```

---

## 📁 Structure du projet

```
.
├── config.js              ← 👈 SEUL fichier à modifier
├── index.js               ← Point d'entrée
├── package.json
├── .gitignore
├── app/
│   ├── cli/               ← Affichage terminal (bannière, code, logs)
│   ├── whatsapp/          ← Connexion Baileys (pairing code)
│   ├── apikey/            ← Génération & stockage de la clé API
│   ├── pdf/               ← Génération du guide PDF
│   └── keepalive.js       ← Serveur HTTP + heartbeat stdout
├── sessions/              ← Sessions WhatsApp (auto-créé, gitignored)
├── output/                ← PDFs générés (auto-créé)
└── assets/
    └── logo.png           ← Votre logo (optionnel)
```

---

## 🔒 Sécurité

- La clé API est stockée dans `sessions/<numero>/api-key.json`
- Le dossier `sessions/` est dans `.gitignore` — vos credentials ne partent pas sur GitHub
- Ne partagez jamais votre clé API

---

## 🔄 Reconnexion automatique

Si le processus redémarre avec une session existante, il se reconnecte **sans demander de code**. La session est persistée dans `sessions/`.

---

## 📱 Format du numéro

| Format | Statut |
|---|---|
| `2250712345678` | ✅ Valide |
| `+2250712345678` | ❌ Pas de `+` |
| `07 12 34 56 78` | ❌ Pas d'espaces |
| `225-07-12-34-56-78` | ❌ Pas de tirets |

---

## ⚙️ Stack technique

- **Runtime** : Node.js 18+ (ESM)
- **WhatsApp** : [@whiskeysockets/baileys](https://github.com/WhiskeySockets/Baileys) — pairing code
- **PDF** : PDFKit
- **Terminal** : Chalk

---

## 🐛 Problèmes courants

| Symptôme | Solution |
|---|---|
| `Numéro non configuré` | Ouvrir `config.js` et mettre votre vrai numéro |
| `Pairing impossible` | Vérifier le numéro, patienter 5 min et relancer |
| `SESSION_REVOKED` | Déconnecter l'appareil dans WhatsApp et relancer |
| Le code n'apparaît pas | Vérifier les **Logs** sur Render ou `pm2 logs` sur VPS |
