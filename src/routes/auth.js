const express = require('express');
const { body } = require('express-validator');
const { verifierValidation } = require('../utils/validation');
const { verifierJWT } = require('../middleware/auth');
const controller = require('../controllers/auth.controller');

const router = express.Router();

/**
 * @openapi
 * /api/auth/register:
 *   post:
 *     summary: "Inscription d'un utilisateur"
 *     description: "Crée un compte utilisateur avec un mot de passe hashé."
 *     tags: [Auth]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [nom, prenom, email, mot_de_passe]
 *             properties:
 *               nom:
 *                 type: string
 *                 example: "Fall"
 *               prenom:
 *                 type: string
 *                 example: "Awa"
 *               email:
 *                 type: string
 *                 format: email
 *                 example: "awa.fall@example.sn"
 *               mot_de_passe:
 *                 type: string
 *                 example: "Motdepasse123!"
 *               role:
 *                 type: string
 *                 enum: [client, agent, admin]
 *                 example: client
 *     responses:
 *       201:
 *         description: "Utilisateur créé"
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Client'
 *       409:
 *         description: "Doublon détecté"
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Erreur'
 */
router.post(
  '/register',
  [
    body('nom').notEmpty().withMessage('Le nom est requis'),
    body('prenom').notEmpty().withMessage('Le prénom est requis'),
    body('email').isEmail().withMessage('Email invalide'),
    body('mot_de_passe').isLength({ min: 8 }).withMessage('Le mot de passe doit contenir au moins 8 caractères'),
    body('role').optional().isIn(['client', 'agent', 'admin']).withMessage('Rôle invalide'),
  ],
  verifierValidation,
  controller.register
);

/**
 * @openapi
 * /api/auth/login:
 *   post:
 *     summary: "Connexion"
 *     description: "Authentifie un utilisateur et retourne un JWT Bearer pour accéder aux endpoints protégés."
 *     tags: [Auth]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [email, mot_de_passe]
 *             properties:
 *               email:
 *                 type: string
 *                 format: email
 *                 example: "moussa.sow@example.sn"
 *               mot_de_passe:
 *                 type: string
 *                 example: "Client123!"
 *     responses:
 *       200:
 *         description: "Connexion réussie"
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 token:
 *                   type: string
 *                 expires_in:
 *                   type: string
 *                 utilisateur:
 *                   type: object
 *                   properties:
 *                     id:
 *                       type: integer
 *                     email:
 *                       type: string
 *                     role:
 *                       type: string
 *       401:
 *         description: "Identifiants incorrects"
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Erreur'
 */
router.post(
  '/login',
  [
    body('email').isEmail().withMessage('Email invalide'),
    body('mot_de_passe').notEmpty().withMessage('Mot de passe requis'),
  ],
  verifierValidation,
  controller.login
);

/**
 * @openapi
 * /api/auth/profil:
 *   get:
 *     summary: "Profil de l'utilisateur connecté"
 *     description: "Retourne les informations du compte authentifié."
 *     tags: [Auth]
 *     security:
 *       - BearerAuth: []
 *     responses:
 *       200:
 *         description: "Profil récupéré"
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Client'
 *       401:
 *         description: "Token manquant ou invalide"
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Erreur'
 */
router.get('/profil', verifierJWT, controller.profil);

module.exports = router;
