const SupportWebRTC = (() => {
  const state = {
    localStream: null,
    remoteStream: null,
    micEnabled: true,
    videoEnabled: true,
    screenSharing: false,
    pendingCall: null,
    activeCall: null,
    peer: null,
    peerId: null,
    peerReady: false,
    screenStream: null,
    callEnding: false,
    callTimer: null,
    callStartedAt: null,
  };

  function afficherOverlay(visible) {
    const overlay = document.getElementById('overlay-appel');
    if (!overlay) return;
    overlay.hidden = !visible;
  }

  function afficherAppelEntrant(visible) {
    const overlay = document.getElementById('appel-entrant-overlay');
    if (!overlay) return;
    overlay.hidden = !visible;
  }

  function setLocalVideo(stream) {
    const videoLocal = document.getElementById('video-locale');
    if (videoLocal) {
      videoLocal.srcObject = stream;
      videoLocal.muted = true;
    }
  }

  function setRemoteVideo(stream) {
    const videoDistante = document.getElementById('video-distante');
    if (videoDistante && stream) {
      videoDistante.srcObject = stream;
    }
  }

  function updateStatus(text) {
    const statut = document.getElementById('statut-appel');
    const statutAudio = document.getElementById('statut-appel-audio');
    const audioStatus = document.getElementById('audio-call-statut');
    if (statut) statut.textContent = text;
    if (statutAudio) statutAudio.textContent = text;
    if (audioStatus) audioStatus.textContent = text;
  }

  function updateCallModeUI(type = 'audio') {
    if (typeof document === 'undefined') {
      return;
    }

    const isVideoCall = type === 'video';
    const overlay = document.getElementById('overlay-appel');
    const cameraBtn = document.getElementById('bouton-camera');
    const screenBtn = document.getElementById('bouton-partage-ecran');
    const videoLocale = document.getElementById('video-locale');
    const videoDistante = document.getElementById('video-distante');
    const controles = typeof document.querySelector === 'function'
      ? document.querySelector('.controles-appel')
      : null;

    if (overlay && overlay.classList) {
      if (typeof overlay.classList.toggle === 'function') {
        overlay.classList.toggle('mode-video', isVideoCall);
        overlay.classList.toggle('mode-audio', !isVideoCall);
      } else {
        if (isVideoCall) {
          overlay.classList.add('mode-video');
          overlay.classList.remove('mode-audio');
        } else {
          overlay.classList.remove('mode-video');
          overlay.classList.add('mode-audio');
        }
      }
    }

    if (cameraBtn) {
      cameraBtn.hidden = !isVideoCall;
      cameraBtn.disabled = !isVideoCall;
    }

    if (screenBtn) {
      screenBtn.hidden = !isVideoCall;
      screenBtn.disabled = !isVideoCall;
    }

    if (videoLocale) {
      videoLocale.hidden = !isVideoCall;
    }

    if (videoDistante) {
      videoDistante.hidden = !isVideoCall;
    }

    if (controles) {
      controles.dataset.mode = isVideoCall ? 'video' : 'audio';
    }
  }

  function formatDuration(totalSeconds) {
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
  }

  function clearCallTimer() {
    if (state.callTimer) {
      clearInterval(state.callTimer);
      state.callTimer = null;
    }
    state.callStartedAt = null;
    const chrono = document.getElementById('chrono-appel');
    if (chrono) chrono.textContent = '00:00';
  }

  function startCallTimer() {
    if (state.callTimer) return;
    state.callStartedAt = Date.now();
    const chrono = document.getElementById('chrono-appel');
    const tick = () => {
      const elapsed = Math.max(0, Math.floor((Date.now() - state.callStartedAt) / 1000));
      if (chrono) chrono.textContent = formatDuration(elapsed);
    };
    tick();
    state.callTimer = setInterval(tick, 1000);
  }

  function isPeerUsable(peer) {
    if (!peer) return false;
    if (peer.destroyed === true) return false;
    if (peer.disconnected === true) return false;
    if (peer.readyState === 'closed') return false;
    return Boolean(peer.id);
  }

  function resetPeer() {
    if (state.peer) {
      try {
        if (typeof state.peer.destroy === 'function') {
          state.peer.destroy();
        } else if (typeof state.peer.disconnect === 'function') {
          state.peer.disconnect();
        }
      } catch (err) {
        console.warn('Erreur lors du reset PeerJS', err);
      }
    }

    state.peer = null;
    state.peerId = null;
    state.peerReady = false;
  }

  function waitPeerReady() {
    if (isPeerUsable(state.peer)) return Promise.resolve(state.peer);
    return new Promise((resolve, reject) => {
      const peer = ensurePeer();
      const onOpen = () => {
        cleanup();
        resolve(peer);
      };
      const onError = (err) => {
        cleanup();
        reject(err);
      };
      const cleanup = () => {
        peer.off('open', onOpen);
        peer.off('error', onError);
      };
      peer.on('open', onOpen);
      peer.on('error', onError);
    });
  }

  /*function ensurePeer() {
    if (isPeerUsable(state.peer)) return state.peer;
    resetPeer();

    const peerPort = 9001;
    const peer = new Peer(undefined, {
      host: '127.0.0.1',
      port: peerPort,
      path: '/peerjs',
      secure: false,
      debug: 0,
      config: {
        iceServers: [
          { urls: 'stun:stun.l.google.com:19302' },
          { urls: 'stun:stun1.l.google.com:19302' },
        ],
      },
    });

    peer.on('open', (id) => {
      state.peerId = id;
      state.peerReady = true;
    });

    peer.on('disconnected', () => {
      state.peerReady = false;
      state.peerId = null;
      console.warn('PeerJS déconnecté du serveur');
      if (state.activeCall || state.pendingCall) {
        try {
          peer.reconnect();
        } catch (err) {
          console.warn('PeerJS reconnect impossible', err);
        }
      }
    });

    peer.on('close', () => {
      state.peerReady = false;
      state.peerId = null;
      state.peer = null;
    });

    peer.on('call', async (call) => {
      if (!state.localStream) {
        await ensureStream({ audio: true, video: true });
      }
      call.answer(state.localStream);
      configurePeerCall(call);
    });

    peer.on('error', (err) => {
      console.error('PeerJS erreur', err);
      showToast('Erreur de connexion PeerJS');
    });

    state.peer = peer;
    return peer;
  }*/

function ensurePeer() {
  if (isPeerUsable(state.peer)) return state.peer;

  resetPeer();

  const peerHost =
    window.location.hostname || 'localhost';

  const peerPort = 9001;

  const peer = new Peer(undefined, {
    host: peerHost,
    port: peerPort,
    path: '/peerjs',
    secure: window.location.protocol === 'https:',
    debug: 2,

    config: {
      iceServers: [
        { urls: 'stun:stun.l.google.com:19302' },
        { urls: 'stun:stun1.l.google.com:19302' }
      ]
    }
  });

  peer.on('open', (id) => {
    console.log('PeerJS connecté, ID:', id);

    state.peerId = id;
    state.peerReady = true;
  });

  peer.on('disconnected', () => {
    console.warn('PeerJS déconnecté du serveur');

    state.peerReady = false;

    if (state.peer && !state.peer.destroyed) {
      setTimeout(() => {
        try {
          state.peer.reconnect();
        } catch (err) {
          console.error('Erreur reconnexion PeerJS:', err);
        }
      }, 2000);
    }
  });

  peer.on('close', () => {
    console.warn('Connexion PeerJS fermée');

    state.peerReady = false;
    state.peerId = null;
    state.peer = null;
  });

  peer.on('error', (err) => {
    console.error('PeerJS erreur:', err);

    if (err.type === 'network') {
      console.error('Impossible de joindre le serveur PeerJS');
    }

    if (err.type === 'socket-error') {
      console.error('Erreur WebSocket PeerJS');
    }
  });

  peer.on('call', async (call) => {
    console.log('Appel PeerJS entrant depuis:', call.peer);

    try {
      if (!state.localStream) {
        await ensureStream({
          audio: true,
          video: true
        });
      }

      call.answer(state.localStream);
      configurePeerCall(call);

    } catch (err) {
      console.error(
        'Impossible de répondre à l’appel PeerJS:',
        err
      );
    }
  });

  state.peer = peer;

  return peer;
}





  async function ensureStream({ audio = true, video = true } = {}) {
    if (state.localStream) {
      state.localStream.getAudioTracks().forEach((track) => { track.enabled = state.micEnabled; });
      state.localStream.getVideoTracks().forEach((track) => { track.enabled = state.videoEnabled; });
      setLocalVideo(state.localStream);
      return state.localStream;
    }

    const stream = await navigator.mediaDevices.getUserMedia({
      audio,
      video: video ? { facingMode: 'user', width: { ideal: 1280 }, height: { ideal: 720 } } : false,
    });

    state.localStream = stream;
    state.micEnabled = true;
    state.videoEnabled = true;
    setLocalVideo(stream);
    return stream;
  }

  function configurePeerCall(call) {
    state.activeCall = {
      ...(state.activeCall || {}),
      call,
      peerId: call.peer,
    };

    updateCallModeUI(state.activeCall.type || 'audio');

    call.on('stream', (remoteStream) => {
      state.remoteStream = remoteStream;
      setRemoteVideo(remoteStream);
      startCallTimer();
      const indicateurs = document.getElementById('indicateurs-distants');
      if (indicateurs) {
        indicateurs.textContent = state.activeCall?.type === 'video' ? 'Vidéo active' : 'Audio active';
      }
    });

    call.on('close', () => {
      state.activeCall = null;
      const videoDistante = document.getElementById('video-distante');
      if (videoDistante) videoDistante.srcObject = null;
      const indicateurs = document.getElementById('indicateurs-distants');
      if (indicateurs) indicateurs.textContent = '';
      updateStatus('Appel terminé');
      clearCallTimer();
      afficherOverlay(false);
      afficherAppelEntrant(false);
    });

    call.on('error', (err) => {
      console.error('PeerJS call error', err);
      showToast('Erreur de flux audio/vidéo');
      clearCallTimer();
      afficherOverlay(false);
      afficherAppelEntrant(false);
    });
  }

  function triggerMonitor(action = 'demarrage') {
    const appelId = state.activeCall?.appelId || state.pendingCall?.appelId;
    const type = state.activeCall?.type || state.pendingCall?.type || 'audio';
    if (!appelId) return;

    console.info(`Monitor appel: ${action} — appelId=${appelId} type=${type}`);
  }

  async function startCall(type = 'audio') {
    const ticketId = window.appState?.selectedTicketId;
    if (!ticketId) return;

    try {
      await ensureStream({ audio: true, video: type === 'video' });
      const socket = window.appState?.socket;
      const peer = await waitPeerReady();
      if (!socket || !peer) return;

      socket.emit('appel:initier', { ticketId, type, peerId: peer.id }, (reponse) => {
        if (reponse && reponse.erreur) {
          alert(reponse.erreur);
          return;
        }
        state.activeCall = { appelId: reponse?.appelId, type, peerId: peer.id };
        updateCallModeUI(type);
        afficherOverlay(true);
        updateStatus(type === 'video' ? 'Appel vidéo en cours…' : 'Appel audio en cours…');
      });
    } catch (err) {
      console.error(err);
      alert('Le navigateur a refusé l’accès au microphone/caméra');
    }
  }

  function showIncomingCall(payload) {
    state.pendingCall = payload;
    const type = payload?.type || 'audio';
    const texte = document.getElementById('appel-entrant-texte');
    if (texte) {
      texte.textContent = `${payload?.initiateur?.nom || 'Quelqu’un'} souhaite démarrer un appel ${type === 'video' ? 'vidéo' : 'audio'}.`;
    }
    afficherAppelEntrant(true);
  }

  async function handleCallAccepted(peerIdDestinataire) {
    const socket = window.appState?.socket;
    if (!peerIdDestinataire || !socket) return;

    const peer = await waitPeerReady();
    await ensureStream({ audio: true, video: state.pendingCall?.type === 'video' });

    if (state.pendingCall && state.pendingCall.appelId) {
      socket.emit('appel:accepter', { appelId: state.pendingCall.appelId, peerId: peer.id });
      const call = peer.call(peerIdDestinataire, state.localStream);
      configurePeerCall(call);
      state.activeCall = { ...(state.activeCall || {}), appelId: state.pendingCall.appelId, type: state.pendingCall.type, peerId: peer.id, call };
      state.pendingCall = null;
      triggerMonitor('accepte');
      updateCallModeUI(state.activeCall.type || 'audio');
      afficherOverlay(true);
      afficherAppelEntrant(false);
      updateStatus(state.activeCall.type === 'video' ? 'Appel vidéo connecté' : 'Appel audio connecté');
    }
  }

  function cancelCall({ keepOverlay = false } = {}) {
    state.pendingCall = null;
    state.callEnding = false;

    if (state.activeCall?.call && typeof state.activeCall.call.close === 'function') {
      try {
        state.activeCall.call.close();
      } catch (err) {
        console.warn('Erreur lors de la fermeture du PeerJS call', err);
      }
    }

    /*if (state.peer && !state.peer.disconnected) {
      try {
        state.peer.disconnect();
      } catch (err) {
        console.warn('Erreur lors de la déconnexion du PeerJS', err);
      }
    }*/

    clearCallTimer();
    state.activeCall = null;

    if (!keepOverlay) {
      afficherOverlay(false);
      afficherAppelEntrant(false);
    }

    if (state.screenStream) {
      state.screenStream.getTracks().forEach((track) => track.stop());
      state.screenStream = null;
    }

    if (state.localStream) {
      state.localStream.getTracks().forEach((track) => track.stop());
      state.localStream = null;
    }

    const localVideo = document.getElementById('video-locale');
    if (localVideo) localVideo.srcObject = null;
    const remoteVideo = document.getElementById('video-distante');
    if (remoteVideo) remoteVideo.srcObject = null;
    state.screenSharing = false;
    state.videoEnabled = true;
    state.micEnabled = true;
    const microBtn = document.getElementById('bouton-micro');
    const videoBtn = document.getElementById('bouton-camera');
    const screenBtn = document.getElementById('bouton-partage-ecran');
    if (microBtn) microBtn.textContent = '🎙️';
    if (videoBtn) videoBtn.textContent = '📷';
    if (screenBtn) screenBtn.textContent = '🖥️';
    updateCallModeUI('audio');
  }

  function endCurrentCall() {
    const socket = window.appState?.socket;
    const appelId = state.activeCall?.appelId || state.pendingCall?.appelId;

    if (appelId && socket && !state.callEnding) {
      state.callEnding = true;
      socket.emit('appel:terminer', { appelId });
    }

    cancelCall();
  }

  function updateControls({ micro, video, partageEcran, source }) {
    const microBtn = document.getElementById('bouton-micro');
    const videoBtn = document.getElementById('bouton-camera');
    const screenBtn = document.getElementById('bouton-partage-ecran');
    const indicateurs = document.getElementById('indicateurs-distants');

    if (microBtn) microBtn.textContent = micro === false ? '🔇' : '🎙️';
    if (videoBtn) videoBtn.textContent = video === false ? '📷 OFF' : '📷';
    if (screenBtn) screenBtn.textContent = partageEcran ? '🖥️ ON' : '🖥️';
    if (indicateurs && source && source !== state.peerId) {
      const labels = [];
      if (micro === false) labels.push('🔇');
      if (video === false) labels.push('📷 OFF');
      if (partageEcran) labels.push('🖥️ écran');
      indicateurs.textContent = labels.length ? labels.join(' ') : 'Connecté';
    }
  }

  async function replaceOutgoingVideoTrack(track) {
    if (!state.activeCall?.call?.peerConnection || !track) return false;

    const peerConnection = state.activeCall.call.peerConnection;
    const senders = peerConnection.getSenders ? peerConnection.getSenders() : [];
    const sender = senders.find((item) => item?.track && item.track.kind === 'video');

    if (sender) {
      await sender.replaceTrack(track);
      return true;
    }

    const localVideoTrack = state.localStream?.getVideoTracks?.()[0];
    if (localVideoTrack) {
      peerConnection.addTrack(track, state.localStream);
      return true;
    }

    return false;
  }

  async function restoreOutgoingCameraTrack() {
    if (!state.localStream || !state.activeCall?.call?.peerConnection) return;

    const cameraTrack = state.localStream.getVideoTracks()[0];
    if (!cameraTrack) return;

    const peerConnection = state.activeCall.call.peerConnection;
    const sender = peerConnection.getSenders().find((item) => item?.track && item.track.kind === 'video');

    if (sender) {
      await sender.replaceTrack(cameraTrack);
    } else {
      peerConnection.addTrack(cameraTrack, state.localStream);
    }
  }

  async function demarrerPartageEcran() {
    if (state.activeCall?.type !== 'video') {
      showToast('Le partage d’écran est disponible uniquement pendant un appel vidéo.');
      return;
    }

    if (!state.activeCall?.call || !state.localStream || !state.activeCall.call.peerConnection) {
      showToast('Lancez d’abord un appel vidéo pour partager votre écran.');
      return;
    }

    try {
      const screenStream = await navigator.mediaDevices.getDisplayMedia({
        video: { frameRate: 15 },
        audio: false,
      });

      const screenTrack = screenStream.getVideoTracks()[0];
      if (!screenTrack) {
        throw new Error('Aucune piste vidéo d’écran disponible');
      }

      await replaceOutgoingVideoTrack(screenTrack);

      state.screenStream = screenStream;
      state.screenSharing = true;

      const videoLocal = document.getElementById('video-locale');
      if (videoLocal) videoLocal.srcObject = screenStream;

      const screenBtn = document.getElementById('bouton-partage-ecran');
      if (screenBtn) screenBtn.textContent = '🖥️ ON';

      const socket = window.appState?.socket;
      socket?.emit('appel:controle', {
        appelId: state.activeCall?.appelId,
        micro: state.micEnabled,
        video: state.videoEnabled,
        partageEcran: true,
      });

      screenTrack.onended = async () => {
        await arreterPartageEcran();
      };
    } catch (err) {
      console.error('Erreur partage écran :', err);
      showToast('Le partage d’écran a été refusé ou n’est pas disponible.');
    }
  }

  async function arreterPartageEcran() {
    if (state.screenStream) {
      state.screenStream.getTracks().forEach((track) => track.stop());
      state.screenStream = null;
    }

    state.screenSharing = false;

    if (state.activeCall?.call && state.localStream) {
      const cameraTrack = state.localStream.getVideoTracks()[0];
      const sender = state.activeCall.call.peerConnection.getSenders().find((item) => item?.track && item.track.kind === 'video');
      if (sender && cameraTrack) {
        await sender.replaceTrack(cameraTrack);
      }
    }

    const videoLocal = document.getElementById('video-locale');
    if (videoLocal) videoLocal.srcObject = state.localStream;

    const screenBtn = document.getElementById('bouton-partage-ecran');
    if (screenBtn) screenBtn.textContent = '🖥️';

    const socket = window.appState?.socket;
    socket?.emit('appel:controle', {
      appelId: state.activeCall?.appelId,
      micro: state.micEnabled,
      video: state.videoEnabled,
      partageEcran: false,
    });
  }

  async function togglePartageEcran() {
    if (!state.activeCall?.call) {
      showToast('Lancez d’abord un appel vidéo pour partager votre écran.');
      return;
    }

    if (state.screenSharing) {
      await arreterPartageEcran();
      return;
    }

    await demarrerPartageEcran();
  }

  async function toggleScreenShare() {
    await togglePartageEcran();
  }

  function bindButtons() {
    const callAudio = document.getElementById('bouton-appel-audio');
    const callVideo = document.getElementById('bouton-appel-video');
    const refuse = document.getElementById('bouton-refuser-appel');
    const accept = document.getElementById('bouton-accepter-appel');
    const hangup = document.getElementById('bouton-raccrocher');
    const hangupAudio = document.getElementById('bouton-raccrocher-audio');
    const micro = document.getElementById('bouton-micro');
    const microAudio = document.getElementById('bouton-micro-audio');
    const camera = document.getElementById('bouton-camera');
    const screen = document.getElementById('bouton-partage-ecran');

    callAudio?.addEventListener('click', () => startCall('audio'));
    callVideo?.addEventListener('click', () => startCall('video'));

    refuse?.addEventListener('click', () => {
      const socket = window.appState?.socket;
      if (state.pendingCall && socket) {
        socket.emit('appel:refuser', { appelId: state.pendingCall.appelId });
      }
      cancelCall();
    });

    accept?.addEventListener('click', async () => {
      const socket = window.appState?.socket;
      if (state.pendingCall && socket) {
        await handleCallAccepted(state.pendingCall.peerIdInitiateur);
      }
    });

    hangup?.addEventListener('click', () => {
      endCurrentCall();
    });

    hangupAudio?.addEventListener('click', () => {
      endCurrentCall();
    });

    const toggleLocalMicro = () => {
      if (!state.localStream) return;
      state.micEnabled = !state.micEnabled;
      state.localStream.getAudioTracks().forEach((track) => {
        track.enabled = state.micEnabled;
      });
      if (micro) micro.textContent = state.micEnabled ? '🎙️' : '🔇';
      if (microAudio) microAudio.textContent = state.micEnabled ? '🎙️' : '🔇';
      const socket = window.appState?.socket;
      socket?.emit('appel:controle', {
        appelId: state.activeCall?.appelId || state.pendingCall?.appelId,
        micro: state.micEnabled,
        video: state.videoEnabled,
        partageEcran: state.screenSharing,
      });
    };

    micro?.addEventListener('click', toggleLocalMicro);
    microAudio?.addEventListener('click', toggleLocalMicro);

    camera?.addEventListener('click', async () => {
      if (!state.localStream) return;
      state.videoEnabled = !state.videoEnabled;
      state.localStream.getVideoTracks().forEach((track) => {
        track.enabled = state.videoEnabled;
      });
      camera.textContent = state.videoEnabled ? '📷' : '📷 OFF';
      const socket = window.appState?.socket;
      socket?.emit('appel:controle', {
        appelId: state.activeCall?.appelId || state.pendingCall?.appelId,
        micro: state.micEnabled,
        video: state.videoEnabled,
        partageEcran: state.screenSharing,
      });
    });

    screen?.addEventListener('click', () => {
      toggleScreenShare();
    });
  }

  document.addEventListener('DOMContentLoaded', () => {
    bindButtons();
    ensurePeer();
  });

  return {
    startCall,
    showIncomingCall,
    handleCallAccepted,
    cancelCall,
    updateControls,
    triggerMonitor,
  };
})();

window.SupportWebRTC = SupportWebRTC;
