(() => {
  'use strict';

  const VERSION = '20260917-rom-storage-mode4-pinned-ui';
  const DB_NAME = 'lux-game-local-first-cache';
  const DB_VERSION = 1;
  const STORE_NAME = 'roms';
  const OPFS_DIRECTORY = 'lux-player-local-first-roms';
  const MODE_PREFIX = 'lux-play:rom-mode:v3:';
  const TEMP_MAX_IDLE_MS = 7 * 24 * 60 * 60 * 1000;
  const CORE_CACHE_MAX_AGE_MINS = 50 * 365 * 24 * 60;
  const CORE_CACHE_MAX_MB = 1024;
  const INSTALL_ATTEMPTS = 400;
  const OVERLAY_ID = 'luxLocalFirstRomOverlay';

  if (window.__luxRomStorageModeVersion === VERSION) return;
  window.__luxRomStorageModeVersion = VERSION;

  let launchBusy = 0;
  let modeBusy = false;
  let uiScheduled = false;

  const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

  function currentGame() {
    try { return typeof currentGameDetails !== 'undefined' ? currentGameDetails : null; }
    catch (_) { return null; }
  }

  function sourceFor(game) {
    try {
      const source = window.LuxRomCache?.resolveSource?.(game);
      if (source?.url) return source;
    } catch (_) {}
    const url = String(game?.r2_url || game?.r2Url || game?.rom_url || game?.url || '').trim();
    return { url, path: String(game?.r2_path || game?.r2Path || game?.rom_path || '').trim(), source: url ? 'fallback' : 'none' };
  }

  function gameIdentity(game) {
    const source = sourceFor(game);
    return String(game?.id || source.path || source.url || game?.name || game?.title || '').slice(0, 700);
  }

  function modeKey(game) {
    return MODE_PREFIX + encodeURIComponent(gameIdentity(game));
  }

  function explicitMode(game) {
    try {
      const value = localStorage.getItem(modeKey(game));
      return value === 'permanent' || value === 'temporary' ? value : null;
    } catch (_) { return null; }
  }

  function saveMode(game, mode) {
    try { localStorage.setItem(modeKey(game), mode === 'permanent' ? 'permanent' : 'temporary'); } catch (_) {}
  }

  function selectedStorageMode(game) {
    return explicitMode(game) === 'permanent' ? 'local' : 'cloud';
  }

  function openDb() {
    return new Promise((resolve, reject) => {
      if (!window.indexedDB) return reject(new Error('Armazenamento local indisponível.'));
      const request = indexedDB.open(DB_NAME, DB_VERSION);
      request.onupgradeneeded = () => {
        if (!request.result.objectStoreNames.contains(STORE_NAME)) {
          request.result.createObjectStore(STORE_NAME, { keyPath: 'key' });
        }
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error || new Error('Não foi possível abrir o cache local.'));
    });
  }

  async function storeRequest(mode, action) {
    const db = await openDb();
    try {
      return await new Promise((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, mode);
        const request = action(tx.objectStore(STORE_NAME));
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error || new Error('Falha no armazenamento local.'));
        tx.onabort = () => reject(tx.error || new Error('Operação de armazenamento cancelada.'));
      });
    } finally {
      db.close();
    }
  }

  const readRecord = key => storeRequest('readonly', store => store.get(key)).then(value => value || null);
  const readRecords = () => storeRequest('readonly', store => store.getAll()).then(value => value || []);
  const putRecord = record => storeRequest('readwrite', store => store.put(record));
  const deleteMetadata = key => storeRequest('readwrite', store => store.delete(key));

  function supportsOpfs() {
    return Boolean(navigator.storage?.getDirectory);
  }

  async function opfsDirectory(create = true) {
    if (!supportsOpfs()) return null;
    const root = await navigator.storage.getDirectory();
    return root.getDirectoryHandle(OPFS_DIRECTORY, { create });
  }

  async function stableHash(value) {
    const text = String(value || '');
    if (crypto?.subtle && window.TextEncoder) {
      const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
      return Array.from(new Uint8Array(digest)).slice(0, 16).map(byte => byte.toString(16).padStart(2, '0')).join('');
    }
    let hash = 2166136261;
    for (let i = 0; i < text.length; i += 1) {
      hash ^= text.charCodeAt(i);
      hash = Math.imul(hash, 16777619);
    }
    return (hash >>> 0).toString(16);
  }

  function sourceExtension(game) {
    const source = sourceFor(game);
    let path = source.path || source.url || game?.name || '';
    try { path = new URL(path, window.location.href).pathname; } catch (_) {}
    return String(path).match(/\.([a-z0-9]{1,8})$/i)?.[0]?.toLowerCase() || '.rom';
  }

  async function opfsFileName(game) {
    return `rom-${await stableHash(gameIdentity(game))}${sourceExtension(game)}`;
  }

  async function readOpfsFile(record) {
    try {
      const dir = await opfsDirectory(false);
      if (!dir || !record?.fileName) return null;
      const handle = await dir.getFileHandle(record.fileName, { create: false });
      const file = await handle.getFile();
      return file?.size ? file : null;
    } catch (_) { return null; }
  }

  async function removeRecord(record) {
    if (!record?.key) return;
    if (record.storage === 'opfs' && record.fileName) {
      try { await (await opfsDirectory(false))?.removeEntry(record.fileName); } catch (_) {}
    }
    await deleteMetadata(record.key).catch(() => {});
  }

  async function requestPersistentStorage() {
    try {
      if (await navigator.storage?.persisted?.()) return true;
      return Boolean(await navigator.storage?.persist?.());
    } catch (_) { return false; }
  }

  async function cleanupExpired() {
    const now = Date.now();
    const records = await readRecords().catch(() => []);
    let removed = 0;
    for (const record of records) {
      if (record?.retention === 'permanent') continue;
      const lastUse = Number(record?.lastUsedAt || record?.savedAt || 0);
      if (!lastUse || now - lastUse >= TEMP_MAX_IDLE_MS) {
        await removeRecord(record);
        removed += 1;
      }
    }
    return removed;
  }

  async function materializeRecord(game, touch = true) {
    const key = gameIdentity(game);
    if (!key) return null;
    const record = await readRecord(key).catch(() => null);
    if (!record) return null;

    const source = sourceFor(game);
    if (source.url && record.sourceUrl && source.url !== record.sourceUrl) {
      await removeRecord(record);
      return null;
    }

    const selected = explicitMode(game);
    if (selected && selected !== record.retention) {
      record.retention = selected;
      record.lastUsedAt = Date.now();
      await putRecord(record).catch(() => {});
    }

    if (record.retention !== 'permanent') {
      const lastUse = Number(record.lastUsedAt || record.savedAt || 0);
      if (!lastUse || Date.now() - lastUse >= TEMP_MAX_IDLE_MS) {
        await removeRecord(record);
        return null;
      }
    }

    let blob = null;
    if (record.storage === 'opfs') blob = await readOpfsFile(record);
    else if (record.blob instanceof Blob && record.blob.size) blob = record.blob;
    if (!blob?.size) {
      await removeRecord(record);
      return null;
    }

    if (touch) {
      record.lastUsedAt = Date.now();
      record.size = blob.size;
      await putRecord(record).catch(() => {});
    }
    return { record, blob };
  }

  function ensureOverlay(game) {
    let overlay = document.getElementById(OVERLAY_ID);
    if (!overlay) {
      const style = document.createElement('style');
      style.textContent = `#${OVERLAY_ID}{position:fixed;inset:0;z-index:2147483600;display:flex;align-items:center;justify-content:center;background:#09060ef2;padding:22px;color:#fff}#${OVERLAY_ID}.hidden{display:none!important}#${OVERLAY_ID}>div{width:min(430px,100%);border:1px solid #6b21a8;border-radius:24px;background:#120c1f;padding:28px;text-align:center;box-shadow:0 25px 80px #0008}#${OVERLAY_ID} .title{font-size:19px;font-weight:900}#${OVERLAY_ID} .game{margin-top:5px;color:#c4b5fd;font-size:12px}#${OVERLAY_ID} .status{margin-top:20px;color:#e9d5ff;font-size:13px;font-weight:700}#${OVERLAY_ID} .track{height:8px;margin-top:12px;border-radius:99px;background:#2e1065;overflow:hidden}#${OVERLAY_ID} .bar{height:100%;width:3%;background:linear-gradient(90deg,#7c3aed,#c084fc);transition:width .16s}#${OVERLAY_ID} .meta{margin-top:8px;color:#a78bfa;font-size:11px}#${OVERLAY_ID} .note{margin-top:17px;color:#8b7ba8;font-size:10px;line-height:1.55}`;
      document.head.appendChild(style);
      overlay = document.createElement('div');
      overlay.id = OVERLAY_ID;
      overlay.className = 'hidden';
      overlay.innerHTML = '<div><div class="title">Preparando jogo</div><div class="game"></div><div class="status">Verificando ROM...</div><div class="track"><div class="bar"></div></div><div class="meta">0%</div><div class="note">A ROM é baixada antes do jogo iniciar para priorizar desempenho. No modo Nuvem ela fica até 7 dias sem uso; no modo Local ela permanece no dispositivo.</div></div>';
      document.body.appendChild(overlay);
    }
    overlay.querySelector('.game').textContent = game?.name || game?.title || 'Jogo';
    overlay.classList.remove('hidden');
    return overlay;
  }

  function updateOverlay(status, progress, meta = '') {
    const overlay = document.getElementById(OVERLAY_ID);
    if (!overlay) return;
    if (status) overlay.querySelector('.status').textContent = status;
    if (Number.isFinite(progress)) {
      const p = Math.max(0, Math.min(1, progress));
      overlay.querySelector('.bar').style.width = `${Math.max(3, Math.round(p * 100))}%`;
      overlay.querySelector('.meta').textContent = meta || `${Math.round(p * 100)}%`;
    } else if (meta) overlay.querySelector('.meta').textContent = meta;
  }

  function hideOverlay(delay = 120) {
    setTimeout(() => document.getElementById(OVERLAY_ID)?.classList.add('hidden'), delay);
  }

  async function saveResponseToOpfs(response, game, total, onProgress) {
    const dir = await opfsDirectory(true);
    if (!dir) throw new Error('OPFS indisponível.');
    const fileName = await opfsFileName(game);
    const handle = await dir.getFileHandle(fileName, { create: true });
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
          if (total > 0) onProgress(received / total);
        }
      } else {
        const blob = await response.blob();
        await writable.write(blob);
        received = blob.size;
      }
      await writable.close();
    } catch (error) {
      try { await writable.abort(); } catch (_) {}
      try { await dir.removeEntry(fileName); } catch (_) {}
      throw error;
    }
    const file = await handle.getFile();
    if (!file.size) throw new Error('A ROM baixada está vazia.');
    return { fileName, size: file.size || received };
  }

  async function saveResponseToIndexedDb(response, total, onProgress) {
    const chunks = [];
    let received = 0;
    if (response.body?.getReader) {
      const reader = response.body.getReader();
      while (true) {
        const part = await reader.read();
        if (part.done) break;
        chunks.push(part.value);
        received += part.value.byteLength;
        if (total > 0) onProgress(received / total);
      }
    } else {
      const blob = await response.blob();
      if (!blob.size) throw new Error('A ROM baixada está vazia.');
      return { blob, size: blob.size };
    }
    const blob = new Blob(chunks, { type: response.headers.get('content-type') || 'application/octet-stream' });
    if (!blob.size) throw new Error('A ROM baixada está vazia.');
    return { blob, size: received || blob.size };
  }

  async function downloadRom(game, onProgress = () => {}) {
    const source = sourceFor(game);
    if (!source.url) throw new Error('Este jogo não possui uma ROM disponível.');

    await cleanupExpired().catch(() => {});
    const existing = await materializeRecord(game, true);
    if (existing) {
      onProgress(1);
      return existing;
    }

    await requestPersistentStorage();
    const retention = explicitMode(game) === 'permanent' ? 'permanent' : 'temporary';
    const response = await fetch(source.url, { method: 'GET', credentials: 'omit', cache: 'no-store' });
    if (!response.ok) throw new Error(`Falha ao baixar a ROM (HTTP ${response.status}).`);
    const total = Number(response.headers.get('content-length')) || 0;
    const now = Date.now();
    let record;

    if (supportsOpfs()) {
      try {
        const saved = await saveResponseToOpfs(response, game, total, onProgress);
        record = { key: gameIdentity(game), sourceUrl: source.url, sourcePath: source.path || '', source: source.source || 'r2', storage: 'opfs', fileName: saved.fileName, size: saved.size, savedAt: now, lastUsedAt: now, retention, name: game?.name || game?.title || '', console: game?.console || '' };
        try {
          await putRecord(record);
        } catch (error) {
          await removeRecord(record).catch(() => {});
          record = null;
          throw error;
        }
      } catch (error) {
        record = null;
        console.warn('[Lux Local First] OPFS falhou; usando IndexedDB:', error);
      }
    }

    if (!record) {
      const retry = supportsOpfs() ? await fetch(source.url, { method: 'GET', credentials: 'omit', cache: 'no-store' }) : response;
      if (!retry.ok) throw new Error(`Falha ao baixar a ROM (HTTP ${retry.status}).`);
      const saved = await saveResponseToIndexedDb(retry, Number(retry.headers.get('content-length')) || total, onProgress);
      record = { key: gameIdentity(game), sourceUrl: source.url, sourcePath: source.path || '', source: source.source || 'r2', storage: 'indexeddb', blob: saved.blob, size: saved.size, savedAt: now, lastUsedAt: now, retention, name: game?.name || game?.title || '', console: game?.console || '' };
      await putRecord(record);
    }

    const verified = await materializeRecord(game, true);
    if (!verified) throw new Error('A ROM terminou de baixar, mas não ficou disponível localmente.');
    onProgress(1);
    return verified;
  }

  async function prepareLocalRom(game) {
    const cached = await materializeRecord(game, true);
    if (cached) {
      updateOverlay('ROM encontrada no dispositivo.', 1, cached.record.retention === 'permanent' ? 'Local permanente' : 'Cache temporário');
      return cached;
    }

    ensureOverlay(game);
    updateOverlay('Baixando ROM antes de iniciar...', 0.03, 'Preparando download');
    const prepared = await downloadRom(game, ratio => {
      const value = Number.isFinite(ratio) ? ratio : 0;
      updateOverlay('Baixando ROM antes de iniciar...', 0.03 + value * 0.9, value > 0 ? `${Math.round(value * 100)}% da ROM` : 'Baixando...');
    });
    updateOverlay('ROM pronta no dispositivo.', 0.96, prepared.record.retention === 'permanent' ? 'Local permanente' : 'Cache por 7 dias');
    return prepared;
  }

  function configurePermanentCoreCache() {
    const previous = window.EJS_cacheConfig && typeof window.EJS_cacheConfig === 'object' ? window.EJS_cacheConfig : {};
    window.EJS_cacheConfig = {
      ...previous,
      enabled: true,
      cacheMaxSizeMB: Math.max(CORE_CACHE_MAX_MB, Number(previous.cacheMaxSizeMB) || 0),
      cacheMaxAgeMins: Math.max(CORE_CACHE_MAX_AGE_MINS, Number(previous.cacheMaxAgeMins) || 0)
    };
    window.EJS_CacheLimit = Math.max(Number(window.EJS_CacheLimit) || 0, CORE_CACHE_MAX_MB * 1024 * 1024);
    requestPersistentStorage().catch(() => {});
  }

  async function setRetention(game, retention) {
    const mode = retention === 'permanent' ? 'permanent' : 'temporary';
    saveMode(game, mode);
    const key = gameIdentity(game);
    const record = key ? await readRecord(key).catch(() => null) : null;
    if (record) {
      record.retention = mode;
      record.lastUsedAt = Date.now();
      await putRecord(record);
    }
    return record;
  }

  async function removePolicyRom(game) {
    const key = gameIdentity(game);
    const record = key ? await readRecord(key).catch(() => null) : null;
    if (record) await removeRecord(record);
  }

  async function refreshStorageUi(game = currentGame()) {
    if (!game) return;
    const cloud = document.getElementById('gameStorageCloud');
    const local = document.getElementById('gameStorageLocal');
    const clear = document.getElementById('gameClearTempButton');
    if (!cloud || !local) return;

    const materialized = await materializeRecord(game, false).catch(() => null);
    if (currentGame() !== game) return;
    const localSelected = selectedStorageMode(game) === 'local';
    cloud.classList.toggle('active', !localSelected);
    local.classList.toggle('active', localSelected);
    cloud.title = 'Nuvem: a ROM é baixada para jogar e removida após 7 dias sem uso.';
    local.title = 'Local: a ROM permanece no dispositivo até você limpar manualmente.';
    cloud.disabled = modeBusy;
    local.disabled = modeBusy;
    if (clear) clear.disabled = modeBusy || !materialized;
  }

  function scheduleUiRefresh() {
    if (uiScheduled) return;
    uiScheduled = true;
    setTimeout(() => {
      uiScheduled = false;
      refreshStorageUi().catch(() => {});
    }, 40);
  }

  function patchStorageMode() {
    const current = window.setCurrentGameStorageMode;
    if (typeof current !== 'function' || current.__luxLocalFirstPolicy === VERSION) return Boolean(current);
    const original = current;

    const wrapped = async function (mode) {
      const game = currentGame();
      if (!game || game.external || game.localUrl || (mode !== 'local' && mode !== 'cloud')) {
        return original.apply(this, arguments);
      }
      if (modeBusy) return undefined;
      modeBusy = true;
      scheduleUiRefresh();
      try {
        if (mode === 'local') {
          let record = await materializeRecord(game, true).catch(() => null);
          if (!record) {
            ensureOverlay(game);
            record = await downloadRom(game, ratio => updateOverlay('Salvando ROM no dispositivo...', 0.04 + (Number(ratio) || 0) * 0.9, `${Math.round((Number(ratio) || 0) * 100)}%`));
          }
          await setRetention(game, 'permanent');
          updateOverlay('ROM mantida no dispositivo.', 1, 'Modo Local');
          hideOverlay(220);
        } else {
          await setRetention(game, 'temporary');
          await cleanupExpired().catch(() => {});
        }
      } catch (error) {
        console.warn('[Lux Local First] Falha ao mudar modo de armazenamento:', error);
        hideOverlay(250);
        if (mode === 'local') window.alert?.(error?.message || 'Não foi possível manter a ROM neste dispositivo.');
      } finally {
        modeBusy = false;
        await refreshStorageUi(game).catch(() => {});
      }
      return undefined;
    };

    wrapped.__luxLocalFirstPolicy = VERSION;
    wrapped.__luxLocalFirstOriginal = original;
    window.setCurrentGameStorageMode = wrapped;
    return true;
  }

  function patchClearCache() {
    const current = window.clearCurrentGameTemporaryFiles;
    if (typeof current !== 'function' || current.__luxLocalFirstPolicy === VERSION) return Boolean(current);
    const original = current;

    const wrapped = async function (...args) {
      const game = currentGame();
      if (!game || game.external) return original.apply(this, args);
      const own = await materializeRecord(game, false).catch(() => null);
      if (!own) return original.apply(this, args);
      const confirmed = window.confirm?.('Limpar a ROM deste dispositivo? Saves, progresso e favoritos não serão apagados.') ?? true;
      if (!confirmed) return undefined;
      await removePolicyRom(game);
      saveMode(game, 'temporary');
      try { await window.LuxRomCache?.remove?.(game); } catch (_) {}
      await refreshStorageUi(game).catch(() => {});
      return undefined;
    };

    wrapped.__luxLocalFirstPolicy = VERSION;
    wrapped.__luxLocalFirstOriginal = original;
    window.clearCurrentGameTemporaryFiles = wrapped;
    return true;
  }

  function patchGameStart() {
    const current = window.startGameFromDetails;
    if (typeof current !== 'function' || current.__luxLocalFirstPolicy === VERSION) return Boolean(current);
    const original = current;

    const wrapped = async function (...args) {
      if (launchBusy > 0) return original.apply(this, args);
      const game = currentGame();
      if (!game || game.external || game.localUrl || !sourceFor(game)?.url) return original.apply(this, args);

      launchBusy += 1;
      const hadLocalUrl = Object.prototype.hasOwnProperty.call(game, 'localUrl');
      const previousLocalUrl = game.localUrl;
      try {
        await cleanupExpired().catch(() => {});
        ensureOverlay(game);
        const prepared = await prepareLocalRom(game);
        const localUrl = URL.createObjectURL(prepared.blob);
        game.localUrl = localUrl;
        updateOverlay('Abrindo jogo pelo dispositivo...', 1, 'ROM local pronta');
        hideOverlay(140);
        return await original.apply(this, args);
      } catch (error) {
        console.warn('[Lux Local First] Cache local falhou; último recurso: fonte remota.', error);
        updateOverlay('Não foi possível preparar a ROM local.', 1, 'Último recurso: abrindo pela nuvem');
        hideOverlay(650);
        return original.apply(this, args);
      } finally {
        if (hadLocalUrl) game.localUrl = previousLocalUrl;
        else delete game.localUrl;
        launchBusy -= 1;
        scheduleUiRefresh();
      }
    };

    wrapped.__luxLocalFirstPolicy = VERSION;
    wrapped.__luxLocalFirstOriginal = original;
    window.startGameFromDetails = wrapped;
    return true;
  }

  function patchCoreStart() {
    const current = window.startEmulatorSession;
    if (typeof current !== 'function' || current.__luxPermanentCorePolicy === VERSION) return Boolean(current);
    const original = current;
    const wrapped = function (...args) {
      configurePermanentCoreCache();
      const result = original.apply(this, args);
      configurePermanentCoreCache();
      return result;
    };
    wrapped.__luxPermanentCorePolicy = VERSION;
    wrapped.__luxPermanentCoreOriginal = original;
    window.startEmulatorSession = wrapped;
    return true;
  }

  function installPolicy() {
    patchStorageMode();
    patchClearCache();
    patchGameStart();
    patchCoreStart();
    configurePermanentCoreCache();
    scheduleUiRefresh();
  }

  requestPersistentStorage().catch(() => {});
  cleanupExpired().catch(() => {});
  installPolicy();

  let attempts = 0;
  const installTimer = setInterval(() => {
    attempts += 1;
    installPolicy();
    if (attempts >= INSTALL_ATTEMPTS) clearInterval(installTimer);
  }, 50);

  const uiObserver = new MutationObserver(scheduleUiRefresh);
  const startObserver = () => uiObserver.observe(document.body, { childList: true, subtree: true });
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', startObserver, { once: true });
  else startObserver();

  window.addEventListener('focus', () => cleanupExpired().catch(() => {}));
  document.addEventListener('visibilitychange', () => { if (!document.hidden) cleanupExpired().catch(() => {}); });

  window.LuxLocalFirstRoms = {
    version: VERSION,
    prepare: prepareLocalRom,
    cleanup: cleanupExpired,
    setRetention,
    refreshUi: refreshStorageUi,
    mode: selectedStorageMode,
    isLocal: game => selectedStorageMode(game) === 'local',
    coreCacheMaxAgeMins: CORE_CACHE_MAX_AGE_MINS
  };

  console.info('[Lux Local First] Nuvem continua selecionada para cache temporário; Local só fica ativo quando o usuário fixa a ROM.');
})();
