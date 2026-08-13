// Génère un JWT de test signé avec le JWT_SECRET du .env — SANS toucher la base de données.
// Utile pour tester manuellement verifierJWT()/garderRole() ou le contrôle d'accès aux données.
//
// Usage :
//   node scripts/generer-token-test.js <id> <role> [email]
//   node scripts/generer-token-test.js 1 admin
//   node scripts/generer-token-test.js 4 client moussa.sow@example.sn
//
// ⚠️ Outil de développement uniquement — ne jamais exposer en production.

require('dotenv').config();
const jwt = require('jsonwebtoken');

const [id, role, email] = process.argv.slice(2);

if (!id || !role) {
  console.error('Usage : node scripts/generer-token-test.js <id> <role> [email]');
  console.error('Rôles valides : client, agent, admin');
  process.exit(1);
}

if (!process.env.JWT_SECRET) {
  console.error('JWT_SECRET introuvable — vérifie que le fichier .env existe (cp .env.example .env)');
  process.exit(1);
}

const token = jwt.sign(
  { id: parseInt(id, 10), nom: 'Test', email: email || `test-${id}@example.sn`, role },
  process.env.JWT_SECRET,
  { expiresIn: process.env.JWT_EXPIRES_IN || '24h', issuer: 'senegal-connect' }
);

console.log(token);
