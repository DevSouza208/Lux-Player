(() => {
  'use strict';

  if (window.__luxSportsSofascoreInstalled) return;
  window.__luxSportsSofascoreInstalled = '20260912-sofascore1';

  const API_BASE = 'https://api.sofascore.com/api/v1';
  const TEAM_IMAGE_BASE = 'https://img.sofascore.com/api/v1/team';
  const REFRESH_MS = 45_000;
  const MAX_DATES = 4;

  let busy = false;
  let timer = null;
  let observer = null;
  let lastRun = 0;

  const normalize = value => String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/&/g, ' e ')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  function teamKey(value) {
    let key = normalize(value)
      .replace(/\b(clube|club|futebol|football|fc|sc|ec|ac|cf|sa|saf)\b/g, ' ')
      .replace(/\b(da|de|do|das|dos)\b/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();

    const aliases = [
      [/\bred bull bragantino\b/g, 'bragantino'],
      [/\batletico mineiro\b/g, 'atletico mg'],
      [/\bathletico paranaense\b/g, 'athletico pr'],
      [/\bvasco gama\b/g, 'vasco'],
      [/\bcr vasco\b/g, 'vasco'],
      [/\bsao paulo\b/g, 'sao paulo'],
      [/\binternacional porto alegre\b/g, 'internacional'],
      [/\bgremio porto alegre\b/g, 'gremio']
    ];
    for (const [pattern, replacement] of aliases) key = key.replace(pattern, replacement);
    return key.replace(/\s+/g, ' ').trim();
  }

  function similarity(a, b) {
    const left = teamKey(a);
    const right = teamKey(b);
    if (!left || !right) return 0;
    if (left === right) return 1;
    if (left.includes(right) || right.includes(left)) return 0.88;

    const aTokens = new Set(left.split(' ').filter(Boolean));
    const bTokens = new Set(right.split(' ').filter(Boolean));
    if (!aTokens.size || !bTokens.size) return 0;
    let intersection = 0;
    aTokens.forEach(token => { if (bTokens.has(token)) intersection += 1; });
    const union = new Set([...aTokens, ...bTokens]).size || 1;
    return intersection / union;
  }

  function localParts(timestampMs) {
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'America/Sao_Paulo',
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', hourCycle: 'h23'
    }).formatToParts(new Date(timestampMs));
    const obj = Object.fromEntries(parts.map(part => [part.type, part.value]));
    return {
      date: `${obj.year}-${obj.month}-${obj.day}`,
      time: `${obj.hour}:${obj.minute}`
    };
  }

  function gameTimestamp(game) {
    const value = Date.parse(game?.kickoff || '');
    if (Number.isFinite(value)) return value;
    const fallback = Date.parse(`${game?.date || ''}T${game?.time || '00:00'}:00-03:00`);
    return Number.isFinite(fallback) ? fallback : NaN;
  }

  function eventTimestamp(event) {
    const seconds = Number(event?.startTimestamp);
    return Number.isFinite(seconds) ? seconds * 1000 : NaN;
  }

  function statusFromEvent(event, fallback = 'scheduled') {
    const type = normalize(event?.status?.type);
    const description = normalize(event?.status?.description);
    const value = `${type} ${description}`;
    if (/inprogress|in progress|1st half|2nd half|halftime|extra time|penalties|live/.test(value)) return 'live';
    if (/finished|ended|after penalties|after extra time/.test(value)) return 'finished';
    if (/notstarted|not started|scheduled/.test(value)) return 'scheduled';
    return fallback;
  }

  function scoreValue(score) {
    for (const key of ['current', 'normaltime', 'display']) {
      const value = Number(score?.[key]);
      if (Number.isFinite(value)) return value;
    }
    return null;
  }

  function matchScore(game, event) {
    const home = similarity(game?.home, event?.homeTeam?.name);
    const away = similarity(game?.away, event?.awayTeam?.name);
    if (home < 0.28 || away < 0.28) return -1;

    const gameMs = gameTimestamp(game);
    const eventMs = eventTimestamp(event);
    let timeBonus = 0;
    if (Number.isFinite(gameMs) && Number.isFinite(eventMs)) {
      const diff = Math.abs(gameMs - eventMs) / 60_000;
      if (diff <= 5) timeBonus = 0.45;
      else if (diff <= 20) timeBonus = 0.30;
      else if (diff <= 60) timeBonus = 0.12;
      else if (diff > 180) return -1;
    }
    return home + away + timeBonus;
  }

  function findEvent(game, events) {
    let best = null;
    let bestScore = 0;
    for (const event of events || []) {
      const score = matchScore(game, event);
      if (score > bestScore) {
        best = event;
        bestScore = score;
      }
    }
    return bestScore >= 1.08 ? best : null;
  }

  async function fetchDate(date) {
    const response = await fetch(`${API_BASE}/sport/football/scheduled-events/${encodeURIComponent(date)}`, {
      method: 'GET',
      mode: 'cors',
      credentials: 'omit',
      cache: 'no-store',
      headers: { Accept: 'application/json' }
    });
    if (!response.ok) throw new Error(`SofaScore HTTP ${response.status}`);
    const data = await response.json();
    return Array.isArray(data?.events) ? data.events : [];
  }

  function teamLogo(team) {
    const id = Number(team?.id);
    return Number.isFinite(id) && id > 0 ? `${TEAM_IMAGE_BASE}/${id}/image` : '';
  }

  function applyEvent(game, event, sports) {
    const timestamp = eventTimestamp(event);
    const local = Number.isFinite(timestamp) ? localParts(timestamp) : { date: game.date, time: game.time };
    const status = statusFromEvent(event, game.status || 'scheduled');
    const homeScore = scoreValue(event?.homeScore);
    const awayScore = scoreValue(event?.awayScore);

    game.sofascore_id = event?.id || game.sofascore_id || '';
    game.sofascore_source = true;
    game.source = 'SofaScore';
    game.date = local.date || game.date;
    game.time = local.time || game.time;
    if (Number.isFinite(timestamp)) game.kickoff = new Date(timestamp).toISOString();
    game.status = status;
    game.competition = event?.tournament?.uniqueTournament?.name || event?.tournament?.name || game.competition;
    if (status === 'live' || status === 'finished') {
      if (homeScore !== null) game.score_home = homeScore;
      if (awayScore !== null) game.score_away = awayScore;
    }

    const homeLogo = teamLogo(event?.homeTeam);
    const awayLogo = teamLogo(event?.awayTeam);
    if (homeLogo || awayLogo) {
      sports.state.teamLogos?.set?.(String(game.id), {
        id: game.id,
        home: game.home,
        away: game.away,
        home_logo: homeLogo,
        away_logo: awayLogo,
        source: 'SofaScore'
      });
    }
  }

  async function enrichFromSofascore(force = false) {
    const sports = window.LuxSports;
    if (!sports?.state?.loaded || !Array.isArray(sports.state.games) || !sports.state.games.length) return;
    if (busy) return;
    if (!force && Date.now() - lastRun < 12_000) return;

    const dates = [...new Set(sports.state.games.map(game => game?.date).filter(Boolean))]
      .sort()
      .slice(0, MAX_DATES);
    if (!dates.length) return;

    busy = true;
    lastRun = Date.now();
    try {
      const results = await Promise.allSettled(dates.map(async date => [date, await fetchDate(date)]));
      const byDate = new Map();
      let successfulDates = 0;
      for (const result of results) {
        if (result.status !== 'fulfilled') continue;
        const [date, events] = result.value;
        byDate.set(date, events);
        successfulDates += 1;
      }
      if (!successfulDates) throw new Error('SofaScore indisponível no navegador.');

      let matched = 0;
      for (const game of sports.state.games) {
        const events = byDate.get(game?.date) || [];
        const event = findEvent(game, events);
        if (!event) continue;
        applyEvent(game, event, sports);
        matched += 1;
      }

      sports.state.sofascoreMatched = matched;
      sports.state.sofascoreAvailable = true;
      if (matched) sports.render?.();
      queueMicrotask(decorateCards);
    } catch (error) {
      sports.state.sofascoreAvailable = false;
      console.warn('[Lux Sports SofaScore]', error);
    } finally {
      busy = false;
    }
  }

  function openBroadcaster(name) {
    const sports = window.LuxSports;
    const resolution = sports?.resolveBroadcaster?.(name, true);
    const channel = resolution?.channel || resolution?.suggestion;
    if (!channel) return false;
    try {
      if (typeof setSection === 'function') setSection('live');
      setTimeout(() => {
        if (typeof playLiveChannel === 'function') playLiveChannel(channel);
      }, 40);
      return true;
    } catch (error) {
      console.warn('[Lux Sports] Não foi possível abrir a emissora:', error);
      return false;
    }
  }

  function ensureChipLogo(chip, channel) {
    const logo = String(channel?.logo || '').trim();
    if (!logo || chip.querySelector('img[data-sports-channel-logo]')) return;
    const image = document.createElement('img');
    image.dataset.sportsChannelLogo = '1';
    image.src = logo;
    image.alt = channel?.name || 'Canal';
    image.loading = 'lazy';
    image.decoding = 'async';
    image.referrerPolicy = 'no-referrer';
    image.className = 'h-5 w-5 shrink-0 rounded-md object-contain';
    image.addEventListener('error', () => image.remove(), { once: true });
    chip.prepend(image);
  }

  function decorateCards() {
    const sports = window.LuxSports;
    const container = document.getElementById('homeJogosContainer');
    if (!sports?.state?.loaded || !container) return;

    container.querySelectorAll('[data-lux-sports-card][data-sports-game-id]').forEach(card => {
      const game = sports.state.games.find(item => String(item?.id) === String(card.dataset.sportsGameId));
      if (!game) return;

      for (const broadcaster of game.broadcasters || []) {
        const chip = [...card.querySelectorAll('span.inline-flex')]
          .find(element => String(element.textContent || '').trim() === String(broadcaster).trim());
        if (!chip) continue;

        const resolution = sports.resolveBroadcaster?.(broadcaster, true);
        const channel = resolution?.channel || resolution?.suggestion;
        if (!channel) continue;

        ensureChipLogo(chip, channel);
        if (chip.dataset.sportsBroadcasterReady === '1') continue;
        chip.dataset.sportsBroadcasterReady = '1';
        chip.dataset.sportsBroadcaster = broadcaster;
        chip.setAttribute('role', 'button');
        chip.setAttribute('tabindex', '0');
        chip.setAttribute('title', `Abrir ${channel.name || broadcaster}`);
        chip.classList.add('cursor-pointer', 'transition', 'hover:bg-emerald-950/60', 'hover:text-emerald-200');

        const activate = event => {
          event.preventDefault();
          event.stopPropagation();
          openBroadcaster(broadcaster);
        };
        chip.addEventListener('click', activate);
        chip.addEventListener('keydown', event => {
          if (event.key === 'Enter' || event.key === ' ') activate(event);
        });
      }

      if (game.sofascore_source) {
        const footer = [...card.querySelectorAll('div')]
          .find(element => /^Dados:\s*/i.test(String(element.textContent || '').trim()));
        if (footer) footer.textContent = 'Dados: SofaScore · TV: Super Placar';
      }
    });
  }

  function start() {
    let attempts = 0;
    const readyTimer = setInterval(() => {
      attempts += 1;
      if (!window.LuxSports?.state?.loaded) {
        if (attempts >= 240) clearInterval(readyTimer);
        return;
      }
      clearInterval(readyTimer);
      enrichFromSofascore(true);
      decorateCards();

      const container = document.getElementById('homeJogosContainer');
      if (container && !observer) {
        observer = new MutationObserver(() => queueMicrotask(decorateCards));
        observer.observe(container, { childList: true, subtree: true });
      }

      timer = setInterval(() => enrichFromSofascore(true), REFRESH_MS);
    }, 50);
  }

  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) {
      decorateCards();
      enrichFromSofascore(false);
    }
  });

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true });
  else start();
})();