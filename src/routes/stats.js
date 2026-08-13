const express = require('express');
const { verifierJWT, garderRole } = require('../middleware/auth');
const controller = require('../controllers/stats.controller');

const router = express.Router();

router.get('/', verifierJWT, garderRole('admin'), controller.tableauDeBord);

module.exports = router;
