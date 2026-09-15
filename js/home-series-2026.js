(() => {
  'use strict';

  const VERSION = '20260915-home-series-2026-4';
  if (window.__luxHomeSeries2026 === VERSION) return;
  window.__luxHomeSeries2026 = VERSION;

  const YEAR = new Date().getFullYear();
  const MAX_ITEMS = 12;
  const MAX_PAGES = 6;
  const MEMORY_CACHE_MS = 15 * 60 * 1000;
  const DAILY_CACHE_VERSION = 1;
  const VISIBLE_SECTION_ID = 'homeSeries2026ContainerSection';
  const VISIBLE_CONTAINER_ID = 'homeSeries2026Container';
  const LEGACY_SECTION_ID = 'homeSeriesLancamentosContainerSection';
  const LEGACY_CONTAINER_ID = 'homeSeriesLancamentosContainer';
  const $ = id => document.getElementById(id);

  const normalize = value => String(value || '')
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\([^)]*\)|\[[^\]]*\]/g, ' ')
    .replace(/\b(dublado|legendado|dual|4k|fhd|uhd|hd|sd|h265|hevc|pt-br)\b/g, ' ')
    .replace(/^[\s\-–—]+/, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[c]));

  let candidateCache = { at: 0, rows: [] };
  let renderPromise = null;
  let renderQueued = false;
  let observer = null;
  let started = false;
  let pendingAdminSeriesSave = false;
  const detailCache = new Map();

  function dayKey() {
    const now = new Date();
    const y = now.getFullYear();
    const m = String(now.getMonth() + 1).padStart(2, '0');
    const d = String(now.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }

  function cacheScope() {
    try {
      const username = currentUser?.user || currentUser?.usuario || currentUser?.username || 'default';
      return normalize(username) || 'default';
    } catch (_) {
      return 'default';
    }
  }

  function dailyCacheKey() {
    return `lux:home:series:${YEAR}:daily:v${DAILY_CACHE_VERSION}:${cacheScope()}`;
  }

  function clearDailyCache() {
    try { localStorage.removeItem(dailyCacheKey()); } catch (_) {}
  }

  function localSeries() {
    try {
      return Array.isArray(allMediaItems)
        ? allMediaItems.filter(item => String(item?.type || '').toLowerCase() === 'series')
        : [];
    } catch (_) {
      return [];
    }
  }

  function tmdbIdOf(item) {
    const raw = item?.tmdb_id ?? item?.tmdbId ?? item?.metadata?.tmdb_id ?? item?.metadata?.tmdbId;
    const value = Number(raw);
    return Number.isFinite(value) && value > 0 ? value : null;
  }

  function localIndex() {
    const items = localSeries();
    const byId = new Map();
    const byUrl = new Map();
    const byTmdb = new Map();
    const byName = new Map();
    for (const item of items) {
      const id = String(item?.id || '');
      const url = String(item?.url || '');
      const tmdb = tmdbIdOf(item);
      if (id && !byId.has(id)) byId.set(id, item);
      if (url && !byUrl.has(url)) byUrl.set(url, item);
      if (tmdb && !byTmdb.has(tmdb)) byTmdb.set(tmdb, item);
      for (const rawName of [item?.name, item?.seriesName]) {
        const name = normalize(rawName);
        if (name && !byName.has(name)) byName.set(name, item);
      }
    }
    return { items, byId, byUrl, byTmdb, byName };
  }

  function matchNames(names, index) {
    const aliases = [...new Set((names || []).map(normalize).filter(Boolean))];
    for (const alias of aliases) {
      const exact = index.byName.get(alias);
      if (exact) return exact;
    }
    for (const alias of aliases) {
      if (alias.length < 5) continue;
      const relaxed = index.items.find(item => {
        const local = normalize(item?.seriesName || item?.name);
        return local && (local.startsWith(alias + ' ') || alias.startsWith(local + ' '));
      });
      if (relaxed) return relaxed;
    }
    return null;
  }

  function directMatch(candidate, index) {
    const id = Number(candidate?.tmdb_id || 0) || null;
    if (id && index.byTmdb.has(id)) return index.byTmdb.get(id);
    return matchNames([candidate?.title, candidate?.name, candidate?.original_name], index);
  }

  function resolveCachedLocal(locator, index) {
    if (!locator) return null;
    const id = String(locator.id || '');
    const url = String(locator.url || '');
    const tmdb = Number(locator.tmdb_id || 0) || null;
    if (id && index.byId.has(id)) return index.byId.get(id);
    if (url && index.byUrl.has(url)) return index.byUrl.get(url);
    if (tmdb && index.byTmdb.has(tmdb)) return index.byTmdb.get(tmdb);
    return matchNames([locator.name, locator.seriesName], index);
  }

  function readDailyCache(index) {
    try {
      const raw = localStorage.getItem(dailyCacheKey());
      if (!raw) return null;
      const cache = JSON.parse(raw);
      if (cache?.version !== DAILY_CACHE_VERSION || cache?.year !== YEAR || cache?.day !== dayKey()) {
        localStorage.removeItem(dailyCacheKey());
        return null;
      }
      if (!Array.isArray(cache.items) || !cache.items.length) return null;
      const rows = cache.items.map(saved => {
        const local = resolveCachedLocal(saved.local, index);
        return local ? { entry: saved.entry || {}, local, manual: !!saved.manual } : null;
      }).filter(Boolean);
      if (!rows.length) {
        localStorage.removeItem(dailyCacheKey());
        return null;
      }
      return rows.slice(0, MAX_ITEMS);
    } catch (_) {
      return null;
    }
  }

  function writeDailyCache(rows) {
    if (!Array.isArray(rows) || !rows.length) return;
    try {
      const items = rows.slice(0, MAX_ITEMS).map(row => ({
        manual: !!row.manual,
        entry: {
          tmdb_id: row.entry?.tmdb_id || null,
          title: row.entry?.title || '',
          name: row.entry?.name || '',
          original_name: row.entry?.original_name || '',
          image: row.entry?.image || '',
          rating: row.entry?.rating || null,
          release_year: row.entry?.release_year || YEAR,
        },
        local: {
          id: row.local?.id || '',
          url: row.local?.url || '',
          name: row.local?.name || '',
          seriesName: row.local?.seriesName || '',
          tmdb_id: tmdbIdOf(row.local),
        }
      }));
      localStorage.setItem(dailyCacheKey(), JSON.stringify({
        version: DAILY_CACHE_VERSION,
        year: YEAR,
        day: dayKey(),
        created_at: Date.now(),
        items,
      }));
    } catch (_) {}
  }

  async function tmdbDetails(id) {
    const numeric = Number(id);
    if (!numeric || typeof TMDB_API_KEY === 'undefined' || !TMDB_API_KEY) return null;
    if (detailCache.has(numeric)) return detailCache.get(numeric);
    const task = (async () => {
      try {
        const url = 'https://api.themoviedb.org/3/tv/' + numeric
          + '?api_key=' + encodeURIComponent(TMDB_API_KEY)
          + '&language=pt-BR&append_to_response=alternative_titles,translations';
        const response = await fetch(url);
        return response.ok ? await response.json() : null;
      } catch (_) {
        return null;
      }
    })();
    detailCache.set(numeric, task);
    return task;
  }

  function matchWithDetails(details, candidate, index) {
    if (!details) return null;
    const aliases = [candidate?.title, candidate?.name, candidate?.original_name, details?.name, details?.original_name];
    (details?.alternative_titles?.results || []).forEach(row => aliases.push(row?.title, row?.name));
    (details?.translations?.translations || []).forEach(row => aliases.push(row?.data?.name, row?.data?.title));
    return matchNames(aliases, index);
  }

  async function tmdbPage(page) {
    if (typeof TMDB_API_KEY === 'undefined' || !TMDB_API_KEY) return [];
    const url = 'https://api.themoviedb.org/3/discover/tv'
      + '?api_key=' + encodeURIComponent(TMDB_API_KEY)
      + '&language=pt-BR&include_adult=false&sort_by=popularity.desc'
      + '&first_air_date.gte=' + YEAR + '-01-01'
      + '&first_air_date.lte=' + YEAR + '-12-31'
      + '&page=' + page;
    try {
      const response = await fetch(url);
      if (!response.ok) return [];
      const data = await response.json();
      return (data.results || []).map((item, index) => ({
        tmdb_id: item.id,
        title: item.name || item.original_name || 'Série',
        name: item.name || '',
        original_name: item.original_name || '',
        image: item.poster_path ? 'https://image.tmdb.org/t/p/w500' + item.poster_path : '',
        rating: Number(item.vote_average) || null,
        release_year: Number(String(item.first_air_date || '').slice(0, 4)) || YEAR,
        rank: (page - 1) * 20 + index + 1
      }));
    } catch (_) {
      return [];
    }
  }

  async function candidates(force = false) {
    const now = Date.now();
    if (!force && candidateCache.rows.length && now - candidateCache.at < MEMORY_CACHE_MS) return candidateCache.rows;
    const rows = [];
    for (let page = 1; page <= MAX_PAGES; page++) rows.push(...await tmdbPage(page));
    candidateCache = { at: now, rows };
    return rows;
  }

  async function publicPinned() {
    if (typeof supabaseClient === 'undefined') return [];
    try {
      const { data, error } = await supabaseClient.functions.invoke('home-rails', { body: { action: 'list_public' } });
      if (error || data?.error) return [];
      return (Array.isArray(data?.items) ? data.items : [])
        .filter(item => item?.rail === 'series')
        .sort((a, b) => Number(a.position) - Number(b.position));
    } catch (_) {
      return [];
    }
  }

  function pinnedMatch(selection, index) {
    const payload = selection?.payload || {};
    const key = String(selection?.source_key || '');
    return index.byId.get(key)
      || index.byUrl.get(key)
      || (payload.url ? index.byUrl.get(String(payload.url)) : null)
      || matchNames([selection?.title, payload?.name], index);
  }

  function openSeries(item) {
    if (!item) return;
    try {
      if (typeof openSeriesModal === 'function') return openSeriesModal(item);
      if (typeof openVodPlayer === 'function') return openVodPlayer(item);
    } catch (_) {}
  }

  function posterCard(entry, local, manual = false) {
    const title = manual ? (local?.name || entry?.title || 'Série') : (entry?.title || local?.name || 'Série');
    const image = manual ? (local?.logo || entry?.image || '') : (entry?.image || local?.logo || '');
    const subtitle = manual
      ? (local?.group || `Lux · ${YEAR}`)
      : (entry?.rating ? `TMDB ${Number(entry.rating).toFixed(1)} · ${entry.release_year || YEAR}` : `TMDB · ${entry?.release_year || YEAR}`);
    const card = document.createElement('div');
    card.className = 'min-w-[130px] w-[130px] md:min-w-[150px] md:w-[150px] bg-[#120c1f] rounded-2xl border border-purple-950 overflow-hidden group shrink-0 transition-all hover:-translate-y-1.5 shadow-lg cursor-pointer';
    card.dataset.luxSeries2026 = '1';
    card.onclick = () => openSeries(local);
    card.innerHTML = `
      <div class="w-full aspect-[2/3] bg-purple-950/40 relative overflow-hidden flex items-center justify-center">
        ${image ? `<img src="${esc(image)}" class="w-full h-full object-cover group-hover:scale-105 transition-transform" loading="lazy" referrerpolicy="no-referrer" alt="">` : ''}
        <span class="absolute top-2 right-2 rounded-md bg-black/70 px-1.5 py-0.5 text-[8px] font-black uppercase tracking-wide text-white">LUX</span>
      </div>
      <div class="p-2.5">
        <h5 class="text-xs font-bold text-white truncate group-hover:text-purple-300" title="${esc(title)}">- ${esc(title)}</h5>
        <p class="mt-1 text-[9px] text-purple-400/75 truncate" title="${esc(subtitle)}">${esc(subtitle)}</p>
      </div>`;
    return card;
  }

  function hideLegacySeriesSection() {
    const legacy = $(LEGACY_SECTION_ID);
    if (!legacy) return;
    legacy.style.display = 'none';
    legacy.setAttribute('aria-hidden', 'true');
    legacy.dataset.luxLegacySeriesRail = '1';
    const legacyContainer = legacy.querySelector(`#${LEGACY_CONTAINER_ID}`);
    if (legacyContainer) legacyContainer.id = `${LEGACY_CONTAINER_ID}Legacy`;
  }

  function ensureSection() {
    const movieContainer = $('homeLancamentosContainer');
    const movieSection = movieContainer?.closest('.space-y-3');
    if (!movieSection?.parentElement) return null;

    hideLegacySeriesSection();

    let section = $(VISIBLE_SECTION_ID);
    if (!section) {
      section = document.createElement('div');
      section.id = VISIBLE_SECTION_ID;
      section.className = 'space-y-3';
      section.innerHTML = `<h3 class="text-sm font-bold text-white tracking-wide uppercase">SÉRIES | LANÇAMENTOS ${YEAR}</h3><div id="${VISIBLE_CONTAINER_ID}" class="flex gap-4 overflow-x-auto pb-2 min-h-[220px] items-center"></div>`;
      movieSection.insertAdjacentElement('afterend', section);
    } else if (section.previousElementSibling !== movieSection) {
      movieSection.insertAdjacentElement('afterend', section);
    }

    return $(VISIBLE_CONTAINER_ID);
  }

  function paintRows(container, rows) {
    const fragment = document.createDocumentFragment();
    rows.slice(0, MAX_ITEMS).forEach(row => fragment.appendChild(posterCard(row.entry, row.local, row.manual)));
    container.replaceChildren(fragment);
    try { lucide.createIcons(); } catch (_) {}
  }

  async function computeRows(index, force = false) {
    const chosen = [];
    const used = new Set();
    const pinned = await publicPinned();

    for (const selection of pinned) {
      const local = pinnedMatch(selection, index);
      if (!local) continue;
      const key = String(local.id || local.url || normalize(local.name));
      if (used.has(key)) continue;
      used.add(key);
      chosen.push({ entry: { title: local.name, image: local.logo || selection.image_url || '' }, local, manual: true });
      if (chosen.length >= MAX_ITEMS) return chosen;
    }

    const rows = await candidates(force);
    const unresolved = [];
    for (const entry of rows) {
      if (chosen.length >= MAX_ITEMS) break;
      const local = directMatch(entry, index);
      if (!local) {
        if (unresolved.length < 40) unresolved.push(entry);
        continue;
      }
      const key = String(local.id || local.url || normalize(local.name));
      if (used.has(key)) continue;
      used.add(key);
      chosen.push({ entry, local, manual: false });
    }

    if (chosen.length < MAX_ITEMS) {
      for (const entry of unresolved) {
        if (chosen.length >= MAX_ITEMS) break;
        const details = await tmdbDetails(entry.tmdb_id);
        const local = matchWithDetails(details, entry, index);
        if (!local) continue;
        const key = String(local.id || local.url || normalize(local.name));
        if (used.has(key)) continue;
        used.add(key);
        if (!tmdbIdOf(local) && entry.tmdb_id) local.tmdb_id = entry.tmdb_id;
        chosen.push({ entry, local, manual: false });
      }
    }
    return chosen;
  }

  async function render(force = false) {
    if (renderPromise) return renderPromise;
    renderPromise = (async () => {
      const container = ensureSection();
      if (!container) return;
      const index = localIndex();
      if (!index.items.length) {
        if (!container.querySelector('[data-lux-series-2026="1"]')) {
          container.innerHTML = '<p class="text-xs text-purple-400/60">Aguardando o catálogo de séries...</p>';
        }
        return;
      }

      if (!force) {
        if (container.querySelector('[data-lux-series-2026="1"]')) return;
        const cached = readDailyCache(index);
        if (cached?.length) {
          paintRows(container, cached);
          return;
        }
      }

      if (!container.querySelector('[data-lux-series-2026="1"]')) {
        container.innerHTML = '<p class="text-xs text-purple-400/60">Buscando lançamentos disponíveis no Lux...</p>';
      }

      const chosen = await computeRows(index, force);
      if (chosen.length) {
        writeDailyCache(chosen);
        paintRows(container, chosen);
      } else if (!container.querySelector('[data-lux-series-2026="1"]')) {
        container.innerHTML = `<p class="text-xs text-purple-400/60">Nenhum lançamento de ${YEAR} disponível no catálogo do Lux.</p>`;
      }
    })().finally(() => { renderPromise = null; });
    return renderPromise;
  }

  function queueRender(force = false) {
    if (renderQueued) return;
    renderQueued = true;
    setTimeout(() => {
      renderQueued = false;
      render(force);
    }, 80);
  }

  function installObserver() {
    if (observer) return;
    observer = new MutationObserver(() => {
      hideLegacySeriesSection();
      ensureSection();
    });
    observer.observe(document.documentElement, { childList: true, subtree: true });
  }

  function tryInitialRender() {
    const container = ensureSection();
    if (!container || !localSeries().length) return false;
    if (!started) {
      started = true;
      queueRender(false);
    }
    return true;
  }

  function isSeriesAdminTabActive() {
    const button = document.querySelector('[data-home-rail-tab="series"]');
    return !!button && button.className.includes('bg-purple-600');
  }

  function installAdminCacheBridge() {
    document.addEventListener('click', event => {
      if (!event.target?.closest?.('#homeRailSave') || !isSeriesAdminTabActive()) return;
      pendingAdminSeriesSave = true;
    }, true);

    const watch = new MutationObserver(() => {
      if (!pendingAdminSeriesSave) return;
      const status = $('homeRailStatus');
      const text = String(status?.textContent || '');
      if (/Seleção salva:/i.test(text)) {
        pendingAdminSeriesSave = false;
        clearDailyCache();
        candidateCache = { at: 0, rows: [] };
        queueRender(true);
      } else if (/não foi possível|erro/i.test(text)) {
        pendingAdminSeriesSave = false;
      }
    });
    watch.observe(document.documentElement, { childList: true, subtree: true, characterData: true });
  }

  function boot() {
    installObserver();
    installAdminCacheBridge();
    if (!tryInitialRender()) {
      let attempts = 0;
      const timer = setInterval(() => {
        attempts += 1;
        hideLegacySeriesSection();
        if (tryInitialRender() || attempts >= 120) clearInterval(timer);
      }, 250);
    }

    const showCachedRail = () => {
      hideLegacySeriesSection();
      const container = ensureSection();
      if (container && !container.querySelector('[data-lux-series-2026="1"]')) queueRender(false);
    };
    $('navHome')?.addEventListener('click', showCachedRail);
    $('bNavHome')?.addEventListener('click', showCachedRail);
  }

  window.LuxHomeSeries2026 = {
    render: () => render(false),
    refresh: () => {
      clearDailyCache();
      candidateCache = { at: 0, rows: [] };
      return render(true);
    },
    clearCache: clearDailyCache,
  };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot, { once: true });
  else boot();
})();