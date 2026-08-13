// Génère un secret JWT aléatoire de 64 caractères hexadécimaux (256 bits).
// Usage : node scripts/generer-secret.js
// Fonctionne de façon identique sur Ubuntu, macOS et Windows (aucune dépendance externe).
const crypto = require('crypto');
console.log(crypto.randomBytes(32).toString('hex'));
