(() => {
  'use strict';

  if (window.__luxSportsPolishInstalled) return;
  window.__luxSportsPolishInstalled = '20260912-sports-polish2';

  const state = {
    logos: new Map(),
    fallbackLogos: new Map(),
    loadingLogos: false,
    observer: null,
    scheduled: false
  };

  const BROADCASTER_DOMAINS = [
    [/\b(amazon|prime video)\b/, 'primevideo.com'],
    [/\b(sportv|spor tv)\b/, 'sportv.globo.com'],
    [/\bpremiere\b/, 'premiere.globo.com'],
    [/\bespn\b/, 'espn.com.br'],
    [/\bdisney\b/, 'disneyplus.com'],
    [/\bcaze\b/, 'youtube.com'],
    [/^globo$/, 'globo.com'],
    [/\b(ge tv|getv)\b/, 'ge.globo.com'],
    [/\brecord\b/, 'record.r7.com'],
    [/\bapple tv\b/, 'tv.apple.com'],
    [/\bparamount\b/, 'paramountplus.com'],
    [/\b(onefootball|one football)\b/, 'onefootball.com'],
    [/\bsporty\s*net\b/, 'sportynet.com.br'],
    [/\bjovem pan\b/, 'jovempan.com.br'],
    [/\bmetropoles\b/, 'metropoles.com'],
    [/\btv brasil\b/, 'tvbrasil.ebc.com.br'],
    [/\bcbf tv\b/, 'cbf.com.br'],
    [/\bfgf tv\b/, 'fgf.com.br'],
    [/\bfpf tv\b/, 'futebolpaulista.com.br'],
    [/\b(xsports|x sports)\b/, 'xsports.com.br'],
    [/\btve es\b/, 'tve.es.gov.br'],
    [/\b(canal do benja|ulisses tv|cariocao tv)\b/, 'youtube.com']
  ];

  const normalize = value => String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  function localDateKey(offsetDays = 0) {
    const date = new Date(Date.now() + offsetDays * 24 * 60 * 60 * 1000);
    try {
      const parts = new Intl.DateTimeFormat('en-CA', {
        timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit'
      }).formatToParts(date);
      const obj = Object.fromEntries(parts.map(part => [part.type, part.value]));
      return `${obj.year}-${obj.month}-${obj.day}`;
    } catch (_) {
      return date.toISOString().slice(0, 10);
    }
  }

  function kickoffMs(game) {
    return new Date(game?.kickoff || `${game?.date}T${game?.time}:00-03:00`).getTime();
  }

  function gamesForCurrentTab() {
    const api = window.LuxSports;
    const tab = api?.state?.activeTab || 'live';
    const games = (api?.state?.games || []).filter(Boolean);
    const today = localDateKey(0);
    const now = Date.now();

    if (tab === 'results') {
      return games
        .filter(game => game.status === 'finished' && game.date === today)
        .sort((a, b) => kickoffMs(b) - kickoffMs(a))
        .slice(0, 16);
    }
    if (tab === 'live') {
      return games
        .filter(game => game.status === 'live')
        .sort((a, b) => kickoffMs(a) - kickoffMs(b))
        .slice(0, 16);
    }
    return games
      .filter(game => game.status === 'scheduled' && Number.isFinite(kickoffMs(game)) && kickoffMs(game) >= now - 2 * 60 * 1000)
      .sort((a, b) => kickoffMs(a) - kickoffMs(b))
      .slice(0, 20);
  }

  function logoEntryFor(game) {
    if (!game) return null;
    return state.logos.get(String(game.id))
      || state.fallbackLogos.get(`${normalize(game.home)}|${normalize(game.away)}`)
      || null;
  }

  function addLogo(target, src, alt) {
    if (!target || !src || target.querySelector('img[data-lux-team-logo]')) return;
    target.classList.add('flex', 'flex-col', 'items-center', 'justify-center', 'gap-1.5');
    const img = document.createElement('img');
    img.dataset.luxTeamLogo = '1';
    img.src = src;
    img.alt = alt;
    img.loading = 'lazy';
    img.decoding = 'async';
    img.referrerPolicy = 'no-referrer';
    img.className = 'h-7 w-7 object-contain drop-shadow';
    img.addEventListener('error', () => img.remove(), { once: true });
    target.prepend(img);
  }

  function broadcasterDomain(name) {
    const key = normalize(name);
    for (const [pattern, domain] of BROADCASTER_DOMAINS) {
      if (pattern.test(key)) return domain;
    }
    return '';
  }

  function broadcasterIcon(name) {
    const domain = broadcasterDomain(name);
    if (!domain) return '';
    return `https://www.google.com/s2/favicons?domain_url=${encodeURIComponent(`https://${domain}`)}&sz=64`;
  }

  function broadcasterFallback(name) {
    const fallback = document.createElement('span');
    fallback.dataset.luxBroadcasterFallback = '1';
    fallback.className = 'inline-flex h-5 min-w-5 items-center justify-center rounded-md bg-purple-800/70 px-1 text-[8px] font-black text-white';
    fallback.textContent = String(name || 'TV').trim().slice(0, 2).toUpperCase();
    return fallback;
  }

  function appendBroadcasterMark(parent, name) {
    const icon = broadcasterIcon(name);
    if (!icon) {
      parent.appendChild(broadcasterFallback(name));
      return;
    }
    const img = document.createElement('img');
    img.dataset.luxBroadcasterLogo = '1';
    img.src = icon;
    img.alt = `Logo ${name}`;
    img.loading = 'lazy';
    img.decoding = 'async';
    img.referrerPolicy = 'no-referrer';
    img.className = 'h-5 w-5 shrink-0 rounded-md bg-white/10 object-contain p-0.5';
    img.addEventListener('error', () => {
      img.replaceWith(broadcasterFallback(name));
    }, { once: true });
    parent.appendChild(img);
  }

  function polishBroadcasters(card, game) {
    const broadcasters = Array.isArray(game?.broadcasters) ? game.broadcasters.filter(Boolean) : [];
    if (!broadcasters.length) return;

    const expected = normalize(broadcasters.join(', '));
    const box = [...card.querySelectorAll('div')].find(el => {
      if (el.dataset.luxBroadcasterBox === '1') return true;
      const text = normalize((el.textContent || '').replace(/^📺\s*/, ''));
      return text === expected;
    });

    if (box && box.dataset.luxBroadcasterBox !== '1') {
      box.dataset.luxBroadcasterBox = '1';
      box.textContent = '';
      box.classList.add('flex', 'flex-wrap', 'items-center', 'gap-2');
      broadcasters.forEach(name => {
        const chip = document.createElement('span');
        chip.className = 'inline-flex items-center gap-1.5 rounded-lg bg-purple-950/50 px-2 py-1 text-[10px] text-purple-200';
        appendBroadcasterMark(chip, name);
        const label = document.createElement('span');
        label.textContent = name;
        chip.appendChild(label);
        box.appendChild(chip);
      });
    }

    const watchButton = card.querySelector('[data-sports-watch]');
    if (watchButton && !watchButton.querySelector('[data-lux-broadcaster-logo], [data-lux-broadcaster-fallback]')) {
      const label = String(watchButton.textContent || '').replace(/^Assistir na\s+/i, '').trim();
      if (label) {
        watchButton.classList.add('flex', 'items-center', 'justify-center', 'gap-2');
        appendBroadcasterMark(watchButton, label);
      }
    }
  }

  function polishTabs() {
    const api = window.LuxSports;
    const tabs = document.querySelectorAll('[data-lux-sports-tabs] [data-sports-tab]');
    tabs.forEach(button => {
      if (!(button instanceof HTMLElement)) return;
      const activeLive = button.dataset.sportsTab === 'live' && api?.state?.activeTab === 'live';
      if (activeLive) {
        button.style.backgroundColor = '#10b981';
        button.style.borderColor = '#34d399';
        button.style.color = '#ffffff';
        button.style.boxShadow = '0 8px 22px rgba(16,185,129,.16)';
      } else {
        button.style.removeProperty('background-color');
        button.style.removeProperty('border-color');
        button.style.removeProperty('color');
        button.style.removeProperty('box-shadow');
      }
    });
  }

  function polishCards() {
    const cards = [...document.querySelectorAll('#homeJogosContainer [data-lux-sports-card]')];
    if (!cards.length) return;
    const games = gamesForCurrentTab();
    const tomorrow = localDateKey(1);

    cards.forEach((card, index) => {
      const game = games[index];
      if (!game || !(card instanceof HTMLElement)) return;
      const live = game.status === 'live';

      if (live) {
        card.style.borderColor = 'rgba(16,185,129,.55)';
        card.style.boxShadow = '0 12px 28px rgba(16,185,129,.08)';
        const badge = [...card.querySelectorAll('span')].find(el => (el.textContent || '').trim().toUpperCase() === 'AO VIVO');
        if (badge instanceof HTMLElement) {
          badge.style.backgroundColor = 'rgba(16,185,129,.18)';
          badge.style.color = '#6ee7b7';
        }
      } else {
        card.style.removeProperty('border-color');
        card.style.removeProperty('box-shadow');
      }

      if (game.status === 'scheduled' && game.date === tomorrow) {
        const badge = [...card.querySelectorAll('span')].find(el => (el.textContent || '').trim() === String(game.time || '').trim());
        if (badge) badge.textContent = `AMANHÃ · ${game.time}`;

        const start = kickoffMs(game);
        if (Number.isFinite(start)) {
          const unlock = new Date(start - 20 * 60 * 1000).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
          const notice = [...card.querySelectorAll('div')].find(el => /^Disponível às /i.test((el.textContent || '').trim()));
          if (notice) notice.textContent = `Disponível amanhã às ${unlock}`;
        }
      }

      const logos = logoEntryFor(game);
      if (logos) {
        const strongs = card.querySelectorAll('strong');
        addLogo(strongs[0], logos.home_logo, `Escudo ${game.home}`);
        addLogo(strongs[2], logos.away_logo, `Escudo ${game.away}`);
      }

      polishBroadcasters(card, game);
    });
  }

  function apply() {
    if (!window.LuxSports?.state?.loaded) return;
    polishTabs();
    polishCards();
  }

  function scheduleApply() {
    if (state.scheduled) return;
    state.scheduled = true;
    requestAnimationFrame(() => {
      state.scheduled = false;
      apply();
    });
  }

  async function loadLogos() {
    if (state.loadingLogos || state.logos.size) return;
    state.loadingLogos = true;
    try {
      const client = typeof supabaseClient !== 'undefined' ? supabaseClient : null;
      if (!client?.functions?.invoke) return;
      const { data, error } = await client.functions.invoke('sports-logos', { body: { action: 'logos' } });
      if (error || data?.error) throw error || new Error(data.error);
      const rows = Array.isArray(data?.logos) ? data.logos : [];
      rows.forEach(row => {
        if (row?.id) state.logos.set(String(row.id), row);
        if (row?.home && row?.away) state.fallbackLogos.set(`${normalize(row.home)}|${normalize(row.away)}`, row);
      });
      scheduleApply();
    } catch (error) {
      console.warn('[Lux Sports Polish] Escudos indisponíveis:', error);
    } finally {
      state.loadingLogos = false;
    }
  }

  function installObserver() {
    const root = document.getElementById('homeJogosContainer')?.parentElement;
    if (!root || state.observer) return false;
    state.observer = new MutationObserver(scheduleApply);
    state.observer.observe(root, { childList: true, subtree: true, characterData: true });
    return true;
  }

  let attempts = 0;
  const timer = setInterval(() => {
    attempts += 1;
    if (window.LuxSports?.state?.loaded) {
      installObserver();
      loadLogos();
      scheduleApply();
      if (attempts > 20) clearInterval(timer);
    }
    if (attempts >= 240) clearInterval(timer);
  }, 100);

  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) scheduleApply();
  });
})();