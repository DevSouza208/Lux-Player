(() => {
  'use strict';

  const VERSION = '20260916-r2-rom-cache4-opfs';
  const DB_NAME = 'lux-game-rom-cache';
  const DB_VERSION = 3;
  const STORE_NAME = 'roms';
  const OPFS_DIRECTORY = 'lux-player-roms';
  const MAX_IDLE_MS = 7 * 24 * 60 * 60 * 1000;
  const MIN_FREE_BUFFER = 8 * 1024 * 1024;
  const GATEWAY_BASE = 'https://lux-r2-gateway.professorsouza-tech.workers.dev/r2/roms';

  if (window.__luxRomCacheVersion === VERSION) return;
  window.__luxRomCacheVersion = VERSION;

  const SYSTEM_FOLDER = Object.freeze({
    megadrive: 'md',
    genesis: 'md',
    segamegadrive: 'md',
    mastersystem: 'ms',
    sms: 'ms',
    segamastersystem: 'ms',
    gameboyadvance: 'gba',
    gameboycolor: 'gbc',
    gameboy: 'gb',
    nintendo64: 'n64',
    famicom: 'nes',
    supernintendo: 'snes',
    supernes: 'snes'
  });

  function normalizeSystem(value = '') {
    const compact = String(value || '').toLowerCase().replace(/[^a-z0-9]/g, '');
    return SYSTEM_FOLDER[compact] || compact;
  }

  function encodeObjectPath(path = '') {
    return String(path || '')
      .split('/')
      .filter(Boolean)
      .map(part => encodeURIComponent(part))
      .join('/');
  }

  function normalizeR2Path(path = '', game = null) {
    let value = String(path || '').trim().replace(/^\/+/, '');
    if (!value) return '';

    try { value = decodeURIComponent(value); } catch (_) {}
    value = value.replace(/^roms\//i, '');

    const parts = value.split('/').filter(Boolean);
    if (!parts.length) return '';

    const mappedFirst = normalizeSystem(parts[0]);
    const gameSystem = normalizeSystem(game?.console || game?.consoleLabel || '');

    if (SYSTEM_FOLDER[String(parts[0]).toLowerCase().replace(/[^a-z0-9]/g, '')] || mappedFirst === gameSystem) {
      parts[0] = mappedFirst || gameSystem || parts[0];
    } else if (gameSystem && parts.length === 1) {
      parts.unshift(gameSystem);
    }

    return parts.join('/');
  }

  function pathFromLegacyUrl(rawUrl = '', game = null) {
    const value = String(rawUrl || '').trim();
    if (!value) return '';

    try {
      const url = new URL(value, window.location.href);
      if (url.origin === new URL(GATEWAY_BASE).origin && url.pathname.includes('/r2/roms/')) {
        return normalizeR2Path(url.pathname.split('/r2/roms/')[1] || '', game);
      }

      const decoded = decodeURIComponent(url.pathname);
      const markers = [
        '/storage/v1/object/public/games/',
        '/storage/v1/object/sign/games/',
        '/storage/v1/object/authenticated/games/',
        '/games/'
      ];
      for (const marker of markers) {
        const index = decoded.indexOf(marker);
        if (index >= 0) return normalizeR2Path(decoded.slice(index + marker.length), game);
      }
    } catch (_) {}

    return '';
  }

  function resolveSource(game) {
    if (!game) return { url: '', path: '', source: 'none' };

    const explicitPath = game.r2Path || game.r2_path || game.romPath || game.rom_path || '';
    let path = normalizeR2Path(explicitPath, game);
    if (!path) path = pathFromLegacyUrl(game.url || game.rom_url || '', game);

    if (path) {
      return {
        path,
        url: `${GATEWAY_BASE}/${encodeObjectPath(path)}`,
        source: 'r2'
      };
    }

    const fallback = String(game.r2Url || game.r2_url || game.url || game.rom_url || '').trim();
    return { url: fallback, path: '', source: fallback ? 'legacy' : 'none' };
  }

  function gameKey(game) {
    const source = resolveSource(game);
    return String(game?.id || source.path || source.url || game?.name || '').slice(0, 700);
  }

  function openDatabase() {
    return new Promise((resolve, reject) => {
      if (!window.indexedDB) {
        reject(new Error('O armazenamento local de jogos não está disponível neste navegador.'));
        return;
      }

      const request = indexedDB.open(DB_NAME, DB_VERSION);
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains(STORE_NAME)) {
          db.createObjectStore(STORE_NAME, { keyPath: 'key' });
        }
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error || new Error('Não foi possível abrir o armazenamento local de ROMs.'));
      request.onblocked = () => reject(new Error('O armazenamento local está ocupado por outra aba. Feche outras abas do Lux Play e tente novamente.'));
    });
  }

  async function transaction(mode, callback) {
    const db = await openDatabase();
    try {
      return await new Promise((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, mode);
        const store = tx.objectStore(STORE_NAME);
        let result;
        let callbackError = null;
        try { result = callback(store); } catch (error) { callbackError = error; }
        if (callbackError) {
          try { tx.abort(); } catch (_) {}
          reject(callbackError);
          return;
        }
        tx.oncomplete = () => resolve(result);
        tx.onerror = () => reject(tx.error || new Error('Falha no armazenamento local da ROM.'));
        tx.onabort = () => reject(tx.error || new Error('Operação local da ROM cancelada.'));
      });
    } finally {
      db.close();
    }
  }

  async function readRecord(key) {
    return transaction('readonly', store => new Promise((resolve, reject) => {
      const request = store.get(key);
      request.onsuccess = () => resolve(request.result || null);
      request.onerror = () => reject(request.error || new Error('Não foi possível ler a ROM salva.'));
    }));
  }

  async function readAllRecords() {
    return transaction('readonly', store => new Promise((resolve, reject) => {
      const request = store.getAll();
      request.onsuccess = () => resolve(request.result || []);
      request.onerror = () => reject(request.error || new Error('Não foi possível listar as ROMs salvas.'));
    }));
  }

  async function putRecord(record) {
    await transaction('readwrite', store => new Promise((resolve, reject) => {
      const request = store.put(record);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error || new Error('Não foi possível registrar a ROM no dispositivo.'));
    }));
  }

  async function deleteMetadata(key) {
    await transaction('readwrite', store => new Promise((resolve, reject) => {
      const request = store.delete(key);
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error || new Error('Não foi possível remover a ROM do índice local.'));
    }));
  }

  function supportsOpfs() {
    return Boolean(navigator.storage?.getDirectory && typeof FileSystemFileHandle !== 'undefined' && FileSystemFileHandle.prototype?.createWritable);
  }

  async function opfsDirectory(create = true) {
    if (!supportsOpfs()) return null;
    const root = await navigator.storage.getDirectory();
    return root.getDirectoryHandle(OPFS_DIRECTORY, { create });
  }

  async function chooseStorageEngine() {
    if (!supportsOpfs()) return 'indexeddb';
    try {
      const directory = await opfsDirectory(true);
      return directory ? 'opfs' : 'indexeddb';
    } catch (error) {
      console.warn('[Lux ROM Cache] OPFS indisponível; usando IndexedDB:', error);
      return 'indexeddb';
    }
  }

  async function stableHash(value) {
    const text = String(value || '');
    if (window.crypto?.subtle && window.TextEncoder) {
      try {
        const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
        return Array.from(new Uint8Array(digest)).slice(0, 16).map(byte => byte.toString(16).padStart(2, '0')).join('');
      } catch (_) {}
    }
    let hash = 2166136261;
    for (let index = 0; index < text.length; index += 1) {
      hash ^= text.charCodeAt(index);
      hash = Math.imul(hash, 16777619);
    }
    return (hash >>> 0).toString(16).padStart(8, '0');
  }

  function sourceExtension(game) {
    const source = resolveSource(game);
    const raw = source.path || source.url || game?.name || '';
    let pathname = raw;
    try { pathname = new URL(raw, window.location.href).pathname; } catch (_) {}
    const match = String(pathname).match(/\.([a-z0-9]{1,8})$/i);
    return match ? `.${match[1].toLowerCase()}` : '.rom';
  }

  async function opfsFileName(game) {
    return `rom-${await stableHash(gameKey(game))}${sourceExtension(game)}`;
  }

  async function readOpfsFile(record) {
    if (!record?.fileName) return null;
    try {
      const directory = await opfsDirectory(false);
      if (!directory) return null;
      const handle = await directory.getFileHandle(record.fileName, { create: false });
      const file = await handle.getFile();
      return file?.size ? file : null;
    } catch (_) {
      return null;
    }
  }

  async function removeOpfsFile(record) {
    if (!record?.fileName || !supportsOpfs()) return;
    try {
      const directory = await opfsDirectory(false);
      await directory?.removeEntry(record.fileName);
    } catch (_) {}
  }

  async function removeRecord(record) {
    if (!record?.key) return;
    if (record.storage === 'opfs') await removeOpfsFile(record);
    await deleteMetadata(record.key).catch(() => {});
  }

  async function requestPersistentStorage() {
    if (!navigator.storage) return false;
    try {
      if (await navigator.storage.persisted?.()) return true;
      return Boolean(await navigator.storage.persist?.());
    } catch (_) {
      return false;
    }
  }

  async function storageEstimate() {
    try {
      const estimate = await navigator.storage?.estimate?.();
      const quota = Number(estimate?.quota) || 0;
      const usage = Number(estimate?.usage) || 0;
      return { quota, usage, available: quota > usage ? quota - usage : 0 };
    } catch (_) {
      return { quota: 0, usage: 0, available: 0 };
    }
  }

  async function assertStorageCapacity(requiredBytes) {
    if (!requiredBytes) return;
    const estimate = await storageEstimate();
    if (!estimate.quota) return;
    const required = Number(requiredBytes) + MIN_FREE_BUFFER;
    if (estimate.available < required) {
      const neededMb = Math.ceil(requiredBytes / 1024 / 1024);
      const freeMb = Math.floor(estimate.available / 1024 / 1024);
      throw new Error(`Sem espaço local suficiente para esta ROM. Necessário: ~${neededMb} MB; disponível para o site: ~${freeMb} MB.`);
    }
  }

  async function cleanupExpired() {
    const now = Date.now();
    const records = await readAllRecords().catch(() => []);
    let removed = 0;
    for (const record of records) {
      const lastUse = Number(record?.lastUsedAt || record?.savedAt || 0);
      if (!lastUse || now - lastUse >= MAX_IDLE_MS) {
        await removeRecord(record);
        removed += 1;
      }
    }
    return removed;
  }

  async function validRecord(game, touch = false) {
    const key = gameKey(game);
    if (!key) return null;

    const source = resolveSource(game);
    const record = await readRecord(key);
    if (!record) return null;

    const savedSource = String(record.sourceUrl || record.url || '');
    if (source.url && savedSource && source.url !== savedSource) {
      await removeRecord(record);
      return null;
    }

    if (Date.now() - Number(record.lastUsedAt || record.savedAt || 0) >= MAX_IDLE_MS) {
      await removeRecord(record);
      return null;
    }

    if (record.storage === 'opfs') {
      const file = await readOpfsFile(record);
      if (!file) {
        await deleteMetadata(record.key).catch(() => {});
        return null;
      }
      record.size = file.size;
    } else if (!(record.blob instanceof Blob) || !record.blob.size) {
      await deleteMetadata(record.key).catch(() => {});
      return null;
    }

    if (touch) {
      record.lastUsedAt = Date.now();
      await putRecord(record);
    }

    return record;
  }

  async function recordBlob(record) {
    if (!record) return null;
    if (record.storage === 'opfs') return readOpfsFile(record);
    return record.blob instanceof Blob ? record.blob : null;
  }

  async function get(game) {
    await cleanupExpired().catch(() => {});
    const record = await validRecord(game, true);
    if (!record) return null;
    const blob = await recordBlob(record);
    if (!blob?.size) {
      await removeRecord(record);
      return null;
    }

    return {
      url: URL.createObjectURL(blob),
      size: Number(record.size) || blob.size,
      savedAt: record.savedAt,
      lastUsedAt: record.lastUsedAt,
      source: record.source || 'r2',
      path: record.r2Path || '',
      storage: record.storage || 'indexeddb'
    };
  }

  async function status(game) {
    await cleanupExpired().catch(() => {});
    const record = await validRecord(game, false);
    if (!record) return null;

    return {
      size: Number(record.size) || record.blob?.size || 0,
      savedAt: record.savedAt,
      lastUsedAt: record.lastUsedAt,
      source: record.source || 'r2',
      path: record.r2Path || '',
      storage: record.storage || 'indexeddb'
    };
  }

  async function downloadToOpfs(response, game, total, onProgress) {
    const directory = await opfsDirectory(true);
    if (!directory) throw new Error('O armazenamento de arquivos do navegador não está disponível.');
    const fileName = await opfsFileName(game);
    const handle = await directory.getFileHandle(fileName, { create: true });
    const writable = await handle.createWritable();
    let received = 0;

    try {
      if (response.body?.getReader) {
        const reader = response.body.getReader();
        while (true) {
          const part = await reader.read();
          if (part.done) break;
          await writable.write(part.value);
          received += part.value.byteLength;
          if (total > 0) onProgress(Math.min(1, received / total));
        }
      } else {
        const blob = await response.blob();
        if (!blob.size) throw new Error('A ROM baixada está vazia.');
        await writable.write(blob);
        received = blob.size;
      }
      await writable.close();
    } catch (error) {
      try { await writable.abort(); } catch (_) {}
      try { await directory.removeEntry(fileName); } catch (_) {}
      throw error;
    }

    const file = await handle.getFile();
    if (!file.size) {
      try { await directory.removeEntry(fileName); } catch (_) {}
      throw new Error('A ROM baixada está vazia.');
    }

    return { fileName, size: file.size || received };
  }

  async function downloadToIndexedDb(response, contentType, total, onProgress) {
    let received = 0;
    let blob;

    if (response.body?.getReader) {
      const reader = response.body.getReader();
      const chunks = [];
      while (true) {
        const part = await reader.read();
        if (part.done) break;
        chunks.push(part.value);
        received += part.value.byteLength;
        if (total > 0) onProgress(Math.min(1, received / total));
      }
      blob = new Blob(chunks, { type: contentType });
    } else {
      blob = await response.blob();
      received = blob.size;
    }

    if (!blob.size) throw new Error('A ROM baixada está vazia.');
    return { blob, size: received || blob.size };
  }

  async function fetchRom(source) {
    const response = await fetch(source.url, {
      method: 'GET',
      credentials: 'omit',
      cache: 'no-store'
    });
    if (!response.ok) throw new Error(`Não foi possível baixar a ROM (HTTP ${response.status}).`);
    return response;
  }

  async function download(game, onProgress = () => {}) {
    const source = resolveSource(game);
    if (!source.url) throw new Error('Este jogo não possui uma ROM disponível.');

    await cleanupExpired().catch(() => {});
    const existing = await validRecord(game, true).catch(() => null);
    if (existing) {
      onProgress(1);
      return {
        size: Number(existing.size) || existing.blob?.size || 0,
        savedAt: existing.savedAt,
        lastUsedAt: existing.lastUsedAt,
        source: existing.source || source.source,
        path: existing.r2Path || source.path,
        storage: existing.storage || 'indexeddb'
      };
    }

    await requestPersistentStorage();

    let engine = await chooseStorageEngine();
    let response = await fetchRom(source);
    let total = Number(response.headers.get('content-length')) || 0;
    let contentType = response.headers.get('content-type') || 'application/octet-stream';
    await assertStorageCapacity(total);

    const now = Date.now();
    let record;

    if (engine === 'opfs') {
      try {
        const saved = await downloadToOpfs(response, game, total, onProgress);
        record = {
          key: gameKey(game),
          sourceUrl: source.url,
          url: source.url,
          source: source.source,
          r2Path: source.path,
          storage: 'opfs',
          fileName: saved.fileName,
          size: saved.size,
          savedAt: now,
          lastUsedAt: now,
          name: game.name || game.title || 'Lux Play ROM',
          console: game.console || ''
        };
        try {
          await putRecord(record);
        } catch (error) {
          await removeOpfsFile(record);
          throw error;
        }
      } catch (error) {
        console.warn('[Lux ROM Cache] Falha ao gravar em OPFS; tentando IndexedDB:', error);
        engine = 'indexeddb';
        response = await fetchRom(source);
        total = Number(response.headers.get('content-length')) || 0;
        contentType = response.headers.get('content-type') || 'application/octet-stream';
        await assertStorageCapacity(total);
      }
    }

    if (engine === 'indexeddb' && !record) {
      const saved = await downloadToIndexedDb(response, contentType, total, onProgress);
      record = {
        key: gameKey(game),
        sourceUrl: source.url,
        url: source.url,
        source: source.source,
        r2Path: source.path,
        storage: 'indexeddb',
        blob: saved.blob,
        size: saved.size,
        savedAt: now,
        lastUsedAt: now,
        name: game.name || game.title || 'Lux Play ROM',
        console: game.console || ''
      };
      await putRecord(record);
    }

    const verified = await validRecord(game, false);
    if (!verified) {
      if (record) await removeRecord(record);
      throw new Error('A ROM terminou de baixar, mas o navegador não confirmou o armazenamento local.');
    }

    onProgress(1);
    return {
      size: Number(verified.size) || record?.size || 0,
      savedAt: verified.savedAt,
      lastUsedAt: verified.lastUsedAt,
      source: verified.source,
      path: verified.r2Path,
      storage: verified.storage || engine
    };
  }

  async function remove(game) {
    const key = gameKey(game);
    if (!key) return;
    const record = await readRecord(key).catch(() => null);
    if (record) await removeRecord(record);
    else await deleteMetadata(key).catch(() => {});
  }

  async function list() {
    await cleanupExpired().catch(() => {});
    const records = await readAllRecords();
    return records.map(record => ({
      key: record.key,
      name: record.name,
      console: record.console,
      size: Number(record.size) || record.blob?.size || 0,
      savedAt: record.savedAt,
      lastUsedAt: record.lastUsedAt,
      source: record.source || 'legacy',
      path: record.r2Path || '',
      storage: record.storage || 'indexeddb'
    }));
  }

  async function diagnostics() {
    const estimate = await storageEstimate();
    let persisted = false;
    try { persisted = Boolean(await navigator.storage?.persisted?.()); } catch (_) {}
    return {
      version: VERSION,
      preferredStorage: await chooseStorageEngine(),
      persisted,
      quota: estimate.quota,
      usage: estimate.usage,
      available: estimate.available,
      cached: await list().catch(() => [])
    };
  }

  window.LuxRomCache = {
    version: VERSION,
    gatewayBase: GATEWAY_BASE,
    maxIdleMs: MAX_IDLE_MS,
    resolveSource,
    get,
    status,
    download,
    remove,
    list,
    cleanupExpired,
    diagnostics
  };

  cleanupExpired().catch(() => {});
  requestPersistentStorage().catch(() => {});
  window.addEventListener('focus', () => cleanupExpired().catch(() => {}));
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) cleanupExpired().catch(() => {});
  });

  if (!document.querySelector('script[data-lux-game-local-cache]')) {
    const script = document.createElement('script');
    script.src = 'js/game-local-cache-flow.js?v=20260916-r2-rom-cache4';
    script.async = true;
    script.dataset.luxGameLocalCache = '1';
    document.head.appendChild(script);
  }
})();
