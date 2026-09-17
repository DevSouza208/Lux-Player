(() => {
  'use strict';

  const VERSION = '20260917-rom-playback-file2';
  const INSTALL_ATTEMPTS = 240;
  const FALLBACK_MAX_IDLE_MS = 7 * 24 * 60 * 60 * 1000;

  if (window.__luxRomPlaybackFileVersion === VERSION) return;
  window.__luxRomPlaybackFileVersion = VERSION;

  function recordKey(game, cache) {
    let source = null;
    try { source = cache.resolveSource?.(game) || null; } catch (_) {}
    return String(game?.id || source?.path || source?.url || game?.name || '').slice(0, 700);
  }

  async function rememberedDirectoryRecord(game, cache) {
    const key = recordKey(game, cache);
    if (!key || typeof cache.diagnostics !== 'function') return null;

    try {
      const diagnostics = await cache.diagnostics();
      const records = Array.isArray(diagnostics?.hybridCached) ? diagnostics.hybridCached : [];
      const record = records.find(item => String(item?.key || '') === key && item?.storage === 'directory');
      if (!record) return null;

      const lastUse = Number(record.lastUsedAt || record.savedAt || 0);
      const maxIdle = Number(cache.maxIdleMs) || FALLBACK_MAX_IDLE_MS;
      if (!lastUse || Date.now() - lastUse >= maxIdle) return null;

      return record;
    } catch (_) {
      return null;
    }
  }

  function install() {
    const cache = window.LuxRomCache;
    if (!cache?.__luxHybridStoragePatched || typeof cache.get !== 'function' || typeof cache.status !== 'function' || typeof cache.chooseLargeRomFolder !== 'function') return false;
    if (cache.get.__luxPlaybackFilePatched && cache.status.__luxPlaybackFilePatched) return true;

    const originalGet = cache.get.bind(cache);
    const originalStatus = cache.status.bind(cache);

    const patchedStatus = async function (game) {
      const live = await originalStatus(game);
      if (live) return live;

      // Directory permissions can return to "prompt" after a browser restart.
      // Keep the saved local state visible from metadata so the UI does not
      // pretend the ROM is cloud-only or trigger another download.
      const remembered = await rememberedDirectoryRecord(game, cache);
      if (!remembered) return null;

      return {
        size: Number(remembered.size) || 0,
        savedAt: remembered.savedAt,
        lastUsedAt: remembered.lastUsedAt,
        source: remembered.source || 'r2',
        path: remembered.path || remembered.r2Path || '',
        storage: 'directory',
        permissionRequired: true,
        verified: false
      };
    };

    patchedStatus.__luxPlaybackFilePatched = VERSION;
    patchedStatus.__luxPlaybackFileOriginal = originalStatus;
    cache.status = patchedStatus;

    const patchedGet = async function (game) {
      let local = await originalGet(game);
      if (local?.url) return local;

      // Only request folder access when this exact game already has a remembered
      // directory-backed ROM. This avoids treating a missing file as a reason to
      // redownload it before the player has a chance to re-authorize the folder.
      const remembered = await rememberedDirectoryRecord(game, cache);
      if (!remembered) return local;

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

    console.info('[Lux ROM Playback] Estado Local persistente: ROMs em pasta continuam reconhecidas após reiniciar o navegador.');
    return true;
  }

  let attempts = 0;
  const timer = setInterval(() => {
    attempts += 1;
    if (install() || attempts >= INSTALL_ATTEMPTS) clearInterval(timer);
  }, 50);

  install();
})();
