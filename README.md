# 🤖 WhatsApp API Agent

Transformez votre compte WhatsApp en API personnelle d'envoi de messages.

---

## ⚡ Installation rapide

```bash
# Cloner ou dézipper le projet
cd whatsapp-api

# Installer les dépendances
npm install

# (Optionnel) Placer votre logo
cp votre-logo.png assets/logo.png

# Lancer
npm start
```

---

## 🚀 Fonctionnement

1. **Lancez** `npm start`
2. **Entrez** votre numéro (ex: `2250712345678`)
3. **Copiez** le code affiché dans le terminal
4. **Dans WhatsApp** → Paramètres → Appareils connectés → Connecter avec numéro
5. **Recevez** sur WhatsApp :
   - 🖼️ Image avec votre clé API
   - 📄 Guide PDF d'intégration complet

---

## 📁 Structure

```
whatsapp-api/
├── index.js              ← Point d'entrée
├── app/
│   ├── cli/              ← Interface terminal
│   ├── whatsapp/         ← Connexion Baileys
│   ├── apikey/           ← Génération & stockage clé API
│   └── pdf/              ← Génération du guide PDF
├── sessions/             ← Sessions WhatsApp (auto-créé)
├── output/               ← PDFs générés (auto-créé)
├── assets/
│   └── logo.png          ← Votre logo (optionnel)
└── logs/
```

---

## 📱 Format du numéro

| Format | Validité |
|--------|----------|
| `2250712345678` | ✅ Valide |
| `+2250712345678` | ❌ Invalide (pas de +) |
| `07 12 34 56 78` | ❌ Invalide (pas d'espaces) |

---

## 🔒 Sécurité

- La clé API est stockée dans `sessions/<numero>/api-key.json`
- Ne partagez jamais cette clé
- Utilisez des variables d'environnement en production

---

## 🔄 Reconnexion

Si le programme est relancé avec une session existante, il se reconnecte automatiquement sans demander de nouveau code.

---

## ⚙️ Stack technique

- **Runtime** : Node.js (ESM)
- **WhatsApp** : Baileys (pairing code)
- **PDF** : PDFKit
- **Terminal** : Chalk + readline-sync
