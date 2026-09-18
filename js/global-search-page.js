(() => {
  'use strict';

  const VERSION = '20260918-global-search1';
  if (window.__luxGlobalSearchVersion === VERSION) return;
  window.__luxGlobalSearchVersion = VERSION;

  const MIN_SCORE = 0.5;
  const PAGE_SIZE = 60;
  const MAX_TITLE_LENGTH = 180;
  const state = {
    index: [],
    matches: [],
    visible: PAGE_SIZE,
    query: '',
    building: false,
    built: false,
    debounce: null,
    mediaRef: null,
    mediaLength: -1,
  };

  const TYPE_META = {
    live: { label: 'TV', icon: 'tv' },
    movie: { label: 'Filme', icon: 'film' },
    series: { label: 'Série', icon: 'clapperboard' },
    game: { label: 'Jogo', icon: 'gamepad-2' },
    book: { label: 'Livro', icon: 'book-open' },
  };

  function normalize(value = '') {
    return String(value)
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function escapeHtml(value = '') {
    return String(value).replace(/[&<>"']/g, char => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[char]));
  }

  function truncate(value = '', max = MAX_TITLE_LENGTH) {
    const text = String(value || '').trim();
    return text.length > max ? `${text.slice(0, max - 1)}…` : text;
  }

  function levenshtein(a, b) {
    if (a === b) return 0;
    if (!a.length) return b.length;
    if (!b.length) return a.length;
    if (Math.abs(a.length - b.length) > Math.max(a.length, b.length) * 0.6) return Math.max(a.length, b.length);

    const previous = new Array(b.length + 1);
    const current = new Array(b.length + 1);
    for (let j = 0; j <= b.length; j++) previous[j] = j;

    for (let i = 1; i <= a.length; i++) {
      current[0] = i;
      for (let j = 1; j <= b.length; j++) {
        const cost = a[i - 1] === b[j - 1] ? 0 : 1;
        current[j] = Math.min(
          previous[j] + 1,
          current[j - 1] + 1,
          previous[j - 1] + cost
        );
      }
      for (let j = 0; j <= b.length; j++) previous[j] = current[j];
    }
    return previous[b.length];
  }

  function tokenSimilarity(queryToken, titleToken) {
    if (!queryToken || !titleToken) return 0;
    if (queryToken === titleToken) return 1;

    const minLen = Math.min(queryToken.length, titleToken.length);
    if (minLen >= 3 && (titleToken.startsWith(queryToken) || queryToken.startsWith(titleToken))) {
      const ratio = minLen / Math.max(queryToken.length, titleToken.length);
      return Math.max(0.78, ratio);
    }

    if (queryToken[0] !== titleToken[0]) return 0;
    if (Math.abs(queryToken.length - titleToken.length) > Math.max(queryToken.length, titleToken.length) * 0.5) return 0;

    const distance = levenshtein(queryToken, titleToken);
    return Math.max(0, 1 - (distance / Math.max(queryToken.length, titleToken.length)));
  }

  function similarity(title, query) {
    const normalizedTitle = normalize(title);
    const normalizedQuery = normalize(query);
    if (!normalizedTitle || !normalizedQuery) return 0;

    if (normalizedTitle === normalizedQuery) return 1;
    if (normalizedTitle.startsWith(`${normalizedQuery} `)) return 0.99;
    if (normalizedTitle.includes(normalizedQuery)) return 0.97;

    const queryTokens = normalizedQuery.split(' ').filter(Boolean);
    const titleTokens = normalizedTitle.split(' ').filter(Boolean);
    if (!queryTokens.length || !titleTokens.length) return 0;

    let total = 0;
    let strong = 0;
    for (const queryToken of queryTokens) {
      let best = 0;
      for (const titleToken of titleTokens) {
        const score = tokenSimilarity(queryToken, titleToken);
        if (score > best) best = score;
        if (best === 1) break;
      }
      total += best;
      if (best >= 0.65) strong += 1;
    }

    const average = total / queryTokens.length;
    const coverage = strong / queryTokens.length;
    let score = average * 0.82 + coverage * 0.18;
    if (queryTokens.length > 1 && coverage < 1) score *= 0.82;

    const firstSimilarity = tokenSimilarity(queryTokens[0], titleTokens[0]);
    if (firstSimilarity >= 0.8) score += 0.02;

    return Math.max(0, Math.min(1, score));
  }

  function itemId(prefix, raw, fallback) {
    return `${prefix}:${String(raw?.id ?? raw?.series_id ?? raw?.stream_id ?? raw?.url ?? fallback ?? '').slice(0, 220)}`;
  }

  function mediaKind(item) {
    const type = String(item?.type || '').toLowerCase();
    if (type === 'live' || type === 'tv') return 'live';
    if (type === 'series' || type === 'serie') return 'series';
    if (type === 'movie' || type === 'movies' || type === 'vod' || type === 'film') return 'movie';
    return '';
  }

  function pushUnique(target, seen, entry) {
    if (!entry?.title || !entry?.kind) return;
    const key = entry.key || `${entry.kind}:${normalize(entry.title)}`;
    if (seen.has(key)) return;
    seen.add(key);
    target.push({
      ...entry,
      key,
      normalizedTitle: normalize(entry.title),
      subtitle: String(entry.subtitle || '').trim(),
      image: String(entry.image || '').trim(),
    });
  }

  async function buildMediaIndex(target, seen) {
    let rows = [];
    try { rows = Array.isArray(allMediaItems) ? allMediaItems : []; } catch (_) { rows = []; }

    for (const item of rows) {
      const kind = mediaKind(item);
      if (!kind) continue;
      const title = String(item?.name || item?.seriesName || '').trim();
      if (!title) continue;
      pushUnique(target, seen, {
        kind,
        title,
        subtitle: item?.group || '',
        image: item?.logo || item?.cover || item?.stream_icon || '',
        raw: item,
        key: itemId(kind, item, `${title}:${item?.group || ''}`),
      });
    }
  }

  async function buildGamesIndex(target, seen) {
    try {
      if (typeof loadGamesCatalog !== 'function') return;
      const rows = await loadGamesCatalog();
      const isAdmin = String(currentUser?.role || '').toLowerCase() === 'admin';

      for (const game of Array.isArray(rows) ? rows : []) {
        const status = String(game?.status || 'pending').toLowerCase();
        if (!isAdmin && status !== 'approved') continue;
        const title = String(game?.title || game?.name || '').trim();
        if (!title) continue;
        let cover = game?.cover_url || '';
        if (!cover && game?.cover_path && typeof gameStorageUrl === 'function') cover = gameStorageUrl(game.cover_path);
        pushUnique(target, seen, {
          kind: 'game',
          title,
          subtitle: game?.console ? String(game.console).toUpperCase() : 'Catálogo Lux',
          image: cover,
          raw: { ...game, source: 'lux' },
          key: `game:lux:${game?.id || normalize(title)}`,
        });
      }

      const external = await window.LuxExternalRoms?.list?.();
      for (const game of Array.isArray(external) ? external : []) {
        const title = String(game?.name || game?.title || '').trim();
        if (!title) continue;
        pushUnique(target, seen, {
          kind: 'game',
          title,
          subtitle: `${String(game?.console || '').toUpperCase()} · ROM do dispositivo`,
          image: game?.logo || game?.cover || '',
          raw: { ...game, source: 'external' },
          key: `game:external:${game?.id || normalize(title)}`,
        });
      }
    } catch (error) {
      console.warn('[Lux Search] Jogos não puderam entrar no índice:', error);
    }
  }

  async function buildBooksIndex(target, seen) {
    try {
      const store = window.LuxReaderStore;
      if (store?.owner && store?.list) {
        const owner = store.owner(currentUser);
        if (owner) {
          const books = await store.list(owner);
          for (const book of Array.isArray(books) ? books : []) {
            const title = String(book?.title || book?.fileName || '').trim();
            if (!title) continue;
            pushUnique(target, seen, {
              kind: 'book',
              title,
              subtitle: book?.category || book?.format || 'Leitura',
              image: book?.cover_url || book?.cover || '',
              raw: book,
              bookSource: 'local',
              key: `book:local:${book?.id || normalize(title)}`,
            });
          }
        }
      }
    } catch (error) {
      console.warn('[Lux Search] Biblioteca local não pôde entrar no índice:', error);
    }

    try {
      if (!window.LuxReaderCloud?.request) return;
      const data = await window.LuxReaderCloud.request(
        'reading-source-library',
        { action: 'groups' },
        undefined,
        { timeoutMs: 20000 }
      );
      for (const group of Array.isArray(data?.groups) ? data.groups : []) {
        const title = String(group?.title || group?.franchise || '').trim();
        if (!title) continue;
        pushUnique(target, seen, {
          kind: 'book',
          title,
          subtitle: `${Number(group?.count || 0).toLocaleString('pt-BR')} edições`,
          image: group?.cover_url || '',
          raw: group,
          bookSource: 'published-group',
          key: `book:group:${group?.source_key || ''}:${group?.franchise || normalize(title)}`,
        });
      }
    } catch (error) {
      console.warn('[Lux Search] Biblioteca publicada não pôde entrar no índice:', error);
    }
  }

  async function buildIndex(force = false) {
    if (state.building) return;

    let mediaRef = null;
    let mediaLength = 0;
    try {
      mediaRef = allMediaItems;
      mediaLength = Array.isArray(allMediaItems) ? allMediaItems.length : 0;
    } catch (_) {}

    if (!force && state.built && state.mediaRef === mediaRef && state.mediaLength === mediaLength) return;

    state.building = true;
    updateStatus('Preparando busca em todo o Lux…');
    const target = [];
    const seen = new Set();

    await buildMediaIndex(target, seen);
    await Promise.allSettled([
      buildGamesIndex(target, seen),
      buildBooksIndex(target, seen),
    ]);

    state.index = target;
    state.mediaRef = mediaRef;
    state.mediaLength = mediaLength;
    state.built = true;
    state.building = false;
    updateStatus(`${target.length.toLocaleString('pt-BR')} itens prontos para pesquisar`);

    if (state.query) runSearch(state.query, false);
    else renderRecent();
  }

  function ensureStyles() {
    if (document.getElementById('luxGlobalSearchStyles')) return;
    const style = document.createElement('style');
    style.id = 'luxGlobalSearchStyles';
    style.textContent = `
      #luxGlobalSearchPage{position:fixed;left:0;right:0;top:64px;bottom:0;z-index:18;background:#09060e;display:flex;flex-direction:column;overflow:hidden}
      #luxGlobalSearchPage[hidden]{display:none!important}
      .lux-search-shell{width:100%;max-width:1480px;margin:0 auto;padding:24px 28px 36px;overflow-y:auto;overscroll-behavior:contain}
      .lux-search-top{display:flex;align-items:flex-start;justify-content:space-between;gap:18px;margin-bottom:18px}
      .lux-search-title{font-size:1.35rem;font-weight:900;color:#fff;letter-spacing:-.02em}.lux-search-subtitle{margin-top:4px;color:#9f8aad;font-size:.78rem}
      .lux-search-close{width:36px;height:36px;border:1px solid #6b21a866;background:#180f29;color:#d8b4fe;border-radius:11px;display:grid;place-items:center;cursor:pointer}
      .lux-search-box{position:sticky;top:-24px;z-index:4;padding:10px 0 16px;background:linear-gradient(#09060e 76%,transparent)}
      .lux-search-input-wrap{display:flex;align-items:center;gap:10px;border:1px solid #6b21a877;background:#120c1f;border-radius:16px;padding:0 15px;min-height:52px;box-shadow:0 12px 35px #0005}
      .lux-search-input-wrap:focus-within{border-color:#a855f7;box-shadow:0 0 0 3px #a855f71a,0 12px 35px #0005}
      .lux-search-input-wrap svg{width:18px;height:18px;color:#c084fc;flex:0 0 auto}.lux-search-input{width:100%;background:transparent;border:0;outline:0;color:#fff;font-size:.95rem}.lux-search-input::placeholder{color:#766982}
      .lux-search-clear{border:0;background:transparent;color:#927fa1;font-size:11px;font-weight:800;cursor:pointer;padding:7px 9px;border-radius:9px}.lux-search-clear:hover{color:#fff;background:#2a183d}
      .lux-search-meta{display:flex;align-items:center;justify-content:space-between;gap:12px;margin:3px 2px 14px;color:#a793b6;font-size:.72rem}.lux-search-meta strong{color:#d8b4fe}
      .lux-search-results{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:12px}
      .lux-search-card{min-width:0;display:flex;align-items:center;gap:12px;border:1px solid #3b1d5566;background:#120c1f;border-radius:16px;padding:10px;text-align:left;color:#fff;cursor:pointer;transition:.16s ease}.lux-search-card:hover{transform:translateY(-2px);border-color:#8b5cf699;background:#170e25}
      .lux-search-cover{width:58px;height:78px;flex:0 0 auto;border-radius:11px;overflow:hidden;background:linear-gradient(145deg,#35164d,#100a17);display:grid;place-items:center;color:#c084fc}.lux-search-cover img{width:100%;height:100%;object-fit:cover}.lux-search-cover svg{width:24px;height:24px}
      .lux-search-info{min-width:0;flex:1}.lux-search-type{display:inline-flex;align-items:center;gap:5px;font-size:9px;font-weight:900;text-transform:uppercase;letter-spacing:.06em;color:#d8b4fe;background:#2a143d;border-radius:999px;padding:4px 7px;margin-bottom:7px}.lux-search-type svg{width:11px;height:11px}.lux-search-name{font-size:.82rem;font-weight:850;line-height:1.25;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.lux-search-detail{margin-top:5px;font-size:.66rem;color:#9d86aa;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
      .lux-search-score{font-size:.62rem;color:#7d6b89;flex:0 0 auto;align-self:flex-start;padding:4px 2px}.lux-search-more{display:block;margin:18px auto 0;border:1px solid #7e22ce88;background:#21132f;color:#e9d5ff;border-radius:12px;padding:10px 18px;font-size:.75rem;font-weight:850;cursor:pointer}.lux-search-more:hover{background:#6d28d9;color:#fff}
      .lux-search-empty{border:1px dashed #5b2a7666;border-radius:18px;padding:46px 20px;text-align:center;color:#8e7b9a}.lux-search-empty svg{width:34px;height:34px;margin:0 auto 10px;color:#6d28d9}.lux-search-empty strong{display:block;color:#d8cce3;margin-bottom:4px}
      .lux-search-recent{display:flex;flex-wrap:wrap;gap:8px;margin-top:10px}.lux-search-recent button{border:1px solid #55247799;background:#150d20;color:#c8b4d7;border-radius:999px;padding:8px 11px;font-size:.7rem;font-weight:750;cursor:pointer}.lux-search-recent button:hover{background:#261336;color:#fff}
      @media(max-width:1023px){#luxGlobalSearchPage{bottom:56px}.lux-search-shell{padding:18px 18px 28px}.lux-search-box{top:-18px}.lux-search-results{grid-template-columns:repeat(2,minmax(0,1fr))}}
      @media(max-width:640px){.lux-search-shell{padding:16px 14px 24px}.lux-search-top{margin-bottom:10px}.lux-search-title{font-size:1.15rem}.lux-search-subtitle{font-size:.7rem}.lux-search-input-wrap{min-height:46px;border-radius:14px;padding:0 12px}.lux-search-results{grid-template-columns:1fr;gap:9px}.lux-search-card{padding:8px;border-radius:14px}.lux-search-cover{width:48px;height:66px;border-radius:9px}.lux-search-name{font-size:.78rem}.lux-search-meta{font-size:.67rem}}
    `;
    document.head.appendChild(style);
  }

  function ensurePage() {
    ensureStyles();
    let page = document.getElementById('luxGlobalSearchPage');
    if (page) return page;

    page = document.createElement('section');
    page.id = 'luxGlobalSearchPage';
    page.hidden = true;
    page.setAttribute('aria-label', 'Busca global');
    page.innerHTML = `
      <div class="lux-search-shell">
        <div class="lux-search-top">
          <div><h1 class="lux-search-title">Buscar em todo o Lux</h1><p class="lux-search-subtitle">TV, filmes, séries, jogos e leitura em uma única busca.</p></div>
          <button id="luxGlobalSearchClose" class="lux-search-close" type="button" aria-label="Fechar busca"><i data-lucide="x"></i></button>
        </div>
        <div class="lux-search-box">
          <div class="lux-search-input-wrap">
            <i data-lucide="search"></i>
            <input id="luxGlobalSearchInput" class="lux-search-input" type="search" autocomplete="off" spellcheck="false" placeholder="Ex.: Homem Aranha">
            <button id="luxGlobalSearchClear" class="lux-search-clear" type="button">Limpar</button>
          </div>
        </div>
        <div class="lux-search-meta"><span id="luxGlobalSearchStatus">Preparando busca…</span><span id="luxGlobalSearchCount"></span></div>
        <div id="luxGlobalSearchRecent" class="lux-search-recent"></div>
        <div id="luxGlobalSearchResults" class="lux-search-results"></div>
        <button id="luxGlobalSearchMore" class="lux-search-more" type="button" hidden>Mostrar mais</button>
      </div>`;

    document.body.appendChild(page);
    document.getElementById('luxGlobalSearchClose').addEventListener('click', closePage);
    document.getElementById('luxGlobalSearchClear').addEventListener('click', () => {
      const input = document.getElementById('luxGlobalSearchInput');
      if (input) input.value = '';
      state.query = '';
      state.matches = [];
      state.visible = PAGE_SIZE;
      renderRecent();
      input?.focus();
    });

    const input = document.getElementById('luxGlobalSearchInput');
    input.addEventListener('input', () => {
      clearTimeout(state.debounce);
      const query = input.value;
      state.debounce = setTimeout(() => runSearch(query, false), 220);
    });
    input.addEventListener('keydown', event => {
      if (event.key === 'Enter') {
        event.preventDefault();
        clearTimeout(state.debounce);
        runSearch(input.value, true);
      }
      if (event.key === 'Escape') closePage();
    });

    document.getElementById('luxGlobalSearchMore').addEventListener('click', () => {
      state.visible += PAGE_SIZE;
      renderMatches();
    });

    window.lucide?.createIcons?.();
    return page;
  }

  function updateStatus(text) {
    const node = document.getElementById('luxGlobalSearchStatus');
    if (node) node.textContent = text || '';
  }

  function getRecentSearches() {
    try {
      const storage = typeof userProgressStorage !== 'undefined' ? userProgressStorage : localStorage;
      const parsed = JSON.parse(storage.getItem('lux_recent_searches') || '[]');
      return Array.isArray(parsed) ? parsed.slice(0, 5) : [];
    } catch (_) { return []; }
  }

  function saveRecent(query) {
    const clean = String(query || '').trim();
    if (clean.length < 2) return;
    try {
      const storage = typeof userProgressStorage !== 'undefined' ? userProgressStorage : localStorage;
      let rows = getRecentSearches().filter(item => normalize(item) !== normalize(clean));
      rows.unshift(clean);
      rows = rows.slice(0, 5);
      storage.setItem('lux_recent_searches', JSON.stringify(rows));
    } catch (_) {}
  }

  function renderRecent() {
    const results = document.getElementById('luxGlobalSearchResults');
    const recent = document.getElementById('luxGlobalSearchRecent');
    const count = document.getElementById('luxGlobalSearchCount');
    const more = document.getElementById('luxGlobalSearchMore');
    if (!results || !recent) return;

    results.innerHTML = '';
    count.textContent = '';
    more.hidden = true;
    const rows = getRecentSearches();
    recent.innerHTML = rows.length
      ? rows.map(term => `<button type="button" data-lux-recent="${escapeHtml(term)}">${escapeHtml(term)}</button>`).join('')
      : '';
    recent.querySelectorAll('[data-lux-recent]').forEach(button => button.addEventListener('click', () => {
      const input = document.getElementById('luxGlobalSearchInput');
      if (input) input.value = button.dataset.luxRecent || '';
      runSearch(button.dataset.luxRecent || '', false);
    }));

    if (!state.building) updateStatus(state.built ? 'Digite para buscar por todos os catálogos' : 'Preparando busca em todo o Lux…');
  }

  function runSearch(query, persist = true) {
    const clean = String(query || '').trim();
    state.query = clean;
    state.visible = PAGE_SIZE;
    const recent = document.getElementById('luxGlobalSearchRecent');
    if (recent) recent.innerHTML = '';

    if (!clean) {
      state.matches = [];
      renderRecent();
      return;
    }

    if (persist) saveRecent(clean);
    if (!state.built) {
      updateStatus('Preparando índice…');
      buildIndex(false);
      return;
    }

    const normalizedQuery = normalize(clean);
    const matches = [];
    for (const entry of state.index) {
      const score = similarity(entry.normalizedTitle || entry.title, normalizedQuery);
      if (score < MIN_SCORE) continue;
      matches.push({ entry, score });
    }

    matches.sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      const aLen = a.entry.normalizedTitle.length;
      const bLen = b.entry.normalizedTitle.length;
      const qLen = normalizedQuery.length;
      const distanceA = Math.abs(aLen - qLen);
      const distanceB = Math.abs(bLen - qLen);
      if (distanceA !== distanceB) return distanceA - distanceB;
      return a.entry.title.localeCompare(b.entry.title, 'pt-BR', { sensitivity: 'base', numeric: true });
    });

    state.matches = matches;
    renderMatches();
  }

  function cardHtml(result, index) {
    const { entry, score } = result;
    const meta = TYPE_META[entry.kind] || TYPE_META.movie;
    const image = entry.image
      ? `<img loading="lazy" referrerpolicy="no-referrer" src="${escapeHtml(entry.image)}" alt="">`
      : `<i data-lucide="${meta.icon}"></i>`;
    return `
      <button type="button" class="lux-search-card" data-lux-result="${index}">
        <span class="lux-search-cover">${image}</span>
        <span class="lux-search-info">
          <span class="lux-search-type"><i data-lucide="${meta.icon}"></i>${meta.label}</span>
          <span class="lux-search-name" title="${escapeHtml(entry.title)}">${escapeHtml(truncate(entry.title, 110))}</span>
          <span class="lux-search-detail">${escapeHtml(entry.subtitle || meta.label)}</span>
        </span>
        <span class="lux-search-score">${Math.round(score * 100)}%</span>
      </button>`;
  }

  function renderMatches() {
    const results = document.getElementById('luxGlobalSearchResults');
    const count = document.getElementById('luxGlobalSearchCount');
    const more = document.getElementById('luxGlobalSearchMore');
    if (!results || !count || !more) return;

    if (!state.matches.length) {
      results.innerHTML = `<div class="lux-search-empty" style="grid-column:1/-1"><i data-lucide="search-x"></i><strong>Nada parecido o suficiente</strong><span>Resultados abaixo de 50% de similaridade são ignorados.</span></div>`;
      count.textContent = '0 resultados';
      updateStatus(`Busca por “${state.query}”`);
      more.hidden = true;
      window.lucide?.createIcons?.();
      return;
    }

    const visible = state.matches.slice(0, state.visible);
    results.innerHTML = visible.map(cardHtml).join('');
    results.querySelectorAll('[data-lux-result]').forEach(button => {
      button.addEventListener('click', () => openResult(visible[Number(button.dataset.luxResult)]?.entry));
    });

    count.innerHTML = `<strong>${state.matches.length.toLocaleString('pt-BR')}</strong> resultado${state.matches.length === 1 ? '' : 's'} · ≥ 50%`;
    updateStatus(`Mais parecidos com “${state.query}” primeiro`);
    more.hidden = state.visible >= state.matches.length;
    if (!more.hidden) more.textContent = `Mostrar mais (${Math.min(PAGE_SIZE, state.matches.length - state.visible)})`;
    window.lucide?.createIcons?.();
  }

  async function openPublishedBookGroup(entry) {
    if (typeof setSection === 'function') setSection('reading');
    try { await window.LuxReadingSourceLibrary?.load?.(); } catch (_) {}

    const target = normalize(entry.title);
    let attempts = 0;
    const timer = setInterval(() => {
      attempts += 1;
      const cards = [...document.querySelectorAll('#readingSourceGrid .reading-source-card')];
      const match = cards.find(card => normalize(card.querySelector('strong')?.textContent) === target);
      if (match) {
        clearInterval(timer);
        match.click();
      } else if (attempts >= 35) clearInterval(timer);
    }, 100);
  }

  async function openResult(entry) {
    if (!entry) return;
    closePage();
    try { activeSearchQuery = ''; } catch (_) {}

    if (entry.kind === 'live') {
      if (typeof setSection === 'function') setSection('live');
      setTimeout(() => { try { playLiveChannel(entry.raw); } catch (_) {} }, 80);
      return;
    }
    if (entry.kind === 'movie') {
      if (typeof setSection === 'function') setSection('movies');
      setTimeout(() => { try { openMovieModal(entry.raw); } catch (_) {} }, 80);
      return;
    }
    if (entry.kind === 'series') {
      if (typeof setSection === 'function') setSection('series');
      setTimeout(() => { try { openSeriesModal(entry.raw); } catch (_) {} }, 80);
      return;
    }
    if (entry.kind === 'game') {
      if (typeof setSection === 'function') setSection('games');
      const id = String(entry.raw?.id || '');
      setTimeout(() => { try { openGameCard(id); } catch (_) {} }, 100);
      return;
    }
    if (entry.kind === 'book') {
      if (entry.bookSource === 'published-group') {
        openPublishedBookGroup(entry);
        return;
      }
      if (typeof setSection === 'function') setSection('reading');
      setTimeout(() => window.LuxReader?.open?.(entry.raw), 120);
    }
  }

  function openPage(prefill = '') {
    const page = ensurePage();
    document.getElementById('searchModal')?.classList.add('hidden');
    page.hidden = false;
    document.documentElement.classList.add('lux-global-search-open');

    const input = document.getElementById('luxGlobalSearchInput');
    if (typeof prefill === 'string' && prefill.trim()) input.value = prefill.trim();
    state.query = input.value.trim();

    if (state.query) runSearch(state.query, false);
    else renderRecent();
    buildIndex(false);
    setTimeout(() => input?.focus(), 30);
  }

  function closePage() {
    const page = document.getElementById('luxGlobalSearchPage');
    if (page) page.hidden = true;
    document.documentElement.classList.remove('lux-global-search-open');
  }

  function installOverrides() {
    try { openSearchModal = () => openPage(); } catch (_) {}
    try { executeSearch = () => {
      const legacyInput = document.getElementById('searchInput');
      const query = legacyInput?.value?.trim() || '';
      document.getElementById('searchModal')?.classList.add('hidden');
      openPage(query);
      if (query) saveRecent(query);
    }; } catch (_) {}

    window.openSearchModal = () => openPage();
    window.executeSearch = () => {
      const legacyInput = document.getElementById('searchInput');
      const query = legacyInput?.value?.trim() || '';
      document.getElementById('searchModal')?.classList.add('hidden');
      openPage(query);
      if (query) saveRecent(query);
    };

    document.addEventListener('click', event => {
      const sectionButton = event.target?.closest?.('[onclick*="setSection("]');
      if (sectionButton && !event.target?.closest?.('#luxGlobalSearchPage')) closePage();
    }, true);
  }

  function start() {
    ensurePage();
    installOverrides();
    buildIndex(false);
    console.info('[Lux Search] Busca global unificada ativa.', VERSION);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true });
  else start();

  window.LuxGlobalSearch = {
    version: VERSION,
    open: openPage,
    close: closePage,
    rebuild: () => buildIndex(true),
    search: query => { openPage(query); runSearch(query, true); },
  };
})();
