const Groq = require('groq-sdk');
const logger = require('../utils/logger');

const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });
const MODELE = process.env.GROQ_MODEL || 'llama-3.3-70b-versatile';

function construirePromptSysteme(vendeur, produits) {
  const catalogue = produits.length
    ? produits
        .map((p) => `- ${p.nom} : ${p.prix} FCFA (stock: ${p.stock}) — ${p.description || 'pas de description'}`)
        .join('\n')
    : "Aucun produit actif n'est enregistré pour le moment.";

  return `Tu es l'assistant commercial WhatsApp de la boutique "${vendeur.nom_boutique}".
Ton rôle : répondre aux clients qui écrivent sur WhatsApp, présenter les produits, répondre aux questions et encourager la commande.

Catalogue actuel :
${catalogue}

Règles :
- Réponds toujours en français, de façon courte et chaleureuse (2-4 phrases max), adaptée à WhatsApp.
- Ne jamais inventer de produit, de prix ou de stock qui ne sont pas dans le catalogue ci-dessus.
- Si le client veut commander, demande la quantité et confirme le récapitulatif (produit, prix, quantité).
- Si la question dépasse tes capacités (réclamation, négociation complexe, problème de livraison), dis que tu transmets au vendeur.`;
}

/**
 * Génère la réponse IA pour un message client, en tenant compte de l'historique
 * et du catalogue produit du vendeur.
 */
async function genererReponse({ vendeur, produitsActifs, historique, messageClient }) {
  const systemPrompt = construirePromptSysteme(vendeur, produitsActifs);

  const messages = [
    { role: 'system', content: systemPrompt },
    ...historique.map((m) => ({
      role: m.expediteur === 'client' ? 'user' : 'assistant',
      content: m.contenu,
    })),
    { role: 'user', content: messageClient },
  ];

  try {
    const completion = await groq.chat.completions.create({
      model: MODELE,
      messages,
      temperature: 0.6,
      max_tokens: 300,
    });
    return completion.choices[0]?.message?.content?.trim() || "Désolé, je n'ai pas compris, tu peux reformuler ?";
  } catch (err) {
    logger.error({ err }, 'Erreur Groq lors de la génération de réponse IA');
    return "Un instant, je reviens vers toi très vite 🙏";
  }
}

module.exports = { genererReponse, construirePromptSysteme };
