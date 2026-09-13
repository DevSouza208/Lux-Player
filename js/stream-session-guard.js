(() => {
  'use strict';

  // ============================================================
  // [LUX-IPTV-STREAM-001] GUARDA DE STREAMS SIMULTÂNEOS
  // ============================================================
  // Objetivo:
  // - contar somente quando TV/filme/episódio tenta reproduzir;
  // - NÃO contar login, app aberto, Home aberta ou perfil selecionado;
  // - compartilhar a capacidade entre contas Lux que usam a mesma fonte IPTV;
  // - impedir apenas uma NOVA reprodução quando a fonte já atingiu o limite;
  // - nunca derrubar aleatoriamente quem já estava assistindo.
  //
  // Como funciona:
  // 1. Antes de playLiveChannel/openVodPlayer, pedimos um slot à Edge Function.
  // 2. Se houver vaga, a reprodução normal do Lux continua sem alterações.
  // 3. Enquanto o <video> estiver realmente tocando, enviamos heartbeat.
  // 4. Pause libera o slot; ao dar play de novo, o vídeo precisa adquirir vaga outra vez.
  // 5. Fim/erro libera tudo; crash/fechamento sem release expira no backend em 90 s.
  // 6. Se o backend de controle estiver indisponível, falhamos ABERTO para não
  //    transformar uma falha de telemetria em indisponibilidade do player.
  //
  // PROTEGIDO:
  // Este arquivo é uma camada de guarda. Ele NÃO monta catálogo, NÃO altera URL,
  // NÃO troca categorias e NÃO modifica a lógica interna dos players originais.
  // ============================================================

  if (window.__luxStreamSessionGuardInstalled) return;
  window.__luxStreamSessionGuardInstalled = '20260913-stream-guard2';

  const HEARTBEAT_MS = 25_000;
  const RELEASE_DELAY_MS = 900;
  const PENDING_PLAY_TIMEOUT_MS = 30_000;

  let slotAcquired = false;
  let currentMediaKey = '';
  let currentItem = null;
  let playbackStarted = false;
  let heartbeatTimer = null;
  let releaseTimer = null;
  let pendingPlayTimer = null;
  let wrappersInstalled = false;
  let resumeAcquireInProgress = false;
  let attempts = 0;

  const getClient = () => {
    try {
      return typeof supabaseClient !== 'undefined' ? supabaseClient : null;
    } catch (_) {
      return null;
    }
  };

  const getUser = () => {
    try {
      return typeof currentUser !== 'undefined' ? currentUser : null;
    } catch (_) {
      return null;
    }
  };

  const getProfileKey = user => String(user?.profile?.data_key || user?.profile?.slot || '').trim();

  // Uma aba por usuário recebe um sessionId próprio. Assim, trocar de conta na
  // mesma aba não reutiliza indevidamente a sessão da conta anterior.
  const getSessionId = user => {
    const username = String(user?.user || 'anonymous').replace(/[^a-z0-9._-]+/gi, '_').slice(0, 60);
    const key = `lux_stream_session_id:${username}`;
    let value = sessionStorage.getItem(key);
    if (!value) {
      value = `lux-${crypto.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`}`;
      sessionStorage.setItem(key, value);
    }
    return value;
  };

  // deviceId é apenas diagnóstico de sessão. Não concede autorização e não serve
  // como identificador de segurança.
  const getDeviceId = () => {
    const key = 'lux_stream_device_id';
    let value = localStorage.getItem(key);
    if (!value) {
      value = `device-${crypto.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`}`;
      localStorage.setItem(key, value);
    }
    return value;
  };

  const normalizeType = value => {
    const type = String(value || '').toLowerCase();
    if (type === 'movie' || type === 'movies' || type === 'vod') return 'movies';
    if (type === 'tv') return 'live';
    return type;
  };

  // Conteúdo próprio R2, ROMs e leitura não consomem a assinatura IPTV.
  const shouldManageItem = item => {
    const user = getUser();
    if (!user || !item) return false;
    if (String(item.source || '').toLowerCase() === 'r2') return false;
    if (!String(user.m3uUrl || user.urlXc || '').trim()) return false;
    return ['live', 'movies', 'series'].includes(normalizeType(item.type));
  };

  // Nunca enviamos a URL inteira da mídia para stream_sessions: ela pode conter
  // credenciais do provedor. O mediaKey serve somente para diagnóstico humano.
  const mediaKeyFor = item => {
    const type = normalizeType(item?.type) || 'media';
    const id = String(item?.stream_id ?? item?.id ?? item?.episodeId ?? '').trim();
    const name = String(item?.seriesName || item?.name || '').replace(/\s+/g, ' ').trim().slice(0, 180);
    return `${type}:${id || name || 'unknown'}`.slice(0, 500);
  };

  const invoke = async (action, extra = {}) => {
    const client = getClient();
    const user = getUser();
    if (!client || !user?.user || !user?.pass) return { unavailable: true };

    const { data, error } = await client.functions.invoke('stream-sessions', {
      body: {
        action,
        username: user.user,
        password: user.pass,
        sessionId: getSessionId(user),
        deviceId: getDeviceId(),
        profileKey: getProfileKey(user),
        mediaKey: currentMediaKey,
        ...extra
      }
    });

    if (error || data?.error) throw error || new Error(data.error);
    return data || {};
  };

  const clearTimer = timer => {
    if (timer) clearTimeout(timer);
  };

  const clearHeartbeat = () => {
    if (heartbeatTimer) clearInterval(heartbeatTimer);
    heartbeatTimer = null;
  };

  const stopTimers = () => {
    clearHeartbeat();
    clearTimer(releaseTimer);
    clearTimer(pendingPlayTimer);
    releaseTimer = null;
    pendingPlayTimer = null;
  };

  const activeVideo = () => {
    const vod = document.getElementById('videoPlayerVod');
    const live = document.getElementById('videoPlayerLive');
    if (vod && !vod.paused && !vod.ended) return vod;
    if (live && !live.paused && !live.ended) return live;
    return vod || live || null;
  };

  const showLimitMessage = response => {
    const active = Number(response?.active) || 0;
    const limit = Number(response?.limit) || 0;
    alert(
      limit > 0
        ? `Limite de reprodução atingido (${active}/${limit}). Aguarde um dos dispositivos parar de assistir e tente novamente.`
        : 'O limite de reprodução desta conta foi atingido. Tente novamente em instantes.'
    );
  };

  const clearSlotState = ({ preserveMedia = false } = {}) => {
    slotAcquired = false;
    playbackStarted = false;
    stopTimers();
    if (!preserveMedia) {
      currentMediaKey = '';
      currentItem = null;
    }
  };

  // Libera o slot no servidor. Em pausa preservamos currentItem para que o botão
  // Play nativo consiga pedir um novo slot antes de retomar o mesmo conteúdo.
  const releaseSlot = async ({ preserveMedia = false } = {}) => {
    if (!slotAcquired) {
      clearSlotState({ preserveMedia });
      return;
    }

    const user = getUser();
    const sessionId = user ? getSessionId(user) : '';
    clearSlotState({ preserveMedia });

    try {
      const client = getClient();
      if (!client || !user?.user || !user?.pass || !sessionId) return;
      await client.functions.invoke('stream-sessions', {
        body: { action: 'release', username: user.user, password: user.pass, sessionId }
      });
    } catch (error) {
      console.warn('[Lux Play] O slot será liberado por expiração automática.', error);
    }
  };

  const startHeartbeat = () => {
    clearHeartbeat();
    heartbeatTimer = setInterval(async () => {
      if (!slotAcquired || !playbackStarted) return;
      const video = activeVideo();
      if (!video || video.paused || video.ended) return;

      try {
        const status = await invoke('heartbeat');
        if (!status?.expired) return;

        // O navegador pode dormir por mais de 90 s. Ao voltar, a sessão antiga já
        // expirou; tentamos ocupar um slot de novo antes de continuar consumindo.
        const result = await invoke('acquire');
        if (result?.allowed !== false) return;

        video.pause();
        showLimitMessage(result);
        clearSlotState();
      } catch (error) {
        console.warn('[Lux Play] Heartbeat de reprodução indisponível.', error);
      }
    }, HEARTBEAT_MS);
  };

  // Reserva um slot ANTES de chamar o player original. Se esta aba já possui um
  // slot, trocar de canal/episódio apenas atualiza a sessão no backend.
  const acquireSlot = async item => {
    if (!shouldManageItem(item)) return true;

    const nextMediaKey = mediaKeyFor(item);
    if (slotAcquired && currentMediaKey === nextMediaKey) return true;

    currentMediaKey = nextMediaKey;
    currentItem = item;
    playbackStarted = false;
    clearTimer(releaseTimer);
    releaseTimer = null;

    try {
      const result = await invoke('acquire', { mediaKey: nextMediaKey });

      // Falha aberta somente quando o serviço de controle não pôde ser usado.
      // Resposta explícita allowed:false sempre bloqueia a nova reprodução.
      if (result?.unavailable) return true;
      if (result?.allowed === false) {
        clearSlotState();
        showLimitMessage(result);
        return false;
      }

      slotAcquired = result?.managed !== false;

      // Reserva não pode ficar presa se a mídia falhar antes do evento playing.
      clearTimer(pendingPlayTimer);
      pendingPlayTimer = setTimeout(() => {
        if (slotAcquired && !playbackStarted) releaseSlot();
      }, PENDING_PLAY_TIMEOUT_MS);

      return true;
    } catch (error) {
      console.warn('[Lux Play] Controle de simultaneidade indisponível; reprodução preservada.', error);
      return true;
    }
  };

  // Quando o usuário usa o controle nativo do <video> para retomar uma mídia que
  // estava pausada, não passa por openVodPlayer/playLiveChannel. Por isso o evento
  // play interrompe a retomada por milissegundos, readquire o slot e só então dá play.
  const reacquireOnNativeResume = async video => {
    if (slotAcquired || resumeAcquireInProgress || !currentItem || !shouldManageItem(currentItem)) return;
    resumeAcquireInProgress = true;
    try {
      video.pause();
      const allowed = await acquireSlot(currentItem);
      if (allowed) {
        try { await video.play(); } catch (_) {}
      }
    } finally {
      resumeAcquireInProgress = false;
    }
  };

  const bindVideoLifecycle = video => {
    if (!video || video.dataset.luxStreamLifecycle === '1') return;
    video.dataset.luxStreamLifecycle = '1';

    video.addEventListener('play', () => {
      if (!slotAcquired && currentItem && shouldManageItem(currentItem)) reacquireOnNativeResume(video);
    });

    video.addEventListener('playing', () => {
      clearTimer(releaseTimer);
      releaseTimer = null;
      clearTimer(pendingPlayTimer);
      pendingPlayTimer = null;
      if (!slotAcquired) return;
      playbackStarted = true;
      startHeartbeat();
    });

    video.addEventListener('pause', () => {
      if (!slotAcquired || !playbackStarted || video.ended) return;
      clearTimer(releaseTimer);
      // Pequeno atraso evita liberar/reocupar por pausas internas muito rápidas.
      releaseTimer = setTimeout(() => {
        if (video.paused && !video.ended) releaseSlot({ preserveMedia: true });
      }, RELEASE_DELAY_MS);
    });

    video.addEventListener('ended', () => releaseSlot());
    video.addEventListener('error', () => {
      if (slotAcquired) releaseSlot();
    });
  };

  // Wrappers mínimos: não copiamos nem alteramos a lógica de reprodução original.
  // Apenas pedimos autorização antes de entrar nela.
  const installWrappers = () => {
    if (wrappersInstalled) return true;
    if (typeof window.playLiveChannel !== 'function' || typeof window.openVodPlayer !== 'function') return false;

    const originalPlayLiveChannel = window.playLiveChannel;
    const originalOpenVodPlayer = window.openVodPlayer;

    window.playLiveChannel = async function (channel) {
      if (!await acquireSlot(channel)) return false;
      return originalPlayLiveChannel.apply(this, arguments);
    };

    window.openVodPlayer = async function (item) {
      if (!await acquireSlot(item)) return false;
      return originalOpenVodPlayer.apply(this, arguments);
    };

    bindVideoLifecycle(document.getElementById('videoPlayerLive'));
    bindVideoLifecycle(document.getElementById('videoPlayerVod'));

    wrappersInstalled = true;
    window.LuxStreamSessions = {
      acquire: acquireSlot,
      release: releaseSlot,
      status: () => invoke('status'),
      get currentMediaKey() { return currentMediaKey; }
    };
    return true;
  };

  const install = () => {
    attempts += 1;
    if (installWrappers() || attempts >= 240) clearInterval(timer);
  };

  const timer = setInterval(install, 50);
  install();
})();