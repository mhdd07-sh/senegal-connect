// ============================================================================
// Sénégal Connect — Suite de tests Jest + Supertest
// ============================================================================
// La base de données est entièrement mockée via jest.mock("../src/config/db") :
// aucun PostgreSQL réel n'est nécessaire pour exécuter cette suite.
// Commande unique : npm test
// ============================================================================

// Variables d'environnement de test — DOIVENT être définies avant tout require
// du code applicatif, car src/config/logger.js lit NODE_ENV au chargement du module.
process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'secret_de_test_ne_jamais_utiliser_en_production_64_caracteres_minimum_xx';
process.env.CORS_ORIGINS = 'http://localhost:3000';

jest.mock('../src/config/db');
jest.mock('bcrypt');

const request = require('supertest');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcrypt');
const { query } = require('../src/config/db');
const app = require('../src/server');

// ----------------------------------------------------------------------------
// Helpers
// ----------------------------------------------------------------------------

function genererToken(donnees = {}) {
  return jwt.sign(
    { id: 1, nom: 'Admin', email: 'admin@senegalconnect.sn', role: 'admin', ...donnees },
    process.env.JWT_SECRET,
    { expiresIn: '24h', issuer: 'senegal-connect' }
  );
}

function genererTokenExpire() {
  return jwt.sign(
    { id: 1, nom: 'Admin', email: 'admin@senegalconnect.sn', role: 'admin' },
    process.env.JWT_SECRET,
    { expiresIn: '-10s', issuer: 'senegal-connect' }
  );
}

const tokenAdmin = () => genererToken({ role: 'admin' });

beforeEach(() => {
  query.mockReset();
  bcrypt.hash.mockReset().mockResolvedValue('$2b$12$hashFictifPourLesTests..........................');
  bcrypt.compare.mockReset().mockResolvedValue(true);
});

// ============================================================================
// AUTH (5 tests)
// ============================================================================
describe('Auth', () => {
  test('inscription valide → 201', async () => {
    query.mockResolvedValueOnce({
      rows: [{ id: 1, nom: 'Fall', prenom: 'Awa', email: 'awa.fall@example.sn', role: 'client', cree_le: new Date() }],
    });

    const reponse = await request(app).post('/api/auth/register').send({
      nom: 'Fall',
      prenom: 'Awa',
      email: 'awa.fall@example.sn',
      mot_de_passe: 'motdepasse123',
    });

    expect(reponse.status).toBe(201);
    expect(reponse.body.email).toBe('awa.fall@example.sn');
    expect(bcrypt.hash).toHaveBeenCalledWith('motdepasse123', 12);
  });

  test('inscription avec email déjà utilisé → 409', async () => {
    const erreurDoublon = new Error('duplicate key value violates unique constraint');
    erreurDoublon.code = '23505';
    erreurDoublon.detail = 'Key (email)=(awa.fall@example.sn) already exists.';
    query.mockRejectedValueOnce(erreurDoublon);

    const reponse = await request(app).post('/api/auth/register').send({
      nom: 'Fall',
      prenom: 'Awa',
      email: 'awa.fall@example.sn',
      mot_de_passe: 'motdepasse123',
    });

    expect(reponse.status).toBe(409);
    expect(reponse.body.message).toMatch(/email/);
  });

  test('login valide → retourne un JWT', async () => {
    query.mockResolvedValueOnce({
      rows: [
        {
          id: 4,
          nom: 'Sow',
          email: 'moussa.sow@example.sn',
          mot_de_passe: '$2b$12$hashFictif',
          role: 'client',
        },
      ],
    });

    const reponse = await request(app)
      .post('/api/auth/login')
      .send({ email: 'moussa.sow@example.sn', mot_de_passe: 'motdepasse123' });

    expect(reponse.status).toBe(200);
    expect(reponse.body.token).toBeDefined();
    expect(reponse.body.utilisateur.role).toBe('client');

    const payload = jwt.verify(reponse.body.token, process.env.JWT_SECRET);
    expect(payload.email).toBe('moussa.sow@example.sn');
  });

  test('login avec email inconnu → 401', async () => {
    query.mockResolvedValueOnce({ rows: [] });

    const reponse = await request(app)
      .post('/api/auth/login')
      .send({ email: 'inconnu@example.sn', mot_de_passe: 'motdepasse123' });

    expect(reponse.status).toBe(401);
    expect(reponse.body.message).toBe('Identifiants incorrects');
  });

  test('token expiré sur route protégée → 401', async () => {
    const reponse = await request(app)
      .get('/api/auth/profil')
      .set('Authorization', `Bearer ${genererTokenExpire()}`);

    expect(reponse.status).toBe(401);
    expect(reponse.body.message).toMatch(/expiré/);
  });
});

// ============================================================================
// CLIENTS (5 tests)
// ============================================================================
describe('Clients', () => {
  test('liste paginée retourne data + pagination', async () => {
    query.mockResolvedValueOnce({ rows: [{ count: '2' }] }); // COUNT(*)
    query.mockResolvedValueOnce({
      rows: [
        { id: 1, nom: 'Sow', prenom: 'Moussa', msisdn: '+221771234567' },
        { id: 2, nom: 'Ba', prenom: 'Fatou', msisdn: '+221772345678' },
      ],
    });

    const reponse = await request(app)
      .get('/api/clients?page=1&limite=20')
      .set('Authorization', `Bearer ${tokenAdmin()}`);

    expect(reponse.status).toBe(200);
    expect(reponse.body.data).toHaveLength(2);
    expect(reponse.body.pagination).toEqual({ total: 2, page: 1, limite: 20, total_pages: 1 });
  });

  test('filtrage ?q= construit une clause ILIKE dynamique', async () => {
    query.mockResolvedValueOnce({ rows: [{ count: '1' }] });
    query.mockResolvedValueOnce({ rows: [{ id: 2, nom: 'Ba', prenom: 'Fatou' }] });

    const reponse = await request(app)
      .get('/api/clients?q=Fatou')
      .set('Authorization', `Bearer ${tokenAdmin()}`);

    expect(reponse.status).toBe(200);
    expect(query.mock.calls[0][0]).toMatch(/ILIKE/);
    expect(query.mock.calls[0][1]).toEqual(['%Fatou%']);
  });

  test("détail d'un client existant renvoie forfait + facture + ticket", async () => {
    query
      .mockResolvedValueOnce({ rows: [{ id: 1, nom: 'Sow', prenom: 'Moussa', forfait_id: 2 }] }) // client
      .mockResolvedValueOnce({ rows: [{ id: 2, nom: 'Forfait Confort' }] }) // forfait
      .mockResolvedValueOnce({ rows: [{ id: 5, reference: 'FAC-202507-0001' }] }) // dernière facture
      .mockResolvedValueOnce({ rows: [] }); // ticket en cours

    const reponse = await request(app)
      .get('/api/clients/1')
      .set('Authorization', `Bearer ${tokenAdmin()}`);

    expect(reponse.status).toBe(200);
    expect(reponse.body.forfait.nom).toBe('Forfait Confort');
    expect(reponse.body.derniere_facture.reference).toBe('FAC-202507-0001');
    expect(reponse.body.ticket_en_cours).toBeNull();
  });

  test('client inexistant → 404', async () => {
    query.mockResolvedValueOnce({ rows: [] });

    const reponse = await request(app)
      .get('/api/clients/999')
      .set('Authorization', `Bearer ${tokenAdmin()}`);

    expect(reponse.status).toBe(404);
    expect(reponse.body.message).toBe('Client introuvable');
  });

  test('création avec MSISDN invalide → 422', async () => {
    const reponse = await request(app)
      .post('/api/clients')
      .set('Authorization', `Bearer ${tokenAdmin()}`)
      .send({
        utilisateur_id: 4,
        nom: 'Sow',
        prenom: 'Moussa',
        msisdn: '0771234567', // format invalide : ne commence pas par +221
        email: 'moussa.sow@example.sn',
      });

    expect(reponse.status).toBe(422);
    expect(reponse.body.erreurs.some((e) => e.champ === 'msisdn')).toBe(true);
    expect(query).not.toHaveBeenCalled(); // la validation bloque avant tout accès BDD
  });
});

