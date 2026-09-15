(() => {
  'use strict';

  const VERSION = '20260914-secondary-ui-fixes2';
  if (window.__luxSecondaryUiFixesInstalled === VERSION) return;
  window.__luxSecondaryUiFixesInstalled = VERSION;

  const SNAPSHOT_FUNCTION = 'content-catalog-snapshot';
  let repairing = null;

  const safeCurrentUser = () => {
    try { return typeof currentUser !== 'undefined' ? currentUser : null; } catch (_) { return null; }
  };

  function authBody(extra = {}) {
    const user = safeCurrentUser();
    return { username: String(user?.user || '').trim(), password: String(user?.pass || ''), ...extra };
  }

  async function invokeSnapshot(offset, limit = 250) {
    if (typeof supabaseClient === 'undefined' || !supabaseClient?.functions?.invoke) return { items: [], has_more: false };
    const { data, error } = await supabaseClient.functions.invoke(SNAPSHOT_FUNCTION, {
      body: authBody({ action: 'page', offset, limit })
    });
    if (error) throw new Error(data?.error || error.message || 'Falha ao consultar catálogo canônico.');
    if (data?.error) throw new Error(data.error);
    return data || {};
  }

  async function fetchSnapshot() {
    const items = [];
    let offset = 0;
    for (let page = 0; page < 10; page++) {
      const data = await invokeSnapshot(offset, 250);
      const batch = Array.isArray(data?.items) ? data.items : [];
      items.push(...batch);
      if (!data?.has_more || batch.length < 250) break;
      offset += batch.length;
    }
    return items;
  }

  function normalize(value) {
    return String(value || '')
      .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .replace(/^\s*[+\-–—]+\s*/, '')
      .replace(/\b(dublado|legendado|dual|pt[- ]?br|4k|fhd|uhd|hd|sd)\b/g, ' ')
      .replace(/[^a-z0-9]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function sourceRole(item) {
    return String(item?.luxSourceRole || '').toLowerCase();
  }

  function hasSecondary(item) {
    return sourceRole(item) === 'secondary' || (Array.isArray(item?.luxSources) && item.luxSources.some(source => source?.role === 'secondary'));
  }

  function hasPrincipal(item) {
    return Array.isArray(item?.luxSources) && item.luxSources.some(source => source?.role === 'principal');
  }

  function isSecondaryOnlyCard(item) {
    if (!item) return false;
    if (String(item.id || '').startsWith('canonical:')) return !hasPrincipal(item);
    return sourceRole(item) === 'secondary' && !hasPrincipal(item);
  }

  function cleanVisibleName(item) {
    if (!isSecondaryOnlyCard(item)) return;
    const cleaned = String(item.name || '').replace(/^\s*[+\-–—]+\s*/, '').trim();
    if (cleaned && cleaned !== item.name) {
      item.name = cleaned;
      if (item.seriesName) item.seriesName = cleaned;
      delete item._luxSearchData;
    }
  }

  function episodeHint(name) {
    const raw = String(name || '').trim();
    let hit = raw.match(/^\s*(\d{1,3})\s*[xX]\s*(\d{1,4})(?:\s*[\/-]\s*(\d{1,4}))?[A-Za-z]{0,3}\b/i);
    if (hit) return { season: Number(hit[1]) || 1, episode: Number(hit[2]) || 1, end: Number(hit[3]) || null };
    hit = raw.match(/^\s*S\s*(\d{1,3})\s*E\s*(\d{1,4})(?:\s*[\/-]\s*E?\s*(\d{1,4}))?/i);
    if (hit) return { season: Number(hit[1]) || 1, episode: Number(hit[2]) || 1, end: Number(hit[3]) || null };
    return null;
  }

  function episodeNumber(ep) {
    return Number(ep?.episodeNum || ep?.episode_num || ep?.episode || 0);
  }

  function mergeEpisodeMaps(target, source) {
    if (!source?.m3uEpisodes || typeof source.m3uEpisodes !== 'object') return;
    if (!target.m3uEpisodes || typeof target.m3uEpisodes !== 'object') target.m3uEpisodes = {};
    for (const [season, list] of Object.entries(source.m3uEpisodes)) {
      if (!Array.isArray(list)) continue;
      if (!Array.isArray(target.m3uEpisodes[season])) target.m3uEpisodes[season] = [];
      for (const episode of list) {
        const num = episodeNumber(episode);
        const existing = target.m3uEpisodes[season].find(row => episodeNumber(row) === num && num > 0);
        if (existing) {
          if (!existing.url && episode?.url) existing.url = episode.url;
          if (!existing.logo && episode?.logo) existing.logo = episode.logo;
          if (Array.isArray(episode?.luxSources)) {
            if (!Array.isArray(existing.luxSources)) existing.luxSources = [];
            for (const src of episode.luxSources) {
              if (!existing.luxSources.some(row => row?.id === src?.id && row?.url === src?.url)) existing.luxSources.push(src);
            }
          }
        } else {
          target.m3uEpisodes[season].push({ ...episode, seriesName: target.name, group: target.group });
        }
      }
      target.m3uEpisodes[season].sort((a, b) => episodeNumber(a) - episodeNumber(b));
    }
  }

  function addDirectAsEpisode(target, source) {
    if (target?.type !== 'series' || !source?.url) return;
    const hint = episodeHint(source.name);
    const season = String(hint?.season || 1);
    const number = hint?.episode || 1;
    if (!target.m3uEpisodes || typeof target.m3uEpisodes !== 'object') target.m3uEpisodes = {};
    if (!Array.isArray(target.m3uEpisodes[season])) target.m3uEpisodes[season] = [];
    if (target.m3uEpisodes[season].some(ep => episodeNumber(ep) === number)) return;
    const title = hint?.end ? `Episódios ${number}-${hint.end}` : (source.name || `Episódio ${number}`);
    target.m3uEpisodes[season].push({
      id: `secondary:${target.canonicalId || target.id}:s${season}e${number}`,
      name: title,
      title,
      episodeTitle: title,
      episodeNum: number,
      episode_num: number,
      episode: number,
      seasonNum: Number(season),
      seriesName: target.name,
      type: 'series',
      url: source.url,
      logo: target.logo || source.logo || '',
      group: target.group,
      luxSourceRole: source.luxSourceRole || 'secondary',
      luxSourceId: source.luxSourceId || '',
      luxSourceName: source.luxSourceName || '',
      luxSources: Array.isArray(source.luxSources) ? [...source.luxSources] : []
    });
    target.m3uEpisodes[season].sort((a, b) => episodeNumber(a) - episodeNumber(b));
  }

  function mergeSources(target, source) {
    if (!Array.isArray(target.luxSources)) target.luxSources = [];
    for (const src of Array.isArray(source?.luxSources) ? source.luxSources : []) {
      if (!target.luxSources.some(row => row?.id === src?.id && row?.url === src?.url)) target.luxSources.push(src);
    }
    mergeEpisodeMaps(target, source);
    if (!source?.m3uEpisodes && source?.url) addDirectAsEpisode(target, source);
    if (!target.logo && source?.logo) target.logo = source.logo;
    if (!target.tmdb_id && source?.tmdb_id) target.tmdb_id = source.tmdb_id;
  }

  function titlePenalty(item) {
    const name = String(item?.name || '');
    let score = name.length;
    if (/^\s*\d{1,3}\s*[xX]\s*\d{1,4}/.test(name) || /^\s*S\d+E\d+/i.test(name)) score += 1000;
    if (/ONSeason|season finale/i.test(name)) score += 300;
    if (/^\s*[+\-–—]/.test(name)) score += 100;
    if (!isSecondaryOnlyCard(item)) score -= 2000;
    return score;
  }

  function dedupeSecondary(catalog) {
    const groups = new Map();
    for (const item of catalog) {
      if (!item || item.type !== 'series' || !hasSecondary(item)) continue;
      const tmdb = Number(item.tmdb_id) || 0;
      const key = tmdb ? `tmdb:${tmdb}` : `name:${normalize(item.name)}|${normalize(item.group)}`;
      if (!key || key === 'name:|') continue;
      const list = groups.get(key) || [];
      list.push(item);
      groups.set(key, list);
    }

    const remove = new Set();
    for (const list of groups.values()) {
      if (list.length < 2) continue;
      const target = [...list].sort((a, b) => titlePenalty(a) - titlePenalty(b))[0];
      for (const item of list) {
        if (item === target) continue;
        if (!isSecondaryOnlyCard(item) && !isSecondaryOnlyCard(target)) continue;
        mergeSources(target, item);
        remove.add(item);
      }
    }
    if (!remove.size) return 0;
    for (let index = catalog.length - 1; index >= 0; index--) {
      if (remove.has(catalog[index])) catalog.splice(index, 1);
    }
    return remove.size;
  }

  function ensurePlayableSecondarySeries(item) {
    if (!isSecondaryOnlyCard(item) || item?.type !== 'series') return;
    const hasEpisodes = item.m3uEpisodes && Object.values(item.m3uEpisodes).some(list => Array.isArray(list) && list.length);
    if (!hasEpisodes && item.url) addDirectAsEpisode(item, item);
  }

  function updateVodCounts() {
    try {
      if (typeof currentSection === 'undefined' || !['movies', 'series'].includes(currentSection)) return;
      const count = typeof currentFilteredItems !== 'undefined' && Array.isArray(currentFilteredItems) ? currentFilteredItems.length : 0;
      const desktop = document.getElementById('vodItemCountBadge');
      const mobile = document.getElementById('vodItemCountBadgeMobile');
      if (desktop) desktop.textContent = `${count} ${count === 1 ? 'item' : 'itens'}`;
      if (mobile) mobile.textContent = String(count);
    } catch (_) {}
  }

  async function repair(options = {}) {
    if (repairing) return repairing;
    repairing = (async () => {
      const user = safeCurrentUser();
      if (!user?.user || !user?.pass) return { grouped: 0, deduped: 0 };
      let catalog;
      try { catalog = typeof allMediaItems !== 'undefined' ? allMediaItems : null; } catch (_) { catalog = null; }
      if (!Array.isArray(catalog)) return { grouped: 0, deduped: 0 };

      const snapshot = await fetchSnapshot();
      const byId = new Map(snapshot.map(title => [String(title?.id || ''), title]));
      let grouped = 0;
      for (const item of catalog) {
        cleanVisibleName(item);
        if (!isSecondaryOnlyCard(item)) continue;
        const canonicalId = String(item?.canonicalId || String(item?.id || '').replace(/^canonical:/, ''));
        const title = byId.get(canonicalId);
        if (title?.metadata?.lux_group) {
          item.group = String(title.metadata.lux_group);
          grouped += 1;
        }
        if (!item.tmdb_id && title?.tmdb_id) item.tmdb_id = title.tmdb_id;
        if (!item.logo && title?.poster) item.logo = title.poster;
        ensurePlayableSecondarySeries(item);
      }

      const deduped = dedupeSecondary(catalog);
      if (options.refreshUi !== false) {
        try { if (typeof renderCategories === 'function') renderCategories(); } catch (_) {}
        try { if (typeof filterMedia === 'function') filterMedia(); } catch (_) {}
        queueMicrotask(updateVodCounts);
      }
      console.info('[LUX-SECONDARY-FIX] Catálogo secundário reparado.', { grouped, deduped });
      return { grouped, deduped };
    })().catch(error => {
      console.warn('[LUX-SECONDARY-FIX] Falha ao reparar catálogo:', error);
      return { grouped: 0, deduped: 0, error: error?.message || String(error) };
    }).finally(() => { repairing = null; });
    return repairing;
  }

  function wrapCanonicalReload() {
    const api = window.LuxCanonicalCatalog;
    if (!api?.reload || api.reload.__luxSecondaryUiWrapped) return Boolean(api?.reload?.__luxSecondaryUiWrapped);
    const original = api.reload.bind(api);
    const wrapped = async function(options = {}) {
      const wantsRefresh = options?.refreshUi !== false;
      const result = await original({ ...options, refreshUi: false });
      await repair({ refreshUi: wantsRefresh });
      return result;
    };
    wrapped.__luxSecondaryUiWrapped = true;
    wrapped.__luxSecondaryUiOriginal = original;
    api.reload = wrapped;
    return true;
  }

  const gridObserver = new MutationObserver(() => updateVodCounts());
  const observeGrid = () => {
    const grid = document.getElementById('vodGridContainer');
    if (grid && !grid.dataset.luxCountObserved) {
      grid.dataset.luxCountObserved = '1';
      gridObserver.observe(grid, { childList: true });
    }
  };

  let attempts = 0;
  const timer = setInterval(() => {
    attempts += 1;
    wrapCanonicalReload();
    observeGrid();
    updateVodCounts();
    if (attempts === 10) repair({ refreshUi: true });
    if (attempts >= 120) clearInterval(timer);
  }, 100);

  document.addEventListener('click', () => setTimeout(updateVodCounts, 0), true);

  window.LuxSecondaryUiFixes = { version: VERSION, repair, updateCounts: updateVodCounts };
})();
