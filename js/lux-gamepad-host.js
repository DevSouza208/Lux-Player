(() => {
  'use strict';

  const SUPABASE_URL = 'https://fvcvshppvxihhttwyyvr.supabase.co';
  const SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_G22WZFcnYGNNkbUbygE5jA_FBBSXNrm';
  const RTC_CONFIG = { iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] };
  const CONTROLLER_ORIGIN = location.protocol === 'file:' ? 'https://lux-player.vercel.app' : location.origin;

  const state = {
    code: null,
    signalClient: null,
    signalChannel: null,
    signalTopic: null,
    peers: new Map(),
    players: {
      1: { status: 'waiting', label: '' },
      2: { status: 'waiting', label: '' }
    },
    activeLayout: null
  };
  let qrLibraryPromise = null;

  const RETROPAD = { B:0, Y:1, SELECT:2, START:3, UP:4, DOWN:5, LEFT:6, RIGHT:7, A:8, X:9, L:10, R:11, L2:12, R2:13, L3:14, R3:15 };

  function randomCode() {
    let code = '';
    do {
      code = String(Math.floor(100000 + Math.random() * 900000));
    } while (/^(123456|654321|111111|222222|333333|444444|555555|666666|777777|888888|999999|000000)$/.test(code));
    return code;
  }

  function ensureCode() {
    if (!state.code) state.code = randomCode();
    return state.code;
  }

  function controllerUrl() {
    return `${CONTROLLER_ORIGIN}/controller/?code=${ensureCode()}`;
  }

  function getSignalClient() {
    if (state.signalClient) return state.signalClient;
    if (!window.supabase?.createClient) throw new Error('Supabase não está disponível para o pareamento do controle.');
    state.signalClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false }
    });
    return state.signalClient;
  }

  function signalPayload(message) {
    return message?.payload || message || {};
  }

  async function sendSignal(payload) {
    const channel = state.signalChannel;
    if (!channel) return;
    try {
      await channel.send({ type: 'broadcast', event: 'signal', payload: { ...payload, session: ensureCode() } });
    } catch (error) {
      console.warn('Lux Gamepad: falha ao enviar sinal.', error);
    }
  }

  function peerForController(controllerId) {
    return [...state.peers.values()].find(peer => peer.controllerId === controllerId) || null;
  }

  function renderPlayerStatus(player) {
    const target = document.getElementById(`luxGamepadPlayer${player}Status`);
    if (!target) return;
    const info = state.players[player] || { status: 'waiting', label: '' };
    if (info.status === 'connected') {
      target.className = 'mt-1 text-[11px] text-emerald-300';
      target.textContent = `🟢 Conectado${info.label ? ` · ${info.label}` : ''}`;
    } else if (info.status === 'connecting') {
      target.className = 'mt-1 text-[11px] text-amber-300';
      target.textContent = '🟡 Conectando...';
    } else {
      target.className = 'mt-1 text-[11px] text-purple-400';
      target.textContent = '⚪ Aguardando controle';
    }
  }

  function renderPlayers() {
    renderPlayerStatus(1);
    renderPlayerStatus(2);
  }

  function setPlayerStatus(player, status, label = '') {
    if (![1, 2].includes(Number(player))) return;
    state.players[player] = { status, label };
    renderPlayerStatus(player);
  }

  function closePeer(player, notify = false) {
    const peer = state.peers.get(Number(player));
    if (!peer) {
      setPlayerStatus(Number(player), 'waiting');
      return;
    }
    if (notify) sendSignal({ type: 'host-disconnect', target: peer.controllerId, player: Number(player) });
    try { peer.dataChannel?.close(); } catch (_) {}
    try { peer.pc?.close(); } catch (_) {}
    state.peers.delete(Number(player));
    setPlayerStatus(Number(player), 'waiting');
  }

  function getEmulatorLayout() {
    let consoleType = '';
    try { consoleType = String(typeof activeEmulatorGame !== 'undefined' ? activeEmulatorGame?.console || '' : ''); } catch (_) {}
    switch (consoleType.toLowerCase()) {
      case 'gb': case 'gbc': return 'gb';
      case 'gba': return 'gba';
      case 'nes': return 'nes';
      case 'snes': return 'snes';
      case 'megadrive': case 'genesis': return 'megadrive6';
      case 'mastersystem': case 'sms': return 'nes';
      case 'n64': return 'n64';
      default: return null;
    }
  }

  function sendHostState(peer) {
    if (!peer?.dataChannel || peer.dataChannel.readyState !== 'open') return;
    const layout = getEmulatorLayout();
    try { peer.dataChannel.send(JSON.stringify({ type: 'host-state', layout })); } catch (_) {}
  }

  function broadcastHostState() {
    const layout = getEmulatorLayout();
    if (layout === state.activeLayout) return;
    state.activeLayout = layout;
    state.peers.forEach(sendHostState);
  }

  function digitalInputIndex(layout, input) {
    if (layout === 'megadrive3' || layout === 'megadrive6') {
      const mega = { A:1, B:0, C:8, X:10, Y:9, Z:11, MODE:2, START:3, UP:4, DOWN:5, LEFT:6, RIGHT:7 };
      return mega[input];
    }
    if (layout === 'n64') {
      const n64 = { A:0, B:1, START:3, UP:4, DOWN:5, LEFT:6, RIGHT:7, L:10, R:11, Z:12 };
      return n64[input];
    }
    return RETROPAD[input];
  }

  function routeRemoteInput(packet) {
    const manager = window.EJS_emulator?.gameManager;
    if (!manager || typeof manager.simulateInput !== 'function') return;
    const player = Math.max(0, Math.min(1, Number(packet.player || 1) - 1));
    const layout = packet.layout || getEmulatorLayout() || 'gba';

    try {
      if (packet.type === 'analog') {
        if (packet.input === 'ANALOG_X') manager.simulateInput(player, 16, Math.round(0x7fff * Number(packet.value || 0)));
        if (packet.input === 'ANALOG_Y') manager.simulateInput(player, 17, Math.round(0x7fff * Number(packet.value || 0)));
        return;
      }

      if (layout === 'n64' && /^C_(UP|DOWN|LEFT|RIGHT)$/.test(packet.input)) {
        const pressed = packet.pressed ? 0x7fff : 0;
        if (packet.input === 'C_LEFT') manager.simulateInput(player, 18, -pressed);
        if (packet.input === 'C_RIGHT') manager.simulateInput(player, 18, pressed);
        if (packet.input === 'C_UP') manager.simulateInput(player, 19, -pressed);
        if (packet.input === 'C_DOWN') manager.simulateInput(player, 19, pressed);
        return;
      }

      const index = digitalInputIndex(layout, packet.input);
      if (typeof index !== 'number') return;
      manager.simulateInput(player, index, packet.pressed ? 1 : 0);
    } catch (error) {
      console.warn('Lux Gamepad: não foi possível enviar o input ao EmulatorJS.', error);
    }
  }

  function bindHostDataChannel(peer, channel) {
    peer.dataChannel = channel;
    channel.onopen = () => {
      setPlayerStatus(peer.player, 'connected', peer.deviceName);
      sendHostState(peer);
    };
    channel.onmessage = event => {
      try {
        const packet = JSON.parse(event.data);
        if (packet?.type === 'digital' || packet?.type === 'analog') routeRemoteInput(packet);
      } catch (error) {
        console.warn('Lux Gamepad: pacote inválido recebido.', error);
      }
    };
    channel.onclose = () => {
      if (state.peers.get(peer.player) === peer) {
        state.peers.delete(peer.player);
        setPlayerStatus(peer.player, 'waiting');
      }
    };
    channel.onerror = () => setPlayerStatus(peer.player, 'waiting');
  }

  async function addHostIce(peer, candidate) {
    if (!candidate) return;
    if (!peer.pc.remoteDescription) {
      peer.pendingIce.push(candidate);
      return;
    }
    try { await peer.pc.addIceCandidate(candidate); } catch (error) { console.warn('Lux Gamepad ICE:', error); }
  }

  async function flushHostIce(peer) {
    const pending = peer.pendingIce.splice(0);
    for (const candidate of pending) await addHostIce(peer, candidate);
  }

  async function createPeerForController(message) {
    const player = Number(message.player);
    if (![1, 2].includes(player) || !message.controllerId) return;

    const existing = state.peers.get(player);
    if (existing && existing.controllerId !== message.controllerId && ['connecting', 'connected'].includes(state.players[player]?.status)) {
      await sendSignal({ type: 'reject', target: message.controllerId, player, reason: `Jogador ${player} já está conectado.` });
      return;
    }
    if (existing) closePeer(player);

    const pc = new RTCPeerConnection(RTC_CONFIG);
    const peer = {
      player,
      controllerId: message.controllerId,
      deviceName: String(message.deviceName || 'Celular').slice(0, 40),
      pc,
      dataChannel: null,
      pendingIce: []
    };
    state.peers.set(player, peer);
    setPlayerStatus(player, 'connecting', peer.deviceName);

    pc.onicecandidate = event => {
      if (event.candidate) sendSignal({ type: 'ice', target: peer.controllerId, player, candidate: event.candidate.toJSON?.() || event.candidate });
    };
    pc.onconnectionstatechange = () => {
      if (['failed', 'closed'].includes(pc.connectionState)) closePeer(player);
      if (pc.connectionState === 'disconnected') setPlayerStatus(player, 'connecting', peer.deviceName);
    };

    const channel = pc.createDataChannel('lux-input');
    bindHostDataChannel(peer, channel);

    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    await sendSignal({ type: 'offer', target: peer.controllerId, player, description: pc.localDescription });
  }

  async function handleSignal(raw) {
    const message = signalPayload(raw);
    if (!message || message.session !== state.code) return;

    try {
      if (message.type === 'join') {
        await createPeerForController(message);
        return;
      }
      if (message.type === 'answer' && message.controllerId) {
        const peer = peerForController(message.controllerId);
        if (!peer || Number(message.player) !== peer.player) return;
        await peer.pc.setRemoteDescription(message.description);
        await flushHostIce(peer);
        return;
      }
      if (message.type === 'ice' && message.controllerId) {
        const peer = peerForController(message.controllerId);
        if (peer) await addHostIce(peer, message.candidate);
        return;
      }
      if (message.type === 'leave' && message.controllerId) {
        const peer = peerForController(message.controllerId);
        if (peer) closePeer(peer.player);
      }
    } catch (error) {
      console.warn('Lux Gamepad: erro no pareamento.', error);
    }
  }

  async function stopSignalSession() {
    [1, 2].forEach(player => closePeer(player, true));
    if (state.signalChannel && state.signalClient) {
      try { await state.signalClient.removeChannel(state.signalChannel); } catch (_) {}
    }
    state.signalChannel = null;
    state.signalTopic = null;
  }

  async function startSignalSession() {
    const code = ensureCode();
    const topic = `lux-gamepad:${code}`;
    if (state.signalChannel && state.signalTopic === topic) return;
    await stopSignalSession();

    try {
      const client = getSignalClient();
      const channel = client.channel(topic, { config: { broadcast: { self: false } } });
      state.signalChannel = channel;
      state.signalTopic = topic;
      channel.on('broadcast', { event: 'signal' }, handleSignal);
      channel.subscribe(status => {
        if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') console.warn('Lux Gamepad: canal de pareamento indisponível.', status);
      });
    } catch (error) {
      console.warn('Lux Gamepad: não foi possível iniciar a sessão.', error);
    }
  }

  function ensureQrLibrary() {
    if (window.QRCode) return Promise.resolve(window.QRCode);
    if (qrLibraryPromise) return qrLibraryPromise;
    qrLibraryPromise = new Promise((resolve, reject) => {
      const existing = document.querySelector('script[data-lux-qrcode]');
      if (existing) {
        existing.addEventListener('load', () => resolve(window.QRCode), { once: true });
        existing.addEventListener('error', reject, { once: true });
        return;
      }
      const script = document.createElement('script');
      script.src = 'https://cdnjs.cloudflare.com/ajax/libs/qrcodejs/1.0.0/qrcode.min.js';
      script.async = true;
      script.dataset.luxQrcode = '1';
      script.onload = () => window.QRCode ? resolve(window.QRCode) : reject(new Error('Biblioteca de QR Code indisponível.'));
      script.onerror = () => reject(new Error('Não foi possível carregar o gerador de QR Code.'));
      document.head.appendChild(script);
    }).catch(error => { qrLibraryPromise = null; throw error; });
    return qrLibraryPromise;
  }

  async function renderQrCode() {
    const target = document.getElementById('luxGamepadQrCode');
    const status = document.getElementById('luxGamepadQrStatus');
    if (!target) return;
    target.innerHTML = '';
    if (status) status.textContent = 'Gerando QR Code...';
    try {
      const QRCode = await ensureQrLibrary();
      if (!document.getElementById('luxGamepadQrCode')) return;
      new QRCode(target, { text: controllerUrl(), width: 184, height: 184, colorDark: '#120c1f', colorLight: '#ffffff', correctLevel: QRCode.CorrectLevel.M });
      const image = target.querySelector('img');
      if (image) image.alt = `QR Code da sala ${ensureCode()}`;
      if (status) status.textContent = 'Escaneie para abrir o controle com o código já preenchido.';
    } catch (error) {
      console.warn('Não foi possível gerar o QR Code do Lux Gamepad:', error);
      target.innerHTML = '<div class="flex h-[184px] w-[184px] items-center justify-center rounded-xl border border-purple-800/60 bg-purple-950/40 p-4 text-center text-[11px] text-purple-300">QR Code indisponível.<br>Use o código ou copie o link.</div>';
      if (status) status.textContent = 'Use o código de 6 dígitos ou o link do painel.';
    }
  }

  function closeLuxGamepadSetup() {
    document.getElementById('luxGamepadSetupModal')?.remove();
  }

  function copyControllerLink() {
    const url = controllerUrl();
    navigator.clipboard?.writeText(url).then(() => {
      const status = document.getElementById('luxGamepadCopyStatus');
      if (status) status.textContent = 'Link copiado.';
    }).catch(() => prompt('Copie o link do Lux Controller:', url));
  }

  async function regenerateLuxGamepadSession() {
    await stopSignalSession();
    state.code = randomCode();
    state.activeLayout = null;
    renderModalValues();
    startSignalSession();
  }

  function renderModalValues() {
    const code = ensureCode();
    const codeEl = document.getElementById('luxGamepadRoomCode');
    const linkEl = document.getElementById('luxGamepadControllerLink');
    if (codeEl) codeEl.textContent = `${code.slice(0, 3)} ${code.slice(3)}`;
    if (linkEl) linkEl.value = controllerUrl();
    renderPlayers();
    renderQrCode();
  }

  function openLuxGamepadSetup() {
    closeLuxGamepadSetup();
    const modal = document.createElement('div');
    modal.id = 'luxGamepadSetupModal';
    modal.className = 'fixed inset-0 z-[70] flex items-center justify-center bg-black/80 backdrop-blur-md p-4';
    modal.innerHTML = `
      <div class="flex w-full max-w-4xl items-stretch justify-center gap-4">
        <div class="w-full max-w-lg max-h-[92vh] overflow-y-auto rounded-3xl border border-purple-800/60 bg-[#120c1f] p-6 shadow-2xl">
          <div class="flex items-start justify-between gap-4">
            <div><p class="text-[10px] font-bold uppercase tracking-[0.18em] text-purple-400">Lux Controller</p><h2 class="mt-1 text-xl font-black text-white">Configurar gamepads</h2><p class="mt-1 text-xs text-purple-300/70">Use o celular como controle para os jogos retrô do Lux Play.</p></div>
            <button onclick="closeLuxGamepadSetup()" class="rounded-xl bg-purple-950/60 p-2 text-purple-300 hover:bg-rose-600 hover:text-white" aria-label="Fechar">✕</button>
          </div>
          <div class="mt-5 rounded-2xl border border-purple-800/50 bg-[#0d0817] p-5 text-center"><p class="text-[10px] font-bold uppercase tracking-widest text-purple-400">Código da sessão</p><div id="luxGamepadRoomCode" class="mt-2 text-4xl font-black tracking-[0.20em] text-white"></div><p class="mt-2 text-[11px] text-purple-300/60">A sessão continuará válida enquanto o Lux Play estiver aberto.</p></div>
          <div class="mt-4 grid grid-cols-2 gap-3"><div class="rounded-2xl border border-purple-900/50 bg-purple-950/30 p-4"><span class="text-xs font-bold text-white">Jogador 1</span><p id="luxGamepadPlayer1Status" class="mt-1 text-[11px] text-purple-400">⚪ Aguardando controle</p></div><div class="rounded-2xl border border-purple-900/50 bg-purple-950/30 p-4"><span class="text-xs font-bold text-white">Jogador 2</span><p id="luxGamepadPlayer2Status" class="mt-1 text-[11px] text-purple-400">⚪ Aguardando controle</p></div></div>
          <label class="mt-4 block text-[10px] font-bold uppercase tracking-wide text-purple-400">Link do controle</label><div class="mt-1 flex gap-2"><input id="luxGamepadControllerLink" readonly class="min-w-0 flex-1 rounded-xl border border-purple-900/60 bg-[#0d0817] px-3 py-2 text-xs text-purple-200 outline-none"><button onclick="copyControllerLink()" class="rounded-xl border border-purple-700/60 bg-purple-950/60 px-3 py-2 text-xs font-bold text-purple-200 hover:bg-purple-800">Copiar</button></div><p id="luxGamepadCopyStatus" class="mt-1 h-4 text-[10px] text-emerald-300"></p>
          <div class="mt-4 flex flex-wrap gap-2"><button onclick="window.open(controllerUrl(), '_blank', 'noopener')" class="flex-1 rounded-xl bg-purple-600 px-4 py-3 text-xs font-bold text-white hover:bg-purple-500">Abrir Lux Controller</button><button onclick="regenerateLuxGamepadSession()" class="rounded-xl border border-purple-800/60 bg-purple-950/50 px-4 py-3 text-xs font-bold text-purple-200 hover:bg-purple-900">Novo código</button></div>
        </div>
        <aside class="hidden w-[250px] shrink-0 flex-col items-center justify-center rounded-3xl border border-purple-800/60 bg-[#120c1f] p-5 text-center shadow-2xl md:flex"><p class="text-[10px] font-bold uppercase tracking-[0.18em] text-purple-400">Conectar celular</p><div id="luxGamepadQrCode" class="mt-4 flex min-h-[184px] min-w-[184px] items-center justify-center rounded-2xl bg-white p-3 shadow-lg shadow-purple-950/30"></div><p id="luxGamepadQrStatus" class="mt-3 text-[10px] leading-relaxed text-purple-300/70">Gerando QR Code...</p><p class="mt-4 text-[10px] leading-relaxed text-purple-300/50">No celular, instale o Lux Controller na tela inicial para jogar sem a barra do navegador.</p></aside>
      </div>`;
    modal.addEventListener('click', event => { if (event.target === modal) closeLuxGamepadSetup(); });
    document.body.appendChild(modal);
    renderModalValues();
    startSignalSession();
  }

  function injectButton() {
    const games = document.getElementById('gamesSection');
    if (!games || document.getElementById('luxGamepadSetupBtn')) return;
    const consoleFilter = [...games.querySelectorAll('select')].find(select => (select.getAttribute('onchange') || '').includes("setGamesFilter('console'"));
    if (!consoleFilter) return;
    const button = document.createElement('button');
    button.id = 'luxGamepadSetupBtn'; button.type = 'button'; button.onclick = openLuxGamepadSetup;
    button.className = 'bg-purple-600 hover:bg-purple-500 border border-purple-400/40 text-white rounded-lg px-3 py-1.5 text-[11px] font-bold transition-colors flex items-center gap-1.5';
    button.innerHTML = '<i data-lucide="smartphone" class="w-3.5 h-3.5"></i><span>Lux Gamepad</span>';
    consoleFilter.parentElement?.insertBefore(button, consoleFilter); window.lucide?.createIcons?.();
  }

  function init() {
    const games = document.getElementById('gamesSection');
    if (!games) return;
    injectButton();
    const observer = new MutationObserver(() => injectButton()); observer.observe(games, { childList: true, subtree: true });
    setInterval(broadcastHostState, 700);
    window.addEventListener('beforeunload', () => { stopSignalSession(); });
  }

  window.openLuxGamepadSetup = openLuxGamepadSetup;
  window.closeLuxGamepadSetup = closeLuxGamepadSetup;
  window.copyControllerLink = copyControllerLink;
  window.regenerateLuxGamepadSession = regenerateLuxGamepadSession;
  window.controllerUrl = controllerUrl;

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, { once: true }); else init();
})();
