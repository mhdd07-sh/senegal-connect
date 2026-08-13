require('dotenv').config();

const http = require('http');
const path = require('path');
const express = require('express');
const cors = require('cors');
const morgan = require('morgan');
const { Server } = require('socket.io');
const { PeerServer } = require('peer');

const logger = require('./config/logger');
const { swaggerUi, swaggerSpec } = require('./config/swagger');
const { gestionnaireErreurs, routeInconnue } = require('./middleware/erreurs');

const authRoutes = require('./routes/auth');
const clientsRoutes = require('./routes/clients');
const forfaitsRoutes = require('./routes/forfaits');
const facturesRoutes = require('./routes/factures');
const statsRoutes = require('./routes/stats');
const ticketsRoutes = require('./routes/tickets');
const initialiserSupport = require('./socket/support');
const initialiserAppels = require('./socket/appels');

const app = express();
const server = http.createServer(app);

// CORS avec origines explicites (jamais '*' en production)
const origines = (process.env.CORS_ORIGINS || '')
  .split(',')
  .map((o) => o.trim())
  .filter(Boolean);

const corsOptions = {
  origin: origines.length ? origines : true,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'],
  credentials: true,
};

app.use(cors(corsOptions));
app.use(express.json());
if (process.env.NODE_ENV !== 'test') {
  app.use(morgan('combined', { stream: logger.stream }));
}
app.use(express.static(path.join(__dirname, '../public')));
app.use('/uploads', express.static(path.join(__dirname, '../uploads')));
app.use('/api/docs', swaggerUi.serve, swaggerUi.setup(swaggerSpec, {
  customSiteTitle: 'Sénégal Connect API',
  persistAuthorization: true,
}));
app.get('/api/docs.json', (req, res) => {
  res.json(swaggerSpec);
});

// ---- Routes métier (Modèle 1 : Requête/Réponse) ----
app.use('/api/auth', authRoutes);
app.use('/api/clients', clientsRoutes);
app.use('/api/forfaits', forfaitsRoutes);
app.use('/api/factures', facturesRoutes);
app.use('/api/stats', statsRoutes);
app.use('/api/tickets', ticketsRoutes);

app.get('/', (req, res) => {
  res.redirect('/index.html');
});

app.get('/app', (req, res) => {
  res.redirect('/app.html');
});

// ---- Healthcheck (utilisé par le HEALTHCHECK Docker) ----
const demarreLe = Date.now();
app.get('/api/health', (req, res) => {
  res.json({
    statut: 'ok',
    version: require('../package.json').version,
    uptime: Math.floor((Date.now() - demarreLe) / 1000),
    env: process.env.NODE_ENV || 'development',
  });
});

const io = new Server(server, {
  cors: corsOptions,
  path: '/socket.io',
  transports: ['polling', 'websocket'],
});


const PORT = Number(process.env.PORT || 3000);
const PEER_PORT = Number(process.env.PEERJS_PORT || 9001);

/*const peerServer = PeerServer({
  host: '127.0.0.1',
  port: PEER_PORT,
  path: '/peerjs',
  alive_timeout: 60,
  cleanUpClosedSessions: true,
  allow_discovery: false,
  proxied: false,
});*/

const peerServer = PeerServer({
  host: '0.0.0.0',
  port: PEER_PORT,
  path: '/peerjs',
  alive_timeout: 60000,
  cleanUpClosedSessions: true,
  allow_discovery: false,
  proxied: false,
});

peerServer.on('error', (error) => {
  logger.error(`PeerJS — ${error.message || error}`);
});

logger.info(`PeerJS démarré sur le port ${PEER_PORT}`);

app.set('io', io);
app.server = server;
initialiserSupport(io);
initialiserAppels(io);

// ---- Middleware d'erreurs — TOUJOURS déclaré en dernier ----
app.use(routeInconnue);
app.use(gestionnaireErreurs);

// N'écoute que si le fichier est exécuté directement (permet à Supertest
// d'importer `app` dans les tests sans ouvrir de vrai port).
if (require.main === module) {
  server.listen(PORT, () => {
    logger.info(`Sénégal Connect démarré sur le port ${PORT} (${process.env.NODE_ENV || 'development'})`);
  });
}

module.exports = app;
