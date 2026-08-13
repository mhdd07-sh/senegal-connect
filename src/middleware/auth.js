const jwt = require('jsonwebtoken');
const logger = require('../config/logger');

// Lit Authorization: Bearer <token>, vérifie le JWT, stocke le payload dans req.user.
// Trois messages d'erreur distincts, comme exigé par le cahier des charges (M2).
function verifierJWT(req, res, next) {
  const enTete = req.headers.authorization;

  if (!enTete || !enTete.startsWith('Bearer ')) {
    return res.status(401).json({ message: 'Token manquant' });
  }

  const token = enTete.split(' ')[1];

  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET);
    req.user = payload;
    next();
  } catch (err) {
    if (err.name === 'TokenExpiredError') {
      return res.status(401).json({ message: 'Token expiré — veuillez vous reconnecter' });
    }
    logger.warn(`Token JWT invalide : ${err.message}`);
    return res.status(401).json({ message: 'Token invalide' });
  }
}

// Middleware factory : garderRole('admin'), garderRole('admin', 'agent')...
function garderRole(...roles) {
  return (req, res, next) => {
    if (!req.user || !roles.includes(req.user.role)) {
      return res.status(403).json({ message: 'Rôle insuffisant pour cette action' });
    }
    next();
  };
}

module.exports = { verifierJWT, garderRole };
