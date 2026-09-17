(() => {
  'use strict';

  if (window.__luxRuntimeStabilityFixInstalled) return;
  window.__luxRuntimeStabilityFixInstalled = '20260917-stability5-client-ready';

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

  const extractFlexibleStreamId = value => {
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

  const loadRawPlaylistItems = async () => {
    const manifest = window.__luxSyncedXtreamManifest;
    const playlistUrl = String(manifest?.playlist || '').trim();
    if (!playlistUrl || typeof window.parseM3U !== 'function') return [];

    const response = await fetch(playlistUrl, { cache: 'no-store' });
    if (!response.ok) throw new Error(`playlist HTTP ${response.status}`);
    const text = await response.text();
    return window.parseM3U(text).filter(item => item?.url);
  };

  const repairSyncedPlaybackUrls = async () => {
    if (!window.__luxSyncedXtreamActive || typeof allMediaItems === 'undefined' || !Array.isArray(allMediaItems)) return;

    const manifest = window.__luxSyncedXtreamManifest;
    if (manifest?.clientReady === true || Number(manifest?.schemaVersion || 0) >= 4) {
      if (window.__luxSyncedXtreamStats) {
        window.__luxSyncedXtreamStats.playbackRepaired = 0;
        window.__luxSyncedXtreamStats.playbackDirectFallbacks = 0;
        window.__luxSyncedXtreamStats.playbackMissing = 0;
      }
      console.info('[Lux Play] Catálogo HTTPS já contém URLs de reprodução prontas.');
      return;
    }

    const pendingItems = allMediaItems.filter(item => {
      if (item?.source !== 'synced-xtream') return false;
      const type = normalizeType(item.type);
      return (type === 'live' || type === 'movies') && !String(item.url || '').trim();
    });

    if (!pendingItems.length) {
      if (window.__luxSyncedXtreamStats) {
        window.__luxSyncedXtreamStats.playbackRepaired = 0;
        window.__luxSyncedXtreamStats.playbackDirectFallbacks = 0;
        window.__luxSyncedXtreamStats.playbackMissing = 0;
      }
      console.info('[Lux Play] URLs de reprodução já vieram prontas do catálogo HTTPS.');
      return;
    }

    let rawItems;
    try {
      rawItems = await loadRawPlaylistItems();
    } catch (error) {
      console.warn('[Lux Play] Não foi possível validar os endereços de reprodução.', error);
      return;
    }
    if (!rawItems.length) return;

    const byTypeAndId = new Map();
    const byAnyId = new Map();
    const byTypeAndName = new Map();
    const byTypeAndLogo = new Map();

    rawItems.forEach(raw => {
      const type = normalizeType(raw.type);
      const id = extractFlexibleStreamId(raw.url);
      if (id) addToMap(byAnyId, id, raw);
      if (type !== 'live' && type !== 'movies') return;
      if (id && !byTypeAndId.has(`${type}|${id}`)) byTypeAndId.set(`${type}|${id}`, raw);
      addToMap(byTypeAndName, `${type}|${normalizeText(raw.name)}`, raw);
      addToMap(byTypeAndLogo, `${type}|${normalizeAssetUrl(raw.logo)}`, raw);
    });

    let repaired = 0;
    let directFallbacks = 0;
    let stillMissing = 0;

    for (const item of pendingItems) {
      if (item?.source !== 'synced-xtream') continue;
      const type = normalizeType(item.type);
      if (type !== 'live' && type !== 'movies') continue;
      if (String(item.url || '').trim()) continue;

      const streamId = String(item.stream_id ?? '').trim();
      let match = streamId ? byTypeAndId.get(`${type}|${streamId}`) : null;

      if (!match && streamId) {
        const sameId = byAnyId.get(streamId) || [];
        if (sameId.length === 1) match = sameId[0];
      }

      if (!match) {
        const nameMatches = byTypeAndName.get(`${type}|${normalizeText(item.name)}`) || [];
        if (nameMatches.length === 1) match = nameMatches[0];
        else if (nameMatches.length > 1) {
          const logo = normalizeAssetUrl(item.logo || item.stream_icon);
          match = nameMatches.find(candidate => logo && normalizeAssetUrl(candidate.logo) === logo) || nameMatches[0];
        }
      }

      if (!match) {
        const logoMatches = byTypeAndLogo.get(`${type}|${normalizeAssetUrl(item.logo || item.stream_icon)}`) || [];
        if (logoMatches.length === 1) match = logoMatches[0];
      }

      if (match?.url) {
        item.url = match.url;
        repaired += 1;
        continue;
      }

      const direct = String(item.direct_source || item.directSource || '').trim();
      if (/^https?:\/\//i.test(direct)) {
        item.url = direct;
        directFallbacks += 1;
        continue;
      }

      stillMissing += 1;
    }

    if (window.__luxSyncedXtreamStats) {
      window.__luxSyncedXtreamStats.playbackRepaired = repaired;
      window.__luxSyncedXtreamStats.playbackDirectFallbacks = directFallbacks;
      window.__luxSyncedXtreamStats.playbackMissing = stillMissing;
    }

    console.info('[Lux Play] Endereços de reprodução validados.', { repaired, directFallbacks, stillMissing });
  };

  const installCatalogRepair = () => {
    if (window.__luxCatalogPlaybackRepairInstalled) return true;
    if (!window.__luxSyncedCatalogBridgeInstalled || typeof window.loadMediaSourcesInPriority !== 'function') return false;

    const originalLoad = window.loadMediaSourcesInPriority;
    window.loadMediaSourcesInPriority = async function () {
      const result = await originalLoad.apply(this, arguments);
      if (result && window.__luxSyncedXtreamActive) {
        // Reparos antigos não podem segurar o splash/login. O catálogo HTTPS
        // deve chegar pronto; qualquer exceção residual roda depois.
        setTimeout(() => {
          repairSyncedPlaybackUrls().catch(error => {
            console.warn('[Lux Play] Reparo residual de reprodução indisponível.', error);
          });
        }, 0);
      }
      return result;
    };

    window.__luxCatalogPlaybackRepairInstalled = true;
    window.LuxPlaybackRepair = { run: repairSyncedPlaybackUrls, extractStreamId: extractFlexibleStreamId };
    return true;
  };


  let attempts = 0;
  const install = () => {
    attempts += 1;
    const catalogReady = installCatalogRepair();
    if (catalogReady || attempts >= 240) clearInterval(timer);
  };

  const timer = setInterval(install, 50);
  install();
})();
