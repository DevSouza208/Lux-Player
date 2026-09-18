(() => {
  'use strict';

  if (window.__luxRuntimeStabilityFixInstalled) return;
  window.__luxRuntimeStabilityFixInstalled = '20260917-stability-perf15';

  const devRepairEvent = (status, label, message = '', durationMs = null, data = null) => {
    window.LuxDevkit?.emit({
      category: 'PLAYBACK-REPAIR',
      status,
      label,
      message,
      durationMs,
      data
    });
  };

  const devRepairRun = async (label, job, data = null) => {
    const started = performance.now();
    devRepairEvent('running', label, 'Iniciando...', null, data);
    try {
      const result = await job();
      devRepairEvent('success', label, 'Concluído', Math.round(performance.now() - started), data);
      return result;
    } catch (error) {
      devRepairEvent('error', label, error?.message || 'Falha desconhecida', Math.round(performance.now() - started), data);
      throw error;
    }
  };

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
    const reused = window.__luxSyncedRawPlaylistItems;
    if (Array.isArray(reused) && reused.length) {
      window.__luxSyncedRawPlaylistItems = null;
      devRepairEvent('success', 'playlist-reuse', 'M3U já parseada reaproveitada', 0, {
        rawItems: reused.length
      });
      return reused;
    }

    const manifest = window.__luxSyncedXtreamManifest;
    const playlistUrl = String(manifest?.playlist || '').trim();
    if (!playlistUrl || typeof window.parseM3U !== 'function') return [];

    const response = await devRepairRun(
      'playlist-fetch',
      () => fetch(playlistUrl, { cache: 'no-store' })
    );
    if (!response.ok) throw new Error(`playlist HTTP ${response.status}`);

    const text = await devRepairRun(
      'playlist-body',
      () => response.text()
    );

    return devRepairRun(
      'playlist-parse',
      () => window.parseM3U(text).filter(item => item?.url),
      { bytes: text.length }
    );
  };

  const repairSyncedPlaybackUrls = async () => {
    if (!window.__luxSyncedXtreamActive || typeof allMediaItems === 'undefined' || !Array.isArray(allMediaItems)) return;

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

    const indexStarted = performance.now();
    devRepairEvent('running', 'criar-indices', 'Indexando playlist bruta...', null, { rawItems: rawItems.length });
    rawItems.forEach(raw => {
      const type = normalizeType(raw.type);
      const id = extractFlexibleStreamId(raw.url);
      if (id) addToMap(byAnyId, id, raw);
      if (type !== 'live' && type !== 'movies') return;
      if (id && !byTypeAndId.has(`${type}|${id}`)) byTypeAndId.set(`${type}|${id}`, raw);
      addToMap(byTypeAndName, `${type}|${normalizeText(raw.name)}`, raw);
      addToMap(byTypeAndLogo, `${type}|${normalizeAssetUrl(raw.logo)}`, raw);
    });
    devRepairEvent('success', 'criar-indices', 'Índices prontos', Math.round(performance.now() - indexStarted), {
      rawItems: rawItems.length,
      ids: byTypeAndId.size,
      names: byTypeAndName.size,
      logos: byTypeAndLogo.size
    });

    let repaired = 0;
    let directFallbacks = 0;
    let stillMissing = 0;

    const matchStarted = performance.now();
    devRepairEvent('running', 'casar-enderecos', 'Validando itens do catálogo...', null, {
      catalogItems: allMediaItems.length
    });
    for (const item of allMediaItems) {
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

    devRepairEvent('success', 'casar-enderecos', 'Validação concluída', Math.round(performance.now() - matchStarted), {
      catalogItems: allMediaItems.length,
      repaired,
      directFallbacks,
      stillMissing
    });

    if (window.__luxSyncedXtreamStats) {
      window.__luxSyncedXtreamStats.playbackRepaired = repaired;
      window.__luxSyncedXtreamStats.playbackDirectFallbacks = directFallbacks;
      window.__luxSyncedXtreamStats.playbackMissing = stillMissing;
    }

    console.info('[Lux Play] Endereços de reprodução validados.', { repaired, directFallbacks, stillMissing });
    devRepairEvent('success', 'resultado', 'Endereços de reprodução validados', null, {
      repaired,
      directFallbacks,
      stillMissing
    });
  };

  const installCatalogRepair = () => {
    if (window.__luxCatalogPlaybackRepairInstalled) return true;
    if (!window.__luxSyncedCatalogBridgeInstalled || typeof window.loadMediaSourcesInPriority !== 'function') return false;

    const originalLoad = window.loadMediaSourcesInPriority;
    window.loadMediaSourcesInPriority = async function () {
      const result = await originalLoad.apply(this, arguments);
      if (result && window.__luxSyncedXtreamActive) {
        const repairStarted = performance.now();
        devRepairEvent('running', 'reparo-total', 'Preparando endereços de reprodução...');
        await repairSyncedPlaybackUrls();
        devRepairEvent('success', 'reparo-total', 'Reparo finalizado', Math.round(performance.now() - repairStarted));
      }
      return result;
    };

    window.__luxCatalogPlaybackRepairInstalled = true;
    window.LuxPlaybackRepair = { run: repairSyncedPlaybackUrls, extractStreamId: extractFlexibleStreamId };
    return true;
  };

  const sameProfile = (a, b) => {
    if (!a || !b) return false;
    if (a.data_key && b.data_key) return String(a.data_key) === String(b.data_key);
    return Number(a.slot || 1) === Number(b.slot || 1);
  };

  const installFastProfileEntry = () => {
    if (window.__luxFastProfileEntryInstalled) return true;
    if (typeof window.activateAccountProfile !== 'function' || typeof window.syncCloudProgress !== 'function') return false;

    const originalActivate = window.activateAccountProfile;

    window.activateAccountProfile = async function (profile) {
      const syncFunction = window.syncCloudProgress;
      const sharedVodFunction = typeof window.loadSharedVodCatalog === 'function' ? window.loadSharedVodCatalog : null;
      let deferredSync = false;
      let deferredSharedVods = false;
      const deferSyncOnly = async () => { deferredSync = true; };
      const deferSharedVodsOnly = async () => { deferredSharedVods = true; };

      window.syncCloudProgress = deferSyncOnly;
      if (sharedVodFunction) window.loadSharedVodCatalog = deferSharedVodsOnly;

      try {
        return await originalActivate.apply(this, arguments);
      } finally {
        if (window.syncCloudProgress === deferSyncOnly) window.syncCloudProgress = syncFunction;
        if (sharedVodFunction && window.loadSharedVodCatalog === deferSharedVodsOnly) window.loadSharedVodCatalog = sharedVodFunction;

        if (!sameProfile(currentUser?.profile, profile)) return;

        if (deferredSync && typeof syncFunction === 'function') {
          setTimeout(() => {
            Promise.resolve(syncFunction()).catch(error => {
              console.warn('[Lux Play] Sincronização em segundo plano indisponível.', error);
            });
          }, 0);
        }

        if (deferredSharedVods && typeof sharedVodFunction === 'function') {
          setTimeout(() => {
            Promise.resolve(sharedVodFunction())
              .then(() => {
                try { if (typeof window.setSection === 'function') window.setSection(currentSection || 'home'); } catch (_) {}
              })
              .catch(error => {
                console.warn('[Lux Play] Conteúdos extras indisponíveis no momento.', error);
              });
          }, 0);
        }
      }
    };

    window.__luxFastProfileEntryInstalled = true;
    return true;
  };

  let attempts = 0;
  const install = () => {
    attempts += 1;
    const catalogReady = installCatalogRepair();
    const profileReady = installFastProfileEntry();
    if ((catalogReady && profileReady) || attempts >= 240) clearInterval(timer);
  };

  const timer = setInterval(install, 50);
  install();
})();
