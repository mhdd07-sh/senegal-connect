const { query } = require('../config/db');

// Référence lisible : FAC-YYYYMM-XXXX (XXXX = suffixe aléatoire à 4 chiffres)
function genererReference(periode) {
  const yyyymm = periode.replace('-', '');
  const suffixe = Math.floor(1000 + Math.random() * 9000);
  return `FAC-${yyyymm}-${suffixe}`;
}

async function genererReferenceUnique(periode) {
  for (let tentative = 0; tentative < 5; tentative++) {
    const reference = genererReference(periode);
    const resultat = await query('SELECT 1 FROM factures WHERE reference = $1', [reference]);
    if (resultat.rows.length === 0) {
      return reference;
    }
  }
  throw new Error('Impossible de générer une référence de facture unique');
}

function construireFiltres(reqQuery) {
  const conditions = [];
  const valeurs = [];
  let i = 1;

  if (reqQuery.client_id) {
    conditions.push(`client_id = $${i}`);
    valeurs.push(reqQuery.client_id);
    i++;
  }
  if (reqQuery.statut) {
    conditions.push(`statut = $${i}`);
    valeurs.push(reqQuery.statut);
    i++;
  }
  if (reqQuery.periode) {
    conditions.push(`periode = $${i}`);
    valeurs.push(reqQuery.periode);
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

    // M2 — Contrôle des rôles : un client (rôle "client") ne voit jamais que ses propres
    // factures, quel que soit le ?client_id= qu'il fournit dans la requête.
    const filtres = { ...req.query };
    if (req.user.role === 'client') {
      const sonClient = await query('SELECT id FROM clients WHERE utilisateur_id = $1', [req.user.id]);
      filtres.client_id = sonClient.rows[0] ? sonClient.rows[0].id : -1; // -1 → aucune facture si pas de fiche liée
    }

    const { whereSql, valeurs } = construireFiltres(filtres);

    const totalResultat = await query(`SELECT COUNT(*) FROM factures ${whereSql}`, valeurs);
    const total = parseInt(totalResultat.rows[0].count, 10);

    const donneesResultat = await query(
      `SELECT * FROM factures ${whereSql} ORDER BY date_emission DESC LIMIT $${valeurs.length + 1} OFFSET $${valeurs.length + 2}`,
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
    const resultat = await query(
      `SELECT f.*, c.nom AS client_nom, c.prenom AS client_prenom, c.msisdn AS client_msisdn,
              c.utilisateur_id AS client_utilisateur_id
       FROM factures f JOIN clients c ON c.id = f.client_id
       WHERE f.id = $1`,
      [req.params.id]
    );
    if (resultat.rows.length === 0) {
      return res.status(404).json({ message: 'Facture introuvable' });
    }

    const facture = resultat.rows[0];

    // M2 — un client authentifié ne peut consulter que ses propres factures.
    if (req.user.role === 'client' && facture.client_utilisateur_id !== req.user.id) {
      return res.status(403).json({ message: 'Vous ne pouvez accéder qu\'à vos propres factures' });
    }
    delete facture.client_utilisateur_id; // identifiant interne, jamais exposé dans la réponse

    res.json(facture);
  } catch (err) {
    next(err);
  }
}

async function creer(req, res, next) {
  try {
    const { client_id, periode, montant_fcfa, date_echeance } = req.body;

    const clientExiste = await query('SELECT id FROM clients WHERE id = $1', [client_id]);
    if (clientExiste.rows.length === 0) {
      return res.status(422).json({
        erreurs: [{ champ: 'client_id', message: "Ce client n'existe pas", valeur: client_id }],
      });
    }

    const reference = genererReference(periode);
    const resultat = await query(
      `INSERT INTO factures (client_id, reference, periode, montant_fcfa, statut, date_echeance)
       VALUES ($1, $2, $3, $4, 'impayee', $5) RETURNING *`,
      [client_id, reference, periode, montant_fcfa, date_echeance]
    );

    res.status(201).json(resultat.rows[0]);
  } catch (err) {
    next(err);
  }
}

async function changerStatut(req, res, next) {
  try {
    const { statut } = req.body;
    const resultat = await query('UPDATE factures SET statut = $1 WHERE id = $2 RETURNING *', [
      statut,
      req.params.id,
    ]);
    if (resultat.rows.length === 0) {
      return res.status(404).json({ message: 'Facture introuvable' });
    }
    res.json(resultat.rows[0]);
  } catch (err) {
    next(err);
  }
}

async function supprimer(req, res, next) {
  try {
    const resultat = await query('DELETE FROM factures WHERE id = $1 RETURNING id', [req.params.id]);
    if (resultat.rows.length === 0) {
      return res.status(404).json({ message: 'Facture introuvable' });
    }
    res.status(204).send();
  } catch (err) {
    next(err);
  }
}

module.exports = { liste, detail, creer, changerStatut, supprimer };
