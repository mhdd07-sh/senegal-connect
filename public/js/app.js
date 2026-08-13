const state = {
  token: localStorage.getItem('sc_token') || '',
  user: JSON.parse(localStorage.getItem('sc_utilisateur') || 'null'),
  tickets: [],
  selectedTicketId: null,
  socket: null,
  messages: [],
  callHistory: [],
  pendingCall: null,
};

const refs = {};

function $id(id) {
  return document.getElementById(id);
}

function setErreur(message) {
  const el = $id('erreur-connexion');
  if (el) {
    el.textContent = message || '';
    el.hidden = !message;
  }
}

function showToast(message) {
  const toast = $id('toast');
  if (!toast) return;
  toast.textContent = message;
  toast.classList.remove('hidden');
  clearTimeout(showToast.timer);
  showToast.timer = setTimeout(() => toast.classList.add('hidden'), 3000);
}

function authHeaders(extra = {}) {
  return {
    ...extra,
    Authorization: `Bearer ${state.token}`,
  };
}

function formatDate(iso) {
  if (!iso) return '';
  const date = new Date(iso);
  return date.toLocaleString('fr-FR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function renderUser() {
  const userName = $id('nom-utilisateur');
  const roleBadge = $id('role-utilisateur');
  if (!userName || !state.user) return;
  userName.textContent = `${state.user.nom || ''}`.trim() || state.user.email || 'Utilisateur';
  roleBadge.textContent = state.user.role || 'client';
}

function renderTickets() {
  const list = $id('liste-tickets');
  if (!list) return;

  list.innerHTML = '';
  if (!state.tickets.length) {
    const empty = document.createElement('li');
    empty.className = 'item-ticket';
    empty.textContent = 'Aucun ticket';
    list.appendChild(empty);
    return;
  }

  state.tickets.forEach((ticket) => {
    const item = document.createElement('li');
    item.className = `item-ticket ${ticket.id === state.selectedTicketId ? 'selectionne' : ''}`;
    item.dataset.ticketId = String(ticket.id);
    item.innerHTML = `
      <span class="sujet">${ticket.sujet || 'Ticket sans sujet'}</span>
      <span class="badge-statut ${ticket.statut || 'ouvert'}">${ticket.statut || 'ouvert'}</span>
    `;
    item.addEventListener('click', () => selectTicket(ticket.id));
    list.appendChild(item);
  });
}

function formatHeureAppel(iso) {
  if (!iso) return '—';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
}

function formatDateAppel(iso) {
  if (!iso) return '—';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '—';

  const aujourdHui = new Date();
  const memeJour = date.getFullYear() === aujourdHui.getFullYear() &&
    date.getMonth() === aujourdHui.getMonth() &&
    date.getDate() === aujourdHui.getDate();

  if (memeJour) {
    return `Aujourd’hui, ${date.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}`;
  }

  return date.toLocaleString('fr-FR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function getAppelTypeLabel(type) {
  return type === 'video' ? 'Appel vidéo' : 'Appel audio';
}

function getAppelIcon(type) {
  return type === 'video' ? '📹' : '📞';
}

function getAppelDirection(appel) {
  const currentUserId = Number(state.user?.id);
  const initiateurId = Number(appel?.initiateur_id ?? appel?.initiateur?.id ?? 0);
  return initiateurId === currentUserId ? 'sortant' : 'entrant';
}

function getAppelCardMeta(appel) {
  const type = appel?.type === 'video' ? 'video' : 'audio';
  const direction = getAppelDirection(appel);
  const statut = String(appel?.statut || '').toLowerCase();
  const isMissed = statut === 'manque' || statut === 'missed';
  const isRefused = statut === 'refuse' || statut === 'refused';
  const isEnded = statut === 'termine' || statut === 'completed' || statut === 'accepte' || statut === 'accepted';

  return {
    type,
    direction,
    status: isMissed ? 'manque' : isRefused ? 'refuse' : isEnded ? 'termine' : 'initie',
    icon: getAppelIcon(type),
    label: getAppelTypeLabel(type),
    directionLabel: direction === 'sortant' ? 'Appel sortant' : 'Appel entrant',
    directionArrow: direction === 'sortant' ? '↗' : '↙',
    title: isMissed ? 'Appel manqué' : isRefused ? 'Appel refusé' : direction === 'sortant' ? 'Appel sortant' : 'Appel entrant',
  };
}

function normalizeCallEntry(appel) {
  if (!appel || !appel.id) return null;
  const meta = getAppelCardMeta(appel);
  const timeStamp = new Date(appel.debut_le || appel.fin_le || Date.now());

  return {
    ...appel,
    __kind: 'call',
    sortKey: timeStamp,
    type: appel.type === 'video' ? 'video' : 'audio',
    direction: meta.direction,
    status: meta.status,
    label: meta.label,
    icon: meta.icon,
    directionLabel: meta.directionLabel,
    directionArrow: meta.directionArrow,
    title: meta.title,
    durationText: Number(appel.duree_secondes) ? formatDureeAppel(appel.duree_secondes) : '',
  };
}

function renderCallCard(call) {
  if (!call) return null;

  const card = document.createElement('div');
  card.className = `bulle-appel ${call.status === 'manque' || call.status === 'refuse' ? 'appel-urgent' : ''}`;
  card.dataset.callId = String(call.id);
  card.tabIndex = 0;

  const isMissed = call.status === 'manque';
  const isRefused = call.status === 'refuse';
  const showDuration = call.durationText && (call.status === 'termine' || call.status === 'accepte');

  const header = document.createElement('div');
  header.className = 'appel-header';
  header.innerHTML = `
    <span class="appel-icone">${call.icon}</span>
    <div class="appel-titre-wrap">
      <span class="appel-titre">${call.label}</span>
      <span class="appel-direction"><span class="appel-flèche">${call.directionArrow}</span> ${isMissed ? 'Appel manqué' : isRefused ? 'Appel refusé' : call.directionLabel}</span>
    </div>
  `;

  const details = document.createElement('div');
  details.className = 'appel-details';
  const heure = call.debut_le ? formatHeureAppel(call.debut_le) : formatHeureAppel(call.fin_le);
  const dateLabel = call.debut_le ? formatDateAppel(call.debut_le) : formatDateAppel(call.fin_le);
  details.innerHTML = `
    <span class="appel-heure">${dateLabel}</span>
    ${showDuration ? `<span class="appel-duree">Durée : ${call.durationText}</span>` : ''}
  `;

  const actionRow = document.createElement('div');
  actionRow.className = 'appel-actions';

  if (isMissed || isRefused) {
    const rappel = document.createElement('button');
    rappel.type = 'button';
    rappel.className = 'appel-rappeler';
    rappel.textContent = 'Rappeler';
    rappel.addEventListener('click', (event) => {
      event.stopPropagation();
      if (typeof window.SupportWebRTC?.startCall === 'function') {
        window.SupportWebRTC.startCall(call.type === 'video' ? 'video' : 'audio');
      }
    });
    actionRow.appendChild(rappel);
  }

  card.addEventListener('click', () => {
    if (isMissed || isRefused) {
      showToast(`${call.label} — ${isMissed ? 'Appel manqué' : 'Appel refusé'}`);
      return;
    }
    showToast(`${call.label} — ${call.directionLabel} — ${call.durationText || heure}`);
  });

  card.appendChild(header);
  card.appendChild(details);
  if (actionRow.children.length) card.appendChild(actionRow);
  return card;
}

function renderMessages() {
  const messagesBox = $id('messages');
  const chatVide = $id('chat-vide');
  const chatActif = $id('chat-actif');

  if (!state.selectedTicketId) {
    chatVide.hidden = false;
    chatActif.hidden = true;
    return;
  }

  chatActif.hidden = false;
  chatVide.hidden = true;

  const ticket = state.tickets.find((t) => t.id === state.selectedTicketId) || null;
  const sujet = $id('chat-sujet');
  const statut = $id('chat-statut');
  if (sujet && ticket) {
    sujet.textContent = ticket.sujet || 'Ticket';
  }
  if (statut && ticket) {
    statut.textContent = ticket.statut || 'ouvert';
    statut.className = `badge-statut ${ticket.statut || 'ouvert'}`;
  }

  if (!messagesBox) return;

  const messageEntries = [...state.messages]
    .filter((message) => message && message.id)
    .map((message) => ({ ...message, __kind: 'message', sortKey: new Date(message.envoye_le || 0) }));

  const callEntries = [...state.callHistory]
    .filter((call) => call && call.id)
    .map((call) => normalizeCallEntry(call))
    .filter(Boolean)
    .map((call) => ({ ...call, __kind: 'call', sortKey: new Date(call.debut_le || call.fin_le || Date.now()) }));

  const entriesOrdre = [...messageEntries, ...callEntries].sort(
    (a, b) => new Date(a.sortKey) - new Date(b.sortKey)
  );

  messagesBox.innerHTML = '';

  entriesOrdre.forEach((entry) => {
    if (entry.__kind === 'call') {
      const card = renderCallCard(entry);
      if (card) messagesBox.appendChild(card);
      return;
    }

    const isMine = Number(entry.expediteur_id) === Number(state.user?.id);
    const bubble = document.createElement('div');
    bubble.className = `bulle ${isMine ? 'mienne' : 'autre'}`;

    let contentHtml = '';
    if (entry.type === 'texte') {
      contentHtml = `<div>${entry.contenu || ''}</div>`;
    } else if (entry.type === 'image' && entry.fichier_url) {
      contentHtml = `<img class="piece-jointe" src="${entry.fichier_url}" alt="${entry.fichier_nom || 'Image'}" />`;
    } else if (entry.type === 'audio' && entry.fichier_url) {
      contentHtml = `<audio controls src="${entry.fichier_url}"></audio>`;
    } else if (entry.fichier_url) {
      contentHtml = `<a class="piece-jointe" href="${entry.fichier_url}" target="_blank" rel="noreferrer">${entry.fichier_nom || 'Pièce jointe'}</a>`;
    }

    const reactions = Array.isArray(entry.reactions) ? entry.reactions : [];
    const reactionHtml = reactions.length
      ? `<div class="barre-reactions">${reactions
          .map((r) => `<span class="pastille-reaction">${r.emoji} ${r.total}</span>`)
          .join('')}</div>`
      : '';

    const status = isMine ? '<span class="coches lu">✓✓</span>' : '';
    bubble.innerHTML = `
      ${contentHtml}
      ${reactionHtml}
      <span class="horodatage">${formatDate(entry.envoye_le)} ${status}</span>
    `;

    const reactionButton = document.createElement('button');
    reactionButton.type = 'button';
    reactionButton.className = 'bouton-reagir';
    reactionButton.textContent = 'Réagir';
    reactionButton.addEventListener('click', () => toggleEmojiPicker(entry.id, bubble));
    bubble.appendChild(reactionButton);

    messagesBox.appendChild(bubble);
  });

  messagesBox.scrollTop = messagesBox.scrollHeight;
}

function toggleEmojiPicker(messageId, bubbleEl) {
  const existing = bubbleEl.querySelector('.mini-selecteur');
  if (existing) {
    existing.remove();
    return;
  }

  const picker = document.createElement('div');
  picker.className = 'mini-selecteur';
  ['👍', '❤️', '🎉', '😄', '😮', '👎', '✅', '🔥'].forEach((emoji) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = emoji;
    button.addEventListener('click', () => {
      state.socket.emit('message:reagir', { messageId, emoji });
      picker.remove();
    });
    picker.appendChild(button);
  });

  bubbleEl.appendChild(picker);
}

async function chargerTickets() {
  if (!state.token) return;
  const reponse = await fetch('/api/tickets', { headers: authHeaders() });
  const donnees = await reponse.json();
  state.tickets = Array.isArray(donnees.data) ? donnees.data : [];
  renderTickets();
  if (state.selectedTicketId) {
    const ticketExiste = state.tickets.some((t) => t.id === state.selectedTicketId);
    if (!ticketExiste) state.selectedTicketId = null;
  }
  if (!state.selectedTicketId && state.tickets.length) {
    selectTicket(state.tickets[0].id);
  }
}

async function chargerMessages(ticketId) {
  const reponse = await fetch(`/api/tickets/${ticketId}/messages`, { headers: authHeaders() });
  const donnees = await reponse.json();
  state.messages = Array.isArray(donnees.data) ? donnees.data : [];
  renderMessages();
}

function formatDureeAppel(secondes) {
  const total = Number(secondes) || 0;
  const minutes = Math.floor(total / 60);
  const secs = total % 60;
  return `${String(minutes).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
}

async function chargerHistoriqueAppels(ticketId) {
  try {
    const reponse = await fetch(`/api/tickets/${ticketId}/appels`, { headers: authHeaders() });
    const donnees = await reponse.json();
    const appels = Array.isArray(donnees.data) ? donnees.data : [];

    const deduplicated = Array.from(new Map(
      appels.map((appel) => [String(appel.id), appel])
    ).values());

    state.callHistory = deduplicated
      .map(normalizeCallEntry)
      .filter(Boolean)
      .sort((a, b) => new Date(a.debut_le || a.fin_le || 0) - new Date(b.debut_le || b.fin_le || 0));

    renderMessages();
  } catch (err) {
    console.error('Historique appels indisponible', err);
  }
}

async function selectTicket(ticketId) {
  state.selectedTicketId = ticketId;
  renderTickets();
  await chargerMessages(ticketId);
  await chargerHistoriqueAppels(ticketId);
  if (state.socket) {
    state.socket.emit('ticket:rejoindre', { ticketId });
  }
  const assignerBtn = $id('bouton-assigner');
  const fermerBtn = $id('bouton-fermer-ticket');
  const ticket = state.tickets.find((t) => t.id === ticketId);
  if (assignerBtn) {
    assignerBtn.hidden = !(state.user?.role === 'agent' && ticket && (!ticket.agent_id || ticket.agent_id === state.user.id));
  }
  if (fermerBtn) {
    fermerBtn.hidden = !(state.user?.role === 'agent' || state.user?.role === 'admin');
  }
}

async function ouvrirNouveauTicket(sujet) {
  const response = await fetch('/api/tickets', {
    method: 'POST',
    headers: authHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify({ sujet }),
  });
  const data = await response.json();
  if (!response.ok) {
    throw new Error(data.message || 'Impossible de créer le ticket');
  }
  if (state.socket) {
    state.socket.emit('ticket:ouvrir', { sujet }, () => {});
  }
  $id('champ-sujet-ticket').value = '';
  $id('formulaire-nouveau-ticket').hidden = true;
  await chargerTickets();
  if (data && data.id) {
    selectTicket(data.id);
  }
}

async function envoyerMessage(contenu) {
  if (!state.selectedTicketId || !contenu.trim()) return;
  const payload = { ticketId: state.selectedTicketId, contenu, type: 'texte' };
  if (state.socket) {
    state.socket.emit('message:envoyer', payload);
  }
  $id('champ-message').value = '';
}

async function envoyerFichier(file) {
  if (!state.selectedTicketId || !file) return;
  const form = new FormData();
  form.append('fichier', file);

  const reponse = await fetch(`/api/tickets/${state.selectedTicketId}/fichier`, {
    method: 'POST',
    headers: authHeaders(),
    body: form,
  });
  const donnees = await reponse.json();
  if (!reponse.ok) {
    throw new Error(donnees.message || 'Échec de l’envoi du fichier');
  }

  if (state.socket) {
    state.socket.emit('fichier:partager', {
      ticketId: state.selectedTicketId,
      fichierUrl: donnees.fichierUrl,
      fichierNom: donnees.fichierNom,
      fichierTaille: donnees.fichierTaille,
      mimeType: donnees.mimeType,
    });
  }
  showToast('Fichier envoyé');
}

function setupConnexionSocket() {
  if (!state.token) return;

  if (state.socket) {
    state.socket.removeAllListeners();
    state.socket.disconnect();
  }

  const socketUrl = window.location.origin || 'http://localhost:3001';
  state.socket = io(socketUrl, {
    path: '/socket.io',
    auth: { token: state.token },
    transports: ['polling', 'websocket'],
    upgrade: true,
    forceNew: true,
    reconnection: true,
    reconnectionAttempts: 5,
    timeout: 20000,
  });

  state.socket.on('connect', () => {
    console.info('Socket connecté');
    if (state.selectedTicketId) {
      state.socket.emit('ticket:rejoindre', { ticketId: state.selectedTicketId });
    }
  });

  state.socket.on('connect_error', (err) => {
    console.error('Socket error', err.message);
    showToast('Impossible de se connecter en temps réel');
  });

  state.socket.on('ticket:nouveau', (ticket) => {
    const existe = state.tickets.some((t) => t.id === ticket.id);
    if (!existe) {
      state.tickets = [ticket, ...state.tickets];
      renderTickets();
    }
    showToast(`Nouveau ticket #${ticket.id}`);
  });

  state.socket.on('ticket:pris_en_charge', (ticket) => {
    state.tickets = state.tickets.map((t) => (t.id === ticket.id ? ticket : t));
    renderTickets();
    if (state.selectedTicketId === ticket.id) {
      renderMessages();
    }
    showToast(`Ticket #${ticket.id} pris en charge`);
  });

  state.socket.on('ticket:mis_a_jour', (ticket) => {
    state.tickets = state.tickets.map((t) => (t.id === ticket.id ? ticket : t));
    renderTickets();
  });

  state.socket.on('message:nouveau', (message) => {
    if (!message) return;
    const exists = state.messages.some((m) => m.id === message.id);
    if (!exists) {
      state.messages.push(message);
      state.messages = [...state.messages].sort(
        (a, b) => new Date(a.envoye_le || 0) - new Date(b.envoye_le || 0)
      );
      renderMessages();
    }
  });

  state.socket.on('message:statut', ({ messageId, statut }) => {
    state.messages = state.messages.map((msg) => (msg.id === messageId ? { ...msg, statut } : msg));
    renderMessages();
  });

  state.socket.on('message:reaction', ({ messageId, reactions }) => {
    state.messages = state.messages.map((msg) => (msg.id === messageId ? { ...msg, reactions } : msg));
    renderMessages();
  });

  state.socket.on('frappe', ({ nom }) => {
    const ind = $id('indicateur-frappe');
    if (!ind) return;
    ind.hidden = false;
    ind.textContent = `${nom || 'Quelqu’un'} est en train d’écrire...`;
    clearTimeout(window.typingHideTimer);
    window.typingHideTimer = setTimeout(() => {
      ind.hidden = true;
    }, 2500);
  });

  state.socket.on('notification:push', ({ message }) => {
    showToast(message || 'Notification');
  });

  state.socket.on('appel:entrant', (payload) => {
    state.pendingCall = payload;
    const overlay = $id('appel-entrant-overlay');
    const titre = overlay?.querySelector('.appel-entrant-titre');
    const texte = overlay?.querySelector('.appel-entrant-texte');
    if (titre) titre.textContent = `Appel ${payload.type === 'video' ? 'vidéo' : 'audio'} entrant`;
    if (texte) texte.textContent = `${payload.initiateur?.nom || 'Utilisateur'} souhaite démarrer un appel.`;
    overlay?.classList.remove('hidden');
    window.SupportWebRTC?.showIncomingCall(payload);
  });

  state.socket.on('appel:accepte', ({ peerIdDestinataire }) => {
    showToast(`Appel accepté, le contact a rejoint la session.`);
    window.SupportWebRTC?.handleCallAccepted?.(peerIdDestinataire);
  });

  state.socket.on('appel:refuse', async ({ appelId }) => {
    showToast('L’appel a été refusé');
    if (state.selectedTicketId && appelId) {
      await chargerHistoriqueAppels(state.selectedTicketId);
    }
    window.SupportWebRTC?.cancelCall();
  });

  state.socket.on('appel:termine', async (appel) => {
    showToast('Appel terminé');
    if (state.selectedTicketId && appel && appel.id) {
      await chargerHistoriqueAppels(state.selectedTicketId);
    }
    window.SupportWebRTC?.cancelCall();
  });

  state.socket.on('appel:controle', ({ micro, video, partageEcran, source }) => {
    window.SupportWebRTC?.updateControls({ micro, video, partageEcran, source });
  });

  state.socket.on('appel:monitor', ({ appelId, type, action }) => {
    const label = action === 'demarrage' ? 'démarrage' : 'acceptation';
    const message = `Monitor d’appel ${label} — ${type === 'video' ? 'vidéo' : 'audio'} (ID: ${appelId})`;
    showToast(message);
    if (typeof window.SupportWebRTC?.triggerMonitor === 'function') {
      window.SupportWebRTC.triggerMonitor(action);
    }
  });
}

function bindUI() {
  const boutonDeconnexion = $id('bouton-deconnexion');
  if (boutonDeconnexion) {
    boutonDeconnexion.addEventListener('click', () => {
      localStorage.removeItem('sc_token');
      localStorage.removeItem('sc_utilisateur');
      window.location.href = '/index.html';
    });
  }

  const boutonNouveauTicket = $id('bouton-nouveau-ticket');
  const formNouveauTicket = $id('formulaire-nouveau-ticket');
  if (boutonNouveauTicket && formNouveauTicket) {
    boutonNouveauTicket.addEventListener('click', () => {
      formNouveauTicket.hidden = !formNouveauTicket.hidden;
    });
  }

  const formNouveau = $id('formulaire-nouveau-ticket');
  if (formNouveau) {
    formNouveau.addEventListener('submit', async (event) => {
      event.preventDefault();
      const sujet = $id('champ-sujet-ticket').value.trim();
      if (!sujet) return;
      try {
        await ouvrirNouveauTicket(sujet);
      } catch (err) {
        showToast(err.message || 'Erreur lors de la création du ticket');
      }
    });
  }

  const formMessage = $id('formulaire-message');
  if (formMessage) {
    formMessage.addEventListener('submit', (event) => {
      event.preventDefault();
      const value = $id('champ-message').value.trim();
      if (value) {
        envoyerMessage(value);
      }
    });
  }

  const champMessage = $id('champ-message');
  if (champMessage) {
    champMessage.addEventListener('input', () => {
      if (!state.selectedTicketId || !state.socket) return;
      const nom = state.user?.nom || 'Vous';
      state.socket.emit('frappe', { ticketId: state.selectedTicketId, nom });
    });
  }

  const fichierInput = $id('entree-fichier');
  if (fichierInput) {
    fichierInput.addEventListener('change', async () => {
      const file = fichierInput.files[0];
      if (!file) return;
      try {
        await envoyerFichier(file);
      } catch (err) {
        showToast(err.message || 'Impossible d’envoyer le fichier');
      } finally {
        fichierInput.value = '';
      }
    });
  }

  const boutonEmoji = $id('bouton-emoji');
  if (boutonEmoji) {
    boutonEmoji.addEventListener('click', () => {
      const selecteur = $id('selecteur-emojis');
      if (!selecteur) return;
      selecteur.hidden = !selecteur.hidden;
      if (!selecteur.hidden) {
        selecteur.innerHTML = '';
        ['😀', '👍', '🎉', '❤', '😄', '😮', '✅', '🔥', '📌', '✨', '💡', '😢'].forEach((emoji) => {
          const btn = document.createElement('button');
          btn.type = 'button';
          btn.textContent = emoji;
          btn.addEventListener('click', () => {
            const champ = $id('champ-message');
            if (champ) {
              champ.value = `${champ.value}${emoji}`.trim();
            }
            selecteur.hidden = true;
          });
          selecteur.appendChild(btn);
        });
      }
    });
  }

  const boutonAssigner = $id('bouton-assigner');
  if (boutonAssigner) {
    boutonAssigner.addEventListener('click', async () => {
      if (!state.selectedTicketId) return;
      if (state.socket) {
        state.socket.emit('ticket:assigner', { ticketId: state.selectedTicketId }, async (ticket) => {
          await chargerTickets();
          if (ticket && ticket.id) {
            await selectTicket(ticket.id);
          }
        });
      }
    });
  }

  const boutonFermer = $id('bouton-fermer-ticket');
  if (boutonFermer) {
    boutonFermer.addEventListener('click', async () => {
      if (!state.selectedTicketId) return;
      state.socket?.emit('ticket:fermer', { ticketId: state.selectedTicketId }, async (ticket) => {
        if (ticket) {
          await chargerTickets();
          if (state.selectedTicketId) {
            await selectTicket(state.selectedTicketId);
          }
        }
      });
    });
  }
}

async function initialiserApp() {
  if (!state.token || !state.user) {
    window.location.href = '/index.html';
    return;
  }

  renderUser();
  bindUI();
  setupConnexionSocket();
  window.addEventListener('beforeunload', () => {
    state.socket?.disconnect();
  });
  await chargerTickets();
  renderMessages();
}

window.addEventListener('DOMContentLoaded', initialiserApp);
window.appState = state;
