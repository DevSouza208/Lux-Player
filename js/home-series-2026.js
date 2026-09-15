(() => {
  'use strict';

  const VERSION = '20260915-home-series-2026-2';
  if (window.__luxHomeSeries2026 === VERSION) return;
  window.__luxHomeSeries2026 = VERSION;

  const YEAR = new Date().getFullYear();
  const MAX_ITEMS = 12;
  const MAX_PAGES = 6;
  const CACHE_MS = 15 * 60 * 1000;
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
  let rerenderQueued = false;
  let observer = null;
  let started = false;
  const detailCache = new Map();

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
    const byName = new Map();
    for (const item of items) {
      const id = tmdbIdOf(item);
      if (id && !byId.has(id)) byId.set(id, item);
      for (const rawName of [item?.name, item?.seriesName]) {
        const name = normalize(rawName);
        if (name && !byName.has(name)) byName.set(name, item);
      }
    }
    return { items, byId, byName };
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
    if (id && index.byId.has(id)) return index.byId.get(id);
    return matchNames([candidate?.title, candidate?.name, candidate?.original_name], index);
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
    if (!force && candidateCache.rows.length && now - candidateCache.at < CACHE_MS) return candidateCache.rows;
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
    return index.items.find(item => String(item.id || '') === key)
      || index.items.find(item => String(item.url || '') === key)
      || index.items.find(item => payload.url && String(item.url || '') === String(payload.url))
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

  function ensureSection() {
    let container = $('homeSeriesLancamentosContainer');
    if (container) return container;
    const movieContainer = $('homeLancamentosContainer');
    const movieSection = movieContainer?.closest('.space-y-3');
    if (!movieSection?.parentElement) return null;
    const section = document.createElement('div');
    section.id = 'homeSeriesLancamentosContainerSection';
    section.className = 'space-y-3';
    section.innerHTML = `<h3 class="text-sm font-bold text-white tracking-wide uppercase">SÉRIES | LANÇAMENTOS ${YEAR}</h3><div id="homeSeriesLancamentosContainer" class="flex gap-4 overflow-x-auto pb-2 min-h-[220px] items-center"></div>`;
    movieSection.insertAdjacentElement('afterend', section);
    return $('homeSeriesLancamentosContainer');
  }

  async function render(force = false) {
    if (renderPromise) return renderPromise;
    renderPromise = (async () => {
      const container = ensureSection();
      const section = container?.closest('.space-y-3');
      if (!container || !section) return;
      const heading = section.querySelector('h3');
      if (heading) heading.textContent = `SÉRIES | LANÇAMENTOS ${YEAR}`;

      const index = localIndex();
      const hadOwnCards = !!container.querySelector('[data-lux-series-2026="1"]');
      if (!index.items.length) {
        if (!hadOwnCards) container.innerHTML = '<p class="text-xs text-purple-400/60">Aguardando o catálogo de séries...</p>';
        return;
      }

      container.dataset.luxSeries2026Rendering = '1';
      if (!hadOwnCards) {
        container.innerHTML = '<p class="text-xs text-purple-400/60">Buscando lançamentos disponíveis no Lux...</p>';
      }

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
        if (chosen.length >= MAX_ITEMS) break;
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

      const fragment = document.createDocumentFragment();
      chosen.slice(0, MAX_ITEMS).forEach(row => fragment.appendChild(posterCard(row.entry, row.local, row.manual)));
      if (chosen.length) {
        container.replaceChildren(fragment);
      } else if (!hadOwnCards) {
        container.innerHTML = `<p class="text-xs text-purple-400/60">Nenhum lançamento de ${YEAR} disponível no catálogo do Lux.</p>`;
      }
      container.dataset.luxSeries2026Rendering = '0';
      try { lucide.createIcons(); } catch (_) {}
    })().finally(() => {
      const container = $('homeSeriesLancamentosContainer');
      if (container) container.dataset.luxSeries2026Rendering = '0';
      renderPromise = null;
    });
    return renderPromise;
  }

  function queueRender(force = false) {
    if (rerenderQueued) return;
    rerenderQueued = true;
    setTimeout(() => {
      rerenderQueued = false;
      render(force);
    }, 100);
  }

  function installObserver() {
    if (observer) return;
    observer = new MutationObserver(mutations => {
      const container = $('homeSeriesLancamentosContainer');
      if (!container || container.dataset.luxSeries2026Rendering === '1') return;
      const changedInside = mutations.some(mutation => mutation.target === container || container.contains(mutation.target));
      if (!changedInside) return;
      const ownCards = container.querySelectorAll('[data-lux-series-2026="1"]').length;
      if (ownCards === 0 && localSeries().length) queueRender(false);
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

  function boot() {
    installObserver();
    if (!tryInitialRender()) {
      let attempts = 0;
      const timer = setInterval(() => {
        attempts += 1;
        if (tryInitialRender() || attempts >= 120) clearInterval(timer);
      }, 250);
    }
    $('navHome')?.addEventListener('click', () => queueRender(false));
    $('bNavHome')?.addEventListener('click', () => queueRender(false));
  }

  window.LuxHomeSeries2026 = { render: () => render(true) };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot, { once: true });
  else boot();
})();