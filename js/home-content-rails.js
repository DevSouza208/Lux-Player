(() => {
  'use strict';

  const VERSION = '20260915-home-content-rails-2';
  if (window.__luxHomeContentRailsVersion === VERSION) return;
  window.__luxHomeContentRailsVersion = VERSION;

  const MAX_ITEMS = 12;
  const CACHE_MS = 60_000;
  const SERIES_CACHE_MS = 15 * 60_000;
  const YEAR = new Date().getFullYear();
  const RAILS = ['movies', 'series', 'games', 'books'];
  const $ = id => document.getElementById(id);

  const normalize = value => String(value || '')
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\([^)]*\)|\[[^\]]*\]/g, ' ')
    .replace(/\b(dublado|legendado|dual|4k|fhd|uhd|hd|sd|h265|hevc|pt-br)\b/g, ' ')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[c]));

  let publicCache = { at: 0, items: [] };
  let seriesCache = { at: 0, year: YEAR, items: [] };
  const admin = {
    activeRail: 'movies',
    saved: { movies: [], series: [], games: [], books: [] },
    candidates: { movies: [], series: [], games: [], books: [] },
    query: { movies: '', series: '', games: '', books: '' },
    loading: false,
  };

  function account() {
    try { return typeof currentUser !== 'undefined' ? currentUser : null; }
    catch (_) { return null; }
  }

  async function invoke(action, payload = {}, needsAdmin = false) {
    if (typeof supabaseClient === 'undefined') throw new Error('Serviço de dados indisponível.');
    const body = { action, ...payload };
    if (needsAdmin) {
      const user = account();
      if (!user || user.role !== 'admin') throw new Error('Apenas administradores podem alterar as faixas da Home.');
      body.username = user.user;
      body.credential = user.pass;
    }
    const { data, error } = await supabaseClient.functions.invoke('home-rails', { body });
    if (error || data?.error) {
      let message = data?.error || 'Não foi possível carregar as faixas da Home.';
      try { message = (await error.context.json()).error || message; } catch (_) {}
      throw new Error(message);
    }
    return data || {};
  }

  async function publicItems(force = false) {
    const now = Date.now();
    if (!force && now - publicCache.at < CACHE_MS) return publicCache.items;
    const data = await invoke('list_public');
    publicCache = { at: now, items: Array.isArray(data.items) ? data.items : [] };
    return publicCache.items;
  }

  async function tmdbSeriesFallback() {
    if (typeof TMDB_API_KEY === 'undefined' || !TMDB_API_KEY) return [];
    const url = 'https://api.themoviedb.org/3/discover/tv'
      + '?api_key=' + encodeURIComponent(TMDB_API_KEY)
      + '&language=pt-BR&include_adult=false&sort_by=popularity.desc'
      + '&first_air_date.gte=' + YEAR + '-01-01'
      + '&first_air_date.lte=' + YEAR + '-12-31&page=1';
    const response = await fetch(url);
    if (!response.ok) throw new Error('TMDB HTTP ' + response.status);
    const data = await response.json();
    return (data.results || []).slice(0, MAX_ITEMS).map((item, index) => ({
      id: 'tmdb-' + item.id,
      tmdb_id: item.id,
      title: item.name || item.original_name || 'Série',
      image: item.poster_path ? 'https://image.tmdb.org/t/p/w500' + item.poster_path : '',
      description: item.overview || '',
      rating: Number(item.vote_average) || null,
      release_year: Number(String(item.first_air_date || '').slice(0, 4)) || YEAR,
      rank: index + 1,
      source: 'TMDB',
      url: item.id ? 'https://www.themoviedb.org/tv/' + item.id : ''
    }));
  }

  async function popularSeries(force = false) {
    const now = Date.now();
    if (!force && seriesCache.year === YEAR && now - seriesCache.at < SERIES_CACHE_MS && seriesCache.items.length) {
      return seriesCache.items;
    }

    let items = [];
    try {
      const data = await invoke('imdb_series', { year: YEAR });
      items = Array.isArray(data.series) ? data.series.slice(0, MAX_ITEMS) : [];
    } catch (error) {
      console.warn('[Lux Home] IMDb indisponível; usando fallback de séries.', error);
    }

    if (!items.length) {
      try { items = await tmdbSeriesFallback(); }
      catch (error) { console.warn('[Lux Home] Fallback de séries indisponível:', error); }
    }

    seriesCache = { at: now, year: YEAR, items };
    return items;
  }

  function mediaItems() {
    try { return Array.isArray(allMediaItems) ? allMediaItems : []; }
    catch (_) { return []; }
  }

  function sectionTemplate(id, title) {
    const section = document.createElement('div');
    section.id = id + 'Section';
    section.className = 'space-y-3';
    section.innerHTML = `<h3 class="text-sm font-bold text-white tracking-wide uppercase">${esc(title)}</h3><div id="${id}" class="flex gap-4 overflow-x-auto pb-2 min-h-[220px] items-center"><p class="text-xs text-purple-400/60">Carregando destaques...</p></div>`;
    return section;
  }

  function ensureHomeSections() {
    const movieContainer = $('homeLancamentosContainer');
    const movieSection = movieContainer?.closest('.space-y-3');
    if (!movieContainer || !movieSection?.parentElement) return false;

    const movieHeading = movieSection.querySelector('h3');
    if (movieHeading) movieHeading.textContent = `FILMES | LANÇAMENTOS ${YEAR}`;

    let anchor = movieSection;
    const definitions = [
      ['homeSeriesLancamentosContainer', `SÉRIES | LANÇAMENTOS ${YEAR}`],
      ['homeFeaturedGamesContainer', 'JOGOS EM DESTAQUE'],
      ['homeFeaturedBooksContainer', 'LIVROS EM DESTAQUE'],
    ];
    for (const [id, title] of definitions) {
      let section = $(id + 'Section');
      if (!section) {
        section = sectionTemplate(id, title);
        anchor.insertAdjacentElement('afterend', section);
      } else {
        const heading = section.querySelector('h3');
        if (heading) heading.textContent = title;
      }
      anchor = section;
    }
    return true;
  }

  function emptyRail(container, message) {
    if (container) container.innerHTML = `<p class="text-xs text-purple-400/60">${esc(message)}</p>`;
  }

  function posterCard({ title, image, subtitle = '', sourceLabel = '', onClick = null, icon = 'sparkles' }) {
    const card = document.createElement('div');
    card.className = 'min-w-[130px] w-[130px] md:min-w-[150px] md:w-[150px] bg-[#120c1f] rounded-2xl border border-purple-950 overflow-hidden group shrink-0 transition-all hover:-translate-y-1.5 shadow-lg';
    if (onClick) {
      card.classList.add('cursor-pointer');
      card.onclick = onClick;
    }
    const safeTitle = title || 'Sem título';
    const media = image
      ? `<img src="${esc(image)}" class="w-full h-full object-cover group-hover:scale-105 transition-transform" loading="lazy" referrerpolicy="no-referrer" alt="" onerror="this.remove(); this.parentElement.querySelector('[data-fallback]').classList.remove('hidden')">`
      : '';
    card.innerHTML = `
      <div class="w-full aspect-[2/3] bg-purple-950/40 relative overflow-hidden flex items-center justify-center">
        ${media}
        <div data-fallback class="${image ? 'hidden ' : ''}absolute inset-0 flex flex-col items-center justify-center gap-2 bg-gradient-to-br from-[#180f29] via-[#0f091a] to-[#08050e] px-3 text-center">
          <i data-lucide="${esc(icon)}" class="w-8 h-8 text-purple-600"></i>
          <span class="text-[10px] font-bold text-purple-200 line-clamp-3">${esc(safeTitle)}</span>
        </div>
        ${sourceLabel ? `<span class="absolute top-2 right-2 rounded-md bg-black/70 px-1.5 py-0.5 text-[8px] font-black uppercase tracking-wide text-white">${esc(sourceLabel)}</span>` : ''}
      </div>
      <div class="p-2.5">
        <h5 class="text-xs font-bold text-white truncate group-hover:text-purple-300" title="${esc(safeTitle)}">- ${esc(safeTitle)}</h5>
        ${subtitle ? `<p class="mt-1 text-[9px] text-purple-400/75 truncate" title="${esc(subtitle)}">${esc(subtitle)}</p>` : ''}
      </div>`;
    return card;
  }

  function uniqueByName(items) {
    const seen = new Set();
    const out = [];
    for (const item of items) {
      const key = normalize(item?.name || item?.title);
      if (!key || seen.has(key)) continue;
      seen.add(key);
      out.push(item);
    }
    return out;
  }

  function localMovieForSelection(selection) {
    const movies = mediaItems().filter(item => item?.type === 'movies');
    const payload = selection?.payload || {};
    const key = String(selection?.source_key || '');
    return movies.find(item => String(item.id || '') === key)
      || movies.find(item => String(item.url || '') === key)
      || movies.find(item => payload.url && String(item.url || '') === String(payload.url))
      || movies.find(item => normalize(item.name) === normalize(selection?.title || payload.name));
  }

  function automaticMovies() {
    const year = String(YEAR);
    return mediaItems().filter(item => {
      if (item?.type !== 'movies') return false;
      const group = String(item.group || '').toLowerCase();
      return group.includes(`lançamentos ${year}`) || group.includes(`lancamentos ${year}`) || group.includes(year);
    });
  }

  function renderMovieRail(selections) {
    const container = $('homeLancamentosContainer');
    if (!container) return;
    container.innerHTML = '';
    const pinned = selections.map(localMovieForSelection).filter(Boolean);
    const pinnedKeys = new Set(pinned.map(item => normalize(item.name)));
    const auto = automaticMovies().filter(item => !pinnedKeys.has(normalize(item.name)));
    const items = uniqueByName([...pinned, ...auto]).slice(0, MAX_ITEMS);
    if (!items.length) return emptyRail(container, `Nenhum lançamento de ${YEAR} encontrado na lista.`);
    items.forEach(item => container.appendChild(posterCard({
      title: item.name,
      image: item.logo,
      subtitle: item.group || '',
      onClick: () => {
        try {
          if (typeof openMovieModal === 'function') openMovieModal(item);
          else if (typeof openVodPlayer === 'function') openVodPlayer(item);
        } catch (_) {}
      },
      icon: 'film'
    })));
  }

  function seriesItems() {
    return mediaItems().filter(item => item?.type === 'series');
  }

  function resolveLocalSeries(title) {
    const target = normalize(title);
    if (!target) return null;
    return seriesItems().find(item => normalize(item.name) === target)
      || seriesItems().find(item => normalize(item.name).startsWith(target + ' '))
      || null;
  }

  function localSeriesForSelection(selection) {
    const payload = selection?.payload || {};
    const key = String(selection?.source_key || '');
    const all = seriesItems();
    return all.find(item => String(item.id || '') === key)
      || all.find(item => String(item.url || '') === key)
      || all.find(item => payload.url && String(item.url || '') === String(payload.url))
      || all.find(item => normalize(item.name) === normalize(selection?.title || payload.name));
  }

  function openSeriesItem(item) {
    if (!item) return;
    try {
      if (typeof openSeriesModal === 'function') openSeriesModal(item);
      else if (typeof openVodPlayer === 'function') openVodPlayer(item);
    } catch (_) {}
  }

  async function renderSeriesRail(selections) {
    const container = $('homeSeriesLancamentosContainer');
    if (!container) return;
    container.innerHTML = '<p class="text-xs text-purple-400/60">Preparando séries em destaque...</p>';

    const pinned = selections.map(localSeriesForSelection).filter(Boolean);
    const pinnedNames = new Set(pinned.map(item => normalize(item.name)));
    let automatic = [];
    try { automatic = await popularSeries(); } catch (_) {}

    container.innerHTML = '';
    const cards = [];

    pinned.forEach(item => {
      cards.push({
        key: normalize(item.name),
        title: item.name,
        image: item.logo || '',
        subtitle: item.group || 'Série selecionada',
        sourceLabel: 'Lux',
        onClick: () => openSeriesItem(item)
      });
    });

    for (const entry of automatic) {
      const key = normalize(entry.title);
      if (!key || pinnedNames.has(key) || cards.some(card => card.key === key)) continue;
      const local = resolveLocalSeries(entry.title);
      cards.push({
        key,
        title: entry.title,
        image: entry.image || '',
        subtitle: entry.rating
          ? `${entry.source || 'IMDb'} ${Number(entry.rating).toFixed(1)} · ${entry.release_year || YEAR}`
          : `${entry.source || 'IMDb'} · ${entry.release_year || YEAR}`,
        sourceLabel: entry.source || 'IMDb',
        onClick: local
          ? () => openSeriesItem(local)
          : (entry.url ? () => window.open(entry.url, '_blank', 'noopener') : null)
      });
      if (cards.length >= MAX_ITEMS) break;
    }

    if (!cards.length) return emptyRail(container, 'Nenhuma série selecionada e a busca automática está indisponível agora.');

    cards.slice(0, MAX_ITEMS).forEach(card => container.appendChild(posterCard({
      title: card.title,
      image: card.image,
      subtitle: card.subtitle,
      sourceLabel: card.sourceLabel,
      onClick: card.onClick,
      icon: 'clapperboard'
    })));
  }

  function openSelectedGame(selection) {
    const id = selection?.payload?.id || selection?.source_key;
    try {
      if (typeof openGameEmulatorById === 'function') return openGameEmulatorById(id);
      if (typeof setSection === 'function') return setSection('games');
    } catch (_) {}
  }

  function bookFromSelection(selection) {
    const payload = selection?.payload || {};
    return {
      id: payload.content_hash || payload.id || selection.source_key,
      title: payload.title || selection.title,
      authors: payload.authors || '',
      description: payload.description || '',
      cover_url: payload.cover_url || selection.image_url || '',
      category: payload.category || 'Livros',
      format: payload.format || 'pdf',
      sourceUrl: payload.url || payload.sourceUrl || '',
      origin: 'catalog',
      remote: true,
      language_code: payload.language_code || '',
      collection_path: payload.collection_path || '',
    };
  }

  function openSelectedBook(selection) {
    const book = bookFromSelection(selection);
    try { if (typeof setSection === 'function') setSection('reading'); } catch (_) {}
    setTimeout(() => {
      try {
        if (window.LuxReader?.open && book.id && book.sourceUrl) window.LuxReader.open(book);
        else {
          const search = $('readingSearch');
          if (search) {
            search.value = book.title;
            search.dispatchEvent(new Event('input', { bubbles: true }));
          }
        }
      } catch (_) {}
    }, 120);
  }

  function renderChosenRail(rail, containerId, selections) {
    const container = $(containerId);
    const section = $(containerId + 'Section');
    if (!container || !section) return;
    if (!selections.length) {
      section.classList.add('hidden');
      container.innerHTML = '';
      return;
    }
    section.classList.remove('hidden');
    container.innerHTML = '';
    selections.slice(0, MAX_ITEMS).forEach(selection => {
      const payload = selection.payload || {};
      const title = selection.title || payload.title || payload.name || 'Destaque';
      const image = selection.image_url || payload.cover_url || payload.logo || '';
      const subtitle = selection.subtitle || (rail === 'games'
        ? [payload.console, payload.release_year].filter(Boolean).join(' · ')
        : [payload.authors, payload.category].filter(Boolean).join(' · '));
      container.appendChild(posterCard({
        title,
        image,
        subtitle,
        onClick: rail === 'games' ? () => openSelectedGame(selection) : () => openSelectedBook(selection),
        icon: rail === 'games' ? 'gamepad-2' : 'book-open'
      }));
    });
  }

  async function renderHome(force = false) {
    if (!ensureHomeSections()) return;
    let items = [];
    try { items = await publicItems(force); }
    catch (error) { console.warn('[Lux Home] Seleções personalizadas indisponíveis:', error); }

    const byRail = rail => items
      .filter(item => item.rail === rail)
      .sort((a, b) => Number(a.position) - Number(b.position));

    renderMovieRail(byRail('movies'));
    renderSeriesRail(byRail('series'));
    renderChosenRail('games', 'homeFeaturedGamesContainer', byRail('games'));
    renderChosenRail('books', 'homeFeaturedBooksContainer', byRail('books'));
    try { lucide.createIcons(); } catch (_) {}
  }

  function mediaCandidate(item, typeLabel) {
    return {
      key: String(item.id || item.url || normalize(item.name)),
      source_key: String(item.id || item.url || normalize(item.name)),
      title: item.name || 'Sem título',
      subtitle: item.group || typeLabel,
      image_url: item.logo || '',
      payload: {
        id: item.id || '',
        url: item.url || '',
        name: item.name || '',
        group: item.group || '',
        logo: item.logo || '',
        type: item.type || ''
      }
    };
  }

  async function loadAdminCandidates(rail) {
    if (rail === 'movies') {
      const autoGroup = automaticMovies();
      const allMovies = mediaItems().filter(item => item?.type === 'movies');
      const preferred = [...autoGroup, ...allMovies.filter(item => !autoGroup.includes(item))];
      admin.candidates.movies = uniqueByName(preferred).map(item => mediaCandidate(item, 'Filme'));
      return;
    }

    if (rail === 'series') {
      admin.candidates.series = uniqueByName(seriesItems()).map(item => mediaCandidate(item, 'Série'));
      return;
    }

    if (rail === 'games') {
      const { data, error } = await supabaseClient
        .from('games')
        .select('id,title,console,release_year,cover_url,cover_path,synopsis,status')
        .eq('status', 'approved')
        .order('title', { ascending: true });
      if (error) throw error;
      admin.candidates.games = (data || []).map(game => ({
        key: String(game.id),
        source_key: String(game.id),
        title: game.title || 'Sem título',
        subtitle: [game.console, game.release_year].filter(Boolean).join(' · '),
        image_url: game.cover_url || (typeof gameStorageUrl === 'function' ? gameStorageUrl(game.cover_path) : ''),
        payload: {
          id: game.id, title: game.title, console: game.console, release_year: game.release_year,
          cover_url: game.cover_url || '', cover_path: game.cover_path || '', synopsis: game.synopsis || ''
        }
      }));
      return;
    }

    if (rail === 'books') {
      const records = await window.LuxReaderCloud?.catalog?.(true) || [];
      admin.candidates.books = records
        .filter(book => book.status === 'approved' && book.upload_complete)
        .map(book => ({
          key: String(book.content_hash),
          source_key: String(book.content_hash),
          title: book.title || 'Sem título',
          subtitle: [book.authors, book.category].filter(Boolean).join(' · '),
          image_url: book.cover_url || '',
          payload: {
            content_hash: book.content_hash, title: book.title, authors: book.authors || '',
            description: book.description || '', cover_url: book.cover_url || '',
            category: book.category || 'Livros', format: book.format || 'pdf', url: book.url || '',
            language_code: book.language_code || '', collection_path: book.collection_path || '',
            status: book.status, upload_complete: book.upload_complete
          }
        }));
    }
  }

  function adminHtml() {
    return `<section id="homeRailAdminRoot" class="rounded-3xl border border-purple-900/60 bg-[#120c1f] p-5 md:p-6 space-y-4">
      <div>
        <h3 class="text-base font-bold text-white">Faixas da Home</h3>
        <p class="mt-1 text-xs text-purple-300">Em Filmes e Séries, os itens escolhidos entram primeiro e o Lux completa até 12 automaticamente. Jogos e Livros mostram somente o que você selecionar.</p>
      </div>
      <div class="flex flex-wrap gap-2" data-home-rail-tabs>
        <button type="button" data-home-rail-tab="movies" class="rounded-xl px-3 py-2 text-xs font-bold">Filmes</button>
        <button type="button" data-home-rail-tab="series" class="rounded-xl px-3 py-2 text-xs font-bold">Séries</button>
        <button type="button" data-home-rail-tab="games" class="rounded-xl px-3 py-2 text-xs font-bold">Jogos</button>
        <button type="button" data-home-rail-tab="books" class="rounded-xl px-3 py-2 text-xs font-bold">Livros</button>
      </div>
      <div class="flex flex-col md:flex-row gap-2">
        <input id="homeRailSearch" type="search" placeholder="Buscar no catálogo..." class="flex-1 rounded-xl border border-purple-900/50 bg-[#180f29] px-3 py-2.5 text-xs text-white focus:outline-none focus:border-purple-500">
        <button id="homeRailRefresh" type="button" class="rounded-xl border border-purple-800/60 bg-purple-950/60 px-4 py-2 text-xs font-bold text-purple-200 hover:bg-purple-900">Atualizar catálogo</button>
        <button id="homeRailSave" type="button" class="rounded-xl bg-emerald-600 hover:bg-emerald-500 px-4 py-2 text-xs font-bold text-white">Salvar seleção</button>
      </div>
      <div class="flex items-center justify-between gap-3">
        <p id="homeRailHint" class="text-[11px] text-purple-400"></p>
        <span id="homeRailCount" class="rounded-full bg-purple-950 px-2.5 py-1 text-[10px] font-mono text-purple-300">0 / 12</span>
      </div>
      <p id="homeRailStatus" class="min-h-[18px] text-xs text-purple-300"></p>
      <div id="homeRailPicker" class="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3"></div>
    </section>`;
  }

  function ensureAdminArea() {
    const panel = $('adminTabHighlights');
    if (!panel || $('homeRailAdminRoot')) return Boolean($('homeRailAdminRoot'));
    panel.insertAdjacentHTML('beforeend', adminHtml());
    wireAdmin();
    return true;
  }

  function setAdminStatus(message, error = false) {
    const node = $('homeRailStatus');
    if (!node) return;
    node.textContent = message || '';
    node.className = `min-h-[18px] text-xs ${error ? 'text-rose-300' : 'text-purple-300'}`;
  }

  function selectedKeys(rail = admin.activeRail) {
    return (admin.saved[rail] || []).map(item => String(item.source_key));
  }

  function setSelectedKeys(rail, keys) {
    const map = new Map((admin.candidates[rail] || []).map(candidate => [String(candidate.source_key), candidate]));
    admin.saved[rail] = keys
      .map(key => map.get(String(key)))
      .filter(Boolean)
      .map((candidate, index) => ({ ...candidate, position: index }));
  }

  function railHint(rail) {
    if (rail === 'movies') return 'Os filmes marcados ficam no começo; o Lux completa o restante até 12 com os lançamentos da lista.';
    if (rail === 'series') return 'As séries marcadas ficam no começo; o Lux tenta completar o restante até 12 com lançamentos populares do IMDb.';
    if (rail === 'games') return 'Escolha até 12 jogos do catálogo Lux para aparecerem na Home.';
    return 'Escolha até 12 livros do catálogo compartilhado para aparecerem na Home.';
  }

  function renderAdminTabs() {
    document.querySelectorAll('[data-home-rail-tab]').forEach(button => {
      const active = button.dataset.homeRailTab === admin.activeRail;
      button.className = active
        ? 'rounded-xl bg-purple-600 px-3 py-2 text-xs font-bold text-white'
        : 'rounded-xl bg-[#180f29] px-3 py-2 text-xs font-bold text-purple-200 hover:bg-[#23153b]';
    });
    if ($('homeRailHint')) $('homeRailHint').textContent = railHint(admin.activeRail);
    if ($('homeRailSearch')) $('homeRailSearch').value = admin.query[admin.activeRail] || '';
  }

  function renderAdminPicker() {
    const rail = admin.activeRail;
    const picker = $('homeRailPicker');
    const count = $('homeRailCount');
    if (!picker || !count) return;

    const selected = new Set(selectedKeys(rail));
    count.textContent = `${selected.size} / ${MAX_ITEMS}`;
    const query = normalize(admin.query[rail]);
    const all = admin.candidates[rail] || [];
    const filtered = all.filter(candidate => !query || normalize(`${candidate.title} ${candidate.subtitle}`).includes(query));
    const ordered = [
      ...filtered.filter(candidate => selected.has(String(candidate.source_key))),
      ...filtered.filter(candidate => !selected.has(String(candidate.source_key)))
    ].slice(0, 100);

    if (!ordered.length) {
      picker.innerHTML = '<p class="col-span-full py-6 text-center text-xs text-purple-400/70">Nenhum item encontrado.</p>';
      return;
    }

    picker.innerHTML = ordered.map(candidate => {
      const checked = selected.has(String(candidate.source_key));
      return `<label class="relative overflow-hidden rounded-2xl border ${checked ? 'border-emerald-500/70 bg-emerald-950/20' : 'border-purple-900/50 bg-[#180f29]'} cursor-pointer transition hover:border-purple-500/70">
        <input type="checkbox" data-home-rail-key="${esc(candidate.source_key)}" class="sr-only" ${checked ? 'checked' : ''}>
        <div class="aspect-[2/3] bg-[#0c0814] relative overflow-hidden">
          ${candidate.image_url ? `<img src="${esc(candidate.image_url)}" class="h-full w-full object-cover" loading="lazy" referrerpolicy="no-referrer" alt="">` : '<div class="absolute inset-0 flex items-center justify-center text-purple-700"><i data-lucide="image" class="h-8 w-8"></i></div>'}
          ${checked ? '<span class="absolute right-2 top-2 rounded-full bg-emerald-500 p-1 text-white"><i data-lucide="check" class="h-3.5 w-3.5"></i></span>' : ''}
        </div>
        <div class="p-2.5">
          <strong class="block truncate text-[11px] text-white" title="${esc(candidate.title)}">${esc(candidate.title)}</strong>
          <span class="mt-1 block truncate text-[9px] text-purple-400">${esc(candidate.subtitle || '')}</span>
        </div>
      </label>`;
    }).join('');

    picker.querySelectorAll('[data-home-rail-key]').forEach(input => {
      input.addEventListener('change', () => {
        const key = String(input.dataset.homeRailKey || '');
        let keys = selectedKeys(rail);
        if (input.checked) {
          if (keys.length >= MAX_ITEMS) {
            input.checked = false;
            setAdminStatus(`Você pode escolher no máximo ${MAX_ITEMS} itens.`, true);
            return;
          }
          if (!keys.includes(key)) keys.push(key);
        } else {
          keys = keys.filter(value => value !== key);
        }
        setSelectedKeys(rail, keys);
        setAdminStatus('');
        renderAdminPicker();
        try { lucide.createIcons(); } catch (_) {}
      });
    });
    try { lucide.createIcons(); } catch (_) {}
  }

  async function loadSavedAdminSelections() {
    const data = await invoke('list_admin', {}, true);
    const rows = Array.isArray(data.items) ? data.items : [];
    for (const rail of RAILS) {
      admin.saved[rail] = rows
        .filter(item => item.rail === rail)
        .sort((a, b) => Number(a.position) - Number(b.position));
    }
  }

  async function refreshAdmin(force = false) {
    if (admin.loading || account()?.role !== 'admin') return;
    if (!ensureAdminArea()) return;
    admin.loading = true;
    setAdminStatus('Carregando catálogo e seleção...');
    try {
      const hasAnySaved = RAILS.some(rail => admin.saved[rail]?.length);
      if (force || !hasAnySaved) await loadSavedAdminSelections();

      await loadAdminCandidates(admin.activeRail);
      const currentKeys = selectedKeys(admin.activeRail);
      const candidateMap = new Map((admin.candidates[admin.activeRail] || []).map(item => [String(item.source_key), item]));
      admin.saved[admin.activeRail] = currentKeys.map((key, index) => {
        const fresh = candidateMap.get(key);
        const previous = admin.saved[admin.activeRail].find(item => String(item.source_key) === key);
        return fresh ? { ...fresh, position: index } : previous;
      }).filter(Boolean);

      renderAdminTabs();
      renderAdminPicker();
      setAdminStatus('Pronto. Marque os itens que devem aparecer na Home.');
    } catch (error) {
      console.warn('[Lux Home] Falha no seletor de faixas:', error);
      setAdminStatus(error.message || 'Não foi possível carregar esta seleção.', true);
    } finally {
      admin.loading = false;
    }
  }

  async function saveAdminRail() {
    const rail = admin.activeRail;
    const button = $('homeRailSave');
    if (button) button.disabled = true;
    setAdminStatus('Salvando seleção...');
    try {
      const items = (admin.saved[rail] || []).slice(0, MAX_ITEMS).map((item, index) => ({
        source_key: item.source_key,
        title: item.title,
        subtitle: item.subtitle,
        image_url: item.image_url,
        payload: item.payload,
        position: index,
      }));
      await invoke('replace', { rail, items }, true);
      publicCache.at = 0;
      if (rail === 'series') seriesCache.at = 0;
      await loadSavedAdminSelections();
      await renderHome(true);
      renderAdminPicker();
      setAdminStatus(`Seleção salva: ${items.length} item(ns).`);
    } catch (error) {
      setAdminStatus(error.message || 'Não foi possível salvar.', true);
    } finally {
      if (button) button.disabled = false;
    }
  }

  function wireAdmin() {
    const root = $('homeRailAdminRoot');
    if (!root || root.dataset.wired === '1') return;
    root.dataset.wired = '1';

    root.querySelectorAll('[data-home-rail-tab]').forEach(button => {
      button.addEventListener('click', async () => {
        admin.activeRail = button.dataset.homeRailTab || 'movies';
        renderAdminTabs();
        setAdminStatus('Carregando catálogo...');
        try {
          await loadAdminCandidates(admin.activeRail);
          renderAdminPicker();
          setAdminStatus('Pronto. Marque os itens que devem aparecer na Home.');
        } catch (error) {
          setAdminStatus(error.message || 'Não foi possível carregar este catálogo.', true);
        }
      });
    });

    $('homeRailSearch')?.addEventListener('input', event => {
      admin.query[admin.activeRail] = event.target.value || '';
      renderAdminPicker();
    });
    $('homeRailRefresh')?.addEventListener('click', () => refreshAdmin(true));
    $('homeRailSave')?.addEventListener('click', saveAdminRail);
  }

  function installAdminObserver() {
    if (window.__luxHomeRailAdminObserver) return;
    const observer = new MutationObserver(() => {
      if (ensureAdminArea()) wireAdmin();
    });
    observer.observe(document.documentElement, { childList: true, subtree: true });
    window.__luxHomeRailAdminObserver = observer;
  }

  function wrapAdminTab() {
    if (typeof window.switchAdminTab !== 'function' || window.switchAdminTab.__luxHomeRailsWrapped) return false;
    const original = window.switchAdminTab;
    const wrapped = function (tab) {
      const result = original.apply(this, arguments);
      if (tab === 'highlights') setTimeout(() => refreshAdmin(false), 0);
      return result;
    };
    wrapped.__luxHomeRailsWrapped = true;
    window.switchAdminTab = wrapped;
    return true;
  }

  function wrapHomeDashboard() {
    if (typeof window.renderHomeDashboard !== 'function' || window.renderHomeDashboard.__luxHomeRailsWrapped) return false;
    const original = window.renderHomeDashboard;
    const wrapped = async function () {
      const result = await original.apply(this, arguments);
      renderHome(false);
      return result;
    };
    wrapped.__luxHomeRailsWrapped = true;
    window.renderHomeDashboard = wrapped;
    return true;
  }

  function boot() {
    ensureHomeSections();
    ensureAdminArea();
    installAdminObserver();
    wrapAdminTab();
    wrapHomeDashboard();
    renderHome(false);

    $('navHome')?.addEventListener('click', () => setTimeout(() => renderHome(false), 0));
    $('bNavHome')?.addEventListener('click', () => setTimeout(() => renderHome(false), 0));

    let attempts = 0;
    const timer = setInterval(() => {
      attempts += 1;
      ensureHomeSections();
      ensureAdminArea();
      const homeReady = wrapHomeDashboard();
      const adminReady = wrapAdminTab();
      if (((homeReady || window.renderHomeDashboard?.__luxHomeRailsWrapped)
        && (adminReady || window.switchAdminTab?.__luxHomeRailsWrapped)) || attempts >= 160) {
        clearInterval(timer);
      }
    }, 50);
  }

  window.LuxHomeRails = {
    render: renderHome,
    refreshAdmin: () => refreshAdmin(true),
    series: () => popularSeries(true)
  };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot, { once: true });
  else boot();
})();