// ============================================================================
// FORFAITS (4 tests)
// ============================================================================
describe('Forfaits', () => {
  test('liste des forfaits → 200 avec nb_clients', async () => {
    query.mockResolvedValueOnce({
      rows: [{ id: 1, nom: 'Forfait Essentiel', prix_mensuel_fcfa: 5000, nb_clients: '3' }],
    });

    const reponse = await request(app).get('/api/forfaits');

    expect(reponse.status).toBe(200);
    expect(reponse.body[0].nb_clients).toBe('3');
  });

  test('création sans token → 401', async () => {
    const reponse = await request(app).post('/api/forfaits').send({
      nom: 'Forfait Test',
      quota_data_go: 10,
      quota_voix_min: 100,
      prix_mensuel_fcfa: 5000,
    });

    expect(reponse.status).toBe(401);
    expect(query).not.toHaveBeenCalled();
  });

  test('création avec prix négatif → 422', async () => {
    const reponse = await request(app)
      .post('/api/forfaits')
      .set('Authorization', `Bearer ${tokenAdmin()}`)
      .send({ nom: 'Forfait Test', quota_data_go: 10, quota_voix_min: 100, prix_mensuel_fcfa: -500 });

    expect(reponse.status).toBe(422);
    expect(reponse.body.erreurs.some((e) => e.champ === 'prix_mensuel_fcfa')).toBe(true);
  });

  test("suppression d'un forfait avec clients actifs abonnés → 409", async () => {
    query.mockResolvedValueOnce({ rows: [{ count: '4' }] });

    const reponse = await request(app)
      .delete('/api/forfaits/2')
      .set('Authorization', `Bearer ${tokenAdmin()}`);

    expect(reponse.status).toBe(409);
    expect(reponse.body.message).toMatch(/abonnés/);
  });
});

// ============================================================================
// FACTURES (4 tests)
// ============================================================================
describe('Factures', () => {
  test('liste filtrée par ?client_id=', async () => {
    query.mockResolvedValueOnce({ rows: [{ count: '1' }] });
    query.mockResolvedValueOnce({ rows: [{ id: 1, client_id: 1, montant_fcfa: 10000 }] });

    const reponse = await request(app)
      .get('/api/factures?client_id=1')
      .set('Authorization', `Bearer ${tokenAdmin()}`);

    expect(reponse.status).toBe(200);
    expect(query.mock.calls[0][0]).toMatch(/client_id = \$1/);
    expect(query.mock.calls[0][1]).toEqual(['1']);
  });

  test('création avec montant négatif → 422', async () => {
    const reponse = await request(app)
      .post('/api/factures')
      .set('Authorization', `Bearer ${tokenAdmin()}`)
      .send({ client_id: 1, periode: '2025-07', montant_fcfa: -1000, date_echeance: '2025-07-15' });

    expect(reponse.status).toBe(422);
    expect(reponse.body.erreurs.some((e) => e.champ === 'montant_fcfa')).toBe(true);
    expect(query).not.toHaveBeenCalled();
  });

  test('création avec client_id inexistant → 422', async () => {
    query.mockResolvedValueOnce({ rows: [] }); // le client n'existe pas

    const reponse = await request(app)
      .post('/api/factures')
      .set('Authorization', `Bearer ${tokenAdmin()}`)
      .send({ client_id: 999, periode: '2025-07', montant_fcfa: 10000, date_echeance: '2025-07-15' });

    expect(reponse.status).toBe(422);
    expect(reponse.body.erreurs[0].champ).toBe('client_id');
  });

  test('mise à jour du statut → 200', async () => {
    query.mockResolvedValueOnce({ rows: [{ id: 1, statut: 'payee' }] });

    const reponse = await request(app)
      .put('/api/factures/1/statut')
      .set('Authorization', `Bearer ${tokenAdmin()}`)
      .send({ statut: 'payee' });

    expect(reponse.status).toBe(200);
    expect(reponse.body.statut).toBe('payee');
  });
});

// ============================================================================
// VALIDATION (4 tests)
// ============================================================================
describe('Validation', () => {
  test('email invalide → 422 avec le champ précisé', async () => {
    const reponse = await request(app)
      .post('/api/auth/register')
      .send({ nom: 'Fall', prenom: 'Awa', email: 'pas-un-email', mot_de_passe: 'motdepasse123' });

    expect(reponse.status).toBe(422);
    expect(reponse.body.erreurs).toEqual(
      expect.arrayContaining([expect.objectContaining({ champ: 'email' })])
    );
  });

  test('format MSISDN incorrect → 422', async () => {
    const reponse = await request(app)
      .post('/api/clients')
      .set('Authorization', `Bearer ${tokenAdmin()}`)
      .send({ utilisateur_id: 4, nom: 'Sow', prenom: 'Moussa', msisdn: '+22177123456', email: 'x@example.sn' });

    expect(reponse.status).toBe(422);
    expect(reponse.body.erreurs.some((e) => e.champ === 'msisdn')).toBe(true);
  });

  test('corps vide → 422', async () => {
    const reponse = await request(app).post('/api/auth/login').send({});

    expect(reponse.status).toBe(422);
    expect(reponse.body.erreurs.length).toBeGreaterThan(0);
  });

  test('route inconnue → 404', async () => {
    const reponse = await request(app).get('/api/route-qui-nexiste-pas');

    expect(reponse.status).toBe(404);
    expect(reponse.body.message).toMatch(/introuvable/);
  });
});

