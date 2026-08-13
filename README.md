# Sénégal Connect

API REST d'opérateur télécom avec support client en temps réel — Projet Fin de Module TCS L3, DSTI, Polytech Diamniadio (UAM).

## Prérequis
- Node.js 20
- Docker + Docker Compose
- PostgreSQL 14 (fourni via Docker)

## Installation locale
```
git clone <url-du-depot>
cd senegal-connect
cp .env.example .env
npm install
npm run secret      # génère un JWT_SECRET aléatoire à coller dans .env
npm run dev
```

## Sécurité (M2)
- Mots de passe hachés avec bcrypt (facteur de coût 12), jamais stockés en clair.
- Authentification JWT stateless (24h), secret ≥ 64 caractères — voir `npm run secret`.
- Middleware `verifierJWT()` : trois messages d'erreur distincts (token manquant / expiré / invalide).
- Middleware `garderRole(...roles)` : 403 si le rôle est insuffisant.
- Contrôle d'accès aux données : un utilisateur de rôle `client` ne peut consulter que sa
  propre fiche client et ses propres factures, quels que soient les filtres qu'il envoie.
- CORS restreint aux origines listées dans `CORS_ORIGINS` (jamais `*` en production).
- `src/utils/escapeHtml.js` : neutralise le HTML avant diffusion (utilisé par le chat Socket.IO, M3).
- Aucun secret dans le code source : tout est lu depuis `.env` (voir `.env.example`).

## Lancement avec Docker
```
cp .env.example .env
docker compose up -d
```

## Documentation API
Swagger UI : http://localhost:3000/api/docs

## Structure du projet
Voir docs/schema.sql pour le schéma de base de données (9 tables).

## Endpoints principaux
| Ressource     | Base URL         |
|---------------|-------------------|
| Auth          | /api/auth         |
| Clients       | /api/clients       |
| Forfaits      | /api/forfaits      |
| Factures      | /api/factures      |
| Tickets       | /api/tickets       |
| Stats         | /api/stats         |
| Health        | /api/health        |
