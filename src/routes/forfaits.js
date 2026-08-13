const express = require('express');
const { body, param } = require('express-validator');
const { verifierValidation } = require('../utils/validation');
const { verifierJWT, garderRole } = require('../middleware/auth');
const controller = require('../controllers/forfaits.controller');

const router = express.Router();

const validationForfait = [
  body('nom').notEmpty().withMessage('Le nom est requis'),
  body('quota_data_go').isFloat({ min: 0 }).withMessage('Le quota data doit être >= 0'),
  body('quota_voix_min').isInt({ min: 0 }).withMessage('Le quota voix doit être >= 0'),
  body('prix_mensuel_fcfa').isFloat({ gt: 0 }).withMessage('Le prix doit être > 0'),
];

/**
 * @openapi
 * /api/forfaits:
 *   get:
 *     summary: "Liste des forfaits"
 *     description: "Retourne les forfaits actifs avec le nombre de clients abonnés."
 *     tags: [Forfaits]
 *     responses:
 *       200:
 *         description: "Liste des forfaits"
 *         content:
 *           application/json:
 *             schema:
 *               type: array
 *               items:
 *                 $ref: '#/components/schemas/Forfait'
 */
router.get('/', controller.liste);
/**
 * @openapi
 * /api/forfaits/{id}:
 *   get:
 *     summary: "Détail d'un forfait"
 *     tags: [Forfaits]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: integer, example: 2 }
 *     responses:
 *       200:
 *         description: "Forfait trouvé"
 *       404:
 *         description: "Forfait introuvable"
 */
router.get('/:id', param('id').isInt().withMessage('id invalide'), verifierValidation, controller.detail);
router.post('/', verifierJWT, garderRole('admin'), validationForfait, verifierValidation, controller.creer);
router.put('/:id', verifierJWT, garderRole('admin'), param('id').isInt().withMessage('id invalide'), validationForfait, verifierValidation, controller.modifier);
router.delete('/:id', verifierJWT, garderRole('admin'), param('id').isInt().withMessage('id invalide'), controller.supprimer);

module.exports = router;
