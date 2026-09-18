(() => {
  'use strict';

  const VERSION = '20260918-https-snapshot-clean1';
  const WORKER_BASE = 'https://lux-playlist-sync.professorsouza-tech.workers.dev';
  const GLOBAL_ACCOUNT = 'admin';
  const MANIFEST_URL = `${WORKER_BASE}/catalogos/${GLOBAL_ACCOUNT}/manifest.json`;

  if (window.__luxHttpsSnapshotModule === VERSION) return;
  window.__luxHttpsSnapshotModule = VERSION;

  let installed = false;
  let loadingPromise = null;
  let activeManifest = null;

  const normalizeText = value => String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\.(mkv|mp4|avi|mov|ts|m3u8?|flv|webm)$/i, '')
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

  const extractStreamId = value => {
    const raw = String(value || '');
    const match = raw.match(/\/(?:live|movie|series)\/[^/]+\/[^/]+\/(\d+)(?:\.[^/?#]+)?(?:[?#]|$)/i);
    return match ? String(match[1]) : '';
  };

  const detectType = (group, url) => {
    const g = String(group || '').toLowerCase();
    const u = String(url || '').toLowerCase();
    if (g.includes('24h') || g.includes('canais') || g.includes('abertos') || (g.includes('tv') && !g.includes('filmes') && !g.includes('series'))) return 'live';
    if (g.includes('serie') || g.includes('séries') || g.includes('temporada') || u.includes('/series/')) return 'series';
    if (g.includes('filme') || g.includes('movie') || g.includes('vod') || g.includes('cinema') || u.endsWith('.mp4') || u.endsWith('.mkv') || u.includes('/movie/')) return 'movies';
    return 'live';
  };

  const parseMirrorM3U = text => {
    const items = [];
    let pending = null;

    for (const rawLine of String(text || '').split(/\r?\n/)) {
      const line = rawLine.trim();
      if (!line) continue;

      if (line.startsWith('#EXTINF:')) {
        const groupMatch = line.match(/group-title="([^"]*)"/i);
        const logoMatch = line.match(/tvg-logo="([^"]*)"/i);
        const commaIdx = line.lastIndexOf(',');
        pending = {
          group: groupMatch?.[1]?.trim() || 'Geral',
          logo: logoMatch?.[1]?.trim() || '',
          name: commaIdx !== -1 ? line.slice(commaIdx + 1).trim() : 'Sem título'
        };
        continue;
      }

      if (line.startsWith('#') || !pending) continue;
      const item = {
        ...pending,
        id: items.length,
        url: line,
        type: detectType(pending.group, line)
      };
      item.isAdult = typeof isAdultContent === 'function' ? isAdultContent(item.group, item.name) : false;
      items.push(item);
      pending = null;
    }

    return items;
  };

  const parseEpisodeMeta = item => {
    if (!item || item.type !== 'series') return null;
    const name = String(item.name || '').trim();
    const patterns = [
      /\bS(?:eason)?\s*0*(\d+)\s*[-_. ]*E(?:pisode)?\s*0*(\d+)\b/i,
      /\bT(?:emporada)?\s*0*(\d+)\s*[-_. ]*E(?:pis[oó]dio)?\s*0*(\d+)\b/i,
      /\b0*(\d{1,2})\s*[xX]\s*0*(\d{1,3})\b/
    ];

    let match = null;
    for (const pattern of patterns) {
      match = name.match(pattern);
      if (match) break;
    }
    if (!match) return null;

    const seasonNum = Number(match[1]);
    const episodeNum = Number(match[2]);
    let seriesName = name.slice(0, match.index).replace(/[\s._\-:|]+$/g, '').trim();
    if (!seriesName) seriesName = name.replace(match[0], ' ').replace(/\s+/g, ' ').trim();
    if (!seriesName || !Number.isFinite(seasonNum) || !Number.isFinite(episodeNum)) return null;
    return { seriesName, seasonNum, episodeNum };
  };

  const groupMirrorSeries = items => {
    const output = [];
    const groups = new Map();

    items.forEach(item => {
      if (item.type !== 'series') {
        output.push(item);
        return;
      }

      const meta = parseEpisodeMeta(item);
      if (!meta) {
        output.push(item);
        return;
      }

      const key = normalizeText(meta.seriesName);
      let series = groups.get(key);
      if (!series) {
        series = {
          ...item,
          id: `mirror-series-${key}`,
          name: meta.seriesName,
          m3uEpisodes: {},
          m3uSeriesName: meta.seriesName
        };
        groups.set(key, series);
        output.push(series);
      }

      const seasonKey = String(meta.seasonNum);
      if (!series.m3uEpisodes[seasonKey]) series.m3uEpisodes[seasonKey] = [];
      series.m3uEpisodes[seasonKey].push({
        ...item,
        seasonNum: meta.seasonNum,
        episodeNum: meta.episodeNum
      });
    });

    groups.forEach(series => {
      Object.values(series.m3uEpisodes).forEach(episodes => {
        episodes.sort((a, b) => Number(a.episodeNum) - Number(b.episodeNum));
      });
    });

    return output;
  };

  const buildSeriesMatcher = groupedSeries => {
    const used = new Set();
    const byName = new Map();
    const byLogo = new Map();

    groupedSeries.forEach(item => {
      const nameKey = normalizeText(item.name);
      if (nameKey) {
        const list = byName.get(nameKey) || [];
        list.push(item);
        byName.set(nameKey, list);
      }
      const logoKey = normalizeAssetUrl(item.logo);
      if (logoKey) {
        const list = byLogo.get(logoKey) || [];
        list.push(item);
        byLogo.set(logoKey, list);
      }
    });

    const firstUnused = list => (list || []).find(item => !used.has(item));

    return official => {
      const coverKey = normalizeAssetUrl(official?.cover || official?.cover_big || official?.backdrop_path?.[0]);
      const coverMatch = coverKey ? firstUnused(byLogo.get(coverKey)) : null;
      if (coverMatch) {
        used.add(coverMatch);
        return coverMatch;
      }

      const nameKey = normalizeText(official?.name);
      const nameMatch = nameKey ? firstUnused(byName.get(nameKey)) : null;
      if (nameMatch) {
        used.add(nameMatch);
        return nameMatch;
      }

      return null;
    };
  };

  const fetchJson = async url => {
    const response = await fetch(url, { cache: 'no-store', credentials: 'omit' });
    if (!response.ok) throw new Error(`HTTP ${response.status} ao carregar dados HTTPS.`);
    return response.json();
  };

  const fetchText = async url => {
    const response = await fetch(url, { cache: 'no-store', credentials: 'omit' });
    if (!response.ok) throw new Error(`HTTP ${response.status} ao carregar lista HTTPS.`);
    return response.text();
  };

  const buildCatalog = payload => {
    const rawM3u = parseMirrorM3U(payload.playlistText);
    const groupedM3u = groupMirrorSeries(rawM3u);
    const liveById = new Map();
    const movieById = new Map();

    rawM3u.forEach(item => {
      const streamId = extractStreamId(item.url);
      if (!streamId) return;
      if (item.type === 'live' && !liveById.has(streamId)) liveById.set(streamId, item);
      if (item.type === 'movies' && !movieById.has(streamId)) movieById.set(streamId, item);
    });

    const seriesMirror = groupedM3u.filter(item => item.type === 'series' && item.m3uEpisodes);
    const matchSeries = buildSeriesMatcher(seriesMirror);

    const liveCatMap = Object.fromEntries(payload.liveCategories.map(item => [String(item.category_id), item.category_name]));
    const movieCatMap = Object.fromEntries(payload.movieCategories.map(item => [String(item.category_id), item.category_name]));
    const seriesCatMap = Object.fromEntries(payload.seriesCategories.map(item => [String(item.category_id), item.category_name]));

    const items = [];
    let matchedLive = 0;
    let matchedMovies = 0;
    let matchedSeries = 0;

    payload.live.forEach(item => {
      const streamId = String(item.stream_id ?? '');
      const mirror = liveById.get(streamId);
      if (mirror) matchedLive++;
      const group = liveCatMap[String(item.category_id)] || 'Canais';
      const name = item.name || mirror?.name || 'Sem título';
      items.push({
        ...item,
        id: `https-live-${streamId || items.length}`,
        name,
        group,
        logo: item.stream_icon || mirror?.logo || '',
        url: mirror?.url || item.direct_source || '',
        type: 'live',
        source: 'https-snapshot',
        isAdult: (typeof isAdultContent === 'function' && isAdultContent(group, name)) || item.adult === true || String(item.is_adult || '') === '1'
      });
    });

    payload.movies.forEach(item => {
      const streamId = String(item.stream_id ?? '');
      const mirror = movieById.get(streamId);
      if (mirror) matchedMovies++;
      const group = movieCatMap[String(item.category_id)] || 'Filmes';
      const name = item.name || mirror?.name || 'Sem título';
      items.push({
        ...item,
        id: `https-movie-${streamId || items.length}`,
        name,
        group,
        logo: item.stream_icon || mirror?.logo || '',
        url: mirror?.url || item.direct_source || '',
        type: 'movies',
        source: 'https-snapshot',
        isAdult: (typeof isAdultContent === 'function' && isAdultContent(group, name)) || item.adult === true || String(item.is_adult || '') === '1'
      });
    });

    payload.series.forEach(item => {
      const mirror = matchSeries(item);
      if (mirror) matchedSeries++;
      const group = seriesCatMap[String(item.category_id)] || 'Séries';
      const name = item.name || mirror?.name || 'Sem título';
      items.push({
        ...item,
        id: `https-series-${item.series_id ?? items.length}`,
        name,
        group,
        logo: item.cover || mirror?.logo || '',
        type: 'series',
        source: 'https-snapshot',
        m3uEpisodes: mirror?.m3uEpisodes || null,
        m3uSeriesName: mirror?.name || '',
        isAdult: (typeof isAdultContent === 'function' && isAdultContent(group, name)) || item.adult === true || String(item.is_adult || '') === '1'
      });
    });

    return {
      items,
      stats: {
        playlistItems: rawM3u.length,
        live: payload.live.length,
        movies: payload.movies.length,
        series: payload.series.length,
        matchedLive,
        matchedMovies,
        matchedSeries
      }
    };
  };

  const loadSnapshot = async () => {
    if (loadingPromise) return loadingPromise;

    loadingPromise = (async () => {
      const started = performance.now();
      window.LuxDevkit?.running?.('IPTV-HTTPS', 'snapshot', 'Carregando snapshot HTTPS global...');

      try {
        const manifest = await fetchJson(MANIFEST_URL);
        const required = ['liveCategories', 'movieCategories', 'seriesCategories', 'live', 'movies', 'series'];
        if (!manifest?.playlist || !manifest?.files) throw new Error('Manifesto HTTPS incompleto.');
        required.forEach(key => {
          if (!manifest.files[key]) throw new Error(`Manifesto HTTPS sem ${key}.`);
        });

        const [playlistText, liveCategories, movieCategories, seriesCategories, live, movies, series] = await Promise.all([
          fetchText(manifest.playlist),
          fetchJson(manifest.files.liveCategories),
          fetchJson(manifest.files.movieCategories),
          fetchJson(manifest.files.seriesCategories),
          fetchJson(manifest.files.live),
          fetchJson(manifest.files.movies),
          fetchJson(manifest.files.series)
        ]);

        const built = buildCatalog({ playlistText, liveCategories, movieCategories, seriesCategories, live, movies, series });
        if (!built.items.length) throw new Error('Snapshot HTTPS vazio.');

        allMediaItems = built.items.filter(item => typeof profileAllowsMedia !== 'function' || profileAllowsMedia(item));
        if (typeof mergeSharedVodsIntoPlayer === 'function') mergeSharedVodsIntoPlayer();
        if (typeof setMediaSourceState === 'function') setMediaSourceState('https-snapshot', 'Snapshot IPTV HTTPS global', built.items.length);

        activeManifest = manifest;
        window.__luxHttpsSnapshotActive = true;
        window.__luxSyncedXtreamActive = false;
        window.__luxHttpsSnapshotStats = built.stats;

        window.LuxDevkit?.success?.('IPTV-HTTPS', 'snapshot', 'Snapshot HTTPS aplicado sem reagrupamento compartilhado', Math.round(performance.now() - started), built.stats);
        return { count: built.items.length, stats: built.stats };
      } catch (error) {
        window.__luxHttpsSnapshotActive = false;
        if (typeof clearMediaSourceState === 'function') clearMediaSourceState();
        window.LuxDevkit?.emit?.({ category: 'IPTV-HTTPS', status: 'error', label: 'snapshot', message: error?.message || 'Falha ao carregar snapshot' });
        throw error;
      }
    })().finally(() => { loadingPromise = null; });

    return loadingPromise;
  };

  const install = () => {
    if (installed) return true;
    if (typeof window.loadMediaSourcesInPriority !== 'function') return false;

    const originalResolve = typeof window.resolveUserCredentials === 'function' ? window.resolveUserCredentials : null;

    window.getMediaSourceCandidates = () => [
      { kind: 'https-snapshot', label: 'Snapshot IPTV HTTPS global', value: MANIFEST_URL }
    ];

    window.loadMediaSourcesInPriority = async () => {
      window.LuxDevkit?.info?.('IPTV', 'ordem-fontes', 'Única fonte ativa: snapshot HTTPS do Cloudflare', {
        candidates: [{ kind: 'https-snapshot', label: 'Snapshot IPTV HTTPS global' }]
      });
      try {
        await loadSnapshot();
        return true;
      } catch (error) {
        console.warn('[Lux IPTV HTTPS] Snapshot indisponível:', error);
        return false;
      }
    };
    window.loadMediaSourcesInPriority.__luxHttpsSnapshot = VERSION;

    window.resolveUserCredentials = user => {
      if (window.__luxHttpsSnapshotActive) return { isXc: false, url: String(activeManifest?.playlist || '') };
      return originalResolve ? originalResolve(user) : { isXc: false, url: '' };
    };

    installed = true;
    window.__luxHttpsSnapshotInstalled = VERSION;
    return true;
  };

  window.LuxHttpsIptv = {
    version: VERSION,
    manifestUrl: MANIFEST_URL,
    reload: loadSnapshot,
    install
  };

  let attempts = 0;
  const timer = setInterval(() => {
    attempts++;
    if (install() || attempts >= 200) clearInterval(timer);
  }, 50);
})();
