(() => {
  'use strict';

  const VERSION = '20260913-user-snapshot-loader1';
  const LEGACY_SYNCED_VERSION = '20260913-provider-metadata2';
  const WORKER_BASE = 'https://lux-playlist-sync.professorsouza-tech.workers.dev';
  let installing = false;

  const usernameOf = () => {
    try { return String(currentUser?.user || currentUser?.usuario || '').trim(); }
    catch (_) { return ''; }
  };

  const currentHttpsUrl = () => {
    try { return String(currentUser?.m3uHttpsUrl || '').trim(); }
    catch (_) { return ''; }
  };

  const currentOriginalUrl = () => {
    try { return String(currentUser?.m3uUrl || '').trim(); }
    catch (_) { return ''; }
  };

  const fetchJson = async url => {
    const response = await fetch(url, { cache: 'no-store' });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return response.json();
  };

  const fetchText = async url => {
    const response = await fetch(url, { cache: 'no-store' });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return response.text();
  };

  async function resolvePublishedSource() {
    const username = usernameOf();
    if (!username) throw new Error('Usuário ainda não disponível.');

    const stableManifestUrl = `${WORKER_BASE}/catalogos/${encodeURIComponent(username)}/manifest.json`;
    try {
      const manifest = await fetchJson(`${stableManifestUrl}?t=${Date.now()}`);
      const playlist = String(manifest?.playlist || '').trim();
      if (/^https:\/\//i.test(playlist)) {
        return { playlist, manifest, manifestUrl: stableManifestUrl, mode: 'snapshot' };
      }
    } catch (_) {
      // Enquanto o servidor ainda prepara a primeira geração, a lista HTTPS antiga continua válida.
    }

    const existing = currentHttpsUrl();
    if (/^https:\/\//i.test(existing)) {
      return { playlist: existing, manifest: null, manifestUrl: '', mode: 'legacy-https' };
    }

    const original = currentOriginalUrl();
    if (/^https:\/\//i.test(original)) {
      return { playlist: original, manifest: null, manifestUrl: '', mode: 'original-https' };
    }

    throw new Error('Ainda não há uma lista HTTPS publicada para esta conta.');
  }

  function normalizeItems(playlistText) {
    const raw = parseM3U(playlistText);
    const grouped = groupM3uSeriesEpisodes(raw);
    const sourceItems = Array.isArray(grouped) && grouped.length ? grouped : raw;

    return sourceItems.map((item, index) => ({
      ...item,
      id: index,
      source: 'user-https-snapshot',
      providerGroup: item?.group || ''
    }));
  }

  async function loadPublishedSnapshot() {
    if (window.luxElectron) throw new Error('Electron usa o carregador local.');
    if (typeof parseM3U !== 'function' || typeof groupM3uSeriesEpisodes !== 'function') {
      throw new Error('Parser da lista ainda não está pronto.');
    }

    const splash = document.getElementById('splashStatusMessage');
    if (splash) splash.innerText = 'Carregando sua lista HTTPS...';

    const source = await resolvePublishedSource();
    const playlistText = await fetchText(source.playlist);
    const parsed = normalizeItems(playlistText);
    if (!parsed.length) throw new Error('A lista HTTPS não retornou conteúdos.');

    allMediaItems = typeof profileAllowsMedia === 'function'
      ? parsed.filter(profileAllowsMedia)
      : parsed;

    try { mergeSharedVodsIntoPlayer(); } catch (_) {}
    try { if (currentUser) currentUser.m3uHttpsUrl = source.playlist; } catch (_) {}

    window.__luxSyncedXtreamActive = true;
    window.__luxUserSnapshotActive = source.mode === 'snapshot';
    window.__luxProviderCatalogActive = false;
    window.__luxIndividualPlaylistUrl = source.playlist;
    window.__luxSyncedXtreamManifest = source.manifest;
    window.__luxSyncedXtreamManifestUrl = source.manifestUrl;
    window.__luxSyncedXtreamStats = {
      rawM3u: parsed.length,
      available: allMediaItems.length,
      mode: source.mode
    };

    window.dispatchEvent(new CustomEvent('lux:media-updated', {
      detail: {
        source: 'user-https-snapshot',
        count: allMediaItems.length,
        version: source.manifest?.version || ''
      }
    }));
    window.dispatchEvent(new CustomEvent('lux:playlist-updated', {
      detail: {
        source: 'user-https-snapshot',
        url: source.playlist,
        version: source.manifest?.version || ''
      }
    }));

    console.info('[Lux Snapshot] Lista HTTPS aplicada sem reconciliação global.', {
      mode: source.mode,
      count: allMediaItems.length,
      playlist: source.playlist
    });

    return {
      count: allMediaItems.length,
      playlistUrl: source.playlist,
      manifest: source.manifest,
      mode: source.mode
    };
  }

  function installSeriesCompatibility() {
    const credentials = window.resolveUserCredentials;
    if (typeof credentials === 'function' && !credentials.__luxUserSnapshotCredentials) {
      const baseCredentials = credentials.__luxBaseCredentials || credentials;
      const patched = function(user) {
        if (!window.luxElectron && window.__luxPreferSnapshotSeriesEpisodes) {
          return { isXc: false, url: String(user?.m3uHttpsUrl || user?.m3uUrl || '') };
        }
        return baseCredentials.apply(this, arguments);
      };
      patched.__luxBaseCredentials = baseCredentials;
      patched.__luxUserSnapshotCredentials = true;
      window.resolveUserCredentials = patched;
    }

    const openSeries = window.openSeriesModal;
    if (typeof openSeries === 'function' && !openSeries.__luxUserSnapshotSeries) {
      const baseOpenSeries = openSeries.__luxBaseOpenSeries || openSeries;
      const patched = async function(series) {
        const useM3uEpisodes = !window.luxElectron &&
          String(series?.source || '') === 'user-https-snapshot' &&
          Array.isArray(series?.m3uEpisodes);

        if (!useM3uEpisodes) return baseOpenSeries.apply(this, arguments);

        window.__luxPreferSnapshotSeriesEpisodes = true;
        try {
          return await baseOpenSeries.apply(this, arguments);
        } finally {
          window.__luxPreferSnapshotSeriesEpisodes = false;
        }
      };
      patched.__luxBaseOpenSeries = baseOpenSeries;
      patched.__luxUserSnapshotSeries = true;
      window.openSeriesModal = patched;
    }
  }

  function installLoader() {
    if (installing || typeof window.loadMediaSourcesInPriority !== 'function') return false;
    installing = true;
    try {
      const current = window.loadMediaSourcesInPriority;
      if (!current.__luxUserSnapshotLoader) {
        const baseLoader = current.__luxBaseLoader || current;
        const patched = async function() {
          if (!window.luxElectron) {
            try {
              const result = await loadPublishedSnapshot();
              try {
                setMediaSourceState('user-https-snapshot', 'Lista HTTPS individual', result.count);
              } catch (_) {}
              return true;
            } catch (error) {
              console.warn('[Lux Snapshot] Snapshot indisponível; usando carregador normal.', error);
            }
          }
          return baseLoader.apply(this, arguments);
        };

        patched.__luxBaseLoader = baseLoader;
        patched.__luxUserSnapshotLoader = true;
        window.loadMediaSourcesInPriority = patched;
      }

      window.__luxSyncedCatalogBridgeInstalled = LEGACY_SYNCED_VERSION;
      window.LuxSyncedCatalog = {
        reload: loadPublishedSnapshot,
        manifestUrl: () => `${WORKER_BASE}/catalogos/${encodeURIComponent(usernameOf())}/manifest.json`,
        individualPlaylistUrl: currentHttpsUrl,
        version: VERSION
      };

      installSeriesCompatibility();
      window.__luxUserSnapshotLoaderVersion = VERSION;
      return true;
    } finally {
      installing = false;
    }
  }

  let attempts = 0;
  const timer = setInterval(() => {
    attempts += 1;
    const current = window.loadMediaSourcesInPriority;
    const needsInstall = !current?.__luxUserSnapshotLoader ||
      window.LuxSyncedCatalog?.version !== VERSION;
    if (needsInstall) installLoader();
    else installSeriesCompatibility();
    if (attempts >= 240) clearInterval(timer);
  }, 50);

  installLoader();
})();