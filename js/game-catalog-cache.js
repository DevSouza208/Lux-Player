(() => {
  'use strict';

  const VERSION = '20260917-game-catalog-cache1';
  const DB_NAME = 'lux-game-catalog-cache';
  const STORE = 'catalogs';
  const DB_VERSION = 1;
  const REFRESH_DAY_KEY = 'lux-play:catalog-refresh-prompt-day:v1';
  const REFRESH_DONE_KEY = 'lux-play:catalog-refresh-done-day:v1';
  const CACHE_MAX_AGE = 30 * 24 * 60 * 60 * 1000;

  if (window.__luxGameCatalogCacheVersion === VERSION) return;
  window.__luxGameCatalogCacheVersion = VERSION;

  let dbPromise = null;
  let installed = false;
  let refreshPromise = null;

  const todayKey = () => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  };

  const readUser = () => {
    try { return typeof currentUser !== 'undefined' ? currentUser : null; } catch (_) { return null; }
  };

  const profileKey = () => {
    const user = readUser();
    if (!user) return 'guest';
    const account = String(user.user || user.id || 'account').toLowerCase();
    const profile = String(user.profile?.data_key || user.profile?.slot || '1');
    const role = String(user.role || 'user').toLowerCase();
    return `${account}|${profile}|${role}`;
  };

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
    } catch (error) {
      console.warn('[Lux Games] Cache local indisponível.', error);
      return null;
    }
  }

  async function writeCache(rows) {
    if (!Array.isArray(rows) || !rows.length) return;
    try {
      await transaction('readwrite', store => store.put({ key: profileKey(), rows, updatedAt: Date.now() }));
      console.info('[Lux Games] Catálogo salvo em cache local.', { games: rows.length });
    } catch (error) {
      console.warn('[Lux Games] Não foi possível salvar o catálogo local.', error);
    }
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
    refreshPromise = Promise.resolve()
      .then(() => original.apply(thisArg, args))
      .then(async rows => {
        const source = Array.isArray(rows) ? rows : (typeof gamesCatalog !== 'undefined' && Array.isArray(gamesCatalog) ? gamesCatalog : []);
        if (source.length) await writeCache(source);
        localStorage.setItem(REFRESH_DONE_KEY, todayKey());
        return source;
      })
      .finally(() => { refreshPromise = null; });
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
          console.info('[Lux Games] Catálogo carregado do cache local.', { games: rows.length, ageMinutes: Math.round((Date.now() - cached.updatedAt) / 60000) });
          return rows;
        }
      }

      try {
        return await refreshFromServer(original, this, args);
      } catch (error) {
        const cached = await readCache();
        if (cached?.rows?.length) {
          console.warn('[Lux Games] Servidor indisponível; usando catálogo local.', error);
          return applyRows(cached.rows);
        }
        throw error;
      }
    };

    wrapped.__luxGameCatalogCache = VERSION;
    wrapped.__luxGameCatalogCacheOriginal = original;
    try { window.loadGamesCatalog = wrapped; } catch (_) {}
    try { loadGamesCatalog = wrapped; } catch (_) {}
    installed = true;
    return true;
  }

  async function refreshAllCatalogs() {
    const button = document.getElementById('luxDailyCatalogRefreshButton');
    if (button) { button.disabled = true; button.textContent = 'Atualizando...'; }
    window.__luxForceGameCatalogRefresh = true;
    try {
      const jobs = [];
      if (typeof window.loadMediaSourcesInPriority === 'function') jobs.push(Promise.resolve().then(() => window.loadMediaSourcesInPriority()));
      if (typeof window.loadGamesCatalog === 'function') jobs.push(Promise.resolve().then(() => window.loadGamesCatalog({ force: true })));
      if (typeof window.loadReadingCatalog === 'function') jobs.push(Promise.resolve().then(() => window.loadReadingCatalog()));
      if (typeof window.loadSharedVodCatalog === 'function') jobs.push(Promise.resolve().then(() => window.loadSharedVodCatalog()));
      await Promise.allSettled(jobs);
      localStorage.setItem(REFRESH_DONE_KEY, todayKey());
      try {
        const section = typeof currentSection !== 'undefined' ? (currentSection || 'home') : 'home';
        if (typeof window.setSection === 'function') window.setSection(section);
      } catch (_) {}
      closePrompt();
    } finally {
      window.__luxForceGameCatalogRefresh = false;
      if (button) { button.disabled = false; button.textContent = 'Atualizar catálogos'; }
    }
  }

  function closePrompt() {
    document.getElementById('luxDailyCatalogRefresh')?.remove();
  }

  function showDailyPrompt() {
    const day = todayKey();
    if (localStorage.getItem(REFRESH_DAY_KEY) === day || document.getElementById('luxDailyCatalogRefresh')) return;
    localStorage.setItem(REFRESH_DAY_KEY, day);

    const overlay = document.createElement('div');
    overlay.id = 'luxDailyCatalogRefresh';
    overlay.className = 'fixed inset-0 z-[1500] flex items-center justify-center bg-black/70 p-4';
    overlay.innerHTML = `
      <div class="w-full max-w-sm rounded-3xl border border-purple-800/60 bg-[#120c1f] p-5 shadow-2xl">
        <div class="flex items-start gap-3">
          <div class="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-purple-600/20 text-xl">↻</div>
          <div><h3 class="text-base font-black text-white">Atualizar catálogos?</h3><p class="mt-1 text-xs leading-relaxed text-purple-300">É a primeira abertura de hoje. Atualize para buscar novos conteúdos; você pode continuar usando os catálogos salvos sem esperar.</p></div>
        </div>
        <div class="mt-5 grid grid-cols-2 gap-2">
          <button type="button" data-lux-catalog-later class="rounded-xl border border-purple-900/60 bg-[#180f29] px-3 py-3 text-xs font-bold text-purple-200">Agora não</button>
          <button id="luxDailyCatalogRefreshButton" type="button" class="rounded-xl bg-purple-600 px-3 py-3 text-xs font-black text-white">Atualizar catálogos</button>
        </div>
      </div>`;
    overlay.querySelector('[data-lux-catalog-later]')?.addEventListener('click', closePrompt);
    overlay.querySelector('#luxDailyCatalogRefreshButton')?.addEventListener('click', refreshAllCatalogs);
    document.body.appendChild(overlay);
  }

  function schedulePrompt() {
    const waitForApp = () => {
      const user = readUser();
      const dashboard = document.getElementById('dashboardScreen');
      const visible = dashboard && !dashboard.classList.contains('hidden') && !dashboard.classList.contains('screen-hidden-down');
      if (user?.profile && visible) return setTimeout(showDailyPrompt, 700);
      setTimeout(waitForApp, 500);
    };
    waitForApp();
  }

  let attempts = 0;
  const timer = setInterval(() => {
    attempts += 1;
    if (installCatalogCache() || attempts >= 240) clearInterval(timer);
  }, 50);
  installCatalogCache();
  schedulePrompt();

  window.LuxCatalogCache = { version: VERSION, refresh: refreshAllCatalogs, read: readCache };
  console.info('[Lux Games] Cache persistente de catálogo ativo.');
})();
