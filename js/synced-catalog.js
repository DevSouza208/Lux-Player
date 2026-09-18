(() => {
  const BRIDGE_VERSION = '20260917-catalog-perf-16';

  const devCatalogRun = async (label, job, meta = null) => {
    const started = performance.now();
    window.LuxDevkit?.running('CATALOG', label, 'Iniciando...', meta);
    try {
      const result = await job();
      const duration = Math.round(performance.now() - started);
      window.LuxDevkit?.success('CATALOG', label, 'Concluído', duration, meta);
      return result;
    } catch (error) {
      const duration = Math.round(performance.now() - started);
      window.LuxDevkit?.emit({
        category: 'CATALOG',
        status: 'error',
        label,
        message: error?.message || 'Falha desconhecida',
        durationMs: duration,
        data: meta
      });
      throw error;
    }
  };

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

  const deriveManifestUrl = () => {
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

  const fetchJson = async url => {
    const response = await fetch(url, { cache: 'no-store' });
    if (!response.ok) throw new Error(`HTTP ${response.status} em ${url}`);
    return response.json();
  };

  const fetchText = async url => {
    const response = await fetch(url, { cache: 'no-store' });
    if (!response.ok) throw new Error(`HTTP ${response.status} em ${url}`);
    return response.text();
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
    const metadata = new Map();

    groupedSeries.forEach((item, index) => {
      const normalized = normalizeText(item?.name);
      const tokens = [...new Set(normalized.split(' ').filter(token => token.length > 1))];
      const record = { item, index, tokens: new Set(tokens) };
      metadata.set(item, record);

      tokens.forEach(token => {
        const list = byToken.get(token) || [];
        list.push(record);
        byToken.set(token, list);
      });
    });

    return official => {
      const coverKey = normalizeAssetUrl(official?.cover || official?.cover_big || official?.backdrop_path?.[0]);
      if (coverKey) {
        const byCover = firstUnused(byLogo.get(coverKey), used);
        if (byCover) {
          used.add(byCover);
          return byCover;
        }
      }

      const nameKey = normalizeText(official?.name);
      if (nameKey) {
        const exact = firstUnused(byName.get(nameKey), used);
        if (exact) {
          used.add(exact);
          return exact;
        }
      }

      const officialTokens = [...new Set(nameKey.split(' ').filter(token => token.length > 1))];
      if (!officialTokens.length) return null;

      const officialTokenSet = new Set(officialTokens);
      const candidateRecords = new Set();
      officialTokens.forEach(token => {
        (byToken.get(token) || []).forEach(record => {
          if (!used.has(record.item)) candidateRecords.add(record);
        });
      });

      let best = null;
      let bestScore = 0;
      let bestIndex = Number.POSITIVE_INFINITY;

      candidateRecords.forEach(record => {
        let common = 0;
        officialTokenSet.forEach(token => {
          if (record.tokens.has(token)) common += 1;
        });
        const score = common / Math.max(officialTokenSet.size, record.tokens.size || 1);

        if (score > bestScore || (score === bestScore && record.index < bestIndex)) {
          bestScore = score;
          best = record.item;
          bestIndex = record.index;
        }
      });

      if (best && bestScore >= 0.72) {
        used.add(best);
        return best;
      }
      return null;
    };
  };

  const buildCatalogItems = ({ playlistText, liveCategories, movieCategories, seriesCategories, live, movies, series }) => {
    const parseStarted = performance.now();
    const rawM3uItems = parseM3U(playlistText);
    window.LuxDevkit?.success('CATALOG-BUILD', 'parse-m3u', 'M3U parseada', Math.round(performance.now() - parseStarted), {
      rawItems: rawM3uItems.length,
      bytes: playlistText.length
    });

    const groupingStarted = performance.now();
    const groupedM3u = groupM3uSeriesEpisodes(rawM3uItems);
    window.LuxDevkit?.success('CATALOG-BUILD', 'agrupar-series-m3u', 'Agrupamento concluído', Math.round(performance.now() - groupingStarted), {
      rawItems: rawM3uItems.length,
      groupedItems: groupedM3u.length
    });

    // Reaproveitado pelo Playback Repair e descartado logo depois.
    window.__luxSyncedRawPlaylistItems = rawM3uItems;

    const rawLiveById = new Map();
    const rawMoviesById = new Map();
    const rawByTypeAndName = new Map();
    const rawByTypeAndLogo = new Map();

    const playbackIndexStarted = performance.now();
    let playbackCandidates = 0;

    rawM3uItems.forEach(item => {
      if (item.type !== 'live' && item.type !== 'movies') return;
      playbackCandidates += 1;

      const streamId = extractXtreamStreamId(item.url);
      if (streamId) {
        if (item.type === 'live' && !rawLiveById.has(streamId)) rawLiveById.set(streamId, item);
        if (item.type === 'movies' && !rawMoviesById.has(streamId)) rawMoviesById.set(streamId, item);
      }

      const nameKey = `${item.type}|${normalizeText(item.name)}`;
      const logoKey = `${item.type}|${normalizeAssetUrl(item.logo)}`;

      if (!rawByTypeAndName.has(nameKey)) rawByTypeAndName.set(nameKey, []);
      rawByTypeAndName.get(nameKey).push(item);

      if (logoKey !== `${item.type}|`) {
        if (!rawByTypeAndLogo.has(logoKey)) rawByTypeAndLogo.set(logoKey, []);
        rawByTypeAndLogo.get(logoKey).push(item);
      }
    });

    window.LuxDevkit?.success('CATALOG-BUILD', 'indice-playback', 'Índice de reprodução pronto', Math.round(performance.now() - playbackIndexStarted), {
      candidates: playbackCandidates,
      ids: rawLiveById.size + rawMoviesById.size,
      names: rawByTypeAndName.size,
      logos: rawByTypeAndLogo.size
    });

    const resolvePlaybackItem = (type, official) => {
      const streamId = String(official?.stream_id ?? '').trim();
      let match = type === 'live' ? rawLiveById.get(streamId) : rawMoviesById.get(streamId);

      if (!match) {
        const nameMatches = rawByTypeAndName.get(`${type}|${normalizeText(official?.name)}`) || [];
        if (nameMatches.length === 1) match = nameMatches[0];
        else if (nameMatches.length > 1) {
          const logo = normalizeAssetUrl(official?.stream_icon || official?.logo || official?.cover);
          match = nameMatches.find(candidate => logo && normalizeAssetUrl(candidate.logo) === logo) || nameMatches[0];
        }
      }

      if (!match) {
        const logo = normalizeAssetUrl(official?.stream_icon || official?.logo || official?.cover);
        const logoMatches = logo ? (rawByTypeAndLogo.get(`${type}|${logo}`) || []) : [];
        if (logoMatches.length === 1) match = logoMatches[0];
      }

      return match || null;
    };

    const groupedSeries = groupedM3u.filter(item => item?.type === 'series' && item?.m3uEpisodes);
    const matcherStarted = performance.now();
    const matchSeries = buildSeriesMatcher(groupedSeries);
    window.LuxDevkit?.success('CATALOG-BUILD', 'indice-series', 'Índice de séries pronto', Math.round(performance.now() - matcherStarted), {
      groupedSeries: groupedSeries.length
    });

    const liveCatMap = Object.fromEntries((liveCategories || []).map(item => [String(item.category_id), item.category_name]));
    const movieCatMap = Object.fromEntries((movieCategories || []).map(item => [String(item.category_id), item.category_name]));
    const seriesCatMap = Object.fromEntries((seriesCategories || []).map(item => [String(item.category_id), item.category_name]));

    const parsedItems = [];
    let matchedLive = 0;
    let matchedMovies = 0;
    let matchedSeries = 0;
    let playbackDirectFallbacks = 0;
    let playbackMissing = 0;

    const liveBuildStarted = performance.now();
    (live || []).forEach(item => {
      const m3u = resolvePlaybackItem('live', item);
      if (m3u) matchedLive += 1;
      const direct = String(item.direct_source || item.directSource || '').trim();
      const playbackUrl = m3u?.url || (/^https?:\/\//i.test(direct) ? direct : '');
      if (!m3u && playbackUrl) playbackDirectFallbacks += 1;
      if (!playbackUrl) playbackMissing += 1;

      const groupName = liveCatMap[String(item.category_id)] || 'Canais';
      parsedItems.push({
        ...item,
        id: parsedItems.length,
        stream_id: item.stream_id,
        name: item.name || m3u?.name || 'Sem título',
        group: groupName,
        logo: item.stream_icon || m3u?.logo || '',
        url: playbackUrl,
        type: 'live',
        source: 'synced-xtream',
        isAdult: isAdultContent(groupName, item.name || m3u?.name) || item.adult === true || String(item.is_adult || '') === '1'
      });
    });

    window.LuxDevkit?.success('CATALOG-BUILD', 'montar-tv', 'Canais montados', Math.round(performance.now() - liveBuildStarted), {
      items: (live || []).length
    });

    const movieBuildStarted = performance.now();
    (movies || []).forEach(item => {
      const m3u = resolvePlaybackItem('movies', item);
      if (m3u) matchedMovies += 1;
      const direct = String(item.direct_source || item.directSource || '').trim();
      const playbackUrl = m3u?.url || (/^https?:\/\//i.test(direct) ? direct : '');
      if (!m3u && playbackUrl) playbackDirectFallbacks += 1;
      if (!playbackUrl) playbackMissing += 1;

      const groupName = movieCatMap[String(item.category_id)] || 'Filmes';
      parsedItems.push({
        ...item,
        id: parsedItems.length,
        stream_id: item.stream_id,
        name: item.name || m3u?.name || 'Sem título',
        group: groupName,
        logo: item.stream_icon || m3u?.logo || '',
        url: playbackUrl,
        type: 'movies',
        source: 'synced-xtream',
        isAdult: isAdultContent(groupName, item.name || m3u?.name) || item.adult === true || String(item.is_adult || '') === '1'
      });
    });

    window.LuxDevkit?.success('CATALOG-BUILD', 'montar-filmes', 'Filmes montados', Math.round(performance.now() - movieBuildStarted), {
      items: (movies || []).length
    });

    const seriesBuildStarted = performance.now();
    (series || []).forEach(item => {
      const m3uSeries = matchSeries(item);
      if (m3uSeries) matchedSeries += 1;
      const groupName = seriesCatMap[String(item.category_id)] || 'Séries';
      parsedItems.push({
        ...item,
        id: parsedItems.length,
        series_id: item.series_id,
        name: item.name || m3uSeries?.name || 'Sem título',
        group: groupName,
        logo: item.cover || m3uSeries?.logo || '',
        type: 'series',
        source: 'synced-xtream',
        m3uEpisodes: m3uSeries?.m3uEpisodes || null,
        m3uSeriesName: m3uSeries?.name || '',
        isAdult: isAdultContent(groupName, item.name || m3uSeries?.name) || item.adult === true || String(item.is_adult || '') === '1'
      });
    });

    window.LuxDevkit?.success('CATALOG-BUILD', 'montar-series', 'Séries montadas', Math.round(performance.now() - seriesBuildStarted), {
      items: (series || []).length,
      matchedSeries
    });

    return {
      items: parsedItems,
      stats: {
        rawM3u: rawM3uItems.length,
        groupedM3u: groupedM3u.length,
        official: parsedItems.length,
        matchedLive,
        matchedMovies,
        matchedSeries,
        playbackResolvedDuringBuild: matchedLive + matchedMovies + playbackDirectFallbacks,
        playbackDirectFallbacks,
        playbackMissing,
        officialSeries: (series || []).length
      }
    };
  };

  const loadSyncedCatalog = async () => {
    const manifestUrl = deriveManifestUrl();
    if (!manifestUrl) throw new Error('Manifesto HTTPS não disponível para esta conta.');

    const splash = document.getElementById('splashStatusMessage');
    if (splash) splash.innerText = 'Baixando catálogo HTTPS sincronizado...';

    const manifest = await devCatalogRun('manifesto', () => fetchJson(manifestUrl));
    if (!manifest?.files || !manifest?.playlist) throw new Error('Manifesto do catálogo está incompleto.');

    const [
      playlistText,
      liveCategories,
      movieCategories,
      seriesCategories,
      live,
      movies,
      series
    ] = await Promise.all([
      devCatalogRun('playlist-https', () => fetchText(manifest.playlist)),
      devCatalogRun('categorias-tv', () => fetchJson(manifest.files.liveCategories)),
      devCatalogRun('categorias-filmes', () => fetchJson(manifest.files.movieCategories)),
      devCatalogRun('categorias-series', () => fetchJson(manifest.files.seriesCategories)),
      devCatalogRun('streams-tv', () => fetchJson(manifest.files.live)),
      devCatalogRun('streams-filmes', () => fetchJson(manifest.files.movies)),
      devCatalogRun('streams-series', () => fetchJson(manifest.files.series))
    ]);

    const built = await devCatalogRun('montagem-catalogo', () => buildCatalogItems({
      playlistText,
      liveCategories,
      movieCategories,
      seriesCategories,
      live,
      movies,
      series
    }), {
      live: Array.isArray(live) ? live.length : 0,
      movies: Array.isArray(movies) ? movies.length : 0,
      series: Array.isArray(series) ? series.length : 0
    });

    if (!built.items.length) throw new Error('Catálogo HTTPS não retornou itens utilizáveis.');

    await devCatalogRun('categorias-e-perfil', () => {
      allMediaItems = built.items.map(item => applySharedCategoryToItem(item)).filter(profileAllowsMedia);
      return allMediaItems.length;
    }, { official: built.items.length });

    await devCatalogRun('mesclar-vod', () => mergeSharedVodsIntoPlayer(), {
      currentItems: allMediaItems.length
    });

    window.__luxSyncedXtreamActive = true;
    window.__luxSyncedXtreamManifest = manifest;
    window.__luxSyncedXtreamStats = built.stats;
    window.__luxSyncedPlaybackResolvedDuringBuild = true;

    const rawReuseRef = window.__luxSyncedRawPlaylistItems;
    setTimeout(() => {
      if (window.__luxSyncedRawPlaylistItems === rawReuseRef) {
        window.__luxSyncedRawPlaylistItems = null;
      }
    }, 60000);

    console.info('[Lux Play] Catálogo Xtream HTTPS carregado.', built.stats);
    return { count: built.items.length, stats: built.stats };
  };

  window.LuxSyncedCatalog = {
    reload: loadSyncedCatalog,
    manifestUrl: deriveManifestUrl,
    version: BRIDGE_VERSION
  };

  const install = () => {
    if (window.__luxSyncedCatalogBridgeInstalled) return true;
    if (typeof window.loadMediaSourcesInPriority !== 'function') return false;
    if (typeof window.parseM3U !== 'function' || typeof window.groupM3uSeriesEpisodes !== 'function') return false;
    if (typeof window.applySharedCategoryToItem !== 'function') return false;

    const originalLoadMediaSourcesInPriority = window.loadMediaSourcesInPriority;
    const originalResolveUserCredentials = window.resolveUserCredentials;
    const originalOpenSeriesModal = window.openSeriesModal;

    window.loadMediaSourcesInPriority = async function () {
      if (!window.luxElectron) {
        try {
          const result = await loadSyncedCatalog();
          setMediaSourceState('synced-xtream', 'Catálogo Xtream HTTPS sincronizado', result.count);
          return true;
        } catch (error) {
          window.__luxSyncedXtreamActive = false;
          console.warn('[Lux Play] Catálogo HTTPS indisponível; usando fallback atual.', error);
        }
      }
      return originalLoadMediaSourcesInPriority.apply(this, arguments);
    };

    if (typeof originalResolveUserCredentials === 'function') {
      window.resolveUserCredentials = function (user) {
        if (!window.luxElectron && window.__luxPreferSyncedSeriesEpisodes) {
          return { isXc: false, url: String(user?.m3uHttpsUrl || user?.m3uUrl || '') };
        }
        return originalResolveUserCredentials.apply(this, arguments);
      };
    }

    if (typeof originalOpenSeriesModal === 'function') {
      window.openSeriesModal = async function (series) {
        const useSyncedSeries = !window.luxElectron && window.__luxSyncedXtreamActive && series?.source === 'synced-xtream';
        if (!useSyncedSeries) return originalOpenSeriesModal.apply(this, arguments);

        window.__luxPreferSyncedSeriesEpisodes = true;
        try {
          return await originalOpenSeriesModal.apply(this, arguments);
        } finally {
          window.__luxPreferSyncedSeriesEpisodes = false;
        }
      };
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
    button.textContent = 'Sincronizar catálogo IPTV';
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
      setStatus('Apenas o administrador pode sincronizar o catálogo.', 'error');
      return;
    }

    const username = String(currentUser?.user || '').trim();
    const password = String(currentUser?.pass || '');
    if (!username || !password) {
      setStatus('Faça login novamente antes de sincronizar.', 'error');
      return;
    }

    const button = getButton();
    syncBusy = true;
    if (button) {
      button.disabled = true;
      button.textContent = 'Sincronizando...';
    }
    setStatus('Sincronizando sua M3U + catálogo PHP. Isso pode levar alguns segundos...');

    try {
      const response = await fetch(`${WORKER_BASE}/sync-account`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password })
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || !data?.ok) {
        throw new Error(data?.error || data?.result?.message || `Worker respondeu HTTP ${response.status}`);
      }

      setStatus('Conversão concluída. Recarregando o catálogo HTTPS...');
      if (typeof window.loadMediaSourcesInPriority === 'function') {
        const loaded = await window.loadMediaSourcesInPriority();
        if (!loaded) throw new Error('O catálogo foi convertido, mas o Lux não conseguiu recarregá-lo.');
      }

      if (typeof window.setSection === 'function') window.setSection(currentSection || 'home');
      const stats = window.__luxSyncedXtreamStats;
      const seriesText = Number.isFinite(Number(stats?.officialSeries))
        ? ` · ${stats.officialSeries} séries oficiais`
        : '';
      setStatus(`Catálogo IPTV sincronizado e aplicado${seriesText}.`, 'ok');
    } catch (error) {
      setStatus(error?.message || 'Não foi possível sincronizar o catálogo IPTV.', 'error');
    } finally {
      syncBusy = false;
      if (button) {
        button.disabled = false;
        button.textContent = 'Sincronizar catálogo IPTV';
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
