(() => {
  'use strict';

  const VERSION = '20260918-rom-cleanup2-retention';
  const DB_NAME = 'lux-game-hybrid-rom-cache';
  const DB_VERSION = 1;
  const ROM_STORE = 'roms';
  const SETTINGS_STORE = 'settings';
  const DIRECTORY_KEY = 'rom-directory';
  const MAX_IDLE_MS = 7 * 24 * 60 * 60 * 1000;
  const RETENTION_PREFIX = 'lux-play:rom-retention:v1:';
  const LEGACY_MODE_PREFIX = 'lux-play:rom-mode:v3:';
  const INSTALL_ATTEMPTS = 240;

  if (window.__luxRomCleanupVersion === VERSION) return;
  window.__luxRomCleanupVersion = VERSION;

  function openDatabase() {
    return new Promise((resolve, reject) => {
      if (!window.indexedDB) return reject(new Error('IndexedDB indisponível.'));
      const request = indexedDB.open(DB_NAME, DB_VERSION);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error || new Error('Não foi possível abrir o índice de ROMs.'));
    });
  }

  async function requestResult(storeName, mode, action) {
    const db = await openDatabase();
    try {
      return await new Promise((resolve, reject) => {
        const tx = db.transaction(storeName, mode);
        const store = tx.objectStore(storeName);
        const request = action(store);
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error || new Error('Falha no índice local de ROMs.'));
        tx.onabort = () => reject(tx.error || new Error('Operação de limpeza cancelada.'));
      });
    } finally {
      db.close();
    }
  }

  const readRecords = () => requestResult(ROM_STORE, 'readonly', store => store.getAll()).then(value => value || []);
  const readDirectorySetting = () => requestResult(SETTINGS_STORE, 'readonly', store => store.get(DIRECTORY_KEY)).then(value => value || null);
  const deleteRecord = key => requestResult(ROM_STORE, 'readwrite', store => store.delete(key));
  const putRecord = record => requestResult(ROM_STORE, 'readwrite', store => store.put(record));

  function recordRetention(record) {
    if (!record?.key) return record?.retention === 'permanent' ? 'permanent' : 'temporary';
    try {
      const encoded = encodeURIComponent(record.key);
      const current = localStorage.getItem(RETENTION_PREFIX + encoded);
      if (current === 'permanent' || current === 'temporary') return current;
      const legacy = localStorage.getItem(LEGACY_MODE_PREFIX + encoded);
      if (legacy === 'permanent' || legacy === 'temporary') return legacy;
    } catch (_) {}
    return record.retention === 'permanent' ? 'permanent' : 'temporary';
  }

  async function hasWritePermission(handle) {
    if (!handle) return false;
    try {
      if (typeof handle.queryPermission !== 'function') return true;
      return (await handle.queryPermission({ mode: 'readwrite' })) === 'granted';
    } catch (_) {
      return false;
    }
  }

  async function removeDirectoryRom(root, record) {
    try {
      const lux = await root.getDirectoryHandle('Lux Play', { create: false });
      const roms = await lux.getDirectoryHandle('ROMs', { create: false });
      const consoleFolder = await roms.getDirectoryHandle(record.systemFolder || 'outros', { create: false });
      await consoleFolder.removeEntry(record.fileName);
      return true;
    } catch (error) {
      return error?.name === 'NotFoundError';
    }
  }

  async function cleanupExpiredLocalRomFiles() {
    const now = Date.now();
    const records = await readRecords().catch(() => []);
    if (!records.length) return { removed: 0, pending: 0 };

    const expired = records.filter(record => {
      if (recordRetention(record) === 'permanent') return false;
      const lastUse = Number(record?.lastUsedAt || record?.savedAt || 0);
      return !lastUse || now - lastUse >= MAX_IDLE_MS;
    });
    if (!expired.length) return { removed: 0, pending: 0 };

    let root = null;
    let canTouchFolder = false;
    if (expired.some(record => record.storage === 'directory')) {
      const setting = await readDirectorySetting().catch(() => null);
      root = setting?.handle || null;
      canTouchFolder = await hasWritePermission(root);
    }

    let removed = 0;
    let pending = 0;
    for (const record of expired) {
      if (!record?.key) continue;

      if (record.storage !== 'directory') {
        await deleteRecord(record.key).catch(() => {});
        removed += 1;
        continue;
      }

      if (!canTouchFolder) {
        pending += 1;
        if (!record.cleanupPendingAt) {
          await putRecord({ ...record, cleanupPendingAt: now }).catch(() => {});
        }
        continue;
      }

      const deleted = await removeDirectoryRom(root, record);
      if (deleted) {
        await deleteRecord(record.key).catch(() => {});
        removed += 1;
      } else {
        pending += 1;
        await putRecord({ ...record, cleanupPendingAt: record.cleanupPendingAt || now }).catch(() => {});
      }
    }

    return { removed, pending };
  }

  function install() {
    const cache = window.LuxRomCache;
    if (!cache?.__luxHybridStoragePatched || typeof cache.cleanupExpired !== 'function') return false;
    if (cache.cleanupExpired.__luxSevenDayCleanupPatched) return true;

    const originalCleanup = cache.cleanupExpired.bind(cache);
    const originalChooseFolder = typeof cache.chooseLargeRomFolder === 'function'
      ? cache.chooseLargeRomFolder.bind(cache)
      : null;

    const patchedCleanup = async function () {
      let previousRemoved = 0;
      try { previousRemoved = Number(await originalCleanup()) || 0; } catch (_) {}
      const result = await cleanupExpiredLocalRomFiles().catch(() => ({ removed: 0, pending: 0 }));
      return previousRemoved + result.removed;
    };
    patchedCleanup.__luxSevenDayCleanupPatched = VERSION;
    patchedCleanup.__luxSevenDayCleanupOriginal = originalCleanup;
    cache.cleanupExpired = patchedCleanup;

    if (originalChooseFolder && !cache.chooseLargeRomFolder.__luxCleanupAfterPermission) {
      const patchedChooseFolder = async function (...args) {
        const handle = await originalChooseFolder(...args);
        await cleanupExpiredLocalRomFiles().catch(() => {});
        return handle;
      };
      patchedChooseFolder.__luxCleanupAfterPermission = VERSION;
      patchedChooseFolder.__luxCleanupAfterPermissionOriginal = originalChooseFolder;
      cache.chooseLargeRomFolder = patchedChooseFolder;
    }

    cache.cleanupRomFiles = cleanupExpiredLocalRomFiles;
    cache.maxRomIdleMs = MAX_IDLE_MS;

    // Never touches lux-user-game-saves or any save-sync data. This module only
    // deletes temporary ROM metadata and files under Lux Play/ROMs.
    patchedCleanup().catch(() => {});
    window.addEventListener('focus', () => patchedCleanup().catch(() => {}));
    document.addEventListener('visibilitychange', () => {
      if (!document.hidden) patchedCleanup().catch(() => {});
    });

    console.info('[Lux ROM Cleanup] Nuvem expira após 7 dias sem uso; Local permanente é preservado; saves ficam separados.');
    return true;
  }

  let attempts = 0;
  const timer = setInterval(() => {
    attempts += 1;
    if (install() || attempts >= INSTALL_ATTEMPTS) clearInterval(timer);
  }, 50);

  install();
})();
