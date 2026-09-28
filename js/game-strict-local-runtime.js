(() => {
  'use strict';

  const VERSION = '20260918-strict-local-runtime1';
  const INSTALL_ATTEMPTS = 600;
  const CORE_CACHE_MAX_AGE_MINS = 50 * 365 * 24 * 60;
  const CORE_CACHE_MAX_MB = 1024;
  const OVERLAY_ID = 'luxStrictLocalRomOverlay';
  const STYLE_ID = 'luxStrictLocalRomOverlayStyle';

  if (window.__luxStrictLocalRuntimeVersion === VERSION) return;
  window.__luxStrictLocalRuntimeVersion = VERSION;

  let launchBusy = false;
  let storageBusy = false;
  let uiSyncTimer = null;

  function currentGame() {
    try { return typeof currentGameDetails !== 'undefined' ? currentGameDetails : null; }
    catch (_) { return null; }
  }

  function pendingGame() {
    try { return typeof pendingEmulatorGame !== 'undefined' ? pendingEmulatorGame : null; }
    catch (_) { return null; }
  }

  function isRemoteUrl(value) {
    return /^https?:\/\//i.test(String(value || '').trim());
  }

  function isUsableLocalUrl(value) {
    const url = String(value || '').trim();
    return Boolean(url) && !isRemoteUrl(url);
  }

  function isCatalogGame(game) {
    return Boolean(game && !game.external);
  }

  function configureCoreCache() {
    const previous = window.EJS_cacheConfig && typeof window.EJS_cacheConfig === 'object'
      ? window.EJS_cacheConfig
      : {};
    window.EJS_cacheConfig = {
      ...previous,
      enabled: true,
      cacheMaxSizeMB: Math.max(CORE_CACHE_MAX_MB, Number(previous.cacheMaxSizeMB) || 0),
      cacheMaxAgeMins: Math.max(CORE_CACHE_MAX_AGE_MINS, Number(previous.cacheMaxAgeMins) || 0)
    };
    window.EJS_CacheLimit = Math.max(Number(window.EJS_CacheLimit) || 0, CORE_CACHE_MAX_MB * 1024 * 1024);
    try { navigator.storage?.persist?.().catch?.(() => {}); } catch (_) {}
  }

  function ensureStyle() {
    if (document.getElementById(STYLE_ID)) return;
    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = `
      #${OVERLAY_ID}{position:fixed;inset:0;z-index:2147483645;display:flex;align-items:center;justify-content:center;padding:24px;background:rgba(9,6,14,.96);color:#fff;backdrop-filter:blur(10px)}
      #${OVERLAY_ID}.hidden{display:none!important}
      #${OVERLAY_ID}>div{width:min(430px,100%);padding:28px;border:1px solid rgba(126,34,206,.68);border-radius:24px;background:#120c1f;text-align:center;box-shadow:0 25px 80px rgba(0,0,0,.55)}
      #${OVERLAY_ID} .lux-local-icon{width:64px;height:64px;margin:0 auto 17px;display:grid;place-items:center;border-radius:20px;background:rgba(147,51,234,.18);border:1px solid rgba(168,85,247,.3);font-size:29px}
      #${OVERLAY_ID} .lux-local-title{font-size:19px;font-weight:900}
      #${OVERLAY_ID} .lux-local-game{margin-top:5px;font-size:12px;color:#c4b5fd}
      #${OVERLAY_ID} .lux-local-status{margin-top:20px;font-size:13px;font-weight:800;color:#e9d5ff}
      #${OVERLAY_ID} .lux-local-track{height:8px;margin-top:12px;overflow:hidden;border-radius:999px;background:#2e1065}
      #${OVERLAY_ID} .lux-local-bar{height:100%;width:3%;border-radius:inherit;background:linear-gradient(90deg,#7c3aed,#c084fc);transition:width .16s ease}
      #${OVERLAY_ID} .lux-local-meta{margin-top:8px;font-size:11px;color:#a78bfa}
      #${OVERLAY_ID} .lux-local-note{margin-top:16px;font-size:10px;line-height:1.55;color:#8b7ba8}
    `;
    document.head.appendChild(style);
  }

  function ensureOverlay(game) {
    ensureStyle();
    let overlay = document.getElementById(OVERLAY_ID);
    if (!overlay) {
      overlay = document.createElement('div');
      overlay.id = OVERLAY_ID;
      overlay.className = 'hidden';
      overlay.innerHTML = `
        <div>
          <div class="lux-local-icon">🎮</div>
          <div class="lux-local-title">Preparando jogo</div>
          <div class="lux-local-game"></div>
          <div class="lux-local-status">Verificando ROM local...</div>
          <div class="lux-local-track"><div class="lux-local-bar"></div></div>
          <div class="lux-local-meta">0%</div>
          <div class="lux-local-note">O Lux baixa a ROM inteira antes de abrir o emulador. Durante o jogo, a ROM é lida do próprio dispositivo — nunca por streaming da nuvem.</div>
        </div>`;
      document.body.appendChild(overlay);
    }
    const name = overlay.querySelector('.lux-local-game');
    if (name) name.textContent = game?.name || game?.title || 'Jogo';
    overlay.classList.remove('hidden');
    return overlay;
  }

  function updateOverlay(status, progress = null, meta = '') {
    const overlay = document.getElementById(OVERLAY_ID);
    if (!overlay) return;
    const statusEl = overlay.querySelector('.lux-local-status');
    const bar = overlay.querySelector('.lux-local-bar');
    const metaEl = overlay.querySelector('.lux-local-meta');
    if (status && statusEl) statusEl.textContent = status;
    if (Number.isFinite(progress)) {
      const ratio = Math.max(0, Math.min(1, Number(progress)));
      if (bar) bar.style.width = `${Math.max(3, Math.round(ratio * 100))}%`;
      if (metaEl) metaEl.textContent = meta || `${Math.round(ratio * 100)}%`;
    } else if (meta && metaEl) {
      metaEl.textContent = meta;
    }
  }

  function hideOverlay(delay = 160) {
    setTimeout(() => document.getElementById(OVERLAY_ID)?.classList.add('hidden'), delay);
  }

  function cacheReady() {
    const cache = window.LuxRomCache;
    return Boolean(
      cache?.__luxHybridStoragePatched &&
      typeof cache.get === 'function' &&
      typeof cache.download === 'function'
    );
  }

  async function ensureLocalRom(game, options = {}) {
    if (!isCatalogGame(game)) {
      if (isUsableLocalUrl(game?.localUrl || game?.url)) return { url: game.localUrl || game.url, storage: 'external' };
      throw new Error('A ROM local deste jogo não está disponível.');
    }

    const cache = window.LuxRomCache;
    if (!cacheReady()) throw new Error('O armazenamento local de ROMs ainda não está pronto.');

    let local = null;
    try { local = await cache.get(game); } catch (error) {
      console.warn('[Lux Local Runtime] Não foi possível ler a ROM local:', error);
    }

    if (local?.url && isUsableLocalUrl(local.url)) {
      updateOverlay('ROM encontrada no dispositivo.', 1, local.retention === 'permanent' ? 'Local permanente' : 'Cache local');
      return local;
    }

    updateOverlay('Baixando ROM para o dispositivo...', 0.02, 'Preparando download');
    await cache.download(game, ratio => {
      const progress = Number.isFinite(Number(ratio)) ? Number(ratio) : 0;
      updateOverlay('Baixando ROM para o dispositivo...', 0.02 + Math.max(0, Math.min(1, progress)) * 0.94, `${Math.round(progress * 100)}% da ROM`);
    });

    local = await cache.get(game);
    if (!local?.url || !isUsableLocalUrl(local.url)) {
      throw new Error('A ROM terminou de baixar, mas o Lux não conseguiu abrir uma cópia local.');
    }

    updateOverlay('ROM pronta no dispositivo.', 1, local.retention === 'permanent' ? 'Local permanente' : 'Cache local por até 7 dias sem uso');
    return local;
  }

  function scheduleStorageUiSync(delay = 60) {
    clearTimeout(uiSyncTimer);
    uiSyncTimer = setTimeout(() => syncStorageUi().catch(() => {}), delay);
  }

  async function syncStorageUi() {
    const game = currentGame();
    const cloud = document.getElementById('gameStorageCloud');
    const local = document.getElementById('gameStorageLocal');
    const clear = document.getElementById('gameClearTempButton');
    if (!game || !cloud || !local || !window.LuxRomCache) return;

    if (game.external) {
      cloud.classList.remove('active');
      local.classList.add('active');
      cloud.disabled = true;
      local.disabled = true;
      if (clear) clear.disabled = true;
      return;
    }

    const [retention, status] = await Promise.all([
      window.LuxRomCache.getRetention?.(game).catch?.(() => 'temporary') || Promise.resolve('temporary'),
      window.LuxRomCache.status?.(game).catch?.(() => null) || Promise.resolve(null)
    ]);
    if (currentGame() !== game) return;

    const permanent = retention === 'permanent';
    cloud.classList.toggle('active', !permanent);
    local.classList.toggle('active', permanent);
    cloud.disabled = storageBusy;
    local.disabled = storageBusy;
    cloud.title = 'Nuvem: a ROM roda localmente e pode ser removida após 7 dias sem uso.';
    local.title = 'Local: a ROM roda localmente e permanece no dispositivo até você limpar.';
    if (clear) clear.disabled = storageBusy || !status;
  }

  function installStorageMode() {
    if (!cacheReady()) return false;
    const current = window.setCurrentGameStorageMode;
    if (current?.__luxStrictLocalRuntime === VERSION) return true;

    const strictStorageMode = async function (mode) {
      const game = currentGame();
      if (!game || game.external || !window.LuxRomCache) return;
      if (mode !== 'local' && mode !== 'cloud') return;
      if (storageBusy) return;

      storageBusy = true;
      scheduleStorageUiSync(0);
      try {
        if (mode === 'local') {
          ensureOverlay(game);
          updateOverlay('Salvando ROM permanentemente...', 0.02, 'Modo Local');
          await window.LuxRomCache.setRetention?.(game, 'permanent');
          await window.LuxRomCache.download(game, ratio => {
            const progress = Number.isFinite(Number(ratio)) ? Number(ratio) : 0;
            updateOverlay('Salvando ROM permanentemente...', 0.02 + Math.max(0, Math.min(1, progress)) * 0.94, `${Math.round(progress * 100)}%`);
          });
          const localCopy = await window.LuxRomCache.get(game);
          if (!localCopy?.url || !isUsableLocalUrl(localCopy.url)) throw new Error('Não foi possível confirmar a ROM local permanente.');
          try { URL.revokeObjectURL(localCopy.url); } catch (_) {}
          updateOverlay('ROM mantida no dispositivo.', 1, 'Modo Local');
          hideOverlay(220);
        } else {
          await window.LuxRomCache.setRetention?.(game, 'temporary');
          // Nuvem é apenas política de retenção. A ROM que já está no aparelho
          // continua ali e sempre será usada localmente para jogar.
        }
      } catch (error) {
        console.warn('[Lux Local Runtime] Falha ao alterar retenção da ROM:', error);
        updateOverlay('Não foi possível concluir.', 1, error?.message || 'Falha no armazenamento local');
        hideOverlay(900);
        window.alert?.(error?.message || 'Não foi possível alterar o armazenamento deste jogo.');
      } finally {
        storageBusy = false;
        scheduleStorageUiSync(0);
      }
    };

    strictStorageMode.__luxStrictLocalRuntime = VERSION;
    strictStorageMode.__luxStrictPrevious = current;
    window.setCurrentGameStorageMode = strictStorageMode;
    return true;
  }

  function installGameStart() {
    const current = window.startGameFromDetails;
    if (typeof current !== 'function') return false;
    if (current.__luxStrictLocalRuntime === VERSION) return true;

    const original = current;
    const strictStart = async function (...args) {
      const game = currentGame();
      if (!game || game.external) {
        configureCoreCache();
        return original.apply(this, args);
      }
      if (launchBusy) return;

      launchBusy = true;
      const hadLocalUrl = Object.prototype.hasOwnProperty.call(game, 'localUrl');
      const previousLocalUrl = game.localUrl;
      ensureOverlay(game);
      updateOverlay('Verificando ROM local...', 0, 'Aguarde');

      try {
        const local = await ensureLocalRom(game);
        game.localUrl = local.url;
        configureCoreCache();
        window.LuxDevkit?.success?.('GAMES', 'rom-local', 'ROM local confirmada antes do emulador', 0, {
          gameId: game.id,
          storage: local.storage || 'local',
          retention: local.retention || await window.LuxRomCache?.getRetention?.(game).catch?.(() => 'temporary')
        });
        updateOverlay('Abrindo emulador local...', 1, 'ROM pronta');
        const result = await original.apply(this, args);
        hideOverlay(160);
        return result;
      } catch (error) {
        console.error('[Lux Local Runtime] Jogo bloqueado porque a ROM local não ficou pronta:', error);
        window.LuxDevkit?.error?.('GAMES', 'rom-local', error?.message || 'ROM local indisponível');
        updateOverlay('Não foi possível preparar o jogo.', 1, error?.message || 'ROM local indisponível');
        hideOverlay(1200);
        window.alert?.(`${error?.message || 'Não foi possível preparar a ROM local.'}\n\nO Lux não vai abrir este jogo pela internet. Tente novamente quando o download puder ser concluído.`);
        return undefined;
      } finally {
        if (hadLocalUrl) game.localUrl = previousLocalUrl;
        else delete game.localUrl;
        launchBusy = false;
        scheduleStorageUiSync(120);
      }
    };

    strictStart.__luxStrictLocalRuntime = VERSION;
    strictStart.__luxStrictLocalOriginal = original;
    window.startGameFromDetails = strictStart;
    return true;
  }

  function installEmulatorGate() {
    const current = window.startEmulatorSession;
    if (typeof current !== 'function') return false;
    if (current.__luxStrictLocalRuntime === VERSION) return true;

    const original = current;
    const strictEmulatorStart = function (...args) {
      const game = pendingGame();
      configureCoreCache();
      if (isCatalogGame(game) && !isUsableLocalUrl(game?.localUrl)) {
        const message = 'A ROM local não está pronta. O emulador foi bloqueado para impedir reprodução direta pela internet.';
        console.error('[Lux Local Runtime]', message, game);
        window.LuxDevkit?.error?.('GAMES', 'emulator-local-gate', message);
        window.alert?.(message);
        return undefined;
      }
      return original.apply(this, args);
    };

    strictEmulatorStart.__luxStrictLocalRuntime = VERSION;
    strictEmulatorStart.__luxStrictLocalOriginal = original;
    window.startEmulatorSession = strictEmulatorStart;
    return true;
  }

  function installAll() {
    if (!cacheReady()) return false;
    configureCoreCache();
    const startOk = installGameStart();
    const emulatorOk = installEmulatorGate();
    const storageOk = installStorageMode();
    scheduleStorageUiSync(80);
    return startOk && emulatorOk && storageOk;
  }

  configureCoreCache();
  installAll();

  let attempts = 0;
  const installTimer = setInterval(() => {
    attempts += 1;
    const done = installAll();
    if (done && attempts > 80) clearInterval(installTimer);
    else if (attempts >= INSTALL_ATTEMPTS) clearInterval(installTimer);
  }, 50);

  const observer = new MutationObserver(() => {
    if (document.getElementById('gameDetailsStoragePanel')) {
      scheduleStorageUiSync(180);
      setTimeout(() => scheduleStorageUiSync(0), 450);
    }
  });
  const startObserver = () => observer.observe(document.body, { childList: true, subtree: true });
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', startObserver, { once: true });
  else startObserver();

  window.addEventListener('beforeunload', () => {
    clearInterval(installTimer);
    observer.disconnect();
  }, { once: true });

  window.LuxStrictLocalRuntime = {
    version: VERSION,
    ensureLocalRom,
    configureCoreCache,
    syncStorageUi
  };

  console.info('[Lux Local Runtime] Ativo: ROM sempre local; Nuvem = retenção temporária; Local = permanente; sem fallback remoto.');
})();
