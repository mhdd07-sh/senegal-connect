const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const { query } = require('../config/db');
const logger = require('../config/logger');

async function register(req, res, next) {
  try {
    const { nom, prenom, email, mot_de_passe, role } = req.body;
    const hash = await bcrypt.hash(mot_de_passe, 12);

    const resultat = await query(
      `INSERT INTO utilisateurs (nom, prenom, email, mot_de_passe, role)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id, nom, prenom, email, role, cree_le`,
      [nom, prenom, email, hash, role || 'client']
    );

    res.status(201).json(resultat.rows[0]);
  } catch (err) {
    next(err);
  }
}

async function login(req, res, next) {
  try {
    const { email, mot_de_passe } = req.body;
    const resultat = await query('SELECT * FROM utilisateurs WHERE email = $1', [email]);
    const utilisateur = resultat.rows[0];

    // Message générique volontaire : ne révèle jamais si le compte existe ou non.
    const messageGenerique = { message: 'Identifiants incorrects' };

    if (!utilisateur) {
      logger.warn(`Tentative de login échouée pour ${email} (compte inexistant)`);
      return res.status(401).json(messageGenerique);
    }

    const motDePasseValide = await bcrypt.compare(mot_de_passe, utilisateur.mot_de_passe);
    if (!motDePasseValide) {
      logger.warn(`Tentative de login échouée pour ${email} (mot de passe incorrect)`);
      return res.status(401).json(messageGenerique);
    }

    const token = jwt.sign(
      { id: utilisateur.id, nom: utilisateur.nom, email: utilisateur.email, role: utilisateur.role },
      process.env.JWT_SECRET,
      { expiresIn: process.env.JWT_EXPIRES_IN || '24h', issuer: 'senegal-connect' }
    );

    res.json({
      token,
      expires_in: process.env.JWT_EXPIRES_IN || '24h',
      utilisateur: {
        id: utilisateur.id,
        nom: utilisateur.nom,
        email: utilisateur.email,
        role: utilisateur.role,
      },
    });
  } catch (err) {
    next(err);
  }
}

async function profil(req, res, next) {
  try {
    const resultat = await query(
      'SELECT id, nom, prenom, email, role, cree_le FROM utilisateurs WHERE id = $1',
      [req.user.id]
    );
    if (resultat.rows.length === 0) {
      return res.status(404).json({ message: 'Utilisateur introuvable' });
    }
    res.json(resultat.rows[0]);
  } catch (err) {
    next(err);
  }
}

module.exports = { register, login, profil };
