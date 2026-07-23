const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const vendeurModel = require('../models/vendeur.model');

const router = express.Router();

router.post('/inscription', async (req, res) => {
  const { nomBoutique, email, motDePasse, telephone } = req.body;
  if (!nomBoutique || !email || !motDePasse) {
    return res.status(400).json({ erreur: 'nomBoutique, email et motDePasse sont requis' });
  }
  if (vendeurModel.trouverParEmail(email)) {
    return res.status(409).json({ erreur: 'Un compte existe déjà avec cet email' });
  }

  const motDePasseHash = await bcrypt.hash(motDePasse, 10);
  const vendeur = vendeurModel.creer({ nomBoutique, email, motDePasseHash, telephone });
  const token = jwt.sign({ vendeurId: vendeur.id }, process.env.JWT_SECRET, { expiresIn: '30d' });

  res.status(201).json({ vendeur, token });
});

router.post('/connexion', async (req, res) => {
  const { email, motDePasse } = req.body;
  const vendeur = vendeurModel.trouverParEmail(email);
  if (!vendeur) return res.status(401).json({ erreur: 'Identifiants invalides' });

  const valide = await bcrypt.compare(motDePasse, vendeur.mot_de_passe);
  if (!valide) return res.status(401).json({ erreur: 'Identifiants invalides' });

  const token = jwt.sign({ vendeurId: vendeur.id }, process.env.JWT_SECRET, { expiresIn: '30d' });
  delete vendeur.mot_de_passe;
  res.json({ vendeur, token });
});

module.exports = router;
