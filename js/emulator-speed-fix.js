(() => {
  'use strict';

  const VERSION = '20260915-n64-performance3';
  const isStandalone = window.matchMedia?.('(display-mode: standalone)').matches || window.navigator.standalone === true;
  const isPhone = /iPhone|iPod|Android.*Mobile/i.test(navigator.userAgent || '') ||
    (navigator.maxTouchPoints > 1 && Math.min(screen.width || 9999, screen.height || 9999) <= 768);
  const isIOS = /iPad|iPhone|iPod/i.test(navigator.userAgent || '') ||
    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

  if (!document.querySelector('script[data-lux-n64-local-session]')) {
    const script = document.createElement('script');
    script.src = 'js/n64-local-session.js?v=20260915-n64-local-session1';
    script.async = false;
    script.dataset.luxN64LocalSession = '1';
    document.head.appendChild(script);
  }

  const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
  const withTimeout = (promise, ms, fallback = null) => Promise.race([
    Promise.resolve(promise).catch(() => fallback),
    sleep(ms).then(() => fallback)
  ]);

  function warmEmulatorCdn() {
    const head = document.head;
    if (!head) return;
    if (!head.querySelector('link[data-lux-ejs-preconnect]')) {
      const link = document.createElement('link');
      link.rel = 'preconnect';
      link.href = 'https://cdn.emulatorjs.org';
      link.crossOrigin = 'anonymous';
      link.dataset.luxEjsPreconnect = '1';
      head.appendChild(link);
    }
  }
  warmEmulatorCdn();

  function ensurePerformanceStyles() {
    if (document.getElementById('luxEmulatorPerformanceStyle')) return;
    const style = document.createElement('style');
    style.id = 'luxEmulatorPerformanceStyle';
    style.textContent = `
      body.lux-emulator-performance #appHeader,
      body.lux-emulator-performance #mainDashboard {
        visibility: hidden !important;
      }
      body.lux-emulator-performance #emulatorModal {
        background: #000 !important;
        backdrop-filter: none !important;
        -webkit-backdrop-filter: none !important;
      }
      body.lux-emulator-performance #emulatorModal > div {
        box-shadow: none !important;
      }
      body.lux-emulator-performance #mainDashboard *,
      body.lux-emulator-performance #appHeader * {
        animation-play-state: paused !important;
        transition: none !important;
      }
    `;
    document.head.appendChild(style);
  }
  ensurePerformanceStyles();

  if (isStandalone && isPhone) {
    const RECOVERY_KEY = 'lux-play:pwa-emulator-recovery-v2';
    let alreadyRecovered = false;
    try { alreadyRecovered = localStorage.getItem(RECOVERY_KEY) === '1'; } catch (_) {}

    if (!alreadyRecovered) {
      try {
        const request = indexedDB.deleteDatabase('EmulatorJS-Cache');
        request.onsuccess = request.onerror = request.onblocked = () => {};
      } catch (_) {}

      if ('caches' in window) {
        caches.keys().then(names => Promise.allSettled(names.map(name => caches.delete(name)))).catch(() => {});
      }

      try {
        Object.keys(localStorage).forEach(key => {
          if (!/^lux-play:/i.test(key)) return;
          if (/orientation|rotate|rotation|landscape/i.test(key)) localStorage.removeItem(key);
        });
        localStorage.setItem(RECOVERY_KEY, '1');
      } catch (_) {}
    }
  }

  const removeLegacyRotationArtifacts = () => {
    document.querySelectorAll(
      '#luxVisibleMobileRotateButton, #luxEmulatorRotateButton, .lux-visible-mobile-rotate-button, .lux-emulator-rotate-button, #luxEmulatorOrientationSetting, [data-lux-rotate-setting]'
    ).forEach(node => node.remove());

    document.querySelectorAll('link[href]').forEach(link => {
      const href = String(link.getAttribute('href') || '');
      if (/mobile-lux-landscape-tune|mobile-lux-landscape-final|mobile-lux-ergonomics-tune|mobile-lux-158-polish/i.test(href)) {
        link.remove();
      }
    });

    const modal = document.getElementById('emulatorModal');
    document.body?.classList.toggle('lux-emulator-performance', !!modal);

    if (modal) {
      modal.style.removeProperty('transform');
      modal.style.removeProperty('transform-origin');
      modal.style.removeProperty('width');
      modal.style.removeProperty('height');
    }

    const container = document.getElementById('emulatorContainer');
    if (container) {
      container.style.removeProperty('transform');
      container.style.removeProperty('transform-origin');
    }
  };

  removeLegacyRotationArtifacts();
  const cleanupObserver = new MutationObserver(removeLegacyRotationArtifacts);
  cleanupObserver.observe(document.documentElement, { childList: true, subtree: true });

  if (window.__luxEmulatorSpeedFixInstalled === VERSION) return;
  window.__luxEmulatorSpeedFixInstalled = VERSION;

  const normalized = new WeakSet();

  function normalSpeed() {
    const emulator = window.EJS_emulator;
    const manager = emulator?.gameManager;
    if (!emulator || !manager) return false;

    try { manager.toggleFastForward?.(0); } catch (_) {}
    try { manager.toggleSlowMotion?.(0); } catch (_) {}
    try { manager.setFastForwardRatio?.(3); } catch (_) {}
    try { manager.setSlowMotionRatio?.(2); } catch (_) {}

    try { emulator.isFastForward = false; } catch (_) {}
    try { emulator.isSlowMotion = false; } catch (_) {}

    return true;
  }

  function patchToggle() {
    if (typeof window.toggleEmulatorFastForward !== 'function' || window.toggleEmulatorFastForward.__luxNormalSpeedPatched) return false;

    const original = window.toggleEmulatorFastForward;
    const patched = function (...args) {
      const emulator = window.EJS_emulator;
      const manager = emulator?.gameManager;
      const enabling = typeof window.emulatorFastForward !== 'undefined' ? !window.emulatorFastForward : true;

      if (enabling) {
        try { manager?.toggleSlowMotion?.(0); } catch (_) {}
        try { if (emulator) emulator.isSlowMotion = false; } catch (_) {}
      }

      const result = original.apply(this, args);
      try {
        if (typeof emulatorFastForward !== 'undefined' && !emulatorFastForward) normalSpeed();
      } catch (_) {}
      return result;
    };

    patched.__luxNormalSpeedPatched = VERSION;
    window.toggleEmulatorFastForward = patched;
    return true;
  }

  function activePendingGame() {
    try {
      if (typeof pendingEmulatorGame !== 'undefined' && pendingEmulatorGame) return pendingEmulatorGame;
      if (typeof activeEmulatorGame !== 'undefined' && activeEmulatorGame) return activeEmulatorGame;
    } catch (_) {}
    return null;
  }

  function isN64Game(game) {
    const value = String(game?.console || game?.consoleLabel || '').toLowerCase().replace(/[^a-z0-9]/g, '');
    return value === 'n64' || value === 'nintendo64';
  }

  function patchN64Startup() {
    const original = window.startEmulatorSession;
    if (typeof original !== 'function' || original.__luxN64PerformancePatched) return false;

    const patched = function (...args) {
      const game = activePendingGame();
      const n64 = isN64Game(game);
      warmEmulatorCdn();
      const result = original.apply(this, args);

      if (n64) {
        window.EJS_core = isIOS ? 'parallel-n64' : 'mupen64plus_next';
        window.EJS_forceLegacyCores = false;

        const threadsAvailable = window.crossOriginIsolated === true && typeof SharedArrayBuffer === 'function';
        window.EJS_threads = threadsAvailable;
      }
      return result;
    };

    patched.__luxN64PerformancePatched = VERSION;
    window.startEmulatorSession = patched;
    return true;
  }

  function patchGameRatingTimeout() {
    const original = window.loadGameRating;
    if (typeof original !== 'function' || original.__luxRatingTimeoutPatched) return false;

    const patched = function (game) {
      const targetGame = game || (() => { try { return currentGameDetails; } catch (_) { return null; } })();
      const result = original.apply(this, arguments);
      setTimeout(() => {
        const container = document.getElementById('gameDetailsRating');
        let sameGame = true;
        try { sameGame = !targetGame || currentGameDetails === targetGame; } catch (_) {}
        if (!container || !sameGame) return;
        if (/Carregando avaliações/i.test(container.textContent || '')) {
          container.innerHTML = '<div class="w-full"><p class="text-xs font-bold uppercase tracking-wide text-purple-400">Avaliação da comunidade</p><p class="mt-2 text-sm text-purple-300">Avaliações demoraram para responder. Você já pode jogar normalmente.</p></div>';
        }
      }, 3500);
      return result;
    };

    patched.__luxRatingTimeoutPatched = VERSION;
    window.loadGameRating = patched;
    return true;
  }

  function patchContinueFlow() {
    const original = window.chooseGameResume;
    if (typeof original !== 'function' || original.__luxContinueFlowPatched) return false;
    if (typeof window.createContinueSlotModalDOM !== 'function') return false;

    const patched = async function () {
      let game = null;
      let user = null;
      try {
        game = currentGameDetails;
        user = currentUser;
      } catch (_) {}
      if (!game) return;

      window.createContinueSlotModalDOM();
      const modal = document.getElementById('continueSlotModal');
      const buttons = document.getElementById('continueSlotButtons');
      if (modal) modal.classList.remove('hidden');
      if (buttons) {
        buttons.innerHTML = `
          <div class="rounded-xl border border-purple-900/50 bg-purple-950/30 p-4 text-center">
            <span class="block text-sm font-bold text-purple-200">Verificando seus saves...</span>
            <span class="mt-1 block text-[10px] text-purple-400">Isso não impede você de começar um novo jogo.</span>
          </div>
          <button onclick="startNewGameFromDetails()" class="rounded-xl border border-purple-700/70 bg-purple-600/80 p-4 text-center text-sm font-bold text-white hover:bg-purple-500">Jogar do zero agora</button>`;
      }

      try {
        if (typeof getGameSaveSlots !== 'function' || typeof nativeGameRecord !== 'function') {
          return await original.apply(this, arguments);
        }

        const slots = getGameSaveSlots(game);
        const nativeGame = nativeGameRecord(game);
        let nativeDate = 0;

        if (user && typeof readLocalGameSave === 'function') {
          const local = await withTimeout(readLocalGameSave(nativeGame, 0, user), 700, null);
          nativeDate = Number(local?.updatedAt) || 0;
        }

        if (user && typeof loadCloudGameSave === 'function') {
          const cloud = await withTimeout(loadCloudGameSave(nativeGame, 0, user), 1400, null);
          nativeDate = Math.max(nativeDate, Number(cloud?.updatedAt) || 0);
        }

        try {
          if (currentGameDetails !== game || currentUser !== user) return;
        } catch (_) {}

        const nativeButton = nativeDate
          ? `<button onclick="continueFromNative()" class="rounded-xl border border-emerald-700/70 bg-emerald-950/50 p-4 text-left hover:bg-emerald-900/70 transition-all"><span class="block text-sm font-bold text-emerald-200">Save natural (principal)</span><span class="mt-1 block text-[10px] text-emerald-300">Salvo em ${new Date(nativeDate).toLocaleString('pt-BR')}</span></button>`
          : '<div class="rounded-xl border border-purple-900/50 bg-purple-950/30 p-4 text-left"><span class="block text-sm font-bold text-purple-300">Save natural (principal)</span><span class="mt-1 block text-[10px] text-purple-400">Ainda não existe. Salve dentro do jogo primeiro.</span></div>';

        const stateButtons = [1, 2, 3].map(slot => {
          let date = 0;
          try { date = typeof gameSlotDate === 'function' ? gameSlotDate(slots[slot]) : 0; } catch (_) {}
          return date
            ? `<button onclick="continueFromSlot(${slot})" class="rounded-xl border border-purple-700/70 bg-purple-950/50 p-4 text-left hover:bg-purple-800/60 transition-all"><span class="block text-sm font-bold text-white">Save State · Slot ${slot}</span><span class="mt-1 block text-[10px] text-purple-300">${new Date(date).toLocaleString('pt-BR')}</span></button>`
            : `<div class="rounded-xl border border-purple-900/40 bg-purple-950/20 p-4 text-left opacity-60"><span class="block text-sm font-bold text-purple-300">Save State · Slot ${slot}</span><span class="mt-1 block text-[10px] text-purple-400">Vazio</span></div>`;
        }).join('');

        if (buttons && document.getElementById('continueSlotModal') && !document.getElementById('continueSlotModal').classList.contains('hidden')) {
          buttons.innerHTML = nativeButton + stateButtons;
        }
      } catch (error) {
        console.warn('[Lux N64] Não foi possível pré-carregar os saves:', error);
        if (buttons) {
          buttons.innerHTML = '<button onclick="startNewGameFromDetails()" class="rounded-xl border border-purple-700/70 bg-purple-600/80 p-4 text-center text-sm font-bold text-white hover:bg-purple-500">Jogar do zero</button>';
        }
      }
    };

    patched.__luxContinueFlowPatched = VERSION;
    window.chooseGameResume = patched;
    return true;
  }

  const timer = setInterval(() => {
    patchToggle();
    patchN64Startup();
    patchGameRatingTimeout();
    patchContinueFlow();
    removeLegacyRotationArtifacts();
    const emulator = window.EJS_emulator;
    if (!emulator || !emulator.gameManager || normalized.has(emulator)) return;
    if (normalSpeed()) normalized.add(emulator);
  }, 200);

  window.addEventListener('beforeunload', () => {
    clearInterval(timer);
    cleanupObserver.disconnect();
    document.body?.classList.remove('lux-emulator-performance');
  }, { once: true });
})();
