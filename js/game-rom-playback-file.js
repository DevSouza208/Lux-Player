(() => {
  'use strict';

  const VERSION = '20260917-rom-playback-file1';
  const INSTALL_ATTEMPTS = 240;

  if (window.__luxRomPlaybackFileVersion === VERSION) return;
  window.__luxRomPlaybackFileVersion = VERSION;

  function install() {
    const cache = window.LuxRomCache;
    if (!cache?.__luxHybridStoragePatched || typeof cache.get !== 'function' || typeof cache.chooseLargeRomFolder !== 'function') return false;
    if (cache.get.__luxPlaybackFilePatched) return true;

    const originalGet = cache.get.bind(cache);

    const patchedGet = async function (game) {
      let local = await originalGet(game);
      if (local?.url) return local;

      // A FileSystemDirectoryHandle can survive a browser restart while its
      // read/write permission returns to "prompt". Re-authorize the folder and
      // retry the same cached file before any caller falls back to the cloud.
      let plan = null;
      try { plan = await cache.storagePlan?.(game); } catch (_) {}
      if (!plan?.large) return local;

      try {
        await cache.chooseLargeRomFolder();
      } catch (error) {
        if (error?.name !== 'AbortError') console.warn('[Lux ROM Playback] Pasta local indisponível:', error);
        return local;
      }

      local = await originalGet(game);
      return local;
    };

    patchedGet.__luxPlaybackFilePatched = VERSION;
    patchedGet.__luxPlaybackFileOriginal = originalGet;
    cache.get = patchedGet;

    console.info('[Lux ROM Playback] Arquivos da pasta autorizada serão reutilizados no EmulatorJS antes do fallback em nuvem.');
    return true;
  }

  let attempts = 0;
  const timer = setInterval(() => {
    attempts += 1;
    if (install() || attempts >= INSTALL_ATTEMPTS) clearInterval(timer);
  }, 50);

  install();
})();
