(() => {
  'use strict';

  const DB_NAME = 'lux-game-rom-cache';
  const DB_VERSION = 1;
  const STORE_NAME = 'roms';
  const MAX_AGE = 7 * 24 * 60 * 60 * 1000;

  function gameKey(game) {
    return String(game?.id || game?.url || game?.name || '').slice(0, 500);
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
        if (!db.objectStoreNames.contains(STORE_NAME)) db.createObjectStore(STORE_NAME, { keyPath: 'key' });
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error || new Error('Não foi possível abrir o armazenamento local.'));
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
        tx.onerror = () => reject(tx.error || new Error('Falha no armazenamento local.'));
        tx.onabort = () => reject(tx.error || new Error('Operação local cancelada.'));
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
    return transaction('readwrite', store => new Promise((resolve, reject) => {
      const request = store.openCursor();
      request.onsuccess = () => {
        const cursor = request.result;
        if (!cursor) { resolve(); return; }
        const record = cursor.value;
        if (now - Number(record.lastUsedAt || record.savedAt || 0) > MAX_AGE) cursor.delete();
        cursor.continue();
      };
      request.onerror = () => reject(request.error);
    }));
  }

  async function get(game) {
    const key = gameKey(game);
    if (!key) return null;
    await cleanupExpired().catch(() => {});
    const record = await readRecord(key);
    if (!record || record.url !== game.url || !(record.blob instanceof Blob)) return null;

    record.lastUsedAt = Date.now();
    await transaction('readwrite', store => store.put(record));
    return {
      url: URL.createObjectURL(record.blob),
      size: record.size,
      lastUsedAt: record.lastUsedAt
    };
  }

  async function status(game) {
    const key = gameKey(game);
    if (!key) return null;
    await cleanupExpired().catch(() => {});
    const record = await readRecord(key);
    if (!record || record.url !== game.url || !(record.blob instanceof Blob)) return null;
    return { size: record.size, savedAt: record.savedAt, lastUsedAt: record.lastUsedAt };
  }

  async function download(game, onProgress = () => {}) {
    if (!game?.url) throw new Error('Este jogo não possui uma ROM disponível.');
    await cleanupExpired().catch(() => {});
    const existing = await status(game).catch(() => null);
    if (existing) {
      onProgress(1);
      return existing;
    }

    const response = await fetch(game.url, { credentials: 'omit' });
    if (!response.ok) throw new Error('Não foi possível baixar a ROM (HTTP ' + response.status + ').');

    const total = Number(response.headers.get('content-length')) || 0;
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
        if (total) onProgress(Math.min(1, received / total));
      }
      blob = new Blob(chunks, { type: response.headers.get('content-type') || 'application/octet-stream' });
    } else {
      blob = await response.blob();
      received = blob.size;
      onProgress(1);
    }

    const record = {
      key: gameKey(game),
      url: game.url,
      blob,
      size: received || blob.size,
      savedAt: Date.now(),
      lastUsedAt: Date.now(),
      name: game.name || 'Lux Play ROM',
      console: game.console || ''
    };
    await transaction('readwrite', store => store.put(record));
    onProgress(1);
    return { size: record.size, savedAt: record.savedAt, lastUsedAt: record.lastUsedAt };
  }

  async function remove(game) {
    const key = gameKey(game);
    if (!key) return;
    await transaction('readwrite', store => store.delete(key));
  }

  window.LuxRomCache = { get, status, download, remove, cleanupExpired };

  if (!document.querySelector('script[data-lux-game-local-cache]')) {
    const script = document.createElement('script');
    script.src = 'js/game-local-cache-flow.js?v=20260915-game-local-cache1';
    script.async = true;
    script.dataset.luxGameLocalCache = '1';
    document.head.appendChild(script);
  }
})();