// ============================================================================
// MONITORING (3 tests)
// ============================================================================
describe('Monitoring', () => {
  test('GET /api/health → 200 avec statut/uptime/version', async () => {
    const reponse = await request(app).get('/api/health');

    expect(reponse.status).toBe(200);
    expect(reponse.body).toHaveProperty('statut', 'ok');
    expect(reponse.body).toHaveProperty('uptime');
    expect(reponse.body).toHaveProperty('version');
    expect(reponse.body).toHaveProperty('env');
  });

  test('GET /api/stats → 200 avec les champs requis', async () => {
    query.mockResolvedValueOnce({
      rows: [
        { clients_actifs: '5', revenus_mensuels_fcfa: '75000', factures_impayees: '2', tickets_ouverts: '1' },
      ],
    });

    const reponse = await request(app).get('/api/stats').set('Authorization', `Bearer ${tokenAdmin()}`);

    expect(reponse.status).toBe(200);
    expect(reponse.body).toHaveProperty('clients_actifs');
    expect(reponse.body).toHaveProperty('revenus_mensuels_fcfa');
    expect(reponse.body).toHaveProperty('factures_impayees');
    expect(reponse.body).toHaveProperty('tickets_ouverts');
  });

  test('GET /api/health répond en moins de 200ms', async () => {
    const debut = Date.now();
    await request(app).get('/api/health');
    const duree = Date.now() - debut;

    expect(duree).toBeLessThan(200);
  });
});

// ============================================================================
// TESTS COMPLÉMENTAIRES — couverture des branches CRUD restantes
// ============================================================================
// Ces tests s'ajoutent aux 25 exigés par le barème pour porter la couverture
// de lignes au-delà du seuil de 70% (npm run test:cov).
describe('Tests complémentaires', () => {
  // ---- Auth ----
  test('login avec mot de passe incorrect → 401 générique', async () => {
    query.mockResolvedValueOnce({
      rows: [{ id: 4, email: 'moussa.sow@example.sn', mot_de_passe: '$2b$12$hash', role: 'client' }],
    });
    bcrypt.compare.mockResolvedValueOnce(false);

    const reponse = await request(app)
      .post('/api/auth/login')
      .send({ email: 'moussa.sow@example.sn', mot_de_passe: 'mauvais_mdp' });

    expect(reponse.status).toBe(401);
    expect(reponse.body.message).toBe('Identifiants incorrects');
  });

  test('GET /api/auth/profil avec token valide → 200', async () => {
    query.mockResolvedValueOnce({
      rows: [{ id: 1, nom: 'Admin', prenom: 'A', email: 'admin@senegalconnect.sn', role: 'admin' }],
    });

    const reponse = await request(app).get('/api/auth/profil').set('Authorization', `Bearer ${tokenAdmin()}`);

    expect(reponse.status).toBe(200);
    expect(reponse.body.email).toBe('admin@senegalconnect.sn');
  });

  // ---- Middleware auth ----
  test('token malformé (signature invalide) → 401 "Token invalide"', async () => {
    const reponse = await request(app).get('/api/auth/profil').set('Authorization', 'Bearer un.faux.token');

    expect(reponse.status).toBe(401);
    expect(reponse.body.message).toBe('Token invalide');
  });

  test('rôle insuffisant sur route admin → 403', async () => {
    const tokenClient = genererToken({ role: 'client' });

    const reponse = await request(app)
      .post('/api/forfaits')
      .set('Authorization', `Bearer ${tokenClient}`)
      .send({ nom: 'Forfait Test', quota_data_go: 5, quota_voix_min: 50, prix_mensuel_fcfa: 3000 });

    expect(reponse.status).toBe(403);
  });

  // ---- Clients : création / modification / statut / suppression ----
  test('création de client réussie → 201', async () => {
    query.mockResolvedValueOnce({ rows: [{ id: 2 }] }); // forfait_id existe
    query.mockResolvedValueOnce({
      rows: [{ id: 6, nom: 'Sow', prenom: 'Moussa', msisdn: '+221771234567', forfait_id: 2, statut: 'actif' }],
    });

    const reponse = await request(app)
      .post('/api/clients')
      .set('Authorization', `Bearer ${tokenAdmin()}`)
      .send({
        utilisateur_id: 4,
        nom: 'Sow',
        prenom: 'Moussa',
        msisdn: '+221771234567',
        email: 'moussa.sow@example.sn',
        forfait_id: 2,
      });

    expect(reponse.status).toBe(201);
    expect(reponse.body.msisdn).toBe('+221771234567');
  });

  test('modification de client réussie → 200', async () => {
    query.mockResolvedValueOnce({
      rows: [{ id: 1, nom: 'Sow', prenom: 'Moussa', msisdn: '+221771234567', statut: 'actif' }],
    });

    const reponse = await request(app)
      .put('/api/clients/1')
      .set('Authorization', `Bearer ${tokenAdmin()}`)
      .send({
        nom: 'Sow',
        prenom: 'Moussa',
        msisdn: '+221771234567',
        email: 'moussa.sow@example.sn',
        statut: 'actif',
      });

    expect(reponse.status).toBe(200);
  });

  test('modification de client inexistant → 404', async () => {
    query.mockResolvedValueOnce({ rows: [] });

    const reponse = await request(app)
      .put('/api/clients/999')
      .set('Authorization', `Bearer ${tokenAdmin()}`)
      .send({
        nom: 'Sow',
        prenom: 'Moussa',
        msisdn: '+221771234567',
        email: 'moussa.sow@example.sn',
        statut: 'actif',
      });

    expect(reponse.status).toBe(404);
  });

  test('résiliation bloquée si factures impayées → 409', async () => {
    query.mockResolvedValueOnce({ rows: [{ count: '1' }] });

    const reponse = await request(app)
      .patch('/api/clients/1/statut')
      .set('Authorization', `Bearer ${tokenAdmin()}`)
      .send({ statut: 'resilie' });

    expect(reponse.status).toBe(409);
  });

  test('changement de statut (suspendu) réussi → 200', async () => {
    query.mockResolvedValueOnce({ rows: [{ id: 1, statut: 'suspendu' }] });

    const reponse = await request(app)
      .patch('/api/clients/1/statut')
      .set('Authorization', `Bearer ${tokenAdmin()}`)
      .send({ statut: 'suspendu' });

    expect(reponse.status).toBe(200);
    expect(reponse.body.statut).toBe('suspendu');
  });

  test('suppression de client bloquée par factures impayées → 409', async () => {
    query.mockResolvedValueOnce({ rows: [{ count: '2' }] });

    const reponse = await request(app).delete('/api/clients/1').set('Authorization', `Bearer ${tokenAdmin()}`);

    expect(reponse.status).toBe(409);
  });

  test('suppression de client réussie → 204', async () => {
    query.mockResolvedValueOnce({ rows: [{ count: '0' }] });
    query.mockResolvedValueOnce({ rows: [{ id: 1 }] });

    const reponse = await request(app).delete('/api/clients/1').set('Authorization', `Bearer ${tokenAdmin()}`);

    expect(reponse.status).toBe(204);
  });

  // ---- Forfaits : détail / création / modification / suppression ----
  test('détail forfait existant → 200 avec clients paginés', async () => {
    query.mockResolvedValueOnce({ rows: [{ id: 2, nom: 'Forfait Confort' }] });
    query.mockResolvedValueOnce({ rows: [{ id: 1, nom: 'Sow' }] });
    query.mockResolvedValueOnce({ rows: [{ count: '1' }] });

    const reponse = await request(app).get('/api/forfaits/2');

    expect(reponse.status).toBe(200);
    expect(reponse.body.clients.pagination.total).toBe(1);
  });

  test('détail forfait inexistant → 404', async () => {
    query.mockResolvedValueOnce({ rows: [] });

    const reponse = await request(app).get('/api/forfaits/999');

    expect(reponse.status).toBe(404);
  });

  test('création de forfait réussie → 201', async () => {
    query.mockResolvedValueOnce({
      rows: [{ id: 5, nom: 'Forfait Test', prix_mensuel_fcfa: 3000, actif: true }],
    });

    const reponse = await request(app)
      .post('/api/forfaits')
      .set('Authorization', `Bearer ${tokenAdmin()}`)
      .send({ nom: 'Forfait Test', quota_data_go: 5, quota_voix_min: 50, prix_mensuel_fcfa: 3000 });

    expect(reponse.status).toBe(201);
  });

  test('modification de forfait réussie → 200', async () => {
    query.mockResolvedValueOnce({ rows: [{ id: 2, nom: 'Forfait Confort+' }] });

    const reponse = await request(app)
      .put('/api/forfaits/2')
      .set('Authorization', `Bearer ${tokenAdmin()}`)
      .send({ nom: 'Forfait Confort+', quota_data_go: 20, quota_voix_min: 400, prix_mensuel_fcfa: 12000 });

    expect(reponse.status).toBe(200);
  });

  test('suppression de forfait réussie (aucun client actif) → 204', async () => {
    query.mockResolvedValueOnce({ rows: [{ count: '0' }] });
    query.mockResolvedValueOnce({ rows: [{ id: 2 }] });

    const reponse = await request(app).delete('/api/forfaits/2').set('Authorization', `Bearer ${tokenAdmin()}`);

    expect(reponse.status).toBe(204);
  });

  // ---- Factures : détail / création / suppression ----
  test('détail facture existante → 200', async () => {
    query.mockResolvedValueOnce({
      rows: [{ id: 1, reference: 'FAC-202507-0001', client_nom: 'Sow', client_prenom: 'Moussa' }],
    });

    const reponse = await request(app).get('/api/factures/1').set('Authorization', `Bearer ${tokenAdmin()}`);

    expect(reponse.status).toBe(200);
    expect(reponse.body.reference).toBe('FAC-202507-0001');
  });

  test('détail facture inexistante → 404', async () => {
    query.mockResolvedValueOnce({ rows: [] });

    const reponse = await request(app).get('/api/factures/999').set('Authorization', `Bearer ${tokenAdmin()}`);

    expect(reponse.status).toBe(404);
  });

  test('création de facture réussie → 201 avec référence générée', async () => {
    query.mockResolvedValueOnce({ rows: [{ id: 1 }] }); // client existe
    query.mockResolvedValueOnce({
      rows: [{ id: 10, reference: 'FAC-202507-1234', client_id: 1, montant_fcfa: 10000, statut: 'impayee' }],
    });

    const reponse = await request(app)
      .post('/api/factures')
      .set('Authorization', `Bearer ${tokenAdmin()}`)
      .send({ client_id: 1, periode: '2025-07', montant_fcfa: 10000, date_echeance: '2025-07-15' });

    expect(reponse.status).toBe(201);
    expect(reponse.body.reference).toMatch(/^FAC-\d{6}-\d{4}$/);
  });

  test('suppression de facture réussie → 204', async () => {
    query.mockResolvedValueOnce({ rows: [{ id: 1 }] });

    const reponse = await request(app).delete('/api/factures/1').set('Authorization', `Bearer ${tokenAdmin()}`);

    expect(reponse.status).toBe(204);
  });

  test('suppression de facture inexistante → 404', async () => {
    query.mockResolvedValueOnce({ rows: [] });

    const reponse = await request(app).delete('/api/factures/999').set('Authorization', `Bearer ${tokenAdmin()}`);

    expect(reponse.status).toBe(404);
  });

  // ---- Middleware d'erreurs ----
  test('erreur PostgreSQL générique → 500 sans exposer la stack', async () => {
    query.mockRejectedValueOnce(new Error('connexion à la base perdue'));

    const reponse = await request(app).get('/api/forfaits');

    expect(reponse.status).toBe(500);
    expect(reponse.body.message).toBe('Erreur interne du serveur');
  });

  test('violation de clé étrangère (23503) → 422', async () => {
    query.mockResolvedValueOnce({ rows: [{ id: 1 }] }); // le client existe (vérif applicative)
    const erreurFK = new Error('insert or update violates foreign key constraint');
    erreurFK.code = '23503';
    query.mockRejectedValueOnce(erreurFK); // l'INSERT échoue malgré tout côté BDD

    const reponse = await request(app)
      .post('/api/factures')
      .set('Authorization', `Bearer ${tokenAdmin()}`)
      .send({ client_id: 1, periode: '2025-07', montant_fcfa: 10000, date_echeance: '2025-07-15' });

    expect(reponse.status).toBe(422);
  });
});

// ============================================================================
// M2 — Contrôle des rôles et des données ("un client n'accède qu'à ses propres données")
// ============================================================================
describe('M2 — Contrôle des rôles et des données', () => {
  test('un client consulte sa propre fiche → 200', async () => {
    const tokenClient = genererToken({ id: 4, role: 'client' });

    query
      .mockResolvedValueOnce({ rows: [{ id: 1, utilisateur_id: 4, forfait_id: 2 }] }) // client
      .mockResolvedValueOnce({ rows: [{ id: 2, nom: 'Forfait Confort' }] }) // forfait
      .mockResolvedValueOnce({ rows: [] }) // dernière facture
      .mockResolvedValueOnce({ rows: [] }); // ticket en cours

    const reponse = await request(app).get('/api/clients/1').set('Authorization', `Bearer ${tokenClient}`);

    expect(reponse.status).toBe(200);
  });

  test("un client ne peut PAS consulter la fiche d'un autre client → 403", async () => {
    const tokenClient = genererToken({ id: 4, role: 'client' });

    query.mockResolvedValueOnce({ rows: [{ id: 2, utilisateur_id: 999, forfait_id: 1 }] });

    const reponse = await request(app).get('/api/clients/2').set('Authorization', `Bearer ${tokenClient}`);

    expect(reponse.status).toBe(403);
  });

  test('la liste des clients pour un rôle "client" est automatiquement filtrée sur son id', async () => {
    const tokenClient = genererToken({ id: 4, role: 'client' });

    query.mockResolvedValueOnce({ rows: [{ count: '1' }] });
    query.mockResolvedValueOnce({ rows: [{ id: 1, utilisateur_id: 4 }] });

    const reponse = await request(app).get('/api/clients').set('Authorization', `Bearer ${tokenClient}`);

    expect(reponse.status).toBe(200);
    expect(query.mock.calls[0][0]).toMatch(/utilisateur_id/);
    expect(query.mock.calls[0][1]).toEqual([4]);
  });

  test('un client consulte sa propre facture → 200 (champ interne non exposé)', async () => {
    const tokenClient = genererToken({ id: 4, role: 'client' });

    query.mockResolvedValueOnce({
      rows: [{ id: 1, reference: 'FAC-202507-0001', client_utilisateur_id: 4 }],
    });

    const reponse = await request(app).get('/api/factures/1').set('Authorization', `Bearer ${tokenClient}`);

    expect(reponse.status).toBe(200);
    expect(reponse.body.client_utilisateur_id).toBeUndefined();
  });

  test("un client ne peut PAS consulter la facture d'un autre client → 403", async () => {
    const tokenClient = genererToken({ id: 4, role: 'client' });

    query.mockResolvedValueOnce({
      rows: [{ id: 2, reference: 'FAC-202507-0002', client_utilisateur_id: 999 }],
    });

    const reponse = await request(app).get('/api/factures/2').set('Authorization', `Bearer ${tokenClient}`);

    expect(reponse.status).toBe(403);
  });

  test('la liste des factures ignore le ?client_id= fourni par un client et impose le sien', async () => {
    const tokenClient = genererToken({ id: 4, role: 'client' });

    query
      .mockResolvedValueOnce({ rows: [{ id: 7 }] }) // résolution de la fiche client du token
      .mockResolvedValueOnce({ rows: [{ count: '1' }] })
      .mockResolvedValueOnce({ rows: [{ id: 1, client_id: 7 }] });

    // Le client tente de lire les factures d'un autre (client_id=999) : doit être ignoré.
    const reponse = await request(app)
      .get('/api/factures?client_id=999')
      .set('Authorization', `Bearer ${tokenClient}`);

    expect(reponse.status).toBe(200);
    expect(query.mock.calls[1][1]).toEqual([7]); // et non 999
  });
});

// ============================================================================
// UTILITAIRE escapeHtml (M2 — sécurité de base)
// ============================================================================
describe('escapeHtml', () => {
  const { escapeHtml } = require('../src/utils/escapeHtml');

  test('neutralise les balises et guillemets dangereux', () => {
    expect(escapeHtml('<script>alert(1)</script>')).toBe('&lt;script&gt;alert(1)&lt;&#x2F;script&gt;');
    expect(escapeHtml(`"'&`)).toBe('&quot;&#39;&amp;');
  });

  test('laisse inchangé un texte sans caractère spécial', () => {
    expect(escapeHtml('Ma facture de juillet est incorrecte')).toBe('Ma facture de juillet est incorrecte');
  });

  test('retourne la valeur telle quelle si ce n\'est pas une chaîne', () => {
    expect(escapeHtml(42)).toBe(42);
    expect(escapeHtml(null)).toBeNull();
  });
});

// ============================================================================
// M3 — Tickets (REST) et partage de fichiers
// ============================================================================
describe('Tickets (REST)', () => {
  test('liste des tickets pour un admin → 200 avec pagination', async () => {
    query.mockResolvedValueOnce({ rows: [{ count: '1' }] });
    query.mockResolvedValueOnce({ rows: [{ id: 1, sujet: 'Facture incorrecte', statut: 'ouvert' }] });

    const reponse = await request(app).get('/api/tickets').set('Authorization', `Bearer ${tokenAdmin()}`);

    expect(reponse.status).toBe(200);
    expect(reponse.body.pagination.total).toBe(1);
  });

  test('la liste des tickets pour un agent est filtrée sur agent_id (assignés + non assignés)', async () => {
    const tokenAgent = genererToken({ id: 2, role: 'agent' });
    query.mockResolvedValueOnce({ rows: [{ count: '0' }] });
    query.mockResolvedValueOnce({ rows: [] });

    const reponse = await request(app).get('/api/tickets').set('Authorization', `Bearer ${tokenAgent}`);

    expect(reponse.status).toBe(200);
    // Régression : "agent_id = $1" seul exclurait à tort les tickets non assignés
    // (agent_id IS NULL) — un agent doit pouvoir les voir pour les prendre en charge.
    expect(query.mock.calls[0][0]).toMatch(/agent_id = \$1 OR agent_id IS NULL/);
    expect(query.mock.calls[0][1]).toEqual([2]);
  });

  test('un client consulte son propre ticket → 200', async () => {
    const tokenClient = genererToken({ id: 4, role: 'client' });
    query.mockResolvedValueOnce({
      rows: [{ id: 1, sujet: 'Facture incorrecte', statut: 'ouvert', client_utilisateur_id: 4 }],
    });

    const reponse = await request(app).get('/api/tickets/1').set('Authorization', `Bearer ${tokenClient}`);

    expect(reponse.status).toBe(200);
    expect(reponse.body.client_utilisateur_id).toBeUndefined();
  });

  test("un client ne peut PAS consulter le ticket d'un autre → 403", async () => {
    const tokenClient = genererToken({ id: 4, role: 'client' });
    query.mockResolvedValueOnce({
      rows: [{ id: 2, sujet: 'Autre demande', statut: 'ouvert', client_utilisateur_id: 999 }],
    });

    const reponse = await request(app).get('/api/tickets/2').set('Authorization', `Bearer ${tokenClient}`);

    expect(reponse.status).toBe(403);
  });

  test('ticket inexistant → 404', async () => {
    query.mockResolvedValueOnce({ rows: [] });

    const reponse = await request(app).get('/api/tickets/999').set('Authorization', `Bearer ${tokenAdmin()}`);

    expect(reponse.status).toBe(404);
  });

  test('création de ticket par un client → 201 (client_id résolu automatiquement)', async () => {
    const tokenClient = genererToken({ id: 4, role: 'client' });
    query.mockResolvedValueOnce({ rows: [{ id: 1 }] }); // résolution de la fiche client
    query.mockResolvedValueOnce({ rows: [{ id: 10, sujet: 'Ma facture est fausse', statut: 'ouvert' }] });

    const reponse = await request(app)
      .post('/api/tickets')
      .set('Authorization', `Bearer ${tokenClient}`)
      .send({ sujet: 'Ma facture est fausse' });

    expect(reponse.status).toBe(201);
    expect(query.mock.calls[1][1]).toEqual([1, 'Ma facture est fausse']);
  });

  test('création de ticket sans sujet → 422', async () => {
    const reponse = await request(app)
      .post('/api/tickets')
      .set('Authorization', `Bearer ${tokenAdmin()}`)
      .send({ client_id: 1 });

    expect(reponse.status).toBe(422);
    expect(query).not.toHaveBeenCalled();
  });

  test('un client ne peut PAS changer le statut d\'un ticket → 403', async () => {
    const tokenClient = genererToken({ id: 4, role: 'client' });

    const reponse = await request(app)
      .patch('/api/tickets/1/statut')
      .set('Authorization', `Bearer ${tokenClient}`)
      .send({ statut: 'ferme' });

    expect(reponse.status).toBe(403);
  });

  test('un agent ferme un ticket → 200 avec ferme_le renseigné', async () => {
    const tokenAgent = genererToken({ id: 2, role: 'agent' });
    query.mockResolvedValueOnce({ rows: [{ id: 1, statut: 'ferme', ferme_le: new Date() }] });

    const reponse = await request(app)
      .patch('/api/tickets/1/statut')
      .set('Authorization', `Bearer ${tokenAgent}`)
      .send({ statut: 'ferme' });

    expect(reponse.status).toBe(200);
    expect(query.mock.calls[0][0]).toMatch(/ferme_le = NOW/);
  });

  test("changement de statut d'un ticket inexistant → 404", async () => {
    query.mockResolvedValueOnce({ rows: [] });

    const reponse = await request(app)
      .patch('/api/tickets/999/statut')
      .set('Authorization', `Bearer ${tokenAdmin()}`)
      .send({ statut: 'en_cours' });

    expect(reponse.status).toBe(404);
  });

  test('historique des messages avec curseur ?avant= (avec réactions)', async () => {
    query.mockResolvedValueOnce({ rows: [{ id: 1, contenu: 'Bonjour' }] });
    query.mockResolvedValueOnce({ rows: [{ message_id: 1, emoji: '👍', total: 2 }] });

    const reponse = await request(app)
      .get('/api/tickets/1/messages?avant=2025-07-20T10:00:00Z')
      .set('Authorization', `Bearer ${tokenAdmin()}`);

    expect(reponse.status).toBe(200);
    expect(query.mock.calls[0][0]).toMatch(/envoye_le < \$2/);
    expect(reponse.body.data[0].reactions).toEqual([{ emoji: '👍', total: 2 }]);
  });

  test('historique des appels du ticket', async () => {
    query.mockResolvedValueOnce({ rows: [{ id: 1, type: 'video', duree_secondes: 320 }] });

    const reponse = await request(app)
      .get('/api/tickets/1/appels')
      .set('Authorization', `Bearer ${tokenAdmin()}`);

    expect(reponse.status).toBe(200);
    expect(reponse.body.data).toHaveLength(1);
  });
});

describe('Partage de fichiers (multer)', () => {
  test('upload réussi → 201 avec URL et UUID', async () => {
    const reponse = await request(app)
      .post('/api/tickets/1/fichier')
      .set('Authorization', `Bearer ${tokenAdmin()}`)
      .attach('fichier', Buffer.from('%PDF-1.4 contenu factice'), {
        filename: 'facture.pdf',
        contentType: 'application/pdf',
      });

    expect(reponse.status).toBe(201);
    expect(reponse.body.fichierUrl).toMatch(/^\/uploads\/.+\.pdf$/);
    expect(reponse.body.fichierNom).toBe('facture.pdf');
    expect(reponse.body.mimeType).toBe('application/pdf');
  });

  test('type de fichier non autorisé → 422', async () => {
    const reponse = await request(app)
      .post('/api/tickets/1/fichier')
      .set('Authorization', `Bearer ${tokenAdmin()}`)
      .attach('fichier', Buffer.from('#!/bin/sh\necho test'), {
        filename: 'script.sh',
        contentType: 'application/x-sh',
      });

    expect(reponse.status).toBe(422);
  });

  test('aucun fichier envoyé → 422', async () => {
    const reponse = await request(app).post('/api/tickets/1/fichier').set('Authorization', `Bearer ${tokenAdmin()}`);

    expect(reponse.status).toBe(422);
  });
});

// ============================================================================
// M3 — Socket.IO (intégration réelle avec socket.io-client)
// ============================================================================
describe('Socket.IO (support temps réel)', () => {
  const ioClient = require('socket.io-client');
  let port;

  beforeAll((fait) => {
    app.server.listen(0, () => {
      port = app.server.address().port;
      fait();
    });
  });

  afterAll((fait) => {
    app.server.close(fait);
  });

  function connecter(token) {
    return ioClient(`http://localhost:${port}`, {
      path: '/socket.io',
      auth: { token },
      transports: ['polling'],
      upgrade: false,
      forceNew: true,
      reconnection: false,
    });
  }

  test('connexion avec token valide → réussie et rejoint sa room "user:{id}"', (fait) => {
    const token = genererToken({ id: 4, role: 'client' });
    const socket = connecter(token);

    socket.on('connect', () => {
      expect(socket.connected).toBe(true);
      socket.disconnect();
      fait();
    });
    socket.on('connect_error', (err) => fait(err));
  });

  test('connexion sans token → rejetée (connect_error)', (fait) => {
    const socket = ioClient(`http://localhost:${port}`, {
      path: '/socket.io',
      transports: ['polling'],
      upgrade: false,
      forceNew: true,
      reconnection: false,
    });

    socket.on('connect_error', (err) => {
      expect(err.message).toBe('Token invalide');
      socket.disconnect();
      fait();
    });
    socket.on('connect', () => fait(new Error('la connexion ne devrait pas réussir sans token')));
  });

  test('message:envoyer diffuse message:nouveau à toute la room du ticket', (fait) => {
    // 1er appel BDD : chargerTicket() dans ticket:rejoindre (l'agent rejoint la room)
    query.mockResolvedValueOnce({
      rows: [{ id: 1, statut: 'en_cours', agent_id: 2, client_utilisateur_id: 4 }],
    });
    // 2e appel BDD : chargerTicket() dans message:envoyer (vérif. participation du client)
    query.mockResolvedValueOnce({
      rows: [{ id: 1, statut: 'en_cours', agent_id: 2, client_utilisateur_id: 4 }],
    });
    // 3e appel BDD : l'INSERT du message
    query.mockResolvedValueOnce({
      rows: [{ id: 1, ticket_id: 1, expediteur_id: 4, type: 'texte', contenu: 'Bonjour' }],
    });

    const socketClient = connecter(genererToken({ id: 4, role: 'client' }));
    const socketAgent = connecter(genererToken({ id: 2, role: 'agent' }));

    socketAgent.on('message:nouveau', (message) => {
      expect(message.contenu).toBe('Bonjour');
      socketClient.disconnect();
      socketAgent.disconnect();
      fait();
    });

    Promise.all([
      new Promise((resolve) => socketClient.on('connect', resolve)),
      new Promise((resolve) => socketAgent.on('connect', resolve)),
    ]).then(() => {
      socketAgent.emit('ticket:rejoindre', { ticketId: 1 });
      // Laisse le temps à l'agent de rejoindre la room côté serveur avant l'envoi.
      setTimeout(() => {
        socketClient.emit('message:envoyer', { ticketId: 1, contenu: 'Bonjour', type: 'texte' });
      }, 80);
    });
  });

  // ============================================================================
  // M3 durci — Contrôle d'accès sur les événements Socket.IO
  // ============================================================================
  test('un client ne peut PAS s\'auto-assigner un ticket via ticket:assigner', (fait) => {
    const socket = connecter(genererToken({ id: 4, role: 'client' }));

    socket.on('connect', () => {
      socket.emit('ticket:assigner', { ticketId: 1 }, (reponse) => {
        expect(reponse.erreur).toMatch(/agent/);
        expect(query).not.toHaveBeenCalled(); // rejeté avant tout accès BDD
        socket.disconnect();
        fait();
      });
    });
  });

  test('un agent ne peut PAS s\'assigner un ticket déjà pris par un autre agent', (fait) => {
    query.mockResolvedValueOnce({
      rows: [{ id: 1, statut: 'en_cours', agent_id: 99, client_utilisateur_id: 4 }],
    });

    const socket = connecter(genererToken({ id: 2, role: 'agent' }));

    socket.on('connect', () => {
      socket.emit('ticket:assigner', { ticketId: 1 }, (reponse) => {
        expect(reponse.erreur).toMatch(/déjà pris en charge/);
        socket.disconnect();
        fait();
      });
    });
  });

  test('un client ne peut PAS clôturer un ticket (ticket:fermer)', (fait) => {
    const socket = connecter(genererToken({ id: 4, role: 'client' }));

    socket.on('connect', () => {
      socket.emit('ticket:fermer', { ticketId: 1 }, (reponse) => {
        expect(reponse.erreur).toMatch(/agent/);
        expect(query).not.toHaveBeenCalled();
        socket.disconnect();
        fait();
      });
    });
  });

  test('un client ne peut PAS envoyer un message dans le ticket d\'un autre client', (fait) => {
    // Le ticket 5 appartient à l'utilisateur 999, pas à l'utilisateur 4 qui tente d'écrire.
    query.mockResolvedValueOnce({
      rows: [{ id: 5, statut: 'en_cours', agent_id: 2, client_utilisateur_id: 999 }],
    });

    const socket = connecter(genererToken({ id: 4, role: 'client' }));

    socket.on('connect', () => {
      socket.emit('message:envoyer', { ticketId: 5, contenu: 'Intrusion', type: 'texte' });

      // Aucun INSERT ne doit jamais être tenté : seule la vérification de participation
      // (1 appel BDD) a lieu, le message est rejeté silencieusement avant l'INSERT.
      setTimeout(() => {
        expect(query).toHaveBeenCalledTimes(1);
        socket.disconnect();
        fait();
      }, 100);
    });
  });

  // ============================================================================
  // Scénario complet du cahier des charges (M3), rejoué de bout en bout avec deux
  // vrais sockets : ticket → notification agent → prise en charge → chat → fichier
  // → réaction émoji → accusé de lecture.
  // ============================================================================
  test('scénario complet : ticket → prise en charge → chat → fichier PDF → émoji → lecture', async () => {
    function attendre(socket, evenement) {
      return new Promise((resolve) => socket.once(evenement, resolve));
    }
    function connecterEtAttendre(token) {
      const socket = connecter(token);
      return new Promise((resolve) => socket.on('connect', () => resolve(socket)));
    }

    const socketClient = await connecterEtAttendre(genererToken({ id: 4, role: 'client' }));
    const socketAgent = await connecterEtAttendre(genererToken({ id: 2, role: 'agent' }));

    // ---- Étape 1 : l'abonné ouvre un ticket ----
    query.mockResolvedValueOnce({ rows: [{ id: 7 }] }); // résolution de sa fiche client
    query.mockResolvedValueOnce({
      rows: [{ id: 1, client_id: 7, sujet: 'Ma facture FAC-202501-0042 de 15 000 FCFA est incorrecte', statut: 'ouvert' }],
    });

    const [ticketRecuParAgent, ackTicket] = await Promise.all([
      attendre(socketAgent, 'ticket:nouveau'),
      new Promise((resolve) => socketClient.emit('ticket:ouvrir', { sujet: 'Ma facture FAC-202501-0042 de 15 000 FCFA est incorrecte' }, resolve)),
    ]);
    expect(ticketRecuParAgent.id).toBe(1);
    expect(ackTicket.id).toBe(1);

    // ---- Étape 2 : l'agent prend en charge le ticket ----
    query.mockResolvedValueOnce({ rows: [{ id: 1, statut: 'ouvert', agent_id: null, client_utilisateur_id: 4 }] });
    query.mockResolvedValueOnce({ rows: [{ id: 1, statut: 'en_cours', agent_id: 2, client_utilisateur_id: 4 }] });

    const [prisEnCharge] = await Promise.all([
      attendre(socketClient, 'ticket:pris_en_charge'),
      new Promise((resolve) => socketAgent.emit('ticket:assigner', { ticketId: 1 }, resolve)),
    ]);
    expect(prisEnCharge.statut).toBe('en_cours');

    // ---- Étape 3 : l'agent répond par chat ----
    query.mockResolvedValueOnce({ rows: [{ id: 1, statut: 'en_cours', agent_id: 2, client_utilisateur_id: 4 }] });
    query.mockResolvedValueOnce({
      rows: [{ id: 10, ticket_id: 1, expediteur_id: 2, type: 'texte', contenu: 'Je regarde ça tout de suite.' }],
    });

    const [messageRecu] = await Promise.all([
      attendre(socketClient, 'message:nouveau'),
      new Promise((resolve) => {
        socketAgent.emit('message:envoyer', { ticketId: 1, contenu: 'Je regarde ça tout de suite.', type: 'texte' });
        resolve();
      }),
    ]);
    expect(messageRecu.contenu).toBe('Je regarde ça tout de suite.');

    // ---- Étape 4 : l'agent envoie la facture corrigée en PDF (après upload REST) ----
    query.mockResolvedValueOnce({ rows: [{ id: 1, statut: 'en_cours', agent_id: 2, client_utilisateur_id: 4 }] });
    query.mockResolvedValueOnce({
      rows: [{ id: 11, ticket_id: 1, expediteur_id: 2, type: 'fichier', fichier_nom: 'facture-corrigee.pdf' }],
    });

    const [fichierRecu] = await Promise.all([
      attendre(socketClient, 'message:nouveau'),
      new Promise((resolve) => {
        socketAgent.emit('fichier:partager', {
          ticketId: 1,
          fichierUrl: '/uploads/facture-corrigee-uuid.pdf',
          fichierNom: 'facture-corrigee.pdf',
          fichierTaille: 20480,
          mimeType: 'application/pdf',
        });
        resolve();
      }),
    ]);
    expect(fichierRecu.type).toBe('fichier');
    expect(fichierRecu.fichier_nom).toBe('facture-corrigee.pdf');

    // ---- Étape 5 : l'abonné répond avec un émoji 👍 (réaction sur le message de l'agent) ----
    query.mockResolvedValueOnce({ rows: [{ ticket_id: 1 }] }); // message ciblé par la réaction
    query.mockResolvedValueOnce({ rows: [{ id: 1, statut: 'en_cours', agent_id: 2, client_utilisateur_id: 4 }] });
    query.mockResolvedValueOnce({ rows: [] }); // aucune réaction existante → on ajoute
    query.mockResolvedValueOnce({ rows: [{}] });
    query.mockResolvedValueOnce({ rows: [{ emoji: '👍', total: 1 }] });

    const [reactionRecue] = await Promise.all([
      attendre(socketAgent, 'message:reaction'),
      new Promise((resolve) => {
        socketClient.emit('message:reagir', { messageId: 10, emoji: '👍' });
        resolve();
      }),
    ]);
    expect(reactionRecue.reactions).toEqual([{ emoji: '👍', total: 1 }]);

    // ---- Étape 6 : accusé de lecture — l'abonné lit le message de l'agent ----
    query.mockResolvedValueOnce({ rows: [{ ticket_id: 1, expediteur_id: 2 }] });
    query.mockResolvedValueOnce({ rows: [{ id: 1, statut: 'en_cours', agent_id: 2, client_utilisateur_id: 4 }] });
    query.mockResolvedValueOnce({ rows: [] });

    const [statutRecu] = await Promise.all([
      attendre(socketAgent, 'message:statut'),
      new Promise((resolve) => {
        socketClient.emit('message:lu', { messageId: 10 });
        resolve();
      }),
    ]);
    expect(statutRecu).toEqual({ messageId: 10, statut: 'lu' });

    socketClient.disconnect();
    socketAgent.disconnect();
  }, 10000);

  // ============================================================================
  // M4 — Signalisation WebRTC/PeerJS (le flux média lui-même n'est pas testable
  // par Jest : ici on vérifie uniquement l'échange de peerId via Socket.IO).
  // ============================================================================
  test('appel:initier refusé si le ticket n\'est pas "en_cours"', (fait) => {
    query.mockResolvedValueOnce({
      rows: [{ id: 1, statut: 'ouvert', agent_id: null, client_utilisateur_id: 4 }],
    });

    const socket = connecter(genererToken({ id: 4, role: 'client' }));
    socket.on('connect', () => {
      socket.emit('appel:initier', { ticketId: 1, type: 'video', peerId: 'peer-client' }, (reponse) => {
        expect(reponse.erreur).toMatch(/en_cours/);
        socket.disconnect();
        fait();
      });
    });
  });

  test('appel:initier par le client → INSERT en BDD + notification "appel:entrant" à l\'agent', (fait) => {
    query.mockResolvedValueOnce({
      rows: [{ id: 1, statut: 'en_cours', agent_id: 2, client_utilisateur_id: 4 }],
    });
    query.mockResolvedValueOnce({
      rows: [{ id: 99, ticket_id: 1, initiateur_id: 4, destinataire_id: 2, type: 'video', statut: 'initie' }],
    });

    const socketClient = connecter(genererToken({ id: 4, role: 'client' }));
    const socketAgent = connecter(genererToken({ id: 2, role: 'agent' }));

    socketAgent.on('appel:entrant', (donnees) => {
      expect(donnees.appelId).toBe(99);
      expect(donnees.peerIdInitiateur).toBe('peer-client');
      socketClient.disconnect();
      socketAgent.disconnect();
      fait();
    });

    // Chaque socket écoute SON PROPRE 'connect' indépendamment (pas d'imbrication) —
    // sinon, si le second se connecte avant que le premier n'écoute, l'événement est
    // manqué et le test reste bloqué jusqu'au timeout.
    Promise.all([
      new Promise((resolve) => socketClient.on('connect', resolve)),
      new Promise((resolve) => socketAgent.on('connect', resolve)),
    ]).then(() => {
      socketClient.emit('appel:initier', { ticketId: 1, type: 'video', peerId: 'peer-client' }, (reponse) => {
        expect(reponse.appelId).toBe(99);
      });
    });
  });

  test('appel:accepter initialise le début de l\'appel puis notifie l\'initiateur', (fait) => {
    query.mockResolvedValueOnce({
      rows: [{ id: 99, initiateur_id: 4, destinataire_id: 2, statut: 'accepte', debut_le: new Date().toISOString() }],
    });

    const socketInitiateur = connecter(genererToken({ id: 4, role: 'client' }));
    const socketDestinataire = connecter(genererToken({ id: 2, role: 'agent' }));

    socketInitiateur.on('appel:accepte', ({ peerIdDestinataire }) => {
      expect(peerIdDestinataire).toBe('peer-agent');
      expect(query.mock.calls[0][0]).toContain('debut_le');
      socketInitiateur.disconnect();
      socketDestinataire.disconnect();
      fait();
    });

    Promise.all([
      new Promise((resolve) => socketInitiateur.on('connect', resolve)),
      new Promise((resolve) => socketDestinataire.on('connect', resolve)),
    ]).then(() => {
      socketDestinataire.emit('appel:accepter', { appelId: 99, peerId: 'peer-agent' });
    });
  });

  test('appel:accepter → notifie l\'initiateur avec le peerId du destinataire', (fait) => {
    query.mockResolvedValueOnce({ rows: [{ id: 99, initiateur_id: 4, destinataire_id: 2 }] });

    const socketInitiateur = connecter(genererToken({ id: 4, role: 'client' }));
    const socketDestinataire = connecter(genererToken({ id: 2, role: 'agent' }));

    socketInitiateur.on('appel:accepte', ({ peerIdDestinataire }) => {
      expect(peerIdDestinataire).toBe('peer-agent');
      socketInitiateur.disconnect();
      socketDestinataire.disconnect();
      fait();
    });

    Promise.all([
      new Promise((resolve) => socketInitiateur.on('connect', resolve)),
      new Promise((resolve) => socketDestinataire.on('connect', resolve)),
    ]).then(() => {
      socketDestinataire.emit('appel:accepter', { appelId: 99, peerId: 'peer-agent' });
    });
  });

  test('appel:controle relaye micro/caméra/partage écran à l\'autre participant', (fait) => {
    query.mockResolvedValueOnce({
      rows: [{ id: 99, initiateur_id: 4, destinataire_id: 2 }],
    });

    const socketInitiateur = connecter(genererToken({ id: 4, role: 'client' }));
    const socketDestinataire = connecter(genererToken({ id: 2, role: 'agent' }));

    socketDestinataire.on('appel:controle', ({ appelId, micro, video, partageEcran, source }) => {
      expect(appelId).toBe(99);
      expect(micro).toBe(false);
      expect(video).toBe(false);
      expect(partageEcran).toBe(true);
      expect(source).toBe(4);
      socketInitiateur.disconnect();
      socketDestinataire.disconnect();
      fait();
    });

    Promise.all([
      new Promise((resolve) => socketInitiateur.on('connect', resolve)),
      new Promise((resolve) => socketDestinataire.on('connect', resolve)),
    ]).then(() => {
      socketInitiateur.emit('appel:controle', {
        appelId: 99,
        micro: false,
        video: false,
        partageEcran: true,
      });
    });
  });

  test('appel:terminer calcule la durée et notifie les deux parties', (fait) => {
    const debut = new Date(Date.now() - 5000).toISOString();
    query.mockResolvedValueOnce({
      rows: [{ id: 99, initiateur_id: 4, destinataire_id: 2, debut_le: debut }],
    });
    query.mockResolvedValueOnce({
      rows: [{ id: 99, initiateur_id: 4, destinataire_id: 2, statut: 'termine', duree_secondes: 5 }],
    });

    const socket = connecter(genererToken({ id: 4, role: 'client' }));

    socket.on('appel:termine', (appel) => {
      expect(appel.statut).toBe('termine');
      expect(appel.duree_secondes).toBeGreaterThanOrEqual(4);
      socket.disconnect();
      fait();
    });

    socket.on('connect', () => {
      socket.emit('appel:terminer', { appelId: 99 });
    });
  });
});
