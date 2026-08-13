const multer = require('multer');
const logger = require('../config/logger');

// Handler global à 4 paramètres — DOIT être déclaré en dernier dans server.js.
function gestionnaireErreurs(err, req, res, next) {
  // Erreurs Multer (taille dépassée, champ inattendu...) et rejet de type de fichier (M3)
  if (err instanceof multer.MulterError) {
    return res.status(422).json({ message: `Erreur d'upload : ${err.message}` });
  }
  if (typeof err.message === 'string' && err.message.startsWith('Type de fichier non autorisé')) {
    return res.status(422).json({ message: err.message });
  }

  // 23505 = violation de contrainte UNIQUE PostgreSQL
  if (err.code === '23505') {
    const champ = (err.detail && err.detail.match(/\(([^)]+)\)/)) ? err.detail.match(/\(([^)]+)\)/)[1] : 'champ';
    return res.status(409).json({ message: `Doublon détecté sur le champ ${champ}` });
  }

  // 23503 = violation de contrainte de clé étrangère
  if (err.code === '23503') {
    return res.status(422).json({ message: 'Référence invalide : la ressource liée n\'existe pas' });
  }

  logger.error(err.stack || err.message);

  const estProd = process.env.NODE_ENV === 'production';
  return res.status(500).json({
    message: 'Erreur interne du serveur',
    ...(estProd ? {} : { detail: err.message }),
  });
}

function routeInconnue(req, res) {
  res.status(404).json({ message: `Route ${req.method} ${req.originalUrl} introuvable` });
}

module.exports = { gestionnaireErreurs, routeInconnue };
