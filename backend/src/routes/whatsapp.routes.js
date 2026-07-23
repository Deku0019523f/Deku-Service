const express = require('express');
const { requireAuth } = require('../middleware/auth');
const whatsappManager = require('../services/whatsappManager');

const router = express.Router();
router.use(requireAuth);

// Démarre une connexion (QR par défaut, ou pairing si numeroTelephone fourni)
router.post('/connecter', async (req, res) => {
  const { mode, numeroTelephone } = req.body;
  try {
    await whatsappManager.connecterVendeur(req.vendeurId, {
      mode: mode === 'pairing' ? 'pairing' : 'qr',
      numeroTelephone,
    });
    res.json({ message: 'Connexion initiée, suis le QR ou le pairing code via Socket.io' });
  } catch (err) {
    res.status(500).json({ erreur: err.message });
  }
});

router.get('/statut', (req, res) => {
  res.json({ statut: whatsappManager.statutVendeur(req.vendeurId) });
});

router.post('/deconnecter', async (req, res) => {
  await whatsappManager.deconnecterVendeur(req.vendeurId);
  res.json({ message: 'Déconnecté' });
});

module.exports = router;
