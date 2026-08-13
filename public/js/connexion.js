// ============================================================================
// Sénégal Connect — Page de connexion (index.html)
// ============================================================================

// Déjà connecté ? On saute directement vers l'application.
if (localStorage.getItem('sc_token')) {
  window.location.href = '/app.html';
}

document.getElementById('formulaire-connexion').addEventListener('submit', async (evenement) => {
  evenement.preventDefault();
  const erreurEl = document.getElementById('erreur-connexion');
  erreurEl.hidden = true;

  try {
    const reponse = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: document.getElementById('champ-email').value,
        mot_de_passe: document.getElementById('champ-mdp').value,
      }),
    });

    const donnees = await reponse.json();
    if (!reponse.ok) {
      throw new Error(donnees.message || 'Connexion impossible');
    }

    localStorage.setItem('sc_token', donnees.token);
    localStorage.setItem('sc_utilisateur', JSON.stringify(donnees.utilisateur));

    window.location.href = '/app.html';
  } catch (err) {
    erreurEl.textContent = err.message;
    erreurEl.hidden = false;
  }
});
