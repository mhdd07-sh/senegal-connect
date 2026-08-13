const express = require('express');
const { body, param } = require('express-validator');
const { verifierValidation } = require('../utils/validation');
const { verifierJWT, garderRole } = require('../middleware/auth');
const controller = require('../controllers/factures.controller');

const router = express.Router();

/**
 * @openapi
 * /api/factures:
 *   get:
 *     summary: "Liste des factures"
 *     description: "Renvoie les factures filtrées par client_id, statut ou période."
 *     tags: [Factures]
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: query
 *         name: client_id
 *         schema: { type: integer, example: 1 }
 *     responses:
 *       200:
 *         description: "Factures trouvées"
 */
router.get('/', verifierJWT, controller.liste);
router.get('/:id', verifierJWT, param('id').isInt().withMessage('id invalide'), verifierValidation, controller.detail);

/**
 * @openapi
 * /api/factures:
 *   post:
 *     summary: "Créer une facture"
 *     description: "Crée une facture avec référence auto-générée et statut impayée."
 *     tags: [Factures]
 *     security:
 *       - BearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [client_id, periode, montant_fcfa, date_echeance]
 *             properties:
 *               client_id:
 *                 type: integer
 *                 example: 1
 *               periode:
 *                 type: string
 *                 example: "2025-07"
 *               montant_fcfa:
 *                 type: number
 *                 example: 10000
 *               date_echeance:
 *                 type: string
 *                 format: date
 *                 example: "2025-07-15"
 *     responses:
 *       201:
 *         description: "Facture créée"
 *       422:
 *         description: "Client ou données invalides"
 */
router.post(
  '/',
  verifierJWT,
  garderRole('admin'),
  [
    body('client_id').isInt().withMessage('client_id est requis'),
    body('periode').matches(/^\d{4}-(0[1-9]|1[0-2])$/).withMessage('La période doit être au format YYYY-MM'),
    body('montant_fcfa').isFloat({ min: 0 }).withMessage('Le montant doit être >= 0'),
    body('date_echeance').isISO8601().withMessage("Date d'échéance invalide"),
  ],
  verifierValidation,
  controller.creer
);

router.put(
  '/:id/statut',
  verifierJWT,
  garderRole('admin'),
  param('id').isInt().withMessage('id invalide'),
  body('statut').isIn(['payee', 'impayee', 'en_retard']).withMessage('Statut invalide'),
  verifierValidation,
  controller.changerStatut
);

router.delete('/:id', verifierJWT, garderRole('admin'), param('id').isInt().withMessage('id invalide'), controller.supprimer);

module.exports = router;
