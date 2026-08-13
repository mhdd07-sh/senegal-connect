const swaggerJsdoc = require('swagger-jsdoc');
const swaggerUi = require('swagger-ui-express');

const options = {
  definition: {
    openapi: '3.0.3',
    info: {
      title: 'Sénégal Connect API',
      version: require('../../package.json').version,
      description: 'API REST pour opérateur télécom avec support client en temps réel, chat via Socket.IO et visio WebRTC/PeerJS.',
    },
    servers: [
      {
        url: 'http://localhost:3000',
        description: 'Serveur local',
      },
    ],
    components: {
      securitySchemes: {
        BearerAuth: {
          type: 'http',
          scheme: 'bearer',
          bearerFormat: 'JWT',
        },
      },
      schemas: {
        Client: {
          type: 'object',
          properties: {
            id: { type: 'integer' },
            utilisateur_id: { type: 'integer' },
            nom: { type: 'string' },
            prenom: { type: 'string' },
            msisdn: { type: 'string' },
            email: { type: 'string', format: 'email' },
            forfait_id: { type: ['integer', 'null'] },
            statut: { type: 'string' },
          },
        },
        Forfait: {
          type: 'object',
          properties: {
            id: { type: 'integer' },
            nom: { type: 'string' },
            quota_data_go: { type: 'number' },
            quota_voix_min: { type: 'integer' },
            prix_mensuel_fcfa: { type: 'number' },
          },
        },
        Facture: {
          type: 'object',
          properties: {
            id: { type: 'integer' },
            client_id: { type: 'integer' },
            periode: { type: 'string', example: '2025-07' },
            montant_fcfa: { type: 'number' },
            date_echeance: { type: 'string', format: 'date' },
            statut: { type: 'string' },
          },
        },
        Pagination: {
          type: 'object',
          properties: {
            total: { type: 'integer' },
            page: { type: 'integer' },
            limite: { type: 'integer' },
            total_pages: { type: 'integer' },
          },
        },
        Erreur: {
          type: 'object',
          properties: {
            message: { type: 'string' },
          },
        },
      },
    },
    security: [{ BearerAuth: [] }],
  },
  apis: ['./src/routes/*.js'],
};

const swaggerSpec = swaggerJsdoc(options);

module.exports = {
  swaggerUi,
  swaggerSpec,
};
