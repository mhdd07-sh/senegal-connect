// Neutralise les caractères HTML dangereux avant diffusion (protection XSS de base).
// Exigé par le cahier des charges M2 ; utilisé notamment lors de la diffusion des
// messages du chat support via Socket.IO (module M3) avant tout INSERT/emit.
function escapeHtml(texte) {
  if (typeof texte !== 'string') {
    return texte;
  }

  const correspondances = {
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
    '/': '&#x2F;',
  };

  return texte.replace(/[&<>"'/]/g, (caractere) => correspondances[caractere]);
}

module.exports = { escapeHtml };
