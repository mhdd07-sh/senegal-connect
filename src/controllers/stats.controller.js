const { query } = require('../config/db');

// Une seule requête SQL avec agrégations, comme exigé par le cahier des charges.
async function tableauDeBord(req, res, next) {
  try {
    const resultat = await query(`
      SELECT
        (SELECT COUNT(*) FROM clients WHERE statut = 'actif') AS clients_actifs,
        (SELECT COALESCE(SUM(f.prix_mensuel_fcfa), 0)
           FROM clients c JOIN forfaits f ON f.id = c.forfait_id
           WHERE c.statut = 'actif') AS revenus_mensuels_fcfa,
        (SELECT COUNT(*) FROM factures WHERE statut IN ('impayee', 'en_retard')) AS factures_impayees,
        (SELECT COUNT(*) FROM tickets WHERE statut != 'ferme') AS tickets_ouverts
    `);
    res.json(resultat.rows[0]);
  } catch (err) {
    next(err);
  }
}

module.exports = { tableauDeBord };
