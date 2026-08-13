const jwt = require('jsonwebtoken');
const logger = require('../config/logger');
const { query } = require('../config/db');
const { escapeHtml } = require('../utils/escapeHtml');

function initialiserSupport(io) {
  io.use((socket, next) => {
    const token = socket.handshake.auth && socket.handshake.auth.token;

    if (!token) {
      return next(new Error('Token invalide'));
    }

    try {
      const payload = jwt.verify(token, process.env.JWT_SECRET);
      socket.data.user = payload;
      next();
    } catch (err) {
      logger.warn(`Connexion Socket.IO refusée : ${err.message}`);
      next(new Error('Token invalide'));
    }
  });

  async function chargerTicket(ticketId) {
    const resultat = await query(
      `SELECT t.*, c.utilisateur_id AS client_utilisateur_id
       FROM tickets t JOIN clients c ON c.id = t.client_id
       WHERE t.id = $1`,
      [ticketId]
    );

    return resultat.rows[0] || null;
  }

  function estParticipant(utilisateur, ticket) {
    if (!ticket) return false;
    if (utilisateur.role === 'admin') return true;
    if (utilisateur.role === 'client') return ticket.client_utilisateur_id === utilisateur.id;
    if (utilisateur.role === 'agent') return !ticket.agent_id || ticket.agent_id === utilisateur.id;
    return false;
  }

  io.on('connection', (socket) => {
    const utilisateur = socket.data.user;

    socket.join(`user:${utilisateur.id}`);
    if (utilisateur.role === 'agent') {
      socket.join('agents');
    }

    logger.info(`Socket connecté : utilisateur ${utilisateur.id} (${utilisateur.role})`);

    socket.on('ticket:rejoindre', async ({ ticketId } = {}) => {
      try {
        const ticket = await chargerTicket(ticketId);
        if (!estParticipant(utilisateur, ticket)) return;
        socket.join(`ticket:${ticketId}`);
      } catch (err) {
        logger.error(`ticket:rejoindre — ${err.message}`);
      }
    });

    socket.on('ticket:ouvrir', async (donnees = {}, ack) => {
      try {
        let clientId = donnees.clientId;

        if (utilisateur.role === 'client') {
          const sonClient = await query('SELECT id FROM clients WHERE utilisateur_id = $1', [utilisateur.id]);
          clientId = sonClient.rows[0] ? sonClient.rows[0].id : null;
        }

        if (!clientId) {
          return typeof ack === 'function' && ack({ erreur: 'Aucune fiche client associée' });
        }

        if (!donnees.sujet || !String(donnees.sujet).trim()) {
          return typeof ack === 'function' && ack({ erreur: 'Le sujet est requis' });
        }

        const resultat = await query(
          `INSERT INTO tickets (client_id, sujet, statut) VALUES ($1, $2, 'ouvert') RETURNING *`,
          [clientId, String(donnees.sujet).trim()]
        );
        const ticket = resultat.rows[0];

        socket.join(`ticket:${ticket.id}`);
        io.to('agents').emit('ticket:nouveau', ticket);

        if (typeof ack === 'function') {
          ack(ticket);
        }
      } catch (err) {
        logger.error(`ticket:ouvrir — ${err.message}`);
        if (typeof ack === 'function') {
          ack({ erreur: 'Erreur serveur' });
        }
      }
    });

    socket.on('ticket:assigner', async ({ ticketId } = {}, ack) => {
      try {
        if (utilisateur.role !== 'agent') {
          return typeof ack === 'function' && ack({ erreur: 'Seul un agent peut prendre en charge un ticket' });
        }

        const ticketAvant = await chargerTicket(ticketId);
        if (!ticketAvant) {
          return typeof ack === 'function' && ack({ erreur: 'Ticket introuvable' });
        }

        if (ticketAvant.agent_id && ticketAvant.agent_id !== utilisateur.id) {
          return typeof ack === 'function' && ack({ erreur: 'Ce ticket est déjà pris en charge par un autre agent' });
        }

        const resultat = await query(
          `UPDATE tickets SET agent_id = $1, statut = 'en_cours' WHERE id = $2 RETURNING *`,
          [utilisateur.id, ticketId]
        );
        const ticket = resultat.rows[0];

        socket.join(`ticket:${ticket.id}`);
        if (typeof ack === 'function') {
          ack(ticket);
        }

        if (ticketAvant.client_utilisateur_id) {
          io.to(`user:${ticketAvant.client_utilisateur_id}`).emit('ticket:pris_en_charge', ticket);
        }

        io.to('agents').emit('ticket:mis_a_jour', ticket);
      } catch (err) {
        logger.error(`ticket:assigner — ${err.message}`);
      }
    });

    socket.on('message:envoyer', async ({ ticketId, contenu, type } = {}) => {
      try {
        if (!contenu || !String(contenu).trim()) {
          return;
        }

        const ticket = await chargerTicket(ticketId);
        if (!estParticipant(utilisateur, ticket)) return;

        const contenuPropre = escapeHtml(String(contenu));
        const resultat = await query(
          `INSERT INTO messages (ticket_id, expediteur_id, type, contenu, envoye_le)
           VALUES ($1, $2, $3, $4, NOW()) RETURNING *`,
          [ticketId, utilisateur.id, type || 'texte', contenuPropre]
        );

        io.to(`ticket:${ticketId}`).emit('message:nouveau', resultat.rows[0]);
      } catch (err) {
        logger.error(`message:envoyer — ${err.message}`);
      }
    });

    socket.on('message:lu', async ({ messageId } = {}) => {
      try {
        const messageResultat = await query('SELECT ticket_id, expediteur_id FROM messages WHERE id = $1', [messageId]);
        const message = messageResultat.rows[0];

        if (!message) return;

        const ticket = await chargerTicket(message.ticket_id);
        if (!estParticipant(utilisateur, ticket)) return;

        await query(
          `INSERT INTO messages_statut (message_id, utilisateur_id, statut, lu_le)
           VALUES ($1, $2, 'lu', NOW())
           ON CONFLICT (message_id, utilisateur_id) DO UPDATE SET statut = 'lu', lu_le = NOW()`,
          [messageId, utilisateur.id]
        );

        if (message.expediteur_id && message.expediteur_id !== utilisateur.id) {
          io.to(`user:${message.expediteur_id}`).emit('message:statut', { messageId, statut: 'lu' });
        }
      } catch (err) {
        logger.error(`message:lu — ${err.message}`);
      }
    });

    socket.on('message:reagir', async ({ messageId, emoji } = {}) => {
      try {
        if (!emoji) return;

        const messageResultat = await query('SELECT ticket_id FROM messages WHERE id = $1', [messageId]);
        const message = messageResultat.rows[0];
        if (!message) return;

        const ticket = await chargerTicket(message.ticket_id);
        if (!estParticipant(utilisateur, ticket)) return;

        const existante = await query(
          'SELECT 1 FROM reactions WHERE message_id = $1 AND utilisateur_id = $2 AND emoji = $3',
          [messageId, utilisateur.id, emoji]
        );

        if (existante.rows.length > 0) {
          await query('DELETE FROM reactions WHERE message_id = $1 AND utilisateur_id = $2 AND emoji = $3', [
            messageId,
            utilisateur.id,
            emoji,
          ]);
        } else {
          await query('INSERT INTO reactions (message_id, utilisateur_id, emoji) VALUES ($1, $2, $3)', [
            messageId,
            utilisateur.id,
            emoji,
          ]);
        }

        const compteurs = await query(
          'SELECT emoji, COUNT(*)::int AS total FROM reactions WHERE message_id = $1 GROUP BY emoji',
          [messageId]
        );

        io.to(`ticket:${message.ticket_id}`).emit('message:reaction', { messageId, reactions: compteurs.rows });
      } catch (err) {
        logger.error(`message:reagir — ${err.message}`);
      }
    });

    socket.on('fichier:partager', async (donnees = {}) => {
      try {
        const { ticketId, fichierUrl, fichierNom, fichierTaille, mimeType } = donnees;
        if (!ticketId || !fichierUrl) return;

        const ticket = await chargerTicket(ticketId);
        if (!estParticipant(utilisateur, ticket)) return;

        let type = 'fichier';
        if (mimeType && mimeType.startsWith('image/')) {
          type = 'image';
        } else if (mimeType && mimeType.startsWith('audio/')) {
          type = 'audio';
        }

        const resultat = await query(
          `INSERT INTO messages (ticket_id, expediteur_id, type, fichier_url, fichier_nom, fichier_taille, envoye_le)
           VALUES ($1, $2, $3, $4, $5, $6, NOW()) RETURNING *`,
          [ticketId, utilisateur.id, type, fichierUrl, fichierNom, fichierTaille]
        );

        io.to(`ticket:${ticketId}`).emit('message:nouveau', resultat.rows[0]);
      } catch (err) {
        logger.error(`fichier:partager — ${err.message}`);
      }
    });

    socket.on('frappe', ({ ticketId, nom } = {}) => {
      if (!ticketId) return;
      socket.to(`ticket:${ticketId}`).emit('frappe', { nom });
    });

    socket.on('ticket:fermer', async ({ ticketId } = {}, ack) => {
      try {
        if (utilisateur.role !== 'agent' && utilisateur.role !== 'admin') {
          return typeof ack === 'function' && ack({ erreur: 'Seul un agent peut clôturer un ticket' });
        }

        const ticketAvant = await chargerTicket(ticketId);
        if (!estParticipant(utilisateur, ticketAvant)) {
          return typeof ack === 'function' && ack({ erreur: 'Vous ne gérez pas ce ticket' });
        }

        const resultat = await query(
          `UPDATE tickets SET statut = 'ferme', ferme_le = NOW() WHERE id = $1 RETURNING *`,
          [ticketId]
        );
        const ticket = resultat.rows[0];

        io.to(`ticket:${ticketId}`).emit('ticket:ferme', ticket);
        if (typeof ack === 'function') {
          ack(ticket);
        }

        if (ticketAvant.client_utilisateur_id) {
          io.to(`user:${ticketAvant.client_utilisateur_id}`).emit('notification:push', {
            type: 'ticket_ferme',
            message: 'Votre ticket de support a été clôturé.',
          });
        }
      } catch (err) {
        logger.error(`ticket:fermer — ${err.message}`);
      }
    });

    socket.on('disconnect', () => {
      logger.info(`Socket déconnecté : utilisateur ${utilisateur.id}`);
    });
  });
}

module.exports = initialiserSupport;
