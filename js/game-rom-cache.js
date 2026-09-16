(() => {
  'use strict';

  const VERSION = '20260916-r2-rom-cache2';
  const DB_NAME = 'lux-game-rom-cache';
  const DB_VERSION = 2;
  const STORE_NAME = 'roms';
  const MAX_IDLE_MS = 7 * 24 * 60 * 60 * 1000;
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
    });
  }

  async function transaction(mode, callback) {
    const db = await openDatabase();
    try {
      return await new Promise((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, mode);
        const store = tx.objectStore(STORE_NAME);
        let result;
        try { result = callback(store); } catch (error) { reject(error); return; }
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
      request.onerror = () => reject(request.error);
    }));
  }

  async function cleanupExpired() {
    const now = Date.now();
    let removed = 0;

    await transaction('readwrite', store => new Promise((resolve, reject) => {
      const request = store.openCursor();
      request.onsuccess = () => {
        const cursor = request.result;
        if (!cursor) { resolve(); return; }
        const record = cursor.value || {};
        const lastUse = Number(record.lastUsedAt || record.savedAt || 0);
        if (!lastUse || now - lastUse >= MAX_IDLE_MS) {
          cursor.delete();
          removed += 1;
        }
        cursor.continue();
      };
      request.onerror = () => reject(request.error);
    }));

    return removed;
  }

  async function validRecord(game, touch = false) {
    const key = gameKey(game);
    if (!key) return null;

    const source = resolveSource(game);
    const record = await readRecord(key);
    if (!record || !(record.blob instanceof Blob)) return null;

    const savedSource = String(record.sourceUrl || record.url || '');
    if (source.url && savedSource && source.url !== savedSource) return null;

    if (Date.now() - Number(record.lastUsedAt || record.savedAt || 0) >= MAX_IDLE_MS) {
      await transaction('readwrite', store => store.delete(key));
      return null;
    }

    if (touch) {
      record.lastUsedAt = Date.now();
      await transaction('readwrite', store => store.put(record));
    }

    return record;
  }

  async function get(game) {
    await cleanupExpired().catch(() => {});
    const record = await validRecord(game, true);
    if (!record) return null;

    return {
      url: URL.createObjectURL(record.blob),
      size: Number(record.size) || record.blob.size,
      savedAt: record.savedAt,
      lastUsedAt: record.lastUsedAt,
      source: record.source || 'r2',
      path: record.r2Path || ''
    };
  }

  async function status(game) {
    await cleanupExpired().catch(() => {});
    const record = await validRecord(game, false);
    if (!record) return null;

    return {
      size: Number(record.size) || record.blob.size,
      savedAt: record.savedAt,
      lastUsedAt: record.lastUsedAt,
      source: record.source || 'r2',
      path: record.r2Path || ''
    };
  }

  async function download(game, onProgress = () => {}) {
    const source = resolveSource(game);
    if (!source.url) throw new Error('Este jogo não possui uma ROM disponível.');

    await cleanupExpired().catch(() => {});
    const existing = await validRecord(game, true).catch(() => null);
    if (existing) {
      onProgress(1);
      return {
        size: Number(existing.size) || existing.blob.size,
        savedAt: existing.savedAt,
        lastUsedAt: existing.lastUsedAt,
        source: existing.source || source.source,
        path: existing.r2Path || source.path
      };
    }

    const response = await fetch(source.url, {
      method: 'GET',
      credentials: 'omit',
      cache: 'no-store'
    });
    if (!response.ok) throw new Error(`Não foi possível baixar a ROM (HTTP ${response.status}).`);

    const total = Number(response.headers.get('content-length')) || 0;
    const contentType = response.headers.get('content-type') || 'application/octet-stream';
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

    const now = Date.now();
    const record = {
      key: gameKey(game),
      sourceUrl: source.url,
      url: source.url,
      source: source.source,
      r2Path: source.path,
      blob,
      size: received || blob.size,
      savedAt: now,
      lastUsedAt: now,
      name: game.name || game.title || 'Lux Play ROM',
      console: game.console || ''
    };

    await transaction('readwrite', store => store.put(record));
    onProgress(1);

    return {
      size: record.size,
      savedAt: record.savedAt,
      lastUsedAt: record.lastUsedAt,
      source: record.source,
      path: record.r2Path
    };
  }

  async function remove(game) {
    const key = gameKey(game);
    if (!key) return;
    await transaction('readwrite', store => store.delete(key));
  }

  async function list() {
    await cleanupExpired().catch(() => {});
    return transaction('readonly', store => new Promise((resolve, reject) => {
      const request = store.getAll();
      request.onsuccess = () => resolve((request.result || []).map(record => ({
        key: record.key,
        name: record.name,
        console: record.console,
        size: Number(record.size) || record.blob?.size || 0,
        savedAt: record.savedAt,
        lastUsedAt: record.lastUsedAt,
        source: record.source || 'legacy',
        path: record.r2Path || ''
      })));
      request.onerror = () => reject(request.error);
    }));
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
    cleanupExpired
  };

  cleanupExpired().catch(() => {});
  window.addEventListener('focus', () => cleanupExpired().catch(() => {}));
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) cleanupExpired().catch(() => {});
  });

  if (!document.querySelector('script[data-lux-game-local-cache]')) {
    const script = document.createElement('script');
    script.src = 'js/game-local-cache-flow.js?v=20260916-r2-rom-cache2';
    script.async = true;
    script.dataset.luxGameLocalCache = '1';
    document.head.appendChild(script);
  }
})();
