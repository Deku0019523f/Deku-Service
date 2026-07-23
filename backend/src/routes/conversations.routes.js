const express = require('express');
const { requireAuth } = require('../middleware/auth');
const conversationModel = require('../models/conversation.model');
const whatsappManager = require('../services/whatsappManager');

const router = express.Router();
router.use(requireAuth);

router.get('/', (req, res) => {
  res.json(conversationModel.listerConversations(req.vendeurId));
});

router.get('/:id/messages', (req, res) => {
  res.json(conversationModel.listerMessages(req.params.id));
});

router.patch('/:id/statut', (req, res) => {
  const { statut } = req.body;
  conversationModel.majStatutConversation(req.params.id, req.vendeurId, statut);
  res.json({ message: 'Statut mis à jour' });
});

// Le vendeur reprend la main (ou la redonne à l'IA)
router.patch('/:id/prise-en-charge', (req, res) => {
  const { priseEnCharge } = req.body; // 'ia' | 'humain'
  conversationModel.majPriseEnCharge(req.params.id, req.vendeurId, priseEnCharge);
  res.json({ message: 'Prise en charge mise à jour' });
});

// Le vendeur envoie un message manuellement dans une conversation
router.post('/:id/messages', async (req, res) => {
  const { texte, jidClient } = req.body;
  if (!texte || !jidClient) return res.status(400).json({ erreur: 'texte et jidClient requis' });

  try {
    await whatsappManager.envoyerMessageVendeur(req.vendeurId, jidClient, texte);
    const message = conversationModel.ajouterMessage(req.params.id, 'vendeur', texte);
    res.status(201).json(message);
  } catch (err) {
    res.status(500).json({ erreur: err.message });
  }
});

router.get('/commandes', (req, res) => {
  res.json(conversationModel.listerCommandes(req.vendeurId));
});

module.exports = router;
