(() => {
  'use strict';

  const VERSION = '20260917-rom-storage-mode2';
  const FALLBACK_THRESHOLD = 100 * 1024 * 1024;
  const PLAN_CACHE_MS = 5 * 60 * 1000;
  const INSTALL_ATTEMPTS = 240;

  if (window.__luxRomStorageModeVersion === VERSION) return;
  window.__luxRomStorageModeVersion = VERSION;

  const planCache = new Map();
  let storageModeBusy = false;

  function currentGame() {
    try { return typeof currentGameDetails !== 'undefined' ? currentGameDetails : null; }
    catch (_) { return null; }
  }

  function normalizedConsole(game) {
    return String(game?.console || game?.consoleLabel || '').toLowerCase().replace(/[^a-z0-9]/g, '');
  }

  function isN64(game) {
    const value = normalizedConsole(game);
    return value === 'n64' || value === 'nintendo64';
  }

  function resolvedSource(game) {
    try { return window.LuxRomCache?.resolveSource?.(game) || null; }
    catch (_) { return null; }
  }

  function knownGameSize(game) {
    const candidates = [
      game?.romSize,
      game?.rom_size,
      game?.fileSize,
      game?.file_size,
      game?.size,
      game?.contentLength,
      game?.content_length
    ];
    for (const value of candidates) {
      const number = Number(value);
      if (Number.isFinite(number) && number > 0) return number;
    }
    return 0;
  }

  async function storagePlan(game, refresh = false) {
    const cache = window.LuxRomCache;
    const source = resolvedSource(game);
    const threshold = Number(cache?.largeRomThreshold) || FALLBACK_THRESHOLD;
    let size = knownGameSize(game);

    if (!size && source?.url) {
      const cacheKey = String(source.url);
      const cached = planCache.get(cacheKey);
      if (!refresh && cached && Date.now() - cached.at < PLAN_CACHE_MS) {
        size = cached.size;
      } else {
        try {
          const response = await fetch(source.url, {
            method: 'HEAD',
            credentials: 'omit',
            cache: 'no-store'
          });
          if (response.ok) size = Number(response.headers.get('content-length')) || 0;
        } catch (_) {
          size = 0;
        }
        planCache.set(cacheKey, { size, at: Date.now() });
      }
    }

    return {
      size,
      threshold,
      known: size > 0,
      large: size >= threshold,
      storage: size >= threshold ? 'directory' : 'indexeddb',
      directoryPickerSupported: typeof window.showDirectoryPicker === 'function',
      source: source?.source || 'none',
      url: source?.url || ''
    };
  }

  function setStorageButtonsBusy(busy) {
    const cloud = document.getElementById('gameStorageCloud');
    const local = document.getElementById('gameStorageLocal');
    const clear = document.getElementById('gameClearTempButton');
    if (cloud) cloud.disabled = Boolean(busy);
    if (local) local.disabled = Boolean(busy);
    if (clear && busy) clear.disabled = true;
  }

  async function refreshStorageToggle(game = currentGame()) {
    const cloud = document.getElementById('gameStorageCloud');
    const local = document.getElementById('gameStorageLocal');
    const clear = document.getElementById('gameClearTempButton');
    if (!game || !cloud || !local || !window.LuxRomCache?.status) return;

    const status = await window.LuxRomCache.status(game).catch(() => null);
    if (currentGame() !== game) return;

    cloud.classList.toggle('active', !status);
    local.classList.toggle('active', Boolean(status));
    cloud.disabled = false;
    local.disabled = false;
    if (clear) clear.disabled = !status;
  }

  async function launchBase(game, args) {
    const loadSlot = args?.[0] ?? null;
    const loadSource = args?.[1] ?? 'native';
    let localUrl = game?.localUrl || null;

    if (!localUrl && !game?.external && window.LuxRomCache?.get) {
      try { localUrl = (await window.LuxRomCache.get(game))?.url || null; }
      catch (error) { console.warn('[Lux ROM Mode] ROM local indisponível:', error); }
    }

    const source = resolvedSource(game);
    const playableGame = {
      ...game,
      url: source?.url || game?.url,
      loadSlot,
      loadSource,
      localUrl
    };

    try {
      if (typeof closeGameDetails === 'function') closeGameDetails();
      else document.getElementById('gameDetailsModal')?.classList.add('hidden');
    } catch (_) {}

    if (typeof window.openGameEmulator === 'function') return window.openGameEmulator(playableGame);
    if (typeof openGameEmulator === 'function') return openGameEmulator(playableGame);
    throw new Error('Emulador indisponível.');
  }

  function install() {
    const cache = window.LuxRomCache;
    const start = window.startGameFromDetails;
    const setMode = window.setCurrentGameStorageMode;

    if (!cache?.__luxHybridStoragePatched || typeof start !== 'function' || typeof setMode !== 'function') return false;
    if (start.__luxStorageModePatched) return true;

    cache.storagePlan = storagePlan;
    window.getCurrentGameRomStoragePlan = (refresh = false) => {
      const game = currentGame();
      return game ? storagePlan(game, refresh) : Promise.resolve(null);
    };

    const originalSetMode = setMode;
    const patchedSetMode = async function (mode) {
      const game = currentGame();
      if (!game || game.external) return originalSetMode.apply(this, arguments);
      if (storageModeBusy) return undefined;

      storageModeBusy = true;
      setStorageButtonsBusy(true);

      try {
        if (mode === 'local') {
          // Explicit Local clicks re-check the real ROM size. Large ROMs ask for
          // the destination first, before the download overlay starts.
          const plan = await storagePlan(game, true).catch(() => ({ large: false, directoryPickerSupported: true }));
          if (plan.large) {
            if (!plan.directoryPickerSupported) {
              window.alert?.('Este jogo é grande demais para o cache normal. Abra o Lux Play no Chrome ou Edge para escolher uma pasta e salvá-lo localmente.');
              return undefined;
            }
            if (typeof cache.chooseLargeRomFolder === 'function') {
              await cache.chooseLargeRomFolder();
            }
          }
        }

        return await originalSetMode.apply(this, arguments);
      } catch (error) {
        if (error?.name !== 'AbortError') {
          console.warn('[Lux ROM Mode] Não foi possível alterar o modo de armazenamento:', error);
        }
        return undefined;
      } finally {
        storageModeBusy = false;
        await refreshStorageToggle(game).catch(() => {});
      }
    };
    patchedSetMode.__luxStorageModePatched = VERSION;
    patchedSetMode.__luxStorageModeOriginal = originalSetMode;
    window.setCurrentGameStorageMode = patchedSetMode;

    const originalStart = start;
    const patchedStart = async function (...args) {
      const game = currentGame();
      if (!game) return originalStart.apply(this, args);

      // Nintendo 64 keeps its specialized startup/core flow. The hybrid cache
      // beneath it still decides Blob vs. user folder based on actual ROM size.
      if (isN64(game) || game.external || game.localUrl) {
        return originalStart.apply(this, args);
      }

      const existing = await cache.status(game).catch(() => null);
      if (existing) return launchBase(game, args);

      const plan = await storagePlan(game).catch(() => ({ large: false, known: false }));

      // Small/unknown games stay cloud-first. Selecting Local explicitly downloads
      // them as Blob, matching the old main behavior that was already reliable.
      if (!plan.large) return launchBase(game, args);

      // A large game must really become local before launch. If the player cancels
      // the folder picker, do not silently fall back to a giant remote/local blob.
      await window.setCurrentGameStorageMode('local');
      const prepared = await cache.status(game).catch(() => null);
      if (!prepared) return undefined;
      return launchBase(game, args);
    };
    patchedStart.__luxStorageModePatched = VERSION;
    patchedStart.__luxStorageModeOriginal = originalStart;
    window.startGameFromDetails = patchedStart;

    console.info('[Lux ROM Mode] Nuvem/Local ativo: nuvem por padrão, Blob para ROM pequena e pasta para ROM >= 100 MB.');
    return true;
  }

  let attempts = 0;
  const timer = setInterval(() => {
    attempts += 1;
    if (install() || attempts >= INSTALL_ATTEMPTS) clearInterval(timer);
  }, 50);

  install();
})();
