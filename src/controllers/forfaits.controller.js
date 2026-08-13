const { query } = require('../config/db');

async function liste(req, res, next) {
  try {
    const resultat = await query(`
      SELECT f.*, COUNT(c.id) FILTER (WHERE c.statut = 'actif') AS nb_clients
      FROM forfaits f
      LEFT JOIN clients c ON c.forfait_id = f.id
      WHERE f.actif = TRUE
      GROUP BY f.id
      ORDER BY f.id
    `);
    res.json(resultat.rows);
  } catch (err) {
    next(err);
  }
}

async function detail(req, res, next) {
  try {
    const forfaitResultat = await query('SELECT * FROM forfaits WHERE id = $1', [req.params.id]);
    if (forfaitResultat.rows.length === 0) {
      return res.status(404).json({ message: 'Forfait introuvable' });
    }

    const page = Math.max(parseInt(req.query.page, 10) || 1, 1);
    const limite = Math.min(Math.max(parseInt(req.query.limite, 10) || 20, 1), 100);
    const offset = (page - 1) * limite;

    const [clientsResultat, totalResultat] = await Promise.all([
      query('SELECT * FROM clients WHERE forfait_id = $1 ORDER BY id LIMIT $2 OFFSET $3', [
        req.params.id,
        limite,
        offset,
      ]),
      query('SELECT COUNT(*) FROM clients WHERE forfait_id = $1', [req.params.id]),
    ]);

    const total = parseInt(totalResultat.rows[0].count, 10);

    res.json({
      ...forfaitResultat.rows[0],
      clients: {
        data: clientsResultat.rows,
        pagination: { total, page, limite, total_pages: Math.ceil(total / limite) || 1 },
      },
    });
  } catch (err) {
    next(err);
  }
}

async function creer(req, res, next) {
  try {
    const { nom, quota_data_go, quota_voix_min, prix_mensuel_fcfa, actif } = req.body;
    const resultat = await query(
      `INSERT INTO forfaits (nom, quota_data_go, quota_voix_min, prix_mensuel_fcfa, actif)
       VALUES ($1, $2, $3, $4, $5) RETURNING *`,
      [nom, quota_data_go, quota_voix_min, prix_mensuel_fcfa, actif !== undefined ? actif : true]
    );
    res.status(201).json(resultat.rows[0]);
  } catch (err) {
    next(err);
  }
}

async function modifier(req, res, next) {
  try {
    const { nom, quota_data_go, quota_voix_min, prix_mensuel_fcfa, actif } = req.body;
    const resultat = await query(
      `UPDATE forfaits SET nom=$1, quota_data_go=$2, quota_voix_min=$3, prix_mensuel_fcfa=$4, actif=$5
       WHERE id=$6 RETURNING *`,
      [nom, quota_data_go, quota_voix_min, prix_mensuel_fcfa, actif, req.params.id]
    );
    if (resultat.rows.length === 0) {
      return res.status(404).json({ message: 'Forfait introuvable' });
    }
    res.json(resultat.rows[0]);
  } catch (err) {
    next(err);
  }
}

async function supprimer(req, res, next) {
  try {
    const abonnes = await query(
      `SELECT COUNT(*) FROM clients WHERE forfait_id = $1 AND statut = 'actif'`,
      [req.params.id]
    );
    if (parseInt(abonnes.rows[0].count, 10) > 0) {
      return res
        .status(409)
        .json({ message: 'Impossible de supprimer : des clients actifs sont abonnés à ce forfait' });
    }

    const resultat = await query('DELETE FROM forfaits WHERE id = $1 RETURNING id', [req.params.id]);
    if (resultat.rows.length === 0) {
      return res.status(404).json({ message: 'Forfait introuvable' });
    }
    res.status(204).send();
  } catch (err) {
    next(err);
  }
}

module.exports = { liste, detail, creer, modifier, supprimer };
