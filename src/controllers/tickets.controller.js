const { query } = require('../config/db');

function construireFiltres(reqQuery, clauseAgentId = null) {
  const conditions = [];
  const valeurs = [];
  let i = 1;

  if (reqQuery.statut) {
    conditions.push(`statut = $${i}`);
    valeurs.push(reqQuery.statut);
    i++;
  }
  if (reqQuery.client_id) {
    conditions.push(`client_id = $${i}`);
    valeurs.push(reqQuery.client_id);
    i++;
  }

  if (clauseAgentId !== null) {
    // Un agent voit ses tickets actifs + les tickets non assignés qui sont ouverts.
    if (reqQuery.statut) {
      conditions.push(`(agent_id = $${i} OR agent_id IS NULL)`);
      valeurs.push(clauseAgentId);
      i++;
    } else {
      conditions.push(
        `((agent_id = $${i} OR agent_id IS NULL) AND ((agent_id = $${i} AND statut != 'ferme') OR (agent_id IS NULL AND statut = 'ouvert')))`
      );
      valeurs.push(clauseAgentId);
      i++;
    }
  } else if (reqQuery.agent_id) {
    conditions.push(`agent_id = $${i}`);
    valeurs.push(reqQuery.agent_id);
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

    // M2/M3 — un client ne voit que ses propres tickets ; un agent voit les siens
    // + les tickets non assignés (pour pouvoir les prendre en charge).
    const filtres = { ...req.query };
    let clauseAgentId = null;

    if (req.user.role === 'client') {
      const sonClient = await query('SELECT id FROM clients WHERE utilisateur_id = $1', [req.user.id]);
      filtres.client_id = sonClient.rows[0] ? sonClient.rows[0].id : -1;
    } else if (req.user.role === 'agent') {
      clauseAgentId = req.user.id;
    }

    const { whereSql, valeurs } = construireFiltres(filtres, clauseAgentId);

    const totalResultat = await query(`SELECT COUNT(*) FROM tickets ${whereSql}`, valeurs);
    const total = parseInt(totalResultat.rows[0].count, 10);

    const donneesResultat = await query(
      `SELECT * FROM tickets ${whereSql} ORDER BY ouvert_le DESC LIMIT $${valeurs.length + 1} OFFSET $${valeurs.length + 2}`,
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
      `SELECT t.*, c.utilisateur_id AS client_utilisateur_id
       FROM tickets t JOIN clients c ON c.id = t.client_id
       WHERE t.id = $1`,
      [req.params.id]
    );
    if (resultat.rows.length === 0) {
      return res.status(404).json({ message: 'Ticket introuvable' });
    }

    const ticket = resultat.rows[0];

    if (req.user.role === 'client' && ticket.client_utilisateur_id !== req.user.id) {
      return res.status(403).json({ message: "Vous ne pouvez accéder qu'à vos propres tickets" });
    }
    if (req.user.role === 'agent' && ticket.agent_id && ticket.agent_id !== req.user.id) {
      return res.status(403).json({ message: 'Ce ticket est assigné à un autre agent' });
    }

    delete ticket.client_utilisateur_id;
    res.json(ticket);
  } catch (err) {
    next(err);
  }
}

async function creer(req, res, next) {
  try {
    let clientId = req.body.client_id;

    // Un client crée toujours un ticket pour sa propre fiche, jamais pour un client_id fourni.
    if (req.user.role === 'client') {
      const sonClient = await query('SELECT id FROM clients WHERE utilisateur_id = $1', [req.user.id]);
      if (sonClient.rows.length === 0) {
        return res.status(422).json({
          erreurs: [{ champ: 'client_id', message: 'Aucune fiche client associée à ce compte' }],
        });
      }
      clientId = sonClient.rows[0].id;
    } else if (!clientId) {
      return res.status(422).json({ erreurs: [{ champ: 'client_id', message: 'client_id est requis' }] });
    }

    const resultat = await query(
      `INSERT INTO tickets (client_id, sujet, statut) VALUES ($1, $2, 'ouvert') RETURNING *`,
      [clientId, req.body.sujet]
    );
    const ticket = resultat.rows[0];

    // Diffuse le nouveau ticket aux agents connectés (room "agents") si Socket.IO est actif.
    const io = req.app.get('io');
    if (io) {
      io.to('agents').emit('ticket:nouveau', ticket);
    }

    res.status(201).json(ticket);
  } catch (err) {
    next(err);
  }
}

async function changerStatut(req, res, next) {
  try {
    const { statut } = req.body;

    const sql =
      statut === 'ferme'
        ? `UPDATE tickets SET statut = $1, ferme_le = NOW() WHERE id = $2 RETURNING *`
        : `UPDATE tickets SET statut = $1 WHERE id = $2 RETURNING *`;

    const resultat = await query(sql, [statut, req.params.id]);
    if (resultat.rows.length === 0) {
      return res.status(404).json({ message: 'Ticket introuvable' });
    }
    res.json(resultat.rows[0]);
  } catch (err) {
    next(err);
  }
}

// Historique des messages, 50 par page, curseur ?avant=timestamp (voir M3).
async function messages(req, res, next) {
  try {
    const limite = 50;
    const conditions = ['ticket_id = $1'];
    const valeurs = [req.params.id];

    if (req.query.avant) {
      conditions.push(`envoye_le < $2`);
      valeurs.push(req.query.avant);
    }

    const resultat = await query(
      `SELECT * FROM messages WHERE ${conditions.join(' AND ')} ORDER BY envoye_le DESC LIMIT ${limite}`,
      valeurs
    );

    const lignes = resultat.rows;

    // Les réactions ne survivraient pas à un rechargement de page si on ne les rejoignait pas ici.
    if (lignes.length > 0) {
      const idsMessages = lignes.map((m) => m.id);
      const reactionsResultat = await query(
        'SELECT message_id, emoji, COUNT(*)::int AS total FROM reactions WHERE message_id = ANY($1::int[]) GROUP BY message_id, emoji',
        [idsMessages]
      );

      const reactionsParMessage = {};
      reactionsResultat.rows.forEach((r) => {
        if (!reactionsParMessage[r.message_id]) reactionsParMessage[r.message_id] = [];
        reactionsParMessage[r.message_id].push({ emoji: r.emoji, total: r.total });
      });

      lignes.forEach((m) => {
        m.reactions = reactionsParMessage[m.id] || [];
      });
    }

    res.json({ data: lignes });
  } catch (err) {
    next(err);
  }
}

// Réception du fichier (multer) — le stockage est fait, mais l'INSERT en BDD et la diffusion
// Socket.IO sont déclenchés côté client via l'événement "fichier:partager" (voir src/socket/support.js).
async function uploadFichier(req, res, next) {
  try {
    if (!req.file) {
      return res.status(422).json({ erreurs: [{ champ: 'fichier', message: 'Aucun fichier reçu' }] });
    }

    res.status(201).json({
      ticketId: req.params.id,
      fichierUrl: `/uploads/${req.file.filename}`,
      fichierNom: req.file.originalname,
      fichierTaille: req.file.size,
      mimeType: req.file.mimetype,
    });
  } catch (err) {
    next(err);
  }
}

async function historiqueAppels(req, res, next) {
  try {
    const resultat = await query('SELECT * FROM appels WHERE ticket_id = $1 ORDER BY debut_le DESC', [
      req.params.id,
    ]);
    res.json({ data: resultat.rows });
  } catch (err) {
    next(err);
  }
}

module.exports = { liste, detail, creer, changerStatut, messages, uploadFichier, historiqueAppels };
