(() => {
  'use strict';

  const VERSION = '20260917-game-catalog-cache2';
  const DB_NAME = 'lux-game-catalog-cache';
  const STORE = 'catalogs';
  const DB_VERSION = 1;
  const FIRST_BOOT_KEY = 'lux-play:catalog-first-bootstrap:v1';
  const CACHE_MAX_AGE = 30 * 24 * 60 * 60 * 1000;

  if (window.__luxGameCatalogCacheVersion === VERSION) return;
  window.__luxGameCatalogCacheVersion = VERSION;

  let dbPromise = null;
  let refreshPromise = null;
  let firstBootRunning = false;

  const readUser = () => { try { return typeof currentUser !== 'undefined' ? currentUser : null; } catch (_) { return null; } };
  const profileKey = () => {
    const user = readUser();
    if (!user) return 'guest';
    return `${String(user.user || user.id || 'account').toLowerCase()}|${String(user.profile?.data_key || user.profile?.slot || '1')}|${String(user.role || 'user').toLowerCase()}`;
  };
  const firstBootKey = () => `${FIRST_BOOT_KEY}:${profileKey()}`;

  function openDb() {
    if (!dbPromise) dbPromise = new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);
      request.onupgradeneeded = () => {
        if (!request.result.objectStoreNames.contains(STORE)) request.result.createObjectStore(STORE, { keyPath: 'key' });
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => { dbPromise = null; reject(request.error); };
    });
    return dbPromise;
  }

  async function transaction(mode, operation) {
    const db = await openDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, mode);
      const request = operation(tx.objectStore(STORE));
      tx.oncomplete = () => resolve(request?.result);
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error || new Error('Cache interrompido.'));
    });
  }

  async function readCache() {
    try {
      const record = await transaction('readonly', store => store.get(profileKey()));
      if (!record || !Array.isArray(record.rows) || !record.rows.length) return null;
      if (Date.now() - Number(record.updatedAt || 0) > CACHE_MAX_AGE) return null;
      return record;
    } catch (_) { return null; }
  }

  async function writeCache(rows) {
    if (!Array.isArray(rows) || !rows.length) return;
    try {
      await transaction('readwrite', store => store.put({ key: profileKey(), rows, updatedAt: Date.now() }));
      console.info('[Lux Games] Catálogo salvo em cache local.', { games: rows.length });
    } catch (error) { console.warn('[Lux Games] Falha ao salvar cache.', error); }
  }

  const applyRows = rows => {
    const filtered = (Array.isArray(rows) ? rows : []).filter(game => {
      try { return typeof profileAllowsMedia === 'function' ? profileAllowsMedia(game) : true; } catch (_) { return true; }
    });
    try { gamesCatalog = filtered; } catch (_) {}
    return filtered;
  };

  async function refreshFromServer(original, thisArg, args) {
    if (refreshPromise) return refreshPromise;
    refreshPromise = Promise.resolve().then(() => original.apply(thisArg, args)).then(async rows => {
      const source = Array.isArray(rows) ? rows : (typeof gamesCatalog !== 'undefined' && Array.isArray(gamesCatalog) ? gamesCatalog : []);
      if (source.length) await writeCache(source);
      return source;
    }).finally(() => { refreshPromise = null; });
    return refreshPromise;
  }

  function installCatalogCache() {
    const original = window.loadGamesCatalog;
    if (typeof original !== 'function') return false;
    if (original.__luxGameCatalogCache) return true;

    const wrapped = async function(...args) {
      const force = args[0]?.force === true || window.__luxForceGameCatalogRefresh === true;
      if (!force) {
        const cached = await readCache();
        if (cached?.rows?.length) {
          const rows = applyRows(cached.rows);
          console.info('[Lux Games] Catálogo carregado do cache local.', { games: rows.length });
          return rows;
        }
      }
      try { return await refreshFromServer(original, this, args); }
      catch (error) {
        const cached = await readCache();
        if (cached?.rows?.length) return applyRows(cached.rows);
        throw error;
      }
    };
    wrapped.__luxGameCatalogCache = VERSION;
    wrapped.__luxGameCatalogCacheOriginal = original;
    try { window.loadGamesCatalog = wrapped; loadGamesCatalog = wrapped; } catch (_) {}
    return true;
  }

  async function refreshAllCatalogs(options = {}) {
    window.__luxForceGameCatalogRefresh = true;
    try {
      const jobs = [];
      if (typeof window.loadMediaSourcesInPriority === 'function') jobs.push(Promise.resolve().then(() => window.loadMediaSourcesInPriority()));
      if (typeof window.loadGamesCatalog === 'function') jobs.push(Promise.resolve().then(() => window.loadGamesCatalog({ force: true })));
      if (typeof window.loadReadingCatalog === 'function') jobs.push(Promise.resolve().then(() => window.loadReadingCatalog()));
      if (typeof window.loadSharedVodCatalog === 'function') jobs.push(Promise.resolve().then(() => window.loadSharedVodCatalog()));
      await Promise.allSettled(jobs);
      try {
        const section = typeof currentSection !== 'undefined' ? (currentSection || 'home') : 'home';
        if (typeof window.setSection === 'function') window.setSection(section);
      } catch (_) {}
      if (!options.silent) console.info('[Lux Play] Catálogos atualizados pelo usuário.');
    } finally { window.__luxForceGameCatalogRefresh = false; }
  }

  function installHeaderRefresh() {
    const button = document.getElementById('headerCatalogRefreshBtn');
    if (!button || button.__luxCatalogRefreshInstalled) return Boolean(button);
    button.__luxCatalogRefreshInstalled = true;
    button.addEventListener('click', async event => {
      event.preventDefault();
      event.stopImmediatePropagation();
      button.disabled = true;
      button.classList.add('animate-spin');
      try {
        if (typeof window.reloadUserData === 'function') await window.reloadUserData();
        await refreshAllCatalogs();
      } finally {
        button.disabled = false;
        button.classList.remove('animate-spin');
      }
    }, true);
    return true;
  }

  function showFirstAccessNotice() {
    document.getElementById('luxFirstCatalogNotice')?.remove();
    const overlay = document.createElement('div');
    overlay.id = 'luxFirstCatalogNotice';
    overlay.className = 'fixed inset-0 z-[1600] flex items-center justify-center bg-black/75 p-4';
    overlay.innerHTML = `
      <div class="w-full max-w-sm rounded-3xl border border-purple-800/60 bg-[#120c1f] p-6 text-center shadow-2xl">
        <div class="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-purple-600/20 text-2xl">↻</div>
        <h3 class="mt-4 text-lg font-black text-white">Preparando seus catálogos</h3>
        <p class="mt-2 text-sm leading-relaxed text-purple-200">No primeiro acesso, o carregamento dos catálogos pode demorar até 1 min.</p>
        <p class="mt-2 text-xs text-purple-400">Isso acontece apenas para criar o cache local. Nas próximas aberturas o conteúdo será carregado muito mais rápido.</p>
        <div class="mt-5 flex items-center justify-center gap-2 text-xs font-bold text-purple-300"><span class="inline-block h-3 w-3 animate-spin rounded-full border-2 border-purple-400 border-t-transparent"></span> Atualizando catálogos...</div>
      </div>`;
    document.body.appendChild(overlay);
  }

  async function bootstrapFirstLogin() {
    if (firstBootRunning || localStorage.getItem(firstBootKey()) === 'done') return;
    firstBootRunning = true;
    showFirstAccessNotice();
    try {
      await refreshAllCatalogs({ silent: true });
      const cache = await readCache();
      if (cache?.rows?.length) localStorage.setItem(firstBootKey(), 'done');
    } catch (error) {
      console.warn('[Lux Play] Primeiro carregamento de catálogos incompleto.', error);
    } finally {
      document.getElementById('luxFirstCatalogNotice')?.remove();
      firstBootRunning = false;
    }
  }

  function scheduleFirstLoginBootstrap() {
    const wait = () => {
      const user = readUser();
      const dashboard = document.getElementById('dashboardScreen');
      const visible = dashboard && !dashboard.classList.contains('hidden') && !dashboard.classList.contains('screen-hidden-down');
      if (user?.profile && visible) return setTimeout(bootstrapFirstLogin, 300);
      setTimeout(wait, 400);
    };
    wait();
  }

  let attempts = 0;
  const timer = setInterval(() => {
    attempts += 1;
    const cacheReady = installCatalogCache();
    const headerReady = installHeaderRefresh();
    if ((cacheReady && headerReady) || attempts >= 240) clearInterval(timer);
  }, 50);
  installCatalogCache();
  installHeaderRefresh();
  scheduleFirstLoginBootstrap();

  window.LuxCatalogCache = { version: VERSION, refresh: refreshAllCatalogs, read: readCache };
  console.info('[Lux Games] Cache de catálogo v2 ativo; primeiro acesso prepara os catálogos.');
})();
