(() => {
  'use strict';

  if (window.__luxSportsPolishInstalled) return;
  window.__luxSportsPolishInstalled = '20260912-sports-polish1';

  const state = {
    logos: new Map(),
    fallbackLogos: new Map(),
    loadingLogos: false,
    observer: null,
    scheduled: false
  };

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