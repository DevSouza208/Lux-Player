(() => {
  'use strict';

  const VERSION = '20260917-loader1';
  if (window.LuxLoader?.version === VERSION) return;

  const taskNames = ['media', 'games', 'progress', 'vod', 'reading', 'notifications', 'saves'];
  const states = Object.fromEntries(taskNames.map(name => [name, {
    name,
    state: 'idle',
    error: null,
    startedAt: 0,
    finishedAt: 0,
    promise: null,
    result: null
  }]));

  let generation = 0;
  let backgroundPromise = null;
  const listeners = new Set();

  const now = () => Date.now();
  const currentAccountKey = () => {
    try {
      return JSON.stringify([
        currentUser?.user || '',
        currentUser?.profile?.data_key || currentUser?.profile?.slot || '',
      ]);
    } catch (_) {
      return '';
    }
  };

  function snapshot() {
    return Object.fromEntries(Object.entries(states).map(([name, state]) => [name, {
      state: state.state,
      error: state.error ? String(state.error?.message || state.error) : null,
      startedAt: state.startedAt,
      finishedAt: state.finishedAt
    }]));
  }

  function emit(name) {
    const payload = { name, task: { ...states[name], promise: undefined }, all: snapshot() };
    listeners.forEach(listener => {
      try { listener(payload); } catch (_) {}
    });
    try {
      window.dispatchEvent(new CustomEvent('lux-loader-state', { detail: payload }));
    } catch (_) {}
  }

  function setState(name, state, patch = {}) {
    Object.assign(states[name], patch, { state });
    emit(name);
  }

  const pause = (ms = 0) => new Promise(resolve => setTimeout(resolve, ms));

  async function waitFor(predicate, timeoutMs = 1600, intervalMs = 40) {
    const started = now();
    while (now() - started < timeoutMs) {
      try { if (predicate()) return true; } catch (_) {}
      await pause(intervalMs);
    }
    return false;
  }

  function refreshCurrentView(source) {
    requestAnimationFrame(() => {
      try {
        const section = typeof currentSection !== 'undefined' ? currentSection : 'home';
        if (source === 'games' && section === 'games' && typeof window.renderGamesCatalog === 'function') {
          window.renderGamesCatalog();
          return;
        }
        if (source === 'media') {
          if (section === 'home' && typeof window.renderHomeDashboard === 'function') {
            window.renderHomeDashboard();
            return;
          }
          if (['live', 'movies', 'series'].includes(section) && typeof window.setSection === 'function') {
            window.setSection(section);
          }
        }
        if (source === 'vod' && section === 'home' && typeof window.renderHomeDashboard === 'function') {
          window.renderHomeDashboard();
        }
      } catch (error) {
        console.warn('[Lux Loader] Não foi possível atualizar a seção atual.', error);
      }
    });
  }

  async function mediaTask(force = false) {
    // O bridge HTTPS é assíncrono. Esperamos um instante para evitar cair no
    // parser legado de M3U antes que o catálogo client-ready esteja instalado.
    if (!window.luxElectron && currentUser?.m3uHttpsUrl) {
      await waitFor(() => Boolean(window.__luxSyncedCatalogBridgeInstalled || window.LuxSyncedCatalog), 1800);
    }
    if (typeof window.loadMediaSourcesInPriority !== 'function') return false;
    const result = await window.loadMediaSourcesInPriority({ force });
    refreshCurrentView('media');
    return result;
  }

  async function gamesTask(force = false) {
    if (window.LuxCatalogCache) {
      const result = force
        ? await window.LuxCatalogCache.refreshGames?.()
        : await window.LuxCatalogCache.ensureGames?.();
      refreshCurrentView('games');
      return result;
    }
    if (typeof window.loadGamesCatalog === 'function') {
      const result = await window.loadGamesCatalog(force ? { force: true } : undefined);
      refreshCurrentView('games');
      return result;
    }
    return null;
  }

  async function progressTask() {
    if (typeof window.syncCloudProgress === 'function') return window.syncCloudProgress();
    return null;
  }

  async function vodTask() {
    if (typeof window.loadSharedVodCatalog !== 'function') return null;
    const result = await window.loadSharedVodCatalog();
    refreshCurrentView('vod');
    return result;
  }

  async function readingTask() {
    if (typeof window.loadReadingCatalog === 'function') return window.loadReadingCatalog();
    if (window.LuxReadingAdmin?.refresh && currentUser?.role === 'admin') return window.LuxReadingAdmin.refresh();
    return null;
  }

  async function notificationsTask() {
    if (typeof window.loadAndShowNotifications === 'function') return window.loadAndShowNotifications();
    return null;
  }

  async function savesTask() {
    if (typeof window.retryPendingGameSaves === 'function') return window.retryPendingGameSaves();
    return null;
  }

  const runners = {
    media: mediaTask,
    games: gamesTask,
    progress: progressTask,
    vod: vodTask,
    reading: readingTask,
    notifications: notificationsTask,
    saves: savesTask
  };

  async function run(name, options = {}) {
    const task = states[name];
    const runner = runners[name];
    if (!task || !runner) return null;
    if (task.promise && !options.force) return task.promise;

    const userKey = currentAccountKey();
    const ownGeneration = generation;
    task.startedAt = now();
    task.finishedAt = 0;
    task.error = null;
    setState(name, 'loading');

    const promise = Promise.resolve()
      .then(() => runner(Boolean(options.force)))
      .then(result => {
        if (ownGeneration !== generation || userKey !== currentAccountKey()) return result;
        task.result = result;
        task.finishedAt = now();
        setState(name, 'ready', { error: null });
        return result;
      })
      .catch(error => {
        if (ownGeneration === generation && userKey === currentAccountKey()) {
          task.finishedAt = now();
          setState(name, 'error', { error });
        }
        console.warn('[Lux Loader] ' + name + ' indisponível.', error);
        if (options.throwOnError) throw error;
        return null;
      })
      .finally(() => {
        if (task.promise === promise) task.promise = null;
      });

    task.promise = promise;
    return promise;
  }

  async function runBackgroundPipeline(ownGeneration) {
    // Uma carga pesada de cada vez. Isso reduz os picos de memória do Safari.
    const order = ['media', 'games', 'progress', 'vod', 'reading', 'notifications', 'saves'];
    for (const name of order) {
      if (ownGeneration !== generation || !currentUser?.profile) return;
      await run(name);
      await pause(name === 'media' ? 80 : 25);
    }
  }

  function openShellImmediately() {
    try {
      if (typeof window.setSection === 'function') window.setSection('home');
    } catch (error) {
      console.warn('[Lux Loader] Home inicial indisponível.', error);
    }
    try {
      if (typeof window.hideSplashScreen === 'function') window.hideSplashScreen();
      else document.getElementById('loadingSplash')?.classList.add('hidden');
    } catch (_) {}
    try { window.lucide?.createIcons?.(); } catch (_) {}
  }

  function start() {
    generation += 1;
    const ownGeneration = generation;

    taskNames.forEach(name => {
      states[name].state = 'idle';
      states[name].error = null;
      states[name].promise = null;
      states[name].result = null;
    });

    openShellImmediately();

    backgroundPromise = pause(40)
      .then(() => runBackgroundPipeline(ownGeneration))
      .catch(error => console.warn('[Lux Loader] Pipeline em segundo plano interrompido.', error));

    return Promise.resolve(true);
  }

  async function refreshAll(options = {}) {
    generation += 1;
    const ownGeneration = generation;
    const order = ['media', 'games', 'progress', 'vod', 'reading', 'notifications', 'saves'];
    const results = {};

    for (const name of order) {
      if (ownGeneration !== generation || !currentUser?.profile) break;
      results[name] = await run(name, { force: name === 'media' || name === 'games' });
      await pause(30);
    }
    return results;
  }

  function cancel() {
    generation += 1;
    backgroundPromise = null;
    taskNames.forEach(name => {
      states[name].promise = null;
      if (states[name].state === 'loading') states[name].state = 'idle';
    });
  }

  window.LuxLoader = {
    version: VERSION,
    start,
    run,
    refreshAll,
    cancel,
    state: name => name ? { ...states[name], promise: undefined } : snapshot(),
    subscribe(listener) {
      if (typeof listener !== 'function') return () => {};
      listeners.add(listener);
      return () => listeners.delete(listener);
    }
  };

  console.info('[Lux Loader] Coordenador central ativo: interface primeiro, catálogos em sequência no fundo.');
})();
