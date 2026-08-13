const { validationResult } = require('express-validator');

// Middleware générique : à placer après les validateurs express-validator sur chaque route.
// Formate les erreurs en 422 avec la liste { champ, message, valeur } exigée par le cahier des charges.
function verifierValidation(req, res, next) {
  const erreurs = validationResult(req);
  if (!erreurs.isEmpty()) {
    return res.status(422).json({
      erreurs: erreurs.array().map((e) => ({
        champ: e.path,
        message: e.msg,
        valeur: e.value,
      })),
    });
  }
  next();
}

module.exports = { verifierValidation };
