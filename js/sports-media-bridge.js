(() => {
  'use strict';
  const VERSION = '20260913-bridge3';
  if (window.__luxSportsMediaBridgeInstalled === VERSION) return;
  window.__luxSportsMediaBridgeInstalled = VERSION;

  const WORKER_BASE = 'https://lux-playlist-sync.professorsouza-tech.workers.dev';
  const PROVIDER_MANIFEST_URL = `${WORKER_BASE}/provider/manifest.json`;

  let lastSignature = '';
  let timer = null;
  let providerTimer = null;
  let metadataVersion = '';
  let metadataPromise = null;
  let reconciling = false;
  let reloadInFlight = false;

  const norm = value => String(value || '').trim();
  const normalizeName = value => String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\.(m3u8?|ts|mp4|mkv|avi)$/i, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  const normalizeLogo = value => {
    const raw = String(value || '').trim();
    if (!raw) return '';
    try {
      const url = new URL(raw);
      return `${url.origin}${url.pathname}`.replace(/\/+$/, '').toLowerCase();
    } catch (_) {
      return raw.split(/[?#]/)[0].replace(/\/+$/, '').toLowerCase();
    }
  };

  function mediaItems() {
    try { return Array.isArray(allMediaItems) ? allMediaItems : []; }
    catch (_) { return []; }
  }

  function guideItems() {
    try {
      if (window.LuxSports?.guideItems) return window.LuxSports.guideItems() || [];
      return mediaItems().filter(item => {
        const group = String(item?.group || '');
        return item?.type === 'live' && item?.url && /(guia\s+de\s+jogos|jogos\s+do\s+dia)/i.test(group);
      });
    } catch (_) {
      return [];
    }
  }

  function signature(items) {
    if (!items.length) return '0';
    return items.map(item => `${norm(item.name)}|${norm(item.url)}|${norm(item.logo)}|${norm(item.group)}`).join('\n');
  }

  function syncSports(force = false) {
    if (document.hidden && !force) return false;
    const items = guideItems();
    const next = signature(items);
    if (!force && next === lastSignature) return false;
    lastSignature = next;
    try { window.LuxSports?.refresh?.(); } catch (_) {}
    return true;
  }

  function extractStreamId(value) {
    const raw = String(value || '').trim();
    if (!raw) return '';

    try {
      const url = new URL(raw);
      for (const key of ['stream_id', 'streamId', 'id']) {
        const candidate = url.searchParams.get(key);
        if (/^\d+$/.test(String(candidate || ''))) return String(candidate);
      }

      const path = decodeURIComponent(url.pathname || '');
      let match = path.match(/\/(?:live|movie|series)\/[^/]+\/[^/]+\/(\d+)(?:\.[^/?#]+)?\/?$/i);
      if (match) return match[1];

      match = path.match(/\/(\d+)(?:\.(?:ts|m3u8?|mp4|mkv|avi))?\/?$/i);
      if (match) return match[1];
    } catch (_) {}

    const match = raw.match(/\/(\d+)(?:\.(?:ts|m3u8?|mp4|mkv|avi))?(?:[?#].*)?$/i);
    return match ? match[1] : '';
  }

  function pushIndex(map, key, item) {
    if (!key) return;
    const list = map.get(key) || [];
    list.push(item);
    map.set(key, list);
  }

  function buildIndex(items) {
    const byId = new Map();
    const byName = new Map();
    const byLogo = new Map();
    (items || []).forEach(item => {
      const id = String(item?.stream_id ?? item?.series_id ?? '');
      if (id) byId.set(id, item);
      pushIndex(byName, normalizeName(item?.name), item);
      pushIndex(byLogo, normalizeLogo(item?.stream_icon || item?.cover), item);
    });
    return { byId, byName, byLogo };
  }

  function unique(list) {
    return Array.isArray(list) && list.length === 1 ? list[0] : null;
  }

  function matchOfficial(item, index) {
    const streamId = String(item?.stream_id || extractStreamId(item?.url) || '');
    if (streamId && index.byId.has(streamId)) return { item: index.byId.get(streamId), via: 'id' };

    const nameKey = normalizeName(item?.name);
    const logoKey = normalizeLogo(item?.logo);
    const nameMatches = nameKey ? (index.byName.get(nameKey) || []) : [];

    if (nameMatches.length === 1) return { item: nameMatches[0], via: 'name' };
    if (nameMatches.length > 1 && logoKey) {
      const both = nameMatches.filter(candidate => normalizeLogo(candidate?.stream_icon || candidate?.cover) === logoKey);
      if (both.length === 1) return { item: both[0], via: 'name+logo' };
    }

    const logoMatch = logoKey ? unique(index.byLogo.get(logoKey)) : null;
    return logoMatch ? { item: logoMatch, via: 'logo' } : null;
  }

  async function fetchJson(url, cache = 'force-cache') {
    const response = await fetch(url, { cache });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return response.json();
  }

  async function providerMetadata(manifest) {
    const version = String(manifest?.version || '');
    if (!version || !manifest?.files) throw new Error('Manifesto do provedor incompleto.');
    if (metadataPromise && metadataVersion === version) return metadataPromise;

    metadataVersion = version;
    metadataPromise = Promise.all([
      fetchJson(manifest.files.liveCategories),
      fetchJson(manifest.files.movieCategories),
      fetchJson(manifest.files.live),
      fetchJson(manifest.files.movies)
    ]).then(([liveCategories, movieCategories, live, movies]) => ({
      liveCatMap: Object.fromEntries((liveCategories || []).map(row => [String(row.category_id), String(row.category_name || '').trim()])),
      movieCatMap: Object.fromEntries((movieCategories || []).map(row => [String(row.category_id), String(row.category_name || '').trim()])),
      liveIndex: buildIndex(live),
      movieIndex: buildIndex(movies)
    })).catch(error => {
      metadataPromise = null;
      throw error;
    });

    return metadataPromise;
  }

  async function reconcileProviderCategories(reason = 'manual') {
    if (reconciling) return null;
    const source = mediaItems();
    const manifest = window.__luxSyncedXtreamManifest;
    if (!source.length || !manifest?.files || !String(manifest?.scope || '').startsWith('provider')) return null;

    reconciling = true;
    try {
      const meta = await providerMetadata(manifest);
      let matchedLive = 0;
      let matchedMovies = 0;
      let changed = 0;
      const via = { id: 0, name: 0, logo: 0, 'name+logo': 0 };

      for (const item of source) {
        const type = String(item?.type || '').toLowerCase();
        if (type !== 'live' && type !== 'movies') continue;

        const index = type === 'live' ? meta.liveIndex : meta.movieIndex;
        const categoryMap = type === 'live' ? meta.liveCatMap : meta.movieCatMap;
        const match = matchOfficial(item, index);
        if (!match?.item) continue;

        const official = match.item;
        const groupName = categoryMap[String(official.category_id)] || String(item.group || '');
        const officialName = String(official.name || item.name || '');
        const officialLogo = String(official.stream_icon || item.logo || '');
        const before = `${item.group}|${item.name}|${item.logo}|${item.category_id}`;

        if (groupName) {
          item.group = groupName;
          item.providerGroup = groupName;
          if ('category' in item) item.category = groupName;
          if ('group_title' in item) item.group_title = groupName;
        }
        if (officialName) item.name = officialName;
        if (officialLogo) item.logo = officialLogo;
        item.stream_id = official.stream_id ?? item.stream_id;
        item.category_id = official.category_id ?? item.category_id;
        item.providerMatch = match.via;

        const after = `${item.group}|${item.name}|${item.logo}|${item.category_id}`;
        if (before !== after) changed += 1;
        via[match.via] = (via[match.via] || 0) + 1;
        if (type === 'live') matchedLive += 1;
        else matchedMovies += 1;
      }

      window.__luxProviderCategoryReconcileStats = {
        reason,
        version: manifest.version,
        matchedLive,
        matchedMovies,
        changed,
        via
      };

      if (changed) {
        window.dispatchEvent(new CustomEvent('lux:provider-categories-reconciled', {
          detail: window.__luxProviderCategoryReconcileStats
        }));
        window.dispatchEvent(new CustomEvent('lux:media-updated', {
          detail: { source: 'provider-category-reconcile', count: source.length, version: manifest.version }
        }));
      }

      syncSports(true);
      return window.__luxProviderCategoryReconcileStats;
    } catch (error) {
      console.warn('[Lux Provider Bridge] Não foi possível reconciliar TV/Filmes com os dados oficiais.', error);
      return null;
    } finally {
      reconciling = false;
    }
  }

  function currentAccountHasPlaylist() {
    try {
      return Boolean(currentUser && (/^https?:\/\//i.test(String(currentUser.m3uHttpsUrl || '')) || /^https?:\/\//i.test(String(currentUser.m3uUrl || ''))));
    } catch (_) {
      return false;
    }
  }

  async function checkProviderVersion(force = false) {
    if (reloadInFlight || (!force && document.hidden) || !currentAccountHasPlaylist()) return false;
    try {
      const manifest = await fetchJson(`${PROVIDER_MANIFEST_URL}?t=${Date.now()}`, 'no-store');
      const remoteVersion = String(manifest?.version || '');
      const localVersion = String(window.__luxSyncedXtreamManifest?.version || '');
      if (!remoteVersion || !localVersion || remoteVersion === localVersion) return false;
      if (!window.LuxSyncedCatalog?.reload) return false;

      reloadInFlight = true;
      console.info('[Lux Provider Bridge] Novo catálogo global detectado. Atualizando esta sessão.', { localVersion, remoteVersion });
      await window.LuxSyncedCatalog.reload();
      await reconcileProviderCategories('manifest-changed');
      try { if (typeof setSection === 'function') setSection(currentSection || 'home'); } catch (_) {}
      return true;
    } catch (error) {
      console.warn('[Lux Provider Bridge] Verificação do catálogo global indisponível.', error);
      return false;
    } finally {
      reloadInFlight = false;
    }
  }

  function installAdminFeedback() {
    const original = window.adminSyncPlaylistCatalog;
    if (typeof original !== 'function' || original.__luxGlobalFeedback) return typeof original === 'function';

    const patched = async function() {
      const result = await original.apply(this, arguments);
      await reconcileProviderCategories('admin-sync');
      const status = document.getElementById('adminPlaylistCatalogSyncStatus');
      if (status && /Dados oficiais atualizados|Catálogo oficial atualizado|Catálogo atualizado/i.test(status.textContent || '')) {
        status.textContent = 'Catálogo global atualizado. Esta conta já foi reaplicada; outras sessões recebem a nova versão automaticamente em até 1 min.';
      }
      return result;
    };
    patched.__luxGlobalFeedback = true;
    window.adminSyncPlaylistCatalog = patched;
    return true;
  }

  function start() {
    syncSports(true);
    reconcileProviderCategories('startup');
    installAdminFeedback();

    timer = setInterval(() => {
      syncSports(false);
      installAdminFeedback();
    }, 2000);

    providerTimer = setInterval(() => checkProviderVersion(false), 60000);

    document.addEventListener('visibilitychange', () => {
      if (!document.hidden) {
        syncSports(false);
        checkProviderVersion(true);
      }
    });

    document.getElementById('navHome')?.addEventListener('click', () => {
      setTimeout(() => syncSports(true), 0);
    });

    window.addEventListener('lux:media-updated', event => {
      if (event?.detail?.source !== 'provider-category-reconcile') reconcileProviderCategories(event?.detail?.source || 'media-updated');
      syncSports(true);
    });
    window.addEventListener('lux:playlist-updated', () => {
      reconcileProviderCategories('playlist-updated');
      syncSports(true);
    });

    window.LuxSportsMediaBridge = {
      refresh: () => syncSports(true),
      reconcile: () => reconcileProviderCategories('manual'),
      checkProvider: () => checkProviderVersion(true),
      signature: () => lastSignature,
      stats: () => window.__luxProviderCategoryReconcileStats || null,
      destroy: () => {
        if (timer) clearInterval(timer);
        if (providerTimer) clearInterval(providerTimer);
      }
    };
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true });
  else start();
})();