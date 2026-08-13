# 🇸🇳 Sénégal Connect

Sénégal Connect est une plateforme de gestion de support client permettant
aux utilisateurs de contacter les agents, de gérer les tickets de support,
d'échanger des messages en temps réel et de réaliser des appels audio/vidéo.

## Fonctionnalités

- Gestion des utilisateurs et clients
- Authentification JWT
- Gestion des forfaits
- Gestion des factures
- Gestion des tickets
- Chat support en temps réel avec Socket.IO
- Appels audio avec WebRTC
- Appels vidéo avec WebRTC
- Partage d'écran
- Historique des appels
- API REST
- Documentation Swagger
- PostgreSQL

## Architecture

- M1 : API REST & PostgreSQL — Gestion métier
- M2 : Authentification JWT & Sécurité
- M3 : Support Client Temps Réel — Socket.IO
- M4 : Support Vidéo — PeerJS + WebRTC + Partage d'écran

## Prérequis
- Node.js 20
- npm
- Docker + Docker Compose
- PostgreSQL 14 (fourni via Docker pour le projet)

## Installation locale
```bash
git clone <url-du-depot>
cd senegal-connect
cp .env.example .env
npm install
npm run secret
npm run dev
```

## Variables d'environnement
Copiez le fichier d’exemple puis adaptez-le selon votre environnement :

```bash
cp .env.example .env
```

Contenu recommandé de `.env` :
```env
DB_HOST=localhost
DB_PORT=5432
DB_NAME=senegal_connect
DB_USER=postgres
DB_PASS=change_me
JWT_SECRET=CHANGE_ME_64_CHARACTERS_MINIMUM
JWT_EXPIRES_IN=24h
PORT=3000
LOG_LEVEL=debug
PEERJS_PORT=9001
CORS_ORIGINS=http://localhost:3000,http://localhost:3001,http://localhost:5173
MAX_FILE_SIZE=10485760
```

> Ne jamais committer le vrai fichier `.env`.

## Lancement avec Docker
```bash
cp .env.example .env
docker compose up --build -d
```

Pour arrêter les services :
```bash
docker compose down
```

Pour voir les logs :
```bash
docker compose logs -f
```

## Vérification
```bash
npm test
npm run test:cov
curl http://localhost:3000/api/health
```

## Documentation API
Swagger UI :
```text
http://localhost:3000/api/docs
```

## Sécurité
- Mots de passe hachés avec bcrypt.
- Authentification JWT stateless avec secret fort.
- Middleware de validation JWT et rôle.
- CORS limité aux origines autorisées.
- Aucun secret stocké dans le code source.
- HTML échappé avant diffusion dans les flux temps réel.

## Structure du projet
- `src/` : code backend et logique métier
- `public/` : interface utilisateur Web
- `docs/` : schéma SQL et documentation
- `tests/` : tests automatisés
- `uploads/` : fichiers téléversés
- `logs/` : journaux applicatifs

## Endpoints principaux
| Ressource | Base URL |
|-----------|----------|
| Auth | `/api/auth` |
| Clients | `/api/clients` |
| Forfaits | `/api/forfaits` |
| Factures | `/api/factures` |
| Tickets | `/api/tickets` |
| Stats | `/api/stats` |
| Health | `/api/health` |

## Auteurs
Projet développé dans le cadre du module TCS L3 — DSTI / Polytech Diamniadio.
