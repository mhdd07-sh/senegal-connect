const express = require('express');
const { body, param } = require('express-validator');
const { verifierValidation } = require('../utils/validation');
const { verifierJWT, garderRole } = require('../middleware/auth');
const controller = require('../controllers/clients.controller');

const router = express.Router();

const validationClient = [
  body('nom').notEmpty().withMessage('Le nom est requis'),
  body('prenom').notEmpty().withMessage('Le prénom est requis'),
  body('msisdn')
    .matches(/^\+221[0-9]{9}$/)
    .withMessage('Le MSISDN doit être au format +221XXXXXXXXX'),
  body('email').isEmail().withMessage('Email invalide'),
  body('forfait_id').optional({ nullable: true }).isInt().withMessage('forfait_id doit être un entier'),
];

/**
 * @openapi
 * /api/clients:
 *   get:
 *     summary: "Liste des clients"
 *     description: "Retourne les clients paginés, avec filtre optionnel par q, forfait_id ou statut."
 *     tags: [Clients]
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: query
 *         name: page
 *         schema: { type: integer, example: 1 }
 *       - in: query
 *         name: limite
 *         schema: { type: integer, example: 20 }
 *       - in: query
 *         name: q
 *         schema: { type: string, example: "Moussa" }
 *     responses:
 *       200:
 *         description: "Liste des clients"
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 data:
 *                   type: array
 *                   items:
 *                     $ref: '#/components/schemas/Client'
 *                 pagination:
 *                   $ref: '#/components/schemas/Pagination'
 */
router.get('/', verifierJWT, controller.liste);

/**
 * @openapi
 * /api/clients/{id}:
 *   get:
 *     summary: "Détail d'un client"
 *     description: "Récupère la fiche détaillée d'un client avec forfait, facture et ticket en cours."
 *     tags: [Clients]
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: integer, example: 1 }
 *     responses:
 *       200:
 *         description: "Client trouvé"
 *       404:
 *         description: "Client introuvable"
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Erreur'
 */
router.get(
  '/:id',
  verifierJWT,
  param('id').isInt().withMessage('id invalide'),
  verifierValidation,
  controller.detail
);

/**
 * @openapi
 * /api/clients:
 *   post:
 *     summary: "Créer un client"
 *     description: "Crée un client, sous réserve que le forfait lié existe."
 *     tags: [Clients]
 *     security:
 *       - BearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [utilisateur_id, nom, prenom, msisdn, email]
 *             properties:
 *               utilisateur_id:
 *                 type: integer
 *                 example: 4
 *               nom:
 *                 type: string
 *                 example: "Sow"
 *               prenom:
 *                 type: string
 *                 example: "Moussa"
 *               msisdn:
 *                 type: string
 *                 example: "+221771234567"
 *               email:
 *                 type: string
 *                 example: "moussa.sow@example.sn"
 *               forfait_id:
 *                 type: integer
 *                 example: 2
 *     responses:
 *       201:
 *         description: "Client créé"
 *       422:
 *         description: "Validation ou référence invalide"
 */
router.post(
  '/',
  verifierJWT,
  garderRole('admin'),
  validationClient,
  verifierValidation,
  controller.creer
);

router.put(
  '/:id',
  verifierJWT,
  garderRole('admin'),
  param('id').isInt().withMessage('id invalide'),
  validationClient,
  verifierValidation,
  controller.modifier
);

router.patch(
  '/:id/statut',
  verifierJWT,
  garderRole('admin'),
  param('id').isInt().withMessage('id invalide'),
  body('statut').isIn(['actif', 'suspendu', 'resilie']).withMessage('Statut invalide'),
  verifierValidation,
  controller.changerStatut
);

router.delete('/:id', verifierJWT, garderRole('admin'), param('id').isInt().withMessage('id invalide'), controller.supprimer);

module.exports = router;
