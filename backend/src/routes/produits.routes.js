const express = require('express');
const { requireAuth } = require('../middleware/auth');
const produitModel = require('../models/produit.model');

const router = express.Router();
router.use(requireAuth);

router.get('/', (req, res) => {
  res.json(produitModel.lister(req.vendeurId));
});

router.post('/', (req, res) => {
  const { nom, description, prix, stock } = req.body;
  if (!nom) return res.status(400).json({ erreur: 'nom requis' });
  res.status(201).json(produitModel.creer(req.vendeurId, { nom, description, prix, stock }));
});

router.put('/:id', (req, res) => {
  const produit = produitModel.modifier(req.params.id, req.vendeurId, req.body);
  if (!produit) return res.status(404).json({ erreur: 'Produit introuvable' });
  res.json(produit);
});

router.delete('/:id', (req, res) => {
  const ok = produitModel.supprimer(req.params.id, req.vendeurId);
  if (!ok) return res.status(404).json({ erreur: 'Produit introuvable' });
  res.json({ message: 'Produit supprimé' });
});

module.exports = router;
