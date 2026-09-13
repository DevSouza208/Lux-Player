(() => {
  'use strict';

  const VERSION = '20260913-catalog-playback-url-1';
  if (window.__luxCatalogPlaybackUrlFix === VERSION) return;
  window.__luxCatalogPlaybackUrlFix = VERSION;

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

  const normalizeType = value => {
    const type = String(value || '').toLowerCase();
    if (type === 'movie' || type === 'movies' || type === 'vod') return 'movies';
    if (type === 'live' || type === 'tv') return 'live';
    return type;
  };

  const extractStreamId = value => {
    const raw = String(value || '').trim();
    if (!raw) return '';

    try {
      const parsed = new URL(raw);
      for (const key of ['stream_id', 'stream', 'id']) {
        const candidate = parsed.searchParams.get(key);
        if (/^\d+$/.test(String(candidate || ''))) return String(candidate);
      }

      const parts = parsed.pathname.split('/').filter(Boolean);
      const last = decodeURIComponent(parts.at(-1) || '');
      const match = last.match(/^(\d+)(?:\.[a-z0-9]{1,10})?$/i);
      if (match) return match[1];
    } catch (_) {}

    const clean = raw.split(/[?#]/)[0].replace(/\/+$/, '');
    const last = clean.split('/').filter(Boolean).at(-1) || '';
    const match = last.match(/^(\d+)(?:\.[a-z0-9]{1,10})?$/i);
    return match ? match[1] : '';
  };

  const addToMap = (map, key, item) => {
    if (!key) return;
    const list = map.get(key) || [];
    list.push(item);
    map.set(key, list);
  };

  const getPlaylistUrl = () => {
    const manifestPlaylist = String(window.__luxSyncedXtreamManifest?.playlist || '').trim();
    if (/^https?:\/\//i.test(manifestPlaylist)) return manifestPlaylist;

    const httpsUrl = String(typeof currentUser !== 'undefined' ? currentUser?.m3uHttpsUrl || '' : '').trim();
    if (/^https?:\/\//i.test(httpsUrl)) return httpsUrl;

    return '';
  };

  const loadRawM3uItems = async () => {
    const playlistUrl = getPlaylistUrl();
    if (!playlistUrl || typeof window.parseM3U !== 'function') return [];

    const response = await fetch(playlistUrl, { cache: 'no-store' });
    if (!response.ok) throw new Error(`playlist HTTP ${response.status}`);

    const text = await response.text();
    return window.parseM3U(text).filter(item => item?.url);
  };

  const chooseByName = (matches, item) => {
    if (!matches?.length) return null;
    if (matches.length === 1) return matches[0];

    const logo = normalizeAssetUrl(item?.logo || item?.stream_icon);
    if (logo) {
      const logoMatch = matches.find(candidate => normalizeAssetUrl(candidate?.logo) === logo);
      if (logoMatch) return logoMatch;
    }

    const group = normalizeText(item?.group || item?.category_name);
    if (group) {
      const groupMatch = matches.find(candidate => normalizeText(candidate?.group) === group);
      if (groupMatch) return groupMatch;
    }

    return matches[0];
  };

  const repairPlaybackUrls = async () => {
    if (!window.__luxSyncedXtreamActive) return { repaired: 0, missing: 0 };
    if (typeof allMediaItems === 'undefined' || !Array.isArray(allMediaItems)) return { repaired: 0, missing: 0 };

    let rawItems;
    try {
      rawItems = await loadRawM3uItems();
    } catch (error) {
      console.warn('[Lux Play] Não foi possível ler as URLs do M3U.', error);
      return { repaired: 0, missing: 0 };
    }
    if (!rawItems.length) return { repaired: 0, missing: 0 };

    const byTypeAndId = new Map();
    const byAnyId = new Map();
    const byTypeAndName = new Map();
    const byTypeAndLogo = new Map();

    rawItems.forEach(raw => {
      const type = normalizeType(raw?.type);
      const streamId = extractStreamId(raw?.url);

      if (streamId) addToMap(byAnyId, streamId, raw);
      if (type !== 'live' && type !== 'movies') return;

      if (streamId) addToMap(byTypeAndId, `${type}|${streamId}`, raw);
      addToMap(byTypeAndName, `${type}|${normalizeText(raw?.name)}`, raw);

      const logo = normalizeAssetUrl(raw?.logo);
      if (logo) addToMap(byTypeAndLogo, `${type}|${logo}`, raw);
    });

    let repaired = 0;
    let missing = 0;

    allMediaItems.forEach(item => {
      if (item?.source !== 'synced-xtream') return;

      const type = normalizeType(item?.type);
      if (type !== 'live' && type !== 'movies') return;

      const streamId = String(item?.stream_id ?? '').trim();
      let match = null;

      if (streamId) {
        const typedMatches = byTypeAndId.get(`${type}|${streamId}`) || [];
        if (typedMatches.length) match = typedMatches[0];
      }

      if (!match && streamId) {
        const idMatches = byAnyId.get(streamId) || [];
        if (idMatches.length === 1) match = idMatches[0];
      }

      if (!match) {
        const nameMatches = byTypeAndName.get(`${type}|${normalizeText(item?.name)}`) || [];
        match = chooseByName(nameMatches, item);
      }

      if (!match) {
        const logo = normalizeAssetUrl(item?.logo || item?.stream_icon);
        if (logo) {
          const logoMatches = byTypeAndLogo.get(`${type}|${logo}`) || [];
          if (logoMatches.length === 1) match = logoMatches[0];
        }
      }

      if (match?.url) {
        // O catálogo continua exatamente como está; somente a URL de playback
        // passa a ser a URL real encontrada no M3U do próprio usuário.
        item.url = match.url;
        repaired += 1;
      } else if (!String(item?.url || '').trim()) {
        missing += 1;
      }
    });

    if (window.__luxSyncedXtreamStats) {
      window.__luxSyncedXtreamStats.playbackUrlsFromM3u = repaired;
      window.__luxSyncedXtreamStats.playbackUrlsMissing = missing;
    }

    console.info('[Lux Play] URLs de TV e filmes ligadas ao M3U.', { repaired, missing });
    return { repaired, missing };
  };

  const install = () => {
    if (typeof window.loadMediaSourcesInPriority !== 'function') return false;
    if (!window.__luxSyncedCatalogBridgeInstalled) return false;
    if (window.loadMediaSourcesInPriority.__luxCatalogPlaybackUrlFix === VERSION) return true;

    const originalLoad = window.loadMediaSourcesInPriority;
    const patchedLoad = async function () {
      const result = await originalLoad.apply(this, arguments);
      if (result && window.__luxSyncedXtreamActive) {
        await repairPlaybackUrls();
      }
      return result;
    };

    patchedLoad.__luxCatalogPlaybackUrlFix = VERSION;
    window.loadMediaSourcesInPriority = patchedLoad;
    window.LuxCatalogPlaybackUrls = {
      run: repairPlaybackUrls,
      version: VERSION,
      extractStreamId
    };

    if (window.__luxSyncedXtreamActive) {
      Promise.resolve(repairPlaybackUrls()).catch(() => {});
    }

    return true;
  };

  if (!install()) {
    let attempts = 0;
    const timer = setInterval(() => {
      attempts += 1;
      if (install() || attempts >= 240) clearInterval(timer);
    }, 50);
  }
})();
