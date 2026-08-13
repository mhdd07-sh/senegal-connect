-- ============================================================================
-- Sénégal Connect — Schéma PostgreSQL 14
-- Projet Fin de Module TCS L3 — DSTI, Polytech Diamniadio — UAM
-- ============================================================================
-- Ce script est monté dans /docker-entrypoint-initdb.d/ par docker-compose
-- et s'exécute automatiquement au premier démarrage du conteneur postgres.
-- ============================================================================

-- Extension pour générer des UUID si besoin (noms de fichiers uploadés, etc.)
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ============================================================================
-- 1. UTILISATEURS (clients, agents, admins)
-- ============================================================================
CREATE TABLE utilisateurs (
    id              SERIAL PRIMARY KEY,
    nom             VARCHAR(100) NOT NULL,
    prenom          VARCHAR(100) NOT NULL,
    email           VARCHAR(150) NOT NULL UNIQUE,
    mot_de_passe    VARCHAR(255) NOT NULL, -- hash bcrypt (coût >= 12)
    role            VARCHAR(20)  NOT NULL CHECK (role IN ('client', 'agent', 'admin')),
    cree_le         TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_utilisateurs_email ON utilisateurs(email);
CREATE INDEX idx_utilisateurs_role  ON utilisateurs(role);

-- ============================================================================
-- 2. FORFAITS (offres commerciales)
-- ============================================================================
CREATE TABLE forfaits (
    id                  SERIAL PRIMARY KEY,
    nom                 VARCHAR(100) NOT NULL,
    quota_data_go       NUMERIC(10,2) NOT NULL CHECK (quota_data_go >= 0),
    quota_voix_min      INTEGER NOT NULL CHECK (quota_voix_min >= 0),
    prix_mensuel_fcfa   NUMERIC(12,2) NOT NULL CHECK (prix_mensuel_fcfa > 0),
    actif               BOOLEAN NOT NULL DEFAULT TRUE
);

CREATE INDEX idx_forfaits_actif ON forfaits(actif);

-- ============================================================================
-- 3. CLIENTS (abonnés)
-- ============================================================================
CREATE TABLE clients (
    id                  SERIAL PRIMARY KEY,
    utilisateur_id      INTEGER NOT NULL REFERENCES utilisateurs(id) ON DELETE CASCADE,
    nom                 VARCHAR(100) NOT NULL,
    prenom              VARCHAR(100) NOT NULL,
    msisdn              VARCHAR(20) NOT NULL UNIQUE CHECK (msisdn ~ '^\+221[0-9]{9}$'),
    email               VARCHAR(150) NOT NULL UNIQUE,
    forfait_id          INTEGER REFERENCES forfaits(id) ON DELETE SET NULL,
    statut              VARCHAR(20) NOT NULL DEFAULT 'actif'
                        CHECK (statut IN ('actif', 'suspendu', 'resilie')),
    date_inscription    TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_clients_msisdn     ON clients(msisdn);
CREATE INDEX idx_clients_forfait_id ON clients(forfait_id);
CREATE INDEX idx_clients_statut     ON clients(statut);

-- ============================================================================
-- 4. FACTURES
-- ============================================================================
CREATE TABLE factures (
    id              SERIAL PRIMARY KEY,
    client_id       INTEGER NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
    reference       VARCHAR(30) NOT NULL UNIQUE, -- format FAC-YYYYMM-XXXX
    periode         VARCHAR(7) NOT NULL CHECK (periode ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'), -- YYYY-MM
    montant_fcfa    NUMERIC(12,2) NOT NULL CHECK (montant_fcfa >= 0),
    statut          VARCHAR(20) NOT NULL DEFAULT 'impayee'
                    CHECK (statut IN ('payee', 'impayee', 'en_retard')),
    date_emission   TIMESTAMP NOT NULL DEFAULT NOW(),
    date_echeance   TIMESTAMP NOT NULL
);

CREATE INDEX idx_factures_client_id ON factures(client_id);
CREATE INDEX idx_factures_statut    ON factures(statut);
CREATE INDEX idx_factures_periode   ON factures(periode);

-- ============================================================================
-- 5. TICKETS SUPPORT
-- ============================================================================
CREATE TABLE tickets (
    id          SERIAL PRIMARY KEY,
    client_id   INTEGER NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
    agent_id    INTEGER REFERENCES utilisateurs(id) ON DELETE SET NULL,
    sujet       VARCHAR(255) NOT NULL,
    statut      VARCHAR(20) NOT NULL DEFAULT 'ouvert'
                CHECK (statut IN ('ouvert', 'en_cours', 'ferme')),
    ouvert_le   TIMESTAMP NOT NULL DEFAULT NOW(),
    ferme_le    TIMESTAMP
);

CREATE INDEX idx_tickets_client_id ON tickets(client_id);
CREATE INDEX idx_tickets_agent_id  ON tickets(agent_id);
CREATE INDEX idx_tickets_statut    ON tickets(statut);

-- ============================================================================
-- 6. MESSAGES (chat support)
-- ============================================================================
CREATE TABLE messages (
    id              SERIAL PRIMARY KEY,
    ticket_id       INTEGER NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
    expediteur_id   INTEGER NOT NULL REFERENCES utilisateurs(id) ON DELETE CASCADE,
    type            VARCHAR(20) NOT NULL CHECK (type IN ('texte', 'fichier', 'image', 'audio')),
    contenu         TEXT,
    fichier_url     VARCHAR(500),
    fichier_nom     VARCHAR(255),
    fichier_taille  INTEGER,
    envoye_le       TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_messages_ticket_id  ON messages(ticket_id);
CREATE INDEX idx_messages_envoye_le  ON messages(envoye_le DESC);

-- ============================================================================
-- 7. MESSAGES_STATUT (accusés de réception ✓✓)
-- ============================================================================
CREATE TABLE messages_statut (
    message_id      INTEGER NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
    utilisateur_id  INTEGER NOT NULL REFERENCES utilisateurs(id) ON DELETE CASCADE,
    statut          VARCHAR(10) NOT NULL DEFAULT 'envoye' CHECK (statut IN ('envoye', 'lu')),
    lu_le           TIMESTAMP,
    PRIMARY KEY (message_id, utilisateur_id)
);

CREATE INDEX idx_messages_statut_message_id ON messages_statut(message_id);

-- ============================================================================
-- 8. APPELS (audio/vidéo WebRTC)
-- ============================================================================
CREATE TABLE appels (
    id                  SERIAL PRIMARY KEY,
    ticket_id           INTEGER NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
    initiateur_id       INTEGER NOT NULL REFERENCES utilisateurs(id) ON DELETE CASCADE,
    destinataire_id     INTEGER NOT NULL REFERENCES utilisateurs(id) ON DELETE CASCADE,
    type                VARCHAR(10) NOT NULL CHECK (type IN ('audio', 'video')),
    statut              VARCHAR(20) NOT NULL DEFAULT 'initie'
                        CHECK (statut IN ('initie', 'accepte', 'refuse', 'termine')),
    duree_secondes      INTEGER,
    debut_le            TIMESTAMP NOT NULL DEFAULT NOW(),
    fin_le              TIMESTAMP
);

CREATE INDEX idx_appels_ticket_id ON appels(ticket_id);
CREATE INDEX idx_appels_statut    ON appels(statut);

-- ============================================================================
-- 9. REACTIONS (émojis sur les messages — table additionnelle requise par M3)
-- ============================================================================
CREATE TABLE reactions (
    message_id      INTEGER NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
    utilisateur_id  INTEGER NOT NULL REFERENCES utilisateurs(id) ON DELETE CASCADE,
    emoji           VARCHAR(10) NOT NULL,
    cree_le         TIMESTAMP NOT NULL DEFAULT NOW(),
    PRIMARY KEY (message_id, utilisateur_id, emoji)
);

CREATE INDEX idx_reactions_message_id ON reactions(message_id);

-- ============================================================================
-- DONNÉES DE TEST
-- ============================================================================

-- 4 forfaits
INSERT INTO forfaits (nom, quota_data_go, quota_voix_min, prix_mensuel_fcfa, actif) VALUES
    ('Forfait Sénégal Essentiel', 5,   120, 5000,  TRUE),
    ('Forfait Sénégal Confort',   15,  300, 10000, TRUE),
    ('Forfait Sénégal Premium',   50,  1000, 20000, TRUE),
    ('Forfait Sénégal Illimité',  100, 5000, 35000, TRUE);

-- Utilisateurs : 1 admin, 2 agents, 5 clients
INSERT INTO utilisateurs (nom, prenom, email, mot_de_passe, role) VALUES
    ('Diop',   'Aminata', 'admin@senegalconnect.sn', '$2b$12$dlVGUE4tAp3luJXP/1sK2ePQvhGYEjnD54zLMiGytZqaB0B7p2gyK', 'admin'),
    ('Ndiaye', 'Cheikh',  'cheikh.agent@senegalconnect.sn', '$2b$12$MwS1yxZlb4ixAMeB3r24V.2VYO82MpCr2dw1HLvn0mDqhpGI2osGG', 'agent'),
    ('Fall',   'Bineta',  'bineta.agent@senegalconnect.sn', '$2b$12$7WPCYWcJ7JsoM0JKq96NROeAFMw66nD3Iu0snLoWPDm5hxMayy.vG', 'agent'),
    ('Sow',    'Moussa',  'moussa.sow@example.sn',   '$2b$12$x9jbd96SXak1eqZB3bKdBehwUEyZCnekUl3Vi82PyH8G4uo2p1w2.', 'client'),
    ('Ba',     'Fatou',   'fatou.ba@example.sn',     '$2b$12$mmWWUqKle90SuS7HN5jmI.8bwvS/oXMXNVFLavoDzEDyAZdn0goue', 'client'),
    ('Diallo', 'Ibrahima','ibrahima.diallo@example.sn','$2b$12$RMuyjxMlXmwGniYE7sb9M.vt7BU27s0l9E2BC0LJahkCl.ItThccS', 'client'),
    ('Sarr',   'Awa',     'awa.sarr@example.sn',     '$2b$12$T0QZcAeexz6dSIkZcZ5sWu4Dhod5OmtW06gE4cv.eMDRxelZt7s9m', 'client'),
    ('Gueye',  'Modou',   'modou.gueye@example.sn',  '$2b$12$UPqurN6361yT0Y.2UBOdqeG3l3RpDBVaOLY6F9.W2mfpVGvGLEehC', 'client');

-- 5 clients (liés aux utilisateurs de rôle "client", ids 4 à 8)
INSERT INTO clients (utilisateur_id, nom, prenom, msisdn, email, forfait_id, statut) VALUES
    (4, 'Sow',    'Moussa',   '+221771234567', 'moussa.sow@example.sn',    2, 'actif'),
    (5, 'Ba',     'Fatou',    '+221772345678', 'fatou.ba@example.sn',      3, 'actif'),
    (6, 'Diallo', 'Ibrahima', '+221773456789', 'ibrahima.diallo@example.sn', 1, 'suspendu'),
    (7, 'Sarr',   'Awa',      '+221774567890', 'awa.sarr@example.sn',      4, 'actif'),
    (8, 'Gueye',  'Modou',    '+221775678901', 'modou.gueye@example.sn',   2, 'resilie');

-- Quelques factures de test
INSERT INTO factures (client_id, reference, periode, montant_fcfa, statut, date_emission, date_echeance) VALUES
    (1, 'FAC-202506-0001', '2025-06', 10000, 'payee',    '2025-06-01', '2025-06-15'),
    (1, 'FAC-202507-0001', '2025-07', 10000, 'impayee',  '2025-07-01', '2025-07-15'),
    (2, 'FAC-202507-0002', '2025-07', 20000, 'payee',    '2025-07-01', '2025-07-15'),
    (3, 'FAC-202506-0002', '2025-06', 5000,  'en_retard','2025-06-01', '2025-06-15'),
    (4, 'FAC-202507-0003', '2025-07', 35000, 'impayee',  '2025-07-01', '2025-07-15');

-- Un ticket de support ouvert avec un message initial
INSERT INTO tickets (client_id, agent_id, sujet, statut, ouvert_le) VALUES
    (1, 2, 'Ma facture FAC-202507-0001 de 10 000 FCFA est incorrecte', 'en_cours', NOW());

INSERT INTO messages (ticket_id, expediteur_id, type, contenu, envoye_le) VALUES
    (1, 4, 'texte', 'Bonjour, ma facture de juillet me semble erronée, pouvez-vous vérifier ?', NOW());
