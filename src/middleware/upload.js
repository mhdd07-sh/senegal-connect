const multer = require('multer');
const path = require('path');
const { v4: uuidv4 } = require('uuid');

// Types autorisés par le cahier des charges : images, PDF, audio.
const TYPES_AUTORISES = ['image/jpeg', 'image/png', 'application/pdf', 'audio/mpeg', 'audio/wav', 'audio/ogg'];

const stockage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, 'uploads/'),
  filename: (req, file, cb) => {
    // Nom de fichier généré en UUID + extension d'origine — jamais le nom fourni par le client.
    const extension = path.extname(file.originalname);
    cb(null, `${uuidv4()}${extension}`);
  },
});

function filtreFichier(req, file, cb) {
  if (TYPES_AUTORISES.includes(file.mimetype)) {
    cb(null, true);
  } else {
    cb(new Error(`Type de fichier non autorisé : ${file.mimetype}`));
  }
}

const upload = multer({
  storage: stockage,
  fileFilter: filtreFichier,
  limits: { fileSize: parseInt(process.env.MAX_FILE_SIZE, 10) || 10 * 1024 * 1024 }, // 10 Mo par défaut
});

module.exports = upload;
