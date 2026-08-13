const express = require('express');
const { body } = require('express-validator');
const { verifierValidation } = require('../utils/validation');
const { verifierJWT, garderRole } = require('../middleware/auth');
const upload = require('../middleware/upload');
const controller = require('../controllers/tickets.controller');

const router = express.Router();

/**
 * @openapi
 * /api/tickets:
 *   get:
 *     summary: "Liste des tickets"
 *     tags: [Tickets]
 *     security:
 *       - BearerAuth: []
 *     responses:
 *       200:
 *         description: "Liste des tickets"
 */
router.get('/', verifierJWT, controller.liste);
router.get('/:id', verifierJWT, controller.detail);

/**
 * @openapi
 * /api/tickets:
 *   post:
 *     summary: "Créer un ticket"
 *     description: "Ouvre un nouveau ticket de support pour un client."
 *     tags: [Tickets]
 *     security:
 *       - BearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [sujet]
 *             properties:
 *               sujet:
 *                 type: string
 *                 example: "Facture FCFA incorrecte"
 *     responses:
 *       201:
 *         description: "Ticket créé"
 */
router.post(
  '/',
  verifierJWT,
  body('sujet').notEmpty().withMessage('Le sujet est requis'),
  verifierValidation,
  controller.creer
);

router.patch(
  '/:id/statut',
  verifierJWT,
  garderRole('agent', 'admin'),
  body('statut').isIn(['ouvert', 'en_cours', 'ferme']).withMessage('Statut invalide'),
  verifierValidation,
  controller.changerStatut
);

router.get('/:id/messages', verifierJWT, controller.messages);
router.get('/:id/appels', verifierJWT, controller.historiqueAppels);
router.post('/:id/fichier', verifierJWT, upload.single('fichier'), controller.uploadFichier);

module.exports = router;
