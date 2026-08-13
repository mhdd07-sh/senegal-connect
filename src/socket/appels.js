const { query } = require('../config/db');
const logger = require('../config/logger');

function initialiserAppels(io) {
  io.on('connection', (socket) => {
    const utilisateur = socket.data.user;

    socket.on('appel:initier', async ({ ticketId, type, peerId } = {}, ack) => {
      try {
        const ticketResultat = await query(
          `SELECT t.*, c.utilisateur_id AS client_utilisateur_id
           FROM tickets t JOIN clients c ON c.id = t.client_id
           WHERE t.id = $1`,
          [ticketId]
        );
        const ticket = ticketResultat.rows[0];

        if (!ticket) {
          return typeof ack === 'function' && ack({ erreur: 'Ticket introuvable' });
        }

        if (ticket.statut !== 'en_cours') {
          return typeof ack === 'function' && ack({ erreur: 'Le ticket doit être "en_cours" pour démarrer un appel' });
        }

        const estClientDuTicket = utilisateur.role === 'client' && ticket.client_utilisateur_id === utilisateur.id;
        const estAgentDuTicket = utilisateur.role === 'agent' && ticket.agent_id === utilisateur.id;
        if (!estClientDuTicket && !estAgentDuTicket && utilisateur.role !== 'admin') {
          return typeof ack === 'function' && ack({ erreur: 'Vous ne participez pas à ce ticket' });
        }

        const destinataireId = utilisateur.role === 'client' ? ticket.agent_id : ticket.client_utilisateur_id;
        if (!destinataireId) {
          return typeof ack === 'function' && ack({ erreur: 'Aucun destinataire disponible pour cet appel' });
        }

        const appelResultat = await query(
          `INSERT INTO appels (ticket_id, initiateur_id, destinataire_id, type, statut)
           VALUES ($1, $2, $3, $4, 'initie') RETURNING *`,
          [ticketId, utilisateur.id, destinataireId, type || 'audio']
        );
        const appel = appelResultat.rows[0];

        io.to(`user:${destinataireId}`).emit('appel:entrant', {
          appelId: appel.id,
          initiateur: { id: utilisateur.id, nom: utilisateur.nom || 'Utilisateur' },
          type: appel.type,
          peerIdInitiateur: peerId || null,
          ticketId,
        });

        if (typeof ack === 'function') {
          ack({ appelId: appel.id, statut: appel.statut });
        }
      } catch (err) {
        logger.error(`appel:initier — ${err.message}`);
        if (typeof ack === 'function') {
          ack({ erreur: 'Erreur serveur' });
        }
      }
    });

    socket.on('appel:accepter', async ({ appelId, peerId } = {}) => {
      try {
        const resultat = await query(
          `UPDATE appels
           SET statut = 'accepte', debut_le = COALESCE(debut_le, NOW())
           WHERE id = $1
           RETURNING *`,
          [appelId]
        );
        const appel = resultat.rows[0];
        if (!appel) return;

        io.to(`user:${appel.initiateur_id}`).emit('appel:accepte', {
          appelId: appel.id,
          peerIdDestinataire: peerId || null,
        });

        io.to(`user:${appel.initiateur_id}`).emit('appel:monitor', {
          appelId: appel.id,
          type: appel.type,
          action: 'accepte',
          destinataireId: appel.destinataire_id,
        });

        io.to(`user:${appel.destinataire_id}`).emit('appel:monitor', {
          appelId: appel.id,
          type: appel.type,
          action: 'accepte',
          initiateurId: appel.initiateur_id,
        });
      } catch (err) {
        logger.error(`appel:accepter — ${err.message}`);
      }
    });

    socket.on('appel:refuser', async ({ appelId } = {}) => {
      try {
        const resultat = await query(
          `UPDATE appels SET statut = 'refuse', fin_le = NOW() WHERE id = $1 RETURNING *`,
          [appelId]
        );
        const appel = resultat.rows[0];
        if (!appel) return;

        io.to(`user:${appel.initiateur_id}`).emit('appel:refuse', { appelId: appel.id });
      } catch (err) {
        logger.error(`appel:refuser — ${err.message}`);
      }
    });

    socket.on('appel:terminer', async ({ appelId } = {}) => {
      try {
        const appelResultat = await query('SELECT * FROM appels WHERE id = $1', [appelId]);
        const appel = appelResultat.rows[0];
        if (!appel) return;

        const debut = appel.debut_le ? new Date(appel.debut_le) : new Date();
        const dureeSecondes = Number.isFinite(debut.getTime())
          ? Math.max(0, Math.round((Date.now() - debut.getTime()) / 1000))
          : 0;

        const resultat = await query(
          `UPDATE appels SET statut = 'termine', duree_secondes = $1, fin_le = NOW() WHERE id = $2 RETURNING *`,
          [dureeSecondes, appelId]
        );
        const appelTermine = resultat.rows[0];

        io.to(`user:${appel.initiateur_id}`).emit('appel:termine', appelTermine);
        io.to(`user:${appel.destinataire_id}`).emit('appel:termine', appelTermine);
      } catch (err) {
        logger.error(`appel:terminer — ${err.message}`);
      }
    });

    socket.on('appel:controle', async ({ appelId, micro, video, partageEcran } = {}) => {
      try {
        const resultat = await query('SELECT initiateur_id, destinataire_id FROM appels WHERE id = $1', [appelId]);
        const appel = resultat.rows[0];
        if (!appel) return;

        const autreParticipantId = utilisateur.id === appel.initiateur_id ? appel.destinataire_id : appel.initiateur_id;
        io.to(`user:${autreParticipantId}`).emit('appel:controle', {
          appelId,
          micro,
          video,
          partageEcran,
          source: utilisateur.id,
        });
      } catch (err) {
        logger.error(`appel:controle — ${err.message}`);
      }
    });
  });
}

module.exports = initialiserAppels;
