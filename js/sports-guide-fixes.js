(() => {
  'use strict';

  const VERSION = '20260914-sports-guide-fixes-1';
  if (window.__luxSportsGuideFixesInstalled === VERSION) return;
  window.__luxSportsGuideFixesInstalled = VERSION;

  const GROUP_RE = /(guia\s+de\s+jogos|jogos\s+do\s+dia)/i;
  const ROLLOVER_AFTER = 180 * 60 * 1000;
  const TEAM_SLUGS = new Map(Object.entries({
    'como': 'como-1907',
    'como 1907': 'como-1907',
    'estrela': 'estrela-amadora',
    'estrela amadora': 'estrela-amadora'
  }));

  let installed = false;
  let refreshBusy = false;

  const norm = value => String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/&/g, ' e ')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  function dateKey(offset = 0) {
    const date = new Date(Date.now() + offset * 86400000);
    try {
      const parts = Object.fromEntries(new Intl.DateTimeFormat('en-CA', {
        timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit'
      }).formatToParts(date).map(part => [part.type, part.value]));
      return `${parts.year}-${parts.month}-${parts.day}`;
    } catch (_) {
      return date.toISOString().slice(0, 10);
    }
  }

  function cleanTeam(value) {
    return String(value || '')
      .replace(/\s+/g, ' ')
      .trim()
      .replace(/^[^\p{L}\p{N}]+/u, '')
      .replace(/[^\p{L}\p{N})]+$/u, '')
      .trim();
  }

  function normalizeGuideName(value) {
    const raw = String(value || '').replace(/\s+/g, ' ').trim();
    const match = raw.match(/^(.+?)\s+(?:x|×|vs\.?|v\.)\s+(.+)$/i);
    if (!match) return raw;

    let home = match[1].trim();
    let away = match[2].trim();
    let time = '';
    let label = '';

    const labelMatch = away.match(/^(.*?)(?:\s*[-–—|]\s*|\s+)((?:sinal|op[cç][aã]o|canal|feed)\s*\d*)\s*$/i);
    if (labelMatch) {
      away = labelMatch[1].trim();
      label = labelMatch[2].trim();
    }

    const leadingTime = home.match(/^[^\p{L}\p{N}]*(\d{1,2}:\d{2})\s*(.*)$/u);
    if (leadingTime) {
      time = leadingTime[1].padStart(5, '0');
      home = leadingTime[2].trim();
    }

    if (!time) {
      const trailingTime = away.match(/^(.*?)(?:\s*[-–—|]\s*|\s+)(\d{1,2}:\d{2})\s*$/i);
      if (trailingTime) {
        away = trailingTime[1].trim();
        time = trailingTime[2].padStart(5, '0');
      }
    }

    home = cleanTeam(home);
    away = cleanTeam(away);
    if (!home || !away) return raw;

    label = label
      .replace(/^sinal\s*(\d+)$/i, (_, number) => `Sinal ${number}`)
      .replace(/^sinal$/i, 'Sinal')
      .trim();

    return `${home} x ${away}${time ? ` - ${time}` : ''}${label ? ` ${label}` : ''}`;
  }

  function guideItems() {
    try {
      return Array.isArray(allMediaItems)
        ? allMediaItems.filter(item => item?.type === 'live' && GROUP_RE.test(String(item?.group || '')))
        : [];
    } catch (_) {
      return [];
    }
  }

  function sanitizeGuideItems() {
    let changed = 0;
    guideItems().forEach(item => {
      const original = String(item._luxSportsOriginalName || item.name || '');
      if (!item._luxSportsOriginalName) item._luxSportsOriginalName = original;
      const normalized = normalizeGuideName(original);
      if (normalized && normalized !== item.name) {
        item.name = normalized;
        delete item._luxSearchData;
        changed += 1;
      }
    });
    return changed;
  }

  function repairImplicitDates() {
    const games = window.LuxSports?.state?.games;
    if (!Array.isArray(games)) return 0;

    const today = dateKey(0);
    const tomorrow = dateKey(1);
    const now = Date.now();
    let changed = 0;

    games.forEach(game => {
      if (!game?.time || game.date) return;
      const todayKickoff = Date.parse(`${today}T${game.time}:00-03:00`);
      if (!Number.isFinite(todayKickoff)) return;

      if (todayKickoff < now - ROLLOVER_AFTER) {
        game.date = tomorrow;
        changed += 1;
      }
    });

    return changed;
  }

  function footyUrl(slug) {
    return `https://assets.footylogos.com/logos/${slug}/${slug}-logo-footylogos.svg`;
  }

  function addAliasLogo(teamBox, name) {
    const slug = TEAM_SLUGS.get(norm(name));
    if (!slug || !teamBox) return;
    const holder = teamBox.firstElementChild;
    if (!holder || holder.querySelector('img[data-guide-fix-logo], img[data-footy-logo], img[data-team-logo]:not(.hidden)')) return;

    const img = document.createElement('img');
    img.dataset.guideFixLogo = '1';
    img.src = footyUrl(slug);
    img.alt = '';
    img.loading = 'lazy';
    img.decoding = 'async';
    img.referrerPolicy = 'no-referrer';
    img.className = 'h-9 w-9 object-contain';
    img.onload = () => holder.querySelector('[data-shield-fallback]')?.classList.add('hidden');
    img.onerror = () => img.remove();
    holder.prepend(img);
  }

  function decorateAliasLogos() {
    const games = window.LuxSports?.state?.games || [];
    document.querySelectorAll('#homeJogosContainer [data-sports-guide-card]').forEach(card => {
      const gameId = card.querySelector('[data-game]')?.dataset.game;
      let game = gameId ? games.find(row => row.id === gameId) : null;
      if (!game) {
        const text = norm(card.textContent);
        game = games.find(row => text.includes(norm(row.home)) && text.includes(norm(row.away)));
      }
      if (!game) return;
      const grid = card.children?.[1];
      if (!grid || grid.children.length < 3) return;
      addAliasLogo(grid.children[0], game.home);
      addAliasLogo(grid.children[2], game.away);
    });
  }

  function finishRepair(render = true) {
    const datesChanged = repairImplicitDates();
    if (render && datesChanged && typeof window.LuxSports?.render === 'function') {
      window.LuxSports.render();
    }
    queueMicrotask(decorateAliasLogos);
  }

  function install() {
    const api = window.LuxSports;
    if (!api?.refresh || !api?.render) return false;
    if (installed) return true;

    const originalRefresh = api.refresh.bind(api);
    const wrappedRefresh = function () {
      sanitizeGuideItems();
      const result = originalRefresh.apply(this, arguments);
      finishRepair(true);
      return result;
    };
    wrappedRefresh.__luxSportsGuideFixOriginal = originalRefresh;
    api.refresh = wrappedRefresh;

    sanitizeGuideItems();
    originalRefresh();
    finishRepair(true);
    installed = true;
    console.info('[Lux Sports] Guia corrigido: horários, nomes e escudos normalizados.');
    return true;
  }

  const observer = new MutationObserver(() => queueMicrotask(decorateAliasLogos));
  const home = document.getElementById('homeJogosContainer');
  if (home) observer.observe(home, { childList: true });

  let attempts = 0;
  const timer = setInterval(() => {
    attempts += 1;
    if (install()) {
      const changed = sanitizeGuideItems();
      if (changed && !refreshBusy) {
        refreshBusy = true;
        try { window.LuxSports.refresh(); }
        finally { refreshBusy = false; }
      } else {
        finishRepair(false);
      }
    }
    if (attempts >= 240) clearInterval(timer);
  }, 250);
})();
