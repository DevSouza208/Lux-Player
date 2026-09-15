(() => {
  'use strict';

  const VERSION = '20260915-n64-local-session2';
  const MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;
  const MAX_AGE_MINS = 7 * 24 * 60;
  const CORE_READY_KEY = 'lux-play:n64-core-ready-v2';
  const OVERLAY_ID = 'luxN64PrepareOverlay';
  const START_TIMEOUT_MS = 18000;

  if (window.__luxN64LocalSession === VERSION) return;
  window.__luxN64LocalSession = VERSION;

  let launchWatchdog = 0;
  let lastLaunchGame = null;

  const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

  function isN64Game(game) {
    const value = String(game?.console || game?.consoleLabel || '')
      .toLowerCase()
      .replace(/[^a-z0-9]/g, '');
    return value === 'n64' || value === 'nintendo64';
  }

  function currentDetailsGame() {
    try { return typeof currentGameDetails !== 'undefined' ? currentGameDetails : null; }
    catch (_) { return null; }
  }

  function pendingGame() {
    try {
      if (typeof pendingEmulatorGame !== 'undefined' && pendingEmulatorGame) return pendingEmulatorGame;
      if (typeof activeEmulatorGame !== 'undefined' && activeEmulatorGame) return activeEmulatorGame;
    } catch (_) {}
    return null;
  }

  function coreCacheFresh() {
    try {
      const stamp = Number(localStorage.getItem(CORE_READY_KEY)) || 0;
      return stamp > 0 && Date.now() - stamp < MAX_AGE_MS;
    } catch (_) {
      return false;
    }
  }

  function markCoreUsed() {
    try { localStorage.setItem(CORE_READY_KEY, String(Date.now())); } catch (_) {}
  }

  function cleanupCoreMarker() {
    try {
      const stamp = Number(localStorage.getItem(CORE_READY_KEY)) || 0;
      if (stamp && Date.now() - stamp >= MAX_AGE_MS) localStorage.removeItem(CORE_READY_KEY);
    } catch (_) {}
  }

  function configureEmulatorCache() {
    const previous = window.EJS_cacheConfig && typeof window.EJS_cacheConfig === 'object'
      ? window.EJS_cacheConfig
      : {};
    window.EJS_cacheConfig = {
      ...previous,
      enabled: true,
      cacheMaxSizeMB: Math.max(512, Number(previous.cacheMaxSizeMB) || 0),
      cacheMaxAgeMins: MAX_AGE_MINS
    };
    window.EJS_CacheLimit = Math.max(Number(window.EJS_CacheLimit) || 0, 512 * 1024 * 1024);
  }

  function ensureStyles() {
    if (document.getElementById('luxN64PrepareStyle')) return;
    const style = document.createElement('style');
    style.id = 'luxN64PrepareStyle';
    style.textContent = `
      #${OVERLAY_ID} {
        position: fixed;
        inset: 0;
        z-index: 2147483500;
        display: flex;
        align-items: center;
        justify-content: center;
        padding: 24px;
        background: #09060e;
        color: #fff;
      }
      #${OVERLAY_ID}.hidden { display: none !important; }
      #${OVERLAY_ID} .lux-n64-prep-card {
        width: min(440px, 100%);
        padding: 30px 26px;
        border: 1px solid rgba(126, 34, 206, .6);
        border-radius: 28px;
        background: #120c1f;
        box-shadow: 0 24px 70px rgba(0, 0, 0, .42);
        text-align: center;
      }
      #${OVERLAY_ID} .lux-n64-prep-icon {
        width: 68px;
        height: 68px;
        margin: 0 auto 18px;
        border-radius: 22px;
        display: grid;
        place-items: center;
        font-size: 30px;
        background: rgba(147, 51, 234, .18);
        border: 1px solid rgba(168, 85, 247, .28);
      }
      #${OVERLAY_ID} .lux-n64-prep-title {
        font-size: 20px;
        font-weight: 900;
        letter-spacing: -.02em;
      }
      #${OVERLAY_ID} .lux-n64-prep-game {
        margin-top: 5px;
        font-size: 13px;
        color: #c4b5fd;
      }
      #${OVERLAY_ID} .lux-n64-prep-status {
        margin-top: 22px;
        font-size: 13px;
        font-weight: 700;
        color: #e9d5ff;
      }
      #${OVERLAY_ID} .lux-n64-prep-track {
        height: 8px;
        margin-top: 12px;
        overflow: hidden;
        border-radius: 999px;
        background: rgba(88, 28, 135, .42);
      }
      #${OVERLAY_ID} .lux-n64-prep-bar {
        width: 3%;
        height: 100%;
        border-radius: inherit;
        background: linear-gradient(90deg, #7c3aed, #c084fc);
        transition: width .18s ease;
      }
      #${OVERLAY_ID} .lux-n64-prep-meta {
        margin-top: 10px;
        font-size: 11px;
        color: #a78bfa;
      }
      #${OVERLAY_ID} .lux-n64-prep-note {
        margin-top: 20px;
        font-size: 11px;
        line-height: 1.55;
        color: #7e6b9f;
      }
      #${OVERLAY_ID} .lux-n64-prep-recovery {
        display: none;
        width: 100%;
        margin-top: 18px;
        border: 1px solid rgba(168, 85, 247, .55);
        border-radius: 14px;
        padding: 11px 14px;
        background: rgba(88, 28, 135, .45);
        color: #f3e8ff;
        font-size: 12px;
        font-weight: 800;
        cursor: pointer;
      }
      #${OVERLAY_ID}[data-recovery="1"] .lux-n64-prep-recovery { display: block; }
    `;
    document.head.appendChild(style);
  }

  function ensureOverlay(game) {
    ensureStyles();
    let overlay = document.getElementById(OVERLAY_ID);
    if (!overlay) {
      overlay = document.createElement('div');
      overlay.id = OVERLAY_ID;
      overlay.dataset.recovery = '0';
      overlay.innerHTML = `
        <div class="lux-n64-prep-card">
          <div class="lux-n64-prep-icon">🎮</div>
          <div class="lux-n64-prep-title">Preparando Nintendo 64</div>
          <div class="lux-n64-prep-game"></div>
          <div class="lux-n64-prep-status">Preparando arquivos temporários...</div>
          <div class="lux-n64-prep-track"><div class="lux-n64-prep-bar"></div></div>
          <div class="lux-n64-prep-meta">0%</div>
          <button type="button" class="lux-n64-prep-recovery">Voltar aos detalhes</button>
          <div class="lux-n64-prep-note">A ROM e o núcleo ficam em cache neste dispositivo. Arquivos sem uso por 7 dias podem ser removidos automaticamente.</div>
        </div>`;
      document.body.appendChild(overlay);
      overlay.querySelector('.lux-n64-prep-recovery')?.addEventListener('click', recoverToDetails);
    }
    overlay.dataset.recovery = '0';
    overlay.querySelector('.lux-n64-prep-game').textContent = game?.name || 'Jogo de Nintendo 64';
    overlay.classList.remove('hidden');
    return overlay;
  }

  function updateOverlay({ status, progress, meta } = {}) {
    const overlay = document.getElementById(OVERLAY_ID);
    if (!overlay) return;
    if (status) overlay.querySelector('.lux-n64-prep-status').textContent = status;
    if (Number.isFinite(progress)) {
      const value = Math.max(0, Math.min(1, progress));
      overlay.querySelector('.lux-n64-prep-bar').style.width = `${Math.max(3, Math.round(value * 100))}%`;
      overlay.querySelector('.lux-n64-prep-meta').textContent = meta || `${Math.round(value * 100)}%`;
    } else if (meta) {
      overlay.querySelector('.lux-n64-prep-meta').textContent = meta;
    }
  }

  function hideOverlay(delay = 120) {
    const overlay = document.getElementById(OVERLAY_ID);
    if (!overlay) return;
    setTimeout(() => {
      overlay.classList.add('hidden');
      overlay.dataset.recovery = '0';
    }, delay);
  }

  function clearLaunchWatchdog() {
    if (!launchWatchdog) return;
    clearTimeout(launchWatchdog);
    launchWatchdog = 0;
  }

  function recoverToDetails() {
    clearLaunchWatchdog();
    const game = lastLaunchGame;
    hideOverlay(0);
    try {
      if (typeof closeGameEmulator === 'function') closeGameEmulator();
    } catch (_) {}
    setTimeout(() => {
      try {
        if (game && typeof openGameDetails === 'function') openGameDetails(game);
      } catch (_) {}
    }, 20);
  }

  function showRecovery(game) {
    lastLaunchGame = game || lastLaunchGame;
    const overlay = ensureOverlay(lastLaunchGame);
    overlay.dataset.recovery = '1';
    updateOverlay({
      status: 'O núcleo demorou mais que o esperado.',
      progress: 1,
      meta: 'Nada ficou preso: volte aos detalhes e tente novamente.'
    });
  }

  function armLaunchWatchdog(game) {
    clearLaunchWatchdog();
    lastLaunchGame = game || lastLaunchGame;
    launchWatchdog = setTimeout(() => {
      launchWatchdog = 0;
      const overlay = document.getElementById(OVERLAY_ID);
      if (!overlay || overlay.classList.contains('hidden')) return;

      const ready = !!window.EJS_emulator?.gameManager;
      if (ready) {
        markCoreUsed();
        updateOverlay({ status: 'Tudo pronto!', progress: 1, meta: 'Executando localmente' });
        hideOverlay(120);
        return;
      }
      showRecovery(lastLaunchGame);
    }, START_TIMEOUT_MS);
  }

  async function getRomStatus(game) {
    if (!window.LuxRomCache?.status || !game?.url) return null;
    try { return await window.LuxRomCache.status(game); }
    catch (_) { return null; }
  }

  async function prepareRom(game) {
    if (!game || game.external || game.localUrl || !game.url || !window.LuxRomCache) {
      return { local: !!game?.localUrl, cached: false };
    }

    const existing = await getRomStatus(game);
    if (existing) return { local: true, cached: true, size: existing.size || 0 };

    ensureOverlay(game);
    updateOverlay({ status: 'Baixando ROM para este dispositivo...', progress: 0.04 });

    await window.LuxRomCache.download(game, ratio => {
      const normalized = Number.isFinite(ratio) ? ratio : 0;
      updateOverlay({
        status: 'Baixando ROM para este dispositivo...',
        progress: 0.04 + (normalized * 0.82),
        meta: normalized > 0 ? `${Math.round(normalized * 100)}% da ROM` : 'Baixando...'
      });
    });

    const saved = await getRomStatus(game);
    return { local: !!saved, cached: false, size: saved?.size || 0 };
  }

  function autoStartPreparedN64(game) {
    if (!isN64Game(game)) return;
    if (document.getElementById('ejs-script') || window.EJS_emulator) {
      armLaunchWatchdog(game);
      return;
    }

    updateOverlay({
      status: 'Carregando núcleo e iniciando o jogo...',
      progress: 0.94,
      meta: coreCacheFresh() ? 'Núcleo em cache' : 'Primeiro início: preparando o núcleo'
    });

    setTimeout(() => {
      try {
        if (typeof window.startEmulatorSession !== 'function') throw new Error('Player do emulador indisponível.');
        window.startEmulatorSession();
        armLaunchWatchdog(game);
      } catch (error) {
        console.warn('[Lux N64] Não foi possível iniciar o player automaticamente:', error);
        showRecovery(game);
      }
    }, 30);
  }

  function patchStartGameFromDetails() {
    const original = window.startGameFromDetails;
    if (typeof original !== 'function' || original.__luxN64LocalSessionPatched) return false;

    const patched = async function (...args) {
      const game = currentDetailsGame();
      if (!isN64Game(game) || game?.external || game?.localUrl) return original.apply(this, args);

      cleanupCoreMarker();
      try { await window.LuxRomCache?.cleanupExpired?.(); } catch (_) {}

      const romStatus = await getRomStatus(game);
      const needsOverlay = !romStatus || !coreCacheFresh();
      if (needsOverlay) ensureOverlay(game);

      try {
        if (!romStatus) await prepareRom(game);

        const result = await original.apply(this, args);

        if (!needsOverlay) ensureOverlay(game);
        updateOverlay({
          status: 'Abrindo a ROM local...',
          progress: 0.90,
          meta: romStatus ? 'ROM encontrada no dispositivo' : 'ROM salva no dispositivo'
        });
        autoStartPreparedN64(pendingGame() || game);
        return result;
      } catch (error) {
        console.warn('[Lux N64] Falha ao preparar a cópia local; usando a fonte online.', error);
        updateOverlay({
          status: 'Não foi possível preparar a cópia local.',
          progress: 1,
          meta: 'Voltando aos detalhes para tentar novamente.'
        });
        await sleep(500);
        recoverToDetails();
        return undefined;
      }
    };

    patched.__luxN64LocalSessionPatched = VERSION;
    window.startGameFromDetails = patched;
    return true;
  }

  function patchStartEmulatorSession() {
    const original = window.startEmulatorSession;
    if (typeof original !== 'function' || original.__luxN64LocalCachePatched) return false;

    const patched = function (...args) {
      const game = pendingGame();
      const n64 = isN64Game(game);
      if (n64) {
        configureEmulatorCache();
        ensureOverlay(game);
        updateOverlay({
          status: 'Carregando núcleo e iniciando o jogo...',
          progress: 0.96,
          meta: coreCacheFresh() ? 'Usando arquivos temporários em cache' : 'Preparando núcleo pela primeira vez'
        });
      }

      const result = original.apply(this, args);

      if (n64) {
        const onStart = window.EJS_onGameStart;
        if (typeof onStart === 'function' && !onStart.__luxN64LocalReadyWrapped) {
          const wrapped = async (...startArgs) => {
            try {
              return await onStart(...startArgs);
            } finally {
              clearLaunchWatchdog();
              markCoreUsed();
              updateOverlay({ status: 'Tudo pronto!', progress: 1, meta: 'Executando localmente' });
              hideOverlay(160);
            }
          };
          wrapped.__luxN64LocalReadyWrapped = VERSION;
          window.EJS_onGameStart = wrapped;
        }
        armLaunchWatchdog(game);
      }

      return result;
    };

    patched.__luxN64LocalCachePatched = VERSION;
    window.startEmulatorSession = patched;
    return true;
  }

  cleanupCoreMarker();
  try { window.LuxRomCache?.cleanupExpired?.(); } catch (_) {}

  let attempts = 0;
  const install = () => {
    const gameOk = patchStartGameFromDetails();
    const emulatorOk = patchStartEmulatorSession();
    return gameOk && emulatorOk;
  };

  if (!install()) {
    const timer = setInterval(() => {
      attempts += 1;
      if (install() || attempts >= 160) clearInterval(timer);
    }, 50);
  }

  window.addEventListener('beforeunload', clearLaunchWatchdog, { once: true });
})();