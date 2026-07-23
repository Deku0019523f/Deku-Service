const jwt = require('jsonwebtoken');

function requireAuth(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;

  if (!token) return res.status(401).json({ erreur: 'Authentification requise' });

  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET);
    req.vendeurId = payload.vendeurId;
    next();
  } catch (err) {
    return res.status(401).json({ erreur: 'Token invalide ou expiré' });
  }
}

module.exports = { requireAuth };
