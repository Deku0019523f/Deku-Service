# Référence API

Base URL : `https://api.tonboutique.com/api` (adapte selon ton déploiement)

## Authentification

L'API utilise un token JWT classique. Il n'y a pas de "clé API" statique par
défaut : chaque vendeur obtient son **identifiant** (`vendeur.id`) et son
**token** en s'inscrivant ou en se connectant. Ce token s'utilise ensuite dans
l'en-tête `Authorization` de toutes les requêtes protégées.

### `POST /auth/inscription`
```json
// Requête
{ "nomBoutique": "Chez Awa Fashion", "email": "awa@example.com", "motDePasse": "••••••••", "telephone": "+2250700000000" }

// Réponse 201
{
  "vendeur": { "id": "3f2a...", "nom_boutique": "Chez Awa Fashion", "email": "awa@example.com" },
  "token": "eyJhbGciOi..."
}
```

### `POST /auth/connexion`
```json
{ "email": "awa@example.com", "motDePasse": "••••••••" }
// → { "vendeur": {...}, "token": "eyJhbGciOi..." }
```

Toutes les routes ci-dessous requièrent l'en-tête :
```
Authorization: Bearer <token>
```

## WhatsApp

| Méthode | Route | Description |
|---|---|---|
| POST | `/whatsapp/connecter` | Lance la connexion. Body : `{ "mode": "qr" }` ou `{ "mode": "pairing", "numeroTelephone": "2250700000000" }` |
| GET | `/whatsapp/statut` | Retourne `{ "statut": "connecte" \| "en_attente_scan" \| "deconnecte" }` |
| POST | `/whatsapp/deconnecter` | Déconnecte et supprime la session |

Le QR code (image base64) et le code de pairing n'arrivent **pas** en réponse
HTTP mais via **Socket.io** (voir plus bas), car leur génération est
asynchrone côté WhatsApp.

## Produits

| Méthode | Route | Body |
|---|---|---|
| GET | `/produits` | — |
| POST | `/produits` | `{ nom, description, prix, stock }` |
| PUT | `/produits/:id` | mêmes champs, partiels |
| DELETE | `/produits/:id` | — |

## Conversations

| Méthode | Route | Description |
|---|---|---|
| GET | `/conversations` | Liste des conversations du vendeur |
| GET | `/conversations/:id/messages` | Historique des messages |
| PATCH | `/conversations/:id/statut` | `{ "statut": "interesse" \| "commande_passee" \| ... }` |
| PATCH | `/conversations/:id/prise-en-charge` | `{ "priseEnCharge": "ia" \| "humain" }` |
| POST | `/conversations/:id/messages` | Le vendeur répond manuellement : `{ "texte", "jidClient" }` |
| GET | `/conversations/commandes` | Commandes détectées par l'IA |

## Événements Socket.io (temps réel)

Connexion :
```javascript
const socket = io('https://api.tonboutique.com', { auth: { token: monToken } });
```

| Événement | Payload | Quand |
|---|---|---|
| `whatsapp:qr` | `{ qr: "data:image/png;base64,..." }` | Un QR code est prêt à être affiché |
| `whatsapp:pairing_code` | `{ code: "ABCD1234" }` | Un code de jumelage est généré |
| `whatsapp:statut` | `{ statut, numero }` | Le statut de connexion change |
| `conversation:message` | `{ conversationId, message }` | Nouveau message (client, IA ou vendeur) |

## Intégrer ça dans ta plateforme existante (façon Chariow)

Deux approches possibles selon ce que tu veux exposer aux vendeurs :

**A. Intégration légère (recommandée pour commencer)** — depuis le tableau de
bord vendeur de ta propre plateforme, ajoute un onglet "Assistant WhatsApp"
qui charge le dashboard fourni ici dans un `<iframe>`, en lui passant le
token du vendeur :

```html
<iframe src="https://dashboard.tonboutique.com/dashboard.html" style="width:100%;height:100%;border:0;"></iframe>
```
```javascript
// juste avant de charger l'iframe, ou via postMessage
localStorage.setItem('token', tokenDuVendeurConnecteSurTaPlateforme);
```

**B. Intégration profonde** — ta plateforme appelle directement l'API
ci-dessus depuis son propre backend (Node/Express, comme le reste de ton
stack) et construit sa propre UI. Exemple minimal :

```javascript
// Depuis ton backend existant, quand un vendeur clique "Connecter WhatsApp"
const reponse = await fetch('https://api.tonboutique.com/api/whatsapp/connecter', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${tokenVendeur}`,
  },
  body: JSON.stringify({ mode: 'qr' }),
});
```

Puis ta propre UI écoute le Socket.io pour afficher le QR code dans ton
design à toi, sans jamais charger l'iframe.

Dans les deux cas, le `token` obtenu via `/auth/connexion` (ou
`/auth/inscription` la première fois) est la seule "clé API" nécessaire par
vendeur — pas de clé globale à gérer.
