(() => {
  'use strict';

  const VERSION = '20260916-hybrid-rom-storage1';
  const DB_NAME = 'lux-game-hybrid-rom-cache';
  const DB_VERSION = 1;
  const ROM_STORE = 'roms';
  const SETTINGS_STORE = 'settings';
  const DIRECTORY_KEY = 'rom-directory';
  const LARGE_ROM_THRESHOLD = 100 * 1024 * 1024;
  const MAX_IDLE_MS = 7 * 24 * 60 * 60 * 1000;
  const INSTALL_ATTEMPTS = 240;
  const MODAL_ID = 'luxRomDirectoryPicker';

  if (window.__luxHybridRomStorageVersion === VERSION) return;
  window.__luxHybridRomStorageVersion = VERSION;

  let sessionDirectoryHandle = null;
  let pendingDirectoryPrompt = null;

  function openDatabase() {
    return new Promise((resolve, reject) => {
      if (!window.indexedDB) {
        reject(new Error('O armazenamento local do navegador não está disponível.'));
        return;
      }
      const request = indexedDB.open(DB_NAME, DB_VERSION);
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains(ROM_STORE)) db.createObjectStore(ROM_STORE, { keyPath: 'key' });
        if (!db.objectStoreNames.contains(SETTINGS_STORE)) db.createObjectStore(SETTINGS_STORE, { keyPath: 'key' });
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error || new Error('Não foi possível abrir o armazenamento híbrido de ROMs.'));
    });
  }

  async function transaction(storeName, mode, callback) {
    const db = await openDatabase();
    try {
      return await new Promise((resolve, reject) => {
        const tx = db.transaction(storeName, mode);
        const store = tx.objectStore(storeName);
        let result;
        try { result = callback(store); } catch (error) { reject(error); return; }
        tx.oncomplete = () => resolve(result);
        tx.onerror = () => reject(tx.error || new Error('Falha no armazenamento local.'));
        tx.onabort = () => reject(tx.error || new Error('Operação de armazenamento cancelada.'));
      });
    } finally {
      db.close();
    }
  }

  function requestResult(storeName, mode, action) {
    return transaction(storeName, mode, store => new Promise((resolve, reject) => {
      const request = action(store);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error || new Error('Falha ao acessar o armazenamento local.'));
    }));
  }

  const readRecord = key => requestResult(ROM_STORE, 'readonly', store => store.get(key)).then(value => value || null);
  const putRecord = record => requestResult(ROM_STORE, 'readwrite', store => store.put(record));
  const deleteRecord = key => requestResult(ROM_STORE, 'readwrite', store => store.delete(key));
  const readAllRecords = () => requestResult(ROM_STORE, 'readonly', store => store.getAll()).then(value => value || []);
  const readSetting = key => requestResult(SETTINGS_STORE, 'readonly', store => store.get(key)).then(value => value || null);
  const putSetting = value => requestResult(SETTINGS_STORE, 'readwrite', store => store.put(value));

  function supportsDirectoryPicker() {
    return typeof window.showDirectoryPicker === 'function';
  }

  async function directoryPermission(handle, request = false) {
    if (!handle) return false;
    const options = { mode: 'readwrite' };
    try {
      if (typeof handle.queryPermission !== 'function') return true;
      let state = await handle.queryPermission(options);
      if (state === 'granted') return true;
      if (request && state === 'prompt' && typeof handle.requestPermission === 'function') {
        state = await handle.requestPermission(options);
      }
      return state === 'granted';
    } catch (_) {
      return false;
    }
  }

  async function storedDirectoryHandle() {
    if (sessionDirectoryHandle) return sessionDirectoryHandle;
    try {
      const setting = await readSetting(DIRECTORY_KEY);
      if (setting?.handle) sessionDirectoryHandle = setting.handle;
    } catch (_) {}
    return sessionDirectoryHandle;
  }

  async function saveDirectoryHandle(handle) {
    sessionDirectoryHandle = handle;
    try { await putSetting({ key: DIRECTORY_KEY, handle, savedAt: Date.now() }); }
    catch (error) { console.warn('[Lux ROM Storage] Não foi possível lembrar a pasta entre sessões:', error); }
  }

  function ensurePickerStyle() {
    if (document.getElementById('luxRomDirectoryPickerStyle')) return;
    const style = document.createElement('style');
    style.id = 'luxRomDirectoryPickerStyle';
    style.textContent = `
      #${MODAL_ID}{position:fixed;inset:0;z-index:2147483646;display:flex;align-items:center;justify-content:center;padding:24px;background:rgba(5,3,10,.92);backdrop-filter:blur(10px)}
      #${MODAL_ID} .lux-rom-dir-card{width:min(480px,100%);border:1px solid rgba(126,34,206,.68);border-radius:26px;background:#120c1f;padding:26px;box-shadow:0 26px 80px rgba(0,0,0,.55);color:#fff}
      #${MODAL_ID} .lux-rom-dir-icon{width:58px;height:58px;display:grid;place-items:center;border-radius:18px;background:rgba(147,51,234,.18);border:1px solid rgba(168,85,247,.3);font-size:25px;margin-bottom:16px}
      #${MODAL_ID} h3{font-size:19px;font-weight:900;margin:0 0 9px}
      #${MODAL_ID} p{font-size:12px;line-height:1.65;color:#c4b5fd;margin:0}
      #${MODAL_ID} .lux-rom-dir-note{margin-top:14px;padding:12px 13px;border:1px solid rgba(88,28,135,.48);border-radius:14px;background:rgba(46,16,101,.24);font-size:11px;line-height:1.55;color:#a78bfa}
      #${MODAL_ID} .lux-rom-dir-actions{display:flex;justify-content:flex-end;gap:9px;margin-top:20px;flex-wrap:wrap}
      #${MODAL_ID} button{border-radius:12px;padding:10px 14px;font-size:11px;font-weight:900}
      #${MODAL_ID} .lux-rom-dir-cancel{border:1px solid rgba(88,28,135,.55);background:#180f29;color:#c4b5fd}
      #${MODAL_ID} .lux-rom-dir-pick{border:1px solid rgba(168,85,247,.45);background:#7e22ce;color:#fff}
      #${MODAL_ID} .lux-rom-dir-pick:disabled{opacity:.55;cursor:wait}
    `;
    document.head.appendChild(style);
  }

  function closePickerModal() {
    document.getElementById(MODAL_ID)?.remove();
  }

  async function promptForDirectory(existingHandle = null) {
    if (pendingDirectoryPrompt) return pendingDirectoryPrompt;
    if (!supportsDirectoryPicker() && !existingHandle) {
      throw new Error('Este navegador não permite escolher uma pasta para ROMs grandes.');
    }

    pendingDirectoryPrompt = new Promise((resolve, reject) => {
      ensurePickerStyle();
      closePickerModal();
      const overlay = document.createElement('div');
      overlay.id = MODAL_ID;
      const canRequestExisting = Boolean(existingHandle);
      overlay.innerHTML = `
        <div class="lux-rom-dir-card" role="dialog" aria-modal="true" aria-labelledby="luxRomDirTitle">
          <div class="lux-rom-dir-icon">📁</div>
          <h3 id="luxRomDirTitle">Escolha onde guardar jogos grandes</h3>
          <p>Jogos acima de 100 MB precisam ser salvos como arquivos no seu dispositivo. Escolha uma pasta para o Lux Play usar.</p>
          <div class="lux-rom-dir-note">O Lux criará automaticamente <strong>Lux Play/ROMs</strong> dentro da pasta escolhida. Jogos que ficarem 7 dias sem uso serão removidos automaticamente. Saves, favoritos e progresso não são apagados.</div>
          <div class="lux-rom-dir-actions">
            <button type="button" class="lux-rom-dir-cancel">Agora não</button>
            <button type="button" class="lux-rom-dir-pick">${canRequestExisting ? 'Autorizar pasta' : 'Escolher pasta'}</button>
          </div>
        </div>`;
      document.body.appendChild(overlay);

      const cancel = overlay.querySelector('.lux-rom-dir-cancel');
      const pick = overlay.querySelector('.lux-rom-dir-pick');
      cancel.onclick = () => {
        closePickerModal();
        reject(new DOMException('Seleção de pasta cancelada.', 'AbortError'));
      };
      pick.onclick = async () => {
        pick.disabled = true;
        try {
          if (existingHandle) {
            const granted = await directoryPermission(existingHandle, true);
            if (granted) {
              await saveDirectoryHandle(existingHandle);
              closePickerModal();
              resolve(existingHandle);
              return;
            }
          }

          if (!supportsDirectoryPicker()) throw new Error('O navegador não permite escolher outra pasta.');
          const handle = await window.showDirectoryPicker({ id: 'lux-play-roms', mode: 'readwrite' });
          if (!(await directoryPermission(handle, true))) throw new Error('Permissão de gravação não concedida.');
          await saveDirectoryHandle(handle);
          closePickerModal();
          resolve(handle);
        } catch (error) {
          if (error?.name === 'AbortError') {
            pick.disabled = false;
            return;
          }
          console.warn('[Lux ROM Storage] Não foi possível autorizar a pasta:', error);
          pick.disabled = false;
          pick.textContent = 'Tentar novamente';
        }
      };
    }).finally(() => { pendingDirectoryPrompt = null; });

    return pendingDirectoryPrompt;
  }

  async function ensureDirectoryHandle(prompt = false) {
    const handle = await storedDirectoryHandle();
    if (handle && await directoryPermission(handle, false)) return handle;
    if (!prompt) return null;
    return promptForDirectory(handle);
  }

  function safeName(value, fallback = 'Jogo') {
    const cleaned = String(value || '')
      .replace(/[<>:"/\\|?*\u0000-\u001F]/g, '_')
      .replace(/[. ]+$/g, '')
      .trim();
    return (cleaned || fallback).slice(0, 150);
  }

  function extensionFromSource(game, source) {
    const candidate = String(source?.path || source?.url || game?.sourceFileName || game?.name || '');
    let pathname = candidate;
    try { pathname = new URL(candidate, window.location.href).pathname; } catch (_) {}
    const match = pathname.match(/\.([a-z0-9]{1,8})$/i);
    return match ? `.${match[1].toLowerCase()}` : '.rom';
  }

  function fileNameForGame(game, source) {
    const ext = extensionFromSource(game, source);
    let base = String(game?.name || game?.title || game?.sourceFileName || 'Jogo');
    base = base.replace(/\.[a-z0-9]{1,8}$/i, '');
    const id = game?.id ? ` [${game.id}]` : '';
    return `${safeName(base)}${id}${ext}`;
  }

  function systemFolder(game) {
    const raw = String(game?.console || game?.consoleLabel || 'outros').toLowerCase().replace(/[^a-z0-9]/g, '');
    const aliases = { megadrive: 'md', genesis: 'md', segamegadrive: 'md', mastersystem: 'ms', sms: 'ms', segamastersystem: 'ms', gameboyadvance: 'gba', gameboycolor: 'gbc', gameboy: 'gb', nintendo64: 'n64', supernintendo: 'snes', supernes: 'snes', famicom: 'nes' };
    return aliases[raw] || raw || 'outros';
  }

  async function gameDirectory(rootHandle, game, create = true) {
    const lux = await rootHandle.getDirectoryHandle('Lux Play', { create });
    const roms = await lux.getDirectoryHandle('ROMs', { create });
    return roms.getDirectoryHandle(systemFolder(game), { create });
  }

  async function directoryFile(record, prompt = false) {
    const root = await ensureDirectoryHandle(prompt);
    if (!root) return null;
    try {
      const lux = await root.getDirectoryHandle('Lux Play', { create: false });
      const roms = await lux.getDirectoryHandle('ROMs', { create: false });
      const folder = await roms.getDirectoryHandle(record.systemFolder || 'outros', { create: false });
      const handle = await folder.getFileHandle(record.fileName, { create: false });
      const file = await handle.getFile();
      return file?.size ? file : null;
    } catch (_) {
      return null;
    }
  }

  async function removeDirectoryFile(record, prompt = false) {
    const root = await ensureDirectoryHandle(prompt);
    if (!root) return false;
    try {
      const lux = await root.getDirectoryHandle('Lux Play', { create: false });
      const roms = await lux.getDirectoryHandle('ROMs', { create: false });
      const folder = await roms.getDirectoryHandle(record.systemFolder || 'outros', { create: false });
      await folder.removeEntry(record.fileName);
      return true;
    } catch (error) {
      if (error?.name === 'NotFoundError') return true;
      return false;
    }
  }

  async function streamResponseToDirectory(response, game, source, total, onProgress) {
    const root = await ensureDirectoryHandle(true);
    if (!root) throw new Error('Selecione uma pasta para armazenar este jogo.');
    const folder = await gameDirectory(root, game, true);
    const fileName = fileNameForGame(game, source);
    const handle = await folder.getFileHandle(fileName, { create: true });
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
      try { await folder.removeEntry(fileName); } catch (_) {}
      throw error;
    }

    const file = await handle.getFile();
    if (!file.size) {
      try { await folder.removeEntry(fileName); } catch (_) {}
      throw new Error('A ROM baixada está vazia.');
    }
    return { fileName, size: file.size || received, systemFolder: systemFolder(game) };
  }

  async function responseToBlob(response, total, onProgress) {
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
      blob = new Blob(chunks, { type: response.headers.get('content-type') || 'application/octet-stream' });
    } else {
      blob = await response.blob();
      received = blob.size;
    }
    if (!blob.size) throw new Error('A ROM baixada está vazia.');
    return { blob, size: received || blob.size };
  }

  async function fetchRom(source, method = 'GET') {
    const response = await fetch(source.url, { method, credentials: 'omit', cache: 'no-store' });
    if (!response.ok) throw new Error(`Não foi possível baixar a ROM (HTTP ${response.status}).`);
    return response;
  }

  async function probeSize(source) {
    try {
      const response = await fetchRom(source, 'HEAD');
      return Number(response.headers.get('content-length')) || 0;
    } catch (_) {
      return 0;
    }
  }

  function recordKey(game, resolveSource) {
    const source = resolveSource(game);
    return String(game?.id || source.path || source.url || game?.name || '').slice(0, 700);
  }

  async function removeNewRecord(record, prompt = false) {
    if (!record?.key) return true;
    if (record.storage === 'directory') {
      const deleted = await removeDirectoryFile(record, prompt);
      if (!deleted) return false;
    }
    await deleteRecord(record.key).catch(() => {});
    return true;
  }

  async function cleanupNewRecords() {
    const now = Date.now();
    const records = await readAllRecords().catch(() => []);
    let removed = 0;
    for (const record of records) {
      const lastUse = Number(record?.lastUsedAt || record?.savedAt || 0);
      if (!lastUse || now - lastUse >= MAX_IDLE_MS) {
        const deleted = await removeNewRecord(record, false);
        if (deleted) removed += 1;
      }
    }
    return removed;
  }

  async function validNewRecord(game, resolveSource, touch = false, prompt = false) {
    const key = recordKey(game, resolveSource);
    if (!key) return null;
    const record = await readRecord(key).catch(() => null);
    if (!record) return null;

    const source = resolveSource(game);
    if (source.url && record.sourceUrl && source.url !== record.sourceUrl) {
      await removeNewRecord(record, false);
      return null;
    }

    if (Date.now() - Number(record.lastUsedAt || record.savedAt || 0) >= MAX_IDLE_MS) {
      await removeNewRecord(record, false);
      return null;
    }

    if (record.storage === 'directory') {
      const file = await directoryFile(record, prompt);
      if (!file) return null;
      record.size = file.size;
    } else if (!(record.blob instanceof Blob) || !record.blob.size) {
      await deleteRecord(record.key).catch(() => {});
      return null;
    }

    if (touch) {
      record.lastUsedAt = Date.now();
      await putRecord(record);
    }
    return record;
  }

  async function recordBlob(record, prompt = false) {
    if (record?.storage === 'directory') return directoryFile(record, prompt);
    return record?.blob instanceof Blob ? record.blob : null;
  }

  function install() {
    const cache = window.LuxRomCache;
    if (!cache?.resolveSource || cache.__luxHybridStoragePatched) return false;

    const original = {
      get: cache.get?.bind(cache),
      status: cache.status?.bind(cache),
      download: cache.download?.bind(cache),
      remove: cache.remove?.bind(cache),
      cleanupExpired: cache.cleanupExpired?.bind(cache),
      diagnostics: cache.diagnostics?.bind(cache)
    };
    const resolveSource = cache.resolveSource.bind(cache);

    cache.get = async function (game) {
      await cleanupNewRecords().catch(() => {});
      const record = await validNewRecord(game, resolveSource, true, false);
      if (record) {
        const blob = await recordBlob(record, false);
        if (blob?.size) {
          return {
            url: URL.createObjectURL(blob),
            size: Number(record.size) || blob.size,
            savedAt: record.savedAt,
            lastUsedAt: record.lastUsedAt,
            source: record.source || 'r2',
            path: record.r2Path || '',
            storage: record.storage
          };
        }
      }
      return original.get ? original.get(game) : null;
    };

    cache.status = async function (game) {
      await cleanupNewRecords().catch(() => {});
      const record = await validNewRecord(game, resolveSource, false, false);
      if (record) {
        return {
          size: Number(record.size) || record.blob?.size || 0,
          savedAt: record.savedAt,
          lastUsedAt: record.lastUsedAt,
          source: record.source || 'r2',
          path: record.r2Path || '',
          storage: record.storage
        };
      }
      return original.status ? original.status(game) : null;
    };

    cache.download = async function (game, onProgress = () => {}) {
      const source = resolveSource(game);
      if (!source?.url) throw new Error('Este jogo não possui uma ROM disponível.');
      await cleanupNewRecords().catch(() => {});

      const ownExisting = await validNewRecord(game, resolveSource, true, true).catch(() => null);
      if (ownExisting) {
        onProgress(1);
        return {
          size: Number(ownExisting.size) || ownExisting.blob?.size || 0,
          savedAt: ownExisting.savedAt,
          lastUsedAt: ownExisting.lastUsedAt,
          source: ownExisting.source || source.source,
          path: ownExisting.r2Path || source.path,
          storage: ownExisting.storage
        };
      }

      const legacyExisting = original.status ? await original.status(game).catch(() => null) : null;
      if (legacyExisting) {
        onProgress(1);
        return legacyExisting;
      }

      const key = recordKey(game, resolveSource);
      const now = Date.now();
      const probedSize = await probeSize(source);
      const mustUseDirectory = probedSize >= LARGE_ROM_THRESHOLD;

      if (mustUseDirectory && supportsDirectoryPicker()) {
        await ensureDirectoryHandle(true);
      }

      let response = await fetchRom(source, 'GET');
      let total = Number(response.headers.get('content-length')) || probedSize || 0;
      const large = total >= LARGE_ROM_THRESHOLD;

      if (large && supportsDirectoryPicker()) {
        const saved = await streamResponseToDirectory(response, game, source, total, onProgress);
        const record = {
          key,
          sourceUrl: source.url,
          source: source.source,
          r2Path: source.path,
          storage: 'directory',
          fileName: saved.fileName,
          systemFolder: saved.systemFolder,
          size: saved.size,
          savedAt: now,
          lastUsedAt: now,
          name: game.name || game.title || 'Lux Play ROM',
          console: game.console || ''
        };
        await putRecord(record);
        onProgress(1);
        return { size: record.size, savedAt: now, lastUsedAt: now, source: record.source, path: record.r2Path, storage: 'directory' };
      }

      if (large && !supportsDirectoryPicker() && original.download) {
        return original.download(game, onProgress);
      }

      const saved = await responseToBlob(response, total, onProgress);
      const record = {
        key,
        sourceUrl: source.url,
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

      try {
        await putRecord(record);
      } catch (error) {
        if (!supportsDirectoryPicker()) throw error;
        console.warn('[Lux ROM Storage] IndexedDB recusou a ROM; movendo para pasta escolhida:', error);
        await ensureDirectoryHandle(true);
        response = await fetchRom(source, 'GET');
        total = Number(response.headers.get('content-length')) || saved.size || 0;
        const fileSaved = await streamResponseToDirectory(response, game, source, total, onProgress);
        const fileRecord = {
          key,
          sourceUrl: source.url,
          source: source.source,
          r2Path: source.path,
          storage: 'directory',
          fileName: fileSaved.fileName,
          systemFolder: fileSaved.systemFolder,
          size: fileSaved.size,
          savedAt: now,
          lastUsedAt: now,
          name: game.name || game.title || 'Lux Play ROM',
          console: game.console || ''
        };
        await putRecord(fileRecord);
        onProgress(1);
        return { size: fileRecord.size, savedAt: now, lastUsedAt: now, source: fileRecord.source, path: fileRecord.r2Path, storage: 'directory' };
      }

      const verified = await validNewRecord(game, resolveSource, false, false);
      if (!verified) {
        await deleteRecord(key).catch(() => {});
        throw new Error('A ROM terminou de baixar, mas o navegador não confirmou o armazenamento local.');
      }
      onProgress(1);
      return { size: verified.size, savedAt: verified.savedAt, lastUsedAt: verified.lastUsedAt, source: verified.source, path: verified.r2Path, storage: verified.storage };
    };

    cache.remove = async function (game) {
      const key = recordKey(game, resolveSource);
      const record = key ? await readRecord(key).catch(() => null) : null;
      if (record) {
        const deleted = await removeNewRecord(record, true);
        if (!deleted) throw new Error('Autorize a pasta para remover a ROM local.');
      }
      if (original.remove) await original.remove(game).catch(() => {});
    };

    cache.cleanupExpired = async function () {
      const own = await cleanupNewRecords().catch(() => 0);
      if (original.cleanupExpired) await original.cleanupExpired().catch(() => {});
      return own;
    };

    cache.chooseLargeRomFolder = () => ensureDirectoryHandle(true);
    cache.largeRomThreshold = LARGE_ROM_THRESHOLD;
    cache.hybridStorageVersion = VERSION;
    cache.__luxHybridStoragePatched = true;

    cache.diagnostics = async function () {
      const base = original.diagnostics ? await original.diagnostics().catch(() => ({})) : {};
      const folder = await storedDirectoryHandle().catch(() => null);
      return {
        ...base,
        hybridStorageVersion: VERSION,
        largeRomThreshold: LARGE_ROM_THRESHOLD,
        directoryPickerSupported: supportsDirectoryPicker(),
        directoryConfigured: Boolean(folder),
        directoryPermission: folder ? (await directoryPermission(folder, false) ? 'granted' : 'prompt-or-denied') : 'none',
        hybridCached: (await readAllRecords().catch(() => [])).map(record => ({
          key: record.key,
          name: record.name,
          console: record.console,
          size: Number(record.size) || record.blob?.size || 0,
          storage: record.storage,
          savedAt: record.savedAt,
          lastUsedAt: record.lastUsedAt
        }))
      };
    };

    cleanupNewRecords().catch(() => {});
    window.addEventListener('focus', () => cleanupNewRecords().catch(() => {}));
    document.addEventListener('visibilitychange', () => { if (!document.hidden) cleanupNewRecords().catch(() => {}); });
    console.info('[Lux ROM Storage] Armazenamento híbrido ativo: Blob < 100 MB, pasta escolhida >= 100 MB.');
    return true;
  }

  let attempts = 0;
  const timer = setInterval(() => {
    attempts += 1;
    if (install() || attempts >= INSTALL_ATTEMPTS) clearInterval(timer);
  }, 50);

  install();
})();
