const { query } = require('../config/db');

// Construit dynamiquement la clause WHERE + les paramètres positionnels ($1, $2...)
// à partir des filtres optionnels de la query string — jamais de concaténation de chaînes.
function construireFiltres(reqQuery) {
  const conditions = [];
  const valeurs = [];
  let i = 1;

  if (reqQuery.q) {
    conditions.push(`(nom ILIKE $${i} OR prenom ILIKE $${i} OR msisdn ILIKE $${i} OR email ILIKE $${i})`);
    valeurs.push(`%${reqQuery.q}%`);
    i++;
  }
  if (reqQuery.forfait_id) {
    conditions.push(`forfait_id = $${i}`);
    valeurs.push(reqQuery.forfait_id);
    i++;
  }
  if (reqQuery.statut) {
    conditions.push(`statut = $${i}`);
    valeurs.push(reqQuery.statut);
    i++;
  }
  // Filtre interne (non exposé publiquement) : imposé par le contrôle des rôles M2,
  // jamais fourni directement par le client de l'API — voir liste() ci-dessous.
  if (reqQuery._utilisateur_id) {
    conditions.push(`utilisateur_id = $${i}`);
    valeurs.push(reqQuery._utilisateur_id);
    i++;
  }

  const whereSql = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  return { whereSql, valeurs };
}

async function liste(req, res, next) {
  try {
    const page = Math.max(parseInt(req.query.page, 10) || 1, 1);
    const limite = Math.min(Math.max(parseInt(req.query.limite, 10) || 20, 1), 100);
    const offset = (page - 1) * limite;

    // M2 — Contrôle des rôles : un client (rôle "client") ne voit jamais que sa propre fiche,
    // quels que soient les filtres qu'il fournit. Agents et admins ne sont pas restreints ici.
    const filtres = { ...req.query };
    if (req.user.role === 'client') {
      filtres._utilisateur_id = req.user.id;
    }

    const { whereSql, valeurs } = construireFiltres(filtres);

    const totalResultat = await query(`SELECT COUNT(*) FROM clients ${whereSql}`, valeurs);
    const total = parseInt(totalResultat.rows[0].count, 10);

    const donneesResultat = await query(
      `SELECT * FROM clients ${whereSql} ORDER BY id DESC LIMIT $${valeurs.length + 1} OFFSET $${valeurs.length + 2}`,
      [...valeurs, limite, offset]
    );

    res.json({
      data: donneesResultat.rows,
      pagination: { total, page, limite, total_pages: Math.ceil(total / limite) || 1 },
    });
  } catch (err) {
    next(err);
  }
}

async function detail(req, res, next) {
  try {
    const clientResultat = await query('SELECT * FROM clients WHERE id = $1', [req.params.id]);
    const client = clientResultat.rows[0];
    if (!client) {
      return res.status(404).json({ message: 'Client introuvable' });
    }

    // M2 — un client authentifié ne peut consulter que sa propre fiche.
    if (req.user.role === 'client' && client.utilisateur_id !== req.user.id) {
      return res.status(403).json({ message: 'Vous ne pouvez accéder qu\'à vos propres données' });
    }

    const [forfaitResultat, factureResultat, ticketResultat] = await Promise.all([
      query('SELECT * FROM forfaits WHERE id = $1', [client.forfait_id]),
      query('SELECT * FROM factures WHERE client_id = $1 ORDER BY date_emission DESC LIMIT 1', [client.id]),
      query(
        `SELECT * FROM tickets WHERE client_id = $1 AND statut != 'ferme' ORDER BY ouvert_le DESC LIMIT 1`,
        [client.id]
      ),
    ]);

    res.json({
      ...client,
      forfait: forfaitResultat.rows[0] || null,
      derniere_facture: factureResultat.rows[0] || null,
      ticket_en_cours: ticketResultat.rows[0] || null,
    });
  } catch (err) {
    next(err);
  }
}

async function creer(req, res, next) {
  try {
    const { utilisateur_id, nom, prenom, msisdn, email, forfait_id, statut } = req.body;

    if (forfait_id) {
      const forfaitExiste = await query('SELECT id FROM forfaits WHERE id = $1', [forfait_id]);
      if (forfaitExiste.rows.length === 0) {
        return res.status(422).json({
          erreurs: [{ champ: 'forfait_id', message: "Ce forfait n'existe pas", valeur: forfait_id }],
        });
      }
    }
    if (!utilisateur_id) {
      return res.status(422).json({
        erreurs: [{ champ: 'utilisateur_id', message: 'utilisateur_id est requis', valeur: utilisateur_id }],
      });
    }

    const resultat = await query(
      `INSERT INTO clients (utilisateur_id, nom, prenom, msisdn, email, forfait_id, statut)
       VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
      [utilisateur_id, nom, prenom, msisdn, email, forfait_id || null, statut || 'actif']
    );

    res.status(201).json(resultat.rows[0]);
  } catch (err) {
    next(err);
  }
}

async function modifier(req, res, next) {
  try {
    const { nom, prenom, msisdn, email, forfait_id, statut } = req.body;

    if (forfait_id) {
      const forfaitExiste = await query('SELECT id FROM forfaits WHERE id = $1', [forfait_id]);
      if (forfaitExiste.rows.length === 0) {
        return res.status(422).json({
          erreurs: [{ champ: 'forfait_id', message: "Ce forfait n'existe pas", valeur: forfait_id }],
        });
      }
    }

    const resultat = await query(
      `UPDATE clients SET nom=$1, prenom=$2, msisdn=$3, email=$4, forfait_id=$5, statut=$6
       WHERE id=$7 RETURNING *`,
      [nom, prenom, msisdn, email, forfait_id || null, statut, req.params.id]
    );

    if (resultat.rows.length === 0) {
      return res.status(404).json({ message: 'Client introuvable' });
    }
    res.json(resultat.rows[0]);
  } catch (err) {
    next(err);
  }
}

async function changerStatut(req, res, next) {
  try {
    const { statut } = req.body;

    if (statut === 'resilie') {
      const impayees = await query(
        `SELECT COUNT(*) FROM factures WHERE client_id = $1 AND statut != 'payee'`,
        [req.params.id]
      );
      if (parseInt(impayees.rows[0].count, 10) > 0) {
        return res.status(409).json({ message: 'Impossible de résilier : le client a des factures impayées' });
      }
    }

    const resultat = await query('UPDATE clients SET statut = $1 WHERE id = $2 RETURNING *', [
      statut,
      req.params.id,
    ]);

    if (resultat.rows.length === 0) {
      return res.status(404).json({ message: 'Client introuvable' });
    }
    res.json(resultat.rows[0]);
  } catch (err) {
    next(err);
  }
}

async function supprimer(req, res, next) {
  try {
    const impayees = await query(
      `SELECT COUNT(*) FROM factures WHERE client_id = $1 AND statut != 'payee'`,
      [req.params.id]
    );
    if (parseInt(impayees.rows[0].count, 10) > 0) {
      return res.status(409).json({ message: 'Impossible de supprimer : le client a des factures impayées' });
    }

    const resultat = await query('DELETE FROM clients WHERE id = $1 RETURNING id', [req.params.id]);
    if (resultat.rows.length === 0) {
      return res.status(404).json({ message: 'Client introuvable' });
    }
    res.status(204).send();
  } catch (err) {
    next(err);
  }
}

module.exports = { liste, detail, creer, modifier, changerStatut, supprimer };
