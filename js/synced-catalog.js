(() => {
  const BRIDGE_VERSION = '20260913-provider-metadata2';
  const WORKER_BASE = 'https://lux-playlist-sync.professorsouza-tech.workers.dev';
  const PROVIDER_MANIFEST_URL = `${WORKER_BASE}/provider/manifest.json`;

  const normalizeText = value => String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\.(mkv|mp4|avi|ts|m3u8?)$/i, '')
    .replace(/\([^)]*\)|\[[^\]]*\]/g, ' ')
    .replace(/\b(dublado|legendado|dual|4k|fhd|uhd|hd|sd|h265|hevc|pt-br)\b/g, ' ')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  const normalizeAssetUrl = value => {
    const raw = String(value || '').trim();
    if (!raw) return '';
    try {
      const url = new URL(raw);
      url.hash = '';
      return `${url.origin}${url.pathname}`.replace(/\/+$/, '').toLowerCase();
    } catch (_) {
      return raw.split('#')[0].split('?')[0].replace(/\/+$/, '').toLowerCase();
    }
  };

  const tokenScore = (a, b) => {
    const aa = new Set(normalizeText(a).split(' ').filter(token => token.length > 1));
    const bb = new Set(normalizeText(b).split(' ').filter(token => token.length > 1));
    if (!aa.size || !bb.size) return 0;
    let common = 0;
    aa.forEach(token => { if (bb.has(token)) common += 1; });
    return common / Math.max(aa.size, bb.size);
  };

  const extractXtreamStreamId = value => {
    const raw = String(value || '');
    const match = raw.match(/\/(?:live|movie|series)\/[^/]+\/[^/]+\/(\d+)(?:\.[^/?#]+)?(?:[?#]|$)/i);
    return match ? String(match[1]) : '';
  };

  const isProviderManifest = manifest => {
    const scope = String(manifest?.scope || '');
    return scope.startsWith('provider') || Number(manifest?.schemaVersion || 0) >= 3;
  };

  const deriveLegacyManifestUrl = () => {
    const httpsUrl = String(currentUser?.m3uHttpsUrl || '').trim();
    if (!/^https:\/\//i.test(httpsUrl)) return '';
    try {
      const url = new URL(httpsUrl);
      const match = url.pathname.match(/^\/listas\/(.+)\.m3u$/i);
      if (!match) return '';
      return `${url.origin}/catalogos/${match[1]}/manifest.json`;
    } catch (_) {
      return '';
    }
  };

  const getIndividualPlaylistUrl = manifest => {
    const synced = String(currentUser?.m3uHttpsUrl || '').trim();
    if (/^https:\/\//i.test(synced)) return synced;

    const original = String(currentUser?.m3uUrl || '').trim();
    if (/^https:\/\//i.test(original)) return original;

    // Apenas manifestos legados por usuário podem fornecer a própria playlist.
    if (!isProviderManifest(manifest)) {
      const legacy = String(manifest?.playlist || '').trim();
      if (/^https:\/\//i.test(legacy)) return legacy;
    }
    return '';
  };

  const fetchJson = async (url, cache = 'no-store') => {
    const response = await fetch(url, { cache });
    if (!response.ok) throw new Error(`HTTP ${response.status} em ${url}`);
    return response.json();
  };

  const fetchText = async (url, cache = 'no-store') => {
    const response = await fetch(url, { cache });
    if (!response.ok) throw new Error(`HTTP ${response.status} em ${url}`);
    return response.text();
  };

  const loadManifest = async () => {
    const candidates = [PROVIDER_MANIFEST_URL, deriveLegacyManifestUrl()].filter(Boolean);
    let lastError = null;
    for (const url of candidates) {
      try {
        const manifest = await fetchJson(url, 'no-store');
        if (!manifest?.files) throw new Error('Manifesto incompleto.');
        return { manifest, url };
      } catch (error) {
        lastError = error;
      }
    }
    throw lastError || new Error('Manifesto HTTPS não disponível.');
  };

  const mapBy = (items, keyFn) => {
    const map = new Map();
    (items || []).forEach(item => {
      const key = keyFn(item);
      if (!key) return;
      const list = map.get(key) || [];
      list.push(item);
      map.set(key, list);
    });
    return map;
  };

  const firstUnused = (items, used) => (items || []).find(item => !used.has(item));

  const buildSeriesMatcher = groupedSeries => {
    const used = new Set();
    const byLogo = mapBy(groupedSeries, item => normalizeAssetUrl(item.logo));
    const byName = mapBy(groupedSeries, item => normalizeText(item.name));
    const byToken = new Map();

    groupedSeries.forEach(item => {
      const token = normalizeText(item.name).split(' ').find(value => value.length > 2);
      if (!token) return;
      const list = byToken.get(token) || [];
      list.push(item);
      byToken.set(token, list);
    });

    const match = official => {
      const coverKey = normalizeAssetUrl(official?.cover || official?.cover_big || official?.backdrop_path?.[0]);
      if (coverKey) {
        const candidate = firstUnused(byLogo.get(coverKey), used);
        if (candidate) { used.add(candidate); return candidate; }
      }

      const nameKey = normalizeText(official?.name);
      if (nameKey) {
        const exact = firstUnused(byName.get(nameKey), used);
        if (exact) { used.add(exact); return exact; }
      }

      const token = nameKey.split(' ').find(value => value.length > 2);
      let best = null;
      let bestScore = 0;
      for (const candidate of token ? (byToken.get(token) || []) : []) {
        if (used.has(candidate)) continue;
        const score = tokenScore(official?.name, candidate?.name);
        if (score > bestScore) { bestScore = score; best = candidate; }
      }
      if (best && bestScore >= 0.72) {
        used.add(best);
        return best;
      }
      return null;
    };

    match.used = used;
    return match;
  };

  const buildCatalogItems = ({ playlistText, liveCategories, movieCategories, seriesCategories, live, movies, series }) => {
    const rawM3uItems = parseM3U(playlistText);
    const groupedM3u = groupM3uSeriesEpisodes(rawM3uItems);

    const rawLiveById = new Map();
    const rawMoviesById = new Map();
    rawM3uItems.forEach(item => {
      const streamId = extractXtreamStreamId(item.url);
      if (!streamId) return;
      if (item.type === 'live' && !rawLiveById.has(streamId)) rawLiveById.set(streamId, item);
      if (item.type === 'movies' && !rawMoviesById.has(streamId)) rawMoviesById.set(streamId, item);
    });

    const groupedSeries = groupedM3u.filter(item => item?.type === 'series' && item?.m3uEpisodes);
    const matchSeries = buildSeriesMatcher(groupedSeries);
    const liveCatMap = Object.fromEntries((liveCategories || []).map(item => [String(item.category_id), String(item.category_name || '').trim()]));
    const movieCatMap = Object.fromEntries((movieCategories || []).map(item => [String(item.category_id), String(item.category_name || '').trim()]));
    const seriesCatMap = Object.fromEntries((seriesCategories || []).map(item => [String(item.category_id), String(item.category_name || '').trim()]));

    const parsedItems = [];
    const matchedLiveIds = new Set();
    const matchedMovieIds = new Set();
    let matchedSeries = 0;

    // Metadados são globais, mas a existência e a URL de reprodução vêm SEMPRE da M3U individual.
    (live || []).forEach(item => {
      const streamId = String(item.stream_id ?? '');
      const m3u = rawLiveById.get(streamId);
      if (!m3u?.url) return;
      matchedLiveIds.add(streamId);
      const groupName = liveCatMap[String(item.category_id)] || m3u.group || 'Canais';
      parsedItems.push({
        ...item,
        id: parsedItems.length,
        stream_id: item.stream_id,
        category_id: item.category_id,
        name: item.name || m3u.name || 'Sem título',
        group: groupName,
        providerGroup: groupName,
        logo: item.stream_icon || m3u.logo || '',
        url: m3u.url,
        type: 'live',
        source: 'provider-metadata+user-m3u',
        isAdult: isAdultContent(groupName, item.name || m3u.name) || item.adult === true || String(item.is_adult || '') === '1'
      });
    });

    (movies || []).forEach(item => {
      const streamId = String(item.stream_id ?? '');
      const m3u = rawMoviesById.get(streamId);
      if (!m3u?.url) return;
      matchedMovieIds.add(streamId);
      const groupName = movieCatMap[String(item.category_id)] || m3u.group || 'Filmes';
      parsedItems.push({
        ...item,
        id: parsedItems.length,
        stream_id: item.stream_id,
        category_id: item.category_id,
        name: item.name || m3u.name || 'Sem título',
        group: groupName,
        providerGroup: groupName,
        logo: item.stream_icon || m3u.logo || '',
        url: m3u.url,
        type: 'movies',
        source: 'provider-metadata+user-m3u',
        isAdult: isAdultContent(groupName, item.name || m3u.name) || item.adult === true || String(item.is_adult || '') === '1'
      });
    });

    (series || []).forEach(item => {
      const m3uSeries = matchSeries(item);
      if (!m3uSeries?.m3uEpisodes) return;
      matchedSeries += 1;
      const groupName = seriesCatMap[String(item.category_id)] || m3uSeries.group || 'Séries';
      parsedItems.push({
        ...item,
        id: parsedItems.length,
        series_id: item.series_id,
        category_id: item.category_id,
        name: item.name || m3uSeries.name || 'Sem título',
        group: groupName,
        providerGroup: groupName,
        logo: item.cover || m3uSeries.logo || '',
        type: 'series',
        source: 'provider-metadata+user-m3u',
        m3uEpisodes: m3uSeries.m3uEpisodes,
        m3uSeriesName: m3uSeries.name || '',
        isAdult: isAdultContent(groupName, item.name || m3uSeries.name) || item.adult === true || String(item.is_adult || '') === '1'
      });
    });

    // Se a API global ainda não conhece um item recém-chegado, mantém o item da M3U individual.
    rawM3uItems.forEach(item => {
      const streamId = extractXtreamStreamId(item.url);
      if (item.type === 'live' && streamId && !matchedLiveIds.has(streamId)) {
        parsedItems.push({ ...item, id: parsedItems.length, source: 'user-m3u-fallback', providerGroup: item.group || '' });
      }
      if (item.type === 'movies' && streamId && !matchedMovieIds.has(streamId)) {
        parsedItems.push({ ...item, id: parsedItems.length, source: 'user-m3u-fallback', providerGroup: item.group || '' });
      }
    });

    groupedSeries.forEach(item => {
      if (item?.type !== 'series' || !item?.m3uEpisodes || matchSeries.used.has(item)) return;
      parsedItems.push({ ...item, id: parsedItems.length, source: 'user-m3u-fallback', providerGroup: item.group || '' });
    });

    return {
      items: parsedItems,
      stats: {
        rawM3u: rawM3uItems.length,
        groupedM3u: groupedM3u.length,
        available: parsedItems.length,
        matchedLive: matchedLiveIds.size,
        matchedMovies: matchedMovieIds.size,
        matchedSeries,
        providerLive: (live || []).length,
        providerMovies: (movies || []).length,
        providerSeries: (series || []).length,
        liveCategories: (liveCategories || []).length,
        movieCategories: (movieCategories || []).length,
        seriesCategories: (seriesCategories || []).length
      }
    };
  };

  const loadSyncedCatalog = async () => {
    const splash = document.getElementById('splashStatusMessage');
    if (splash) splash.innerText = 'Preparando sua lista com os dados oficiais do provedor...';

    const { manifest, url: manifestUrl } = await loadManifest();
    const playlistUrl = getIndividualPlaylistUrl(manifest);
    if (!playlistUrl) throw new Error('A lista HTTPS individual desta conta ainda não está disponível.');

    const providerTruth = isProviderManifest(manifest);
    const metadataCache = providerTruth ? 'force-cache' : 'no-store';

    const [
      playlistText,
      liveCategories,
      movieCategories,
      seriesCategories,
      live,
      movies,
      series
    ] = await Promise.all([
      fetchText(playlistUrl, 'no-store'),
      fetchJson(manifest.files.liveCategories, metadataCache),
      fetchJson(manifest.files.movieCategories, metadataCache),
      fetchJson(manifest.files.seriesCategories, metadataCache),
      fetchJson(manifest.files.live, metadataCache),
      fetchJson(manifest.files.movies, metadataCache),
      fetchJson(manifest.files.series, metadataCache)
    ]);

    const built = buildCatalogItems({
      playlistText,
      liveCategories,
      movieCategories,
      seriesCategories,
      live,
      movies,
      series
    });
    if (!built.items.length) throw new Error('Sua lista não retornou itens utilizáveis com o catálogo do provedor.');

    allMediaItems = (providerTruth
      ? built.items
      : built.items.map(item => applySharedCategoryToItem(item)))
      .filter(profileAllowsMedia);

    mergeSharedVodsIntoPlayer();

    window.__luxSyncedXtreamActive = true;
    window.__luxProviderCatalogActive = providerTruth;
    window.__luxSyncedXtreamManifest = manifest;
    window.__luxSyncedXtreamManifestUrl = manifestUrl;
    window.__luxIndividualPlaylistUrl = playlistUrl;
    window.__luxSyncedXtreamStats = built.stats;

    window.dispatchEvent(new CustomEvent('lux:media-updated', {
      detail: { source: providerTruth ? 'provider-metadata+user-m3u' : 'legacy-synced-catalog', count: allMediaItems.length, version: manifest.version }
    }));
    window.dispatchEvent(new CustomEvent('lux:playlist-updated', {
      detail: { source: 'user-m3u', url: playlistUrl, version: manifest.version }
    }));

    console.info('[Lux Play] Metadados globais + M3U individual carregados.', {
      manifest: manifest.version,
      playlist: playlistUrl,
      providerTruth,
      ...built.stats
    });
    return { count: built.items.length, stats: built.stats, manifest, providerTruth, playlistUrl };
  };

  window.LuxSyncedCatalog = {
    reload: loadSyncedCatalog,
    manifestUrl: () => PROVIDER_MANIFEST_URL,
    legacyManifestUrl: deriveLegacyManifestUrl,
    individualPlaylistUrl: () => getIndividualPlaylistUrl(window.__luxSyncedXtreamManifest),
    version: BRIDGE_VERSION
  };

  const install = () => {
    if (window.__luxSyncedCatalogBridgeInstalled === BRIDGE_VERSION) return true;
    if (typeof window.loadMediaSourcesInPriority !== 'function') return false;
    if (typeof window.parseM3U !== 'function' || typeof window.groupM3uSeriesEpisodes !== 'function') return false;
    if (typeof profileAllowsMedia !== 'function') return false;

    const originalLoadMediaSourcesInPriority = window.loadMediaSourcesInPriority;
    const originalResolveUserCredentials = window.resolveUserCredentials;
    const originalOpenSeriesModal = window.openSeriesModal;
    const baseLoader = originalLoadMediaSourcesInPriority.__luxBaseLoader || originalLoadMediaSourcesInPriority;

    const providerLoader = async function () {
      if (!window.luxElectron) {
        try {
          const result = await loadSyncedCatalog();
          setMediaSourceState('provider-metadata+user-m3u', 'Lista individual + catálogo oficial', result.count);
          return true;
        } catch (error) {
          window.__luxSyncedXtreamActive = false;
          window.__luxProviderCatalogActive = false;
          console.warn('[Lux Play] Catálogo mestre indisponível; usando fallback atual.', error);
        }
      }
      return baseLoader.apply(this, arguments);
    };
    providerLoader.__luxBaseLoader = baseLoader;
    window.loadMediaSourcesInPriority = providerLoader;

    if (typeof originalResolveUserCredentials === 'function' && !originalResolveUserCredentials.__luxProviderMetadataCredentials) {
      const baseCredentials = originalResolveUserCredentials.__luxBaseCredentials || originalResolveUserCredentials;
      const patchedCredentials = function (user) {
        if (!window.luxElectron && window.__luxPreferSyncedSeriesEpisodes) {
          return { isXc: false, url: String(user?.m3uHttpsUrl || user?.m3uUrl || '') };
        }
        return baseCredentials.apply(this, arguments);
      };
      patchedCredentials.__luxBaseCredentials = baseCredentials;
      patchedCredentials.__luxProviderMetadataCredentials = true;
      window.resolveUserCredentials = patchedCredentials;
    }

    if (typeof originalOpenSeriesModal === 'function' && !originalOpenSeriesModal.__luxProviderMetadataSeries) {
      const baseOpenSeries = originalOpenSeriesModal.__luxBaseOpenSeries || originalOpenSeriesModal;
      const patchedOpenSeries = async function (series) {
        const useSyncedSeries = !window.luxElectron && window.__luxSyncedXtreamActive && /(?:provider|synced|user-m3u)/.test(String(series?.source || ''));
        if (!useSyncedSeries) return baseOpenSeries.apply(this, arguments);
        window.__luxPreferSyncedSeriesEpisodes = true;
        try {
          return await baseOpenSeries.apply(this, arguments);
        } finally {
          window.__luxPreferSyncedSeriesEpisodes = false;
        }
      };
      patchedOpenSeries.__luxBaseOpenSeries = baseOpenSeries;
      patchedOpenSeries.__luxProviderMetadataSeries = true;
      window.openSeriesModal = patchedOpenSeries;
    }

    window.__luxSyncedCatalogBridgeInstalled = BRIDGE_VERSION;
    return true;
  };

  if (!install()) {
    let attempts = 0;
    const timer = setInterval(() => {
      attempts += 1;
      if (install() || attempts >= 160) clearInterval(timer);
    }, 50);
  }
})();

(() => {
  const WORKER_BASE = 'https://lux-playlist-sync.professorsouza-tech.workers.dev';
  let syncBusy = false;

  const getStatus = () => document.getElementById('adminPlaylistCatalogSyncStatus');
  const getButton = () => document.getElementById('adminPlaylistCatalogSyncButton');

  const setStatus = (message, kind = 'normal') => {
    const status = getStatus();
    if (!status) return;
    status.textContent = message;
    status.className = 'mt-2 min-h-[18px] text-[11px] ' + (
      kind === 'ok' ? 'text-emerald-300' :
      kind === 'error' ? 'text-rose-300' :
      'text-purple-300'
    );
  };

  const installAdminSyncButton = () => {
    if (document.getElementById('adminPlaylistCatalogSyncButton')) return true;
    const categoryButton = document.getElementById('adminCategorySyncButton');
    if (!categoryButton?.parentElement) return false;

    const button = document.createElement('button');
    button.id = 'adminPlaylistCatalogSyncButton';
    button.type = 'button';
    button.className = 'flex-1 bg-fuchsia-600 hover:bg-fuchsia-500 text-white font-bold py-2.5 rounded-xl text-xs transition-all disabled:opacity-50';
    button.textContent = 'Atualizar dados do provedor';
    button.addEventListener('click', () => window.adminSyncPlaylistCatalog?.());
    categoryButton.parentElement.appendChild(button);

    const status = document.createElement('p');
    status.id = 'adminPlaylistCatalogSyncStatus';
    status.className = 'mt-2 min-h-[18px] text-[11px] text-purple-300';
    status.setAttribute('role', 'status');

    const categoryStatus = document.getElementById('adminCategorySyncStatus');
    if (categoryStatus) categoryStatus.insertAdjacentElement('afterend', status);
    else categoryButton.parentElement.insertAdjacentElement('afterend', status);
    return true;
  };

  window.adminSyncPlaylistCatalog = async function () {
    if (syncBusy) return;
    const isAdmin = String(currentUser?.accountRole || currentUser?.role || '').toLowerCase() === 'admin';
    if (!isAdmin) {
      setStatus('Apenas o administrador pode atualizar os dados do provedor.', 'error');
      return;
    }

    const username = String(currentUser?.user || '').trim();
    const password = String(currentUser?.pass || '');
    if (!username || !password) {
      setStatus('Faça login novamente antes de atualizar.', 'error');
      return;
    }

    const button = getButton();
    syncBusy = true;
    if (button) {
      button.disabled = true;
      button.textContent = 'Atualizando dados...';
    }
    setStatus('Baixando categorias, nomes e catálogo oficial do provedor...');

    try {
      const response = await fetch(`${WORKER_BASE}/sync-provider`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password })
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || !data?.ok) {
        throw new Error(data?.error || `Worker respondeu HTTP ${response.status}`);
      }

      setStatus('Dados do provedor atualizados. Reaplicando na sua lista...');
      const result = await window.LuxSyncedCatalog?.reload?.();
      if (!result?.count) throw new Error('Os dados atualizaram, mas o catálogo não pôde ser aplicado à sua lista.');

      if (typeof window.setSection === 'function') window.setSection(currentSection || 'home');
      setStatus(`Dados oficiais atualizados · ${result.count} itens disponíveis nesta conta.`, 'ok');
    } catch (error) {
      setStatus(error?.message || 'Não foi possível atualizar os dados do provedor.', 'error');
    } finally {
      syncBusy = false;
      if (button) {
        button.disabled = false;
        button.textContent = 'Atualizar dados do provedor';
      }
    }
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', installAdminSyncButton, { once: true });
  } else {
    installAdminSyncButton();
  }

  let attempts = 0;
  const timer = setInterval(() => {
    attempts += 1;
    if (installAdminSyncButton() || attempts >= 120) clearInterval(timer);
  }, 100);
})();
