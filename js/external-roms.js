(() => {
  'use strict';

  const DB_NAME = 'lux-external-roms';
  const DB_VERSION = 1;
  const STORE_NAME = 'games';

  const systems = [
    { id: 'gb', label: 'Game Boy', core: 'gb', status: 'tested' },
    { id: 'gbc', label: 'Game Boy Color', core: 'gb', status: 'tested' },
    { id: 'gba', label: 'Game Boy Advance', core: 'gba', status: 'tested' },
    { id: 'nes', label: 'NES', core: 'nes', status: 'tested' },
    { id: 'snes', label: 'SNES', core: 'snes', status: 'tested' },
    { id: 'megadrive', label: 'Mega Drive', core: 'segaMD', status: 'tested' },
    { id: 'mastersystem', label: 'Master System', core: 'segaMS', status: 'tested' },
    { id: 'n64', label: 'Nintendo 64', core: 'n64', status: 'tested' },
    { id: 'psp', label: 'PSP', core: 'psp', status: 'untested' }
  ];

  const extensionMap = {
    gb: 'gb', gbc: 'gbc', gba: 'gba', nes: 'nes',
    sfc: 'snes', smc: 'snes', sms: 'mastersystem',
    md: 'megadrive', gen: 'megadrive', n64: 'n64', z64: 'n64', v64: 'n64',
    iso: 'psp', cso: 'psp', pbp: 'psp'
  };

  function openDatabase() {
    return new Promise((resolve, reject) => {
      if (!window.indexedDB) return reject(new Error('Armazenamento local indisponível.'));
      const request = indexedDB.open(DB_NAME, DB_VERSION);
      request.onupgradeneeded = () => {
        if (!request.result.objectStoreNames.contains(STORE_NAME)) {
          request.result.createObjectStore(STORE_NAME, { keyPath: 'id' });
        }
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error || new Error('Não foi possível abrir a biblioteca local.'));
    });
  }

  async function transaction(mode, callback) {
    const db = await openDatabase();
    try {
      return await new Promise((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, mode);
        const result = callback(tx.objectStore(STORE_NAME));
        tx.oncomplete = () => resolve(result);
        tx.onerror = () => reject(tx.error || new Error('Falha na biblioteca local.'));
        tx.onabort = () => reject(tx.error || new Error('Operação cancelada.'));
      });
    } finally {
      db.close();
    }
  }

  function systemForFile(file) {
    const extension = String(file?.name || '').split('.').pop()?.toLowerCase() || '';
    return extensionMap[extension] || null;
  }

  function systemInfo(id) {
    return systems.find(system => system.id === id) || { id, label: id.toUpperCase(), core: id, status: 'untested' };
  }

  function toGame(record, objectUrl) {
    const system = systemInfo(record.console);
    return {
      id: record.id,
      name: record.name,
      console: record.console,
      consoleLabel: system.label.toUpperCase(),
      url: objectUrl,
      localUrl: objectUrl,
      logo: '',
      synopsis: 'ROM aberta do dispositivo.',
      genres: 'Jogo externo',
      source: 'external',
      external: true,
      sourceFileName: record.fileName,
      isAdult: false
    };
  }

  async function list() {
    return transaction('readonly', store => new Promise((resolve, reject) => {
      const request = store.getAll();
      request.onsuccess = () => resolve((request.result || []).map(record => ({ ...record, blob: undefined })));
      request.onerror = () => reject(request.error);
    }));
  }

  async function importFile(file) {
    if (!file?.name || !file.size) throw new Error('Escolha uma ROM válida.');
    const consoleId = systemForFile(file);
    if (!consoleId) throw new Error('Extensão não reconhecida. Use uma ROM de Game Boy, NES, SNES, Mega Drive, Master System, N64 ou PSP.');
    const record = {
      id: 'external_' + (crypto.randomUUID?.() || Date.now() + '_' + Math.random().toString(36).slice(2)),
      name: file.name.replace(/\.[^.]+$/, ''),
      fileName: file.name,
      console: consoleId,
      size: file.size,
      addedAt: Date.now(),
      blob: file
    };
    await transaction('readwrite', store => store.put(record));
    return record;
  }

  async function open(id) {
    const record = await transaction('readonly', store => new Promise((resolve, reject) => {
      const request = store.get(id);
      request.onsuccess = () => resolve(request.result || null);
      request.onerror = () => reject(request.error);
    }));
    if (!record?.blob) throw new Error('ROM externa não encontrada.');
    const url = URL.createObjectURL(record.blob);
    const game = toGame(record, url);
    game.externalObjectUrl = url;
    if (typeof window.openGameDetails === 'function') window.openGameDetails(game);
    return game;
  }

  async function remove(id) {
    return transaction('readwrite', store => store.delete(id));
  }

  function coreStatuses() {
    const overrides = (() => {
      try { return JSON.parse(localStorage.getItem('lux_core_statuses') || '{}'); } catch (_) { return {}; }
    })();
    return systems.map(system => ({
      ...system,
      status: overrides[system.id] || system.status,
      tested: (overrides[system.id] || system.status) === 'tested'
    }));
  }

  function setCoreStatuses(statuses = {}) {
    const allowed = new Set(systems.map(system => system.id));
    const clean = Object.fromEntries(Object.entries(statuses).filter(([id, status]) => allowed.has(id) && ['tested', 'untested'].includes(status)));
    localStorage.setItem('lux_core_statuses', JSON.stringify(clean));
    return coreStatuses();
  }
  function saveCoreStatuses(statuses = {}) {
    const allowed = new Set(systems.map(system => system.id));
    const clean = Object.fromEntries(Object.entries(statuses).filter(([id, status]) => allowed.has(id) && ['tested', 'untested'].includes(status)));
    localStorage.setItem('lux_core_statuses', JSON.stringify(clean));
    return coreStatuses();
  }

  window.LuxExternalRoms = { systems, systemForFile, coreStatuses, setCoreStatuses, saveCoreStatuses, list, importFile, open, remove };
  window.openExternalGame = id => window.LuxExternalRoms.open(id).catch(error => alert(error.message));
  window.importExternalRom = async input => {
    const file = input?.files?.[0] || input;
    try {
      const record = await importFile(file);
      input.value = '';
      await window.renderGamesCatalog?.();
      alert(`ROM adicionada: ${record.name}`);
    } catch (error) {
      if (input?.value !== undefined) input.value = '';
      alert(error.message);
    }
  };
})();
