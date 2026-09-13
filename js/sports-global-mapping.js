(() => {
  'use strict';
  if (window.__luxSportsLogoDecoratorInstalled === '20260913-global-cache1') return;
  window.__luxSportsLogoDecoratorInstalled = '20260913-global-cache1';

  const MAX_ACTIVE_LOGOS = 6;
  const LOCAL_KEY = 'lux-play:team-logo-url-cache:v1';
  const LOCAL_MAX = 500;
  const LOCAL_TTL = 90 * 86400000;

  const failedUrls = new Set();
  const readyUrls = new Set();
  const pendingUrls = new Map();
  const queue = [];
  const lookedUpKeys = new Set();
  const lookupPendingKeys = new Set();
  const globalRows = new Map();
  const resolvingTeams = new Map();
  const reportedTeams = new Set();
  const markedMissing = new Set();
  let active = 0;
  let scheduled = false;

  const norm = v => String(v || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/&/g, ' e ')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  const slugify = value => norm(value).replace(/\s+/g, '-');

  const FOOTY = new Map(Object.entries({
    'santos':'santos-fc','santos fc':'santos-fc','sao paulo':'sao-paulo','sao paulo fc':'sao-paulo','spfc':'sao-paulo',
    'bragantino':'rb-bragantino','rb bragantino':'rb-bragantino','red bull bragantino':'rb-bragantino',
    'atletico mg':'atletico-mineiro','atletico mineiro':'atletico-mineiro','athletico pr':'athletico-paranaense',
    'athletico paranaense':'athletico-paranaense','internacional':'sc-internacional','vasco':'vasco-da-gama',
    'vasco da gama':'vasco-da-gama','flamengo':'flamengo-crf','mirassol':'mirassol-fc','remo':'clube-de-remo',
    'ceara':'ceara-sc','sport':'sport-recife','celta':'celta-vigo','coventry':'coventry-city',
    'brighton':'brighton-hove-albion','psg':'paris-saint-germain-psg','paris saint germain':'paris-saint-germain-psg',
    'liverpool':'liverpool-fc','bayern de munique':'bayern-munich',
    'fc dallas':'fc-dallas','portland timbers':'portland-timbers','st louis city sc':'st-louis-city-sc',
    'minnesota united fc':'minnesota-united','minnesota united':'minnesota-united','monterrey':'monterrey',
    'tigres uanl':'tigres-uanl','colorado rapids':'colorado-rapids','cf montreal':'cf-montreal',
    'racing santander':'racing-santander','alaves':'deportivo-alaves','deportivo alaves':'deportivo-alaves',
    'genoa':'genoa','frosinone':'frosinone-calcio','frosinone calcio':'frosinone-calcio',
    'borussia dortmund':'borussia-dortmund','dortmund':'borussia-dortmund','augsburg':'fc-augsburg',
    'fc augsburg':'fc-augsburg','bayer leverkusen':'bayer-leverkusen'
  }));

  const LOGODETIMES = new Map(Object.entries({
    'alaves':'deportivo-alaves','deportivo alaves':'deportivo-alaves',
    'borussia dortmund':'borussia-dortmund','dortmund':'borussia-dortmund',
    'bayer leverkusen':'bayer-leverkusen','augsburg':'augsburg',
    'racing santander':'racing-santander','genoa':'genoa','frosinone':'frosinone'
  }));

  const ESCUDOSFC = new Map(Object.entries({
    'borussia dortmund':['borusia.png'],
    'dortmund':['borusia.png'],
    'paderborn':['paderborn_ger.png'],
    'paderborn 07':['paderborn_ger.png']
  }));

  function readLocalCache() {
    try {
      const raw = JSON.parse(localStorage.getItem(LOCAL_KEY) || '{}');
      const now = Date.now();
      const clean = {};
      Object.entries(raw || {}).forEach(([key, value]) => {
        if (!value || typeof value !== 'object') return;
        if (!value.url || now - Number(value.ts || 0) > LOCAL_TTL) return;
        clean[key] = value;
      });
      return clean;
    } catch (_) {
      return {};
    }
  }

  let localCache = readLocalCache();

  function persistLocalCache() {
    try {
      const entries = Object.entries(localCache)
        .sort((a, b) => Number(b[1]?.ts || 0) - Number(a[1]?.ts || 0))
        .slice(0, LOCAL_MAX);
      localCache = Object.fromEntries(entries);
      localStorage.setItem(LOCAL_KEY, JSON.stringify(localCache));
    } catch (_) {}
  }

  function setLocal(teamName, url, source) {
    const key = norm(teamName);
    if (!key || !url) return;
    localCache[key] = { url, source: source || 'cache', ts: Date.now() };
    persistLocalCache();
  }

  function dropLocal(teamName, url = '') {
    const key = norm(teamName);
    if (!key || !localCache[key]) return;
    if (url && localCache[key].url !== url) return;
    delete localCache[key];
    persistLocalCache();
  }

  function ensureConnectionHints() {
    [
      'https://assets.footylogos.com',
      'https://logodetimes.com',
      'https://escudosfc.com.br'
    ].forEach((href, index) => {
      if (!document.head.querySelector(`link[data-lux-logo-preconnect="${index}"]`)) {
        const link = document.createElement('link');
        link.rel = 'preconnect';
        link.href = href;
        link.crossOrigin = 'anonymous';
        link.dataset.luxLogoPreconnect = String(index);
        document.head.appendChild(link);
      }
    });
  }

  function teamSlug(name) {
    const full = norm(name).replace(/\b(?:da|de|do|das|dos)\b/g, ' ').replace(/\s+/g, ' ').trim();
    const simple = full.replace(/\b(?:clube|club|futebol|football|fc|sc|ec|ac|cf|saf)\b/g, ' ').replace(/\s+/g, ' ').trim();
    return FOOTY.get(full) || FOOTY.get(simple) || full.replace(/\s+/g, '-');
  }

  function sourceCandidates(name) {
    const key = norm(name);
    const footySlug = teamSlug(name);
    const logoTimesSlug = LOGODETIMES.get(key) || slugify(name);
    const plainUnderscore = slugify(name).replace(/-/g, '_');
    const firstWord = key.split(' ')[0] || '';
    const escudos = ESCUDOSFC.get(key) || [
      `${plainUnderscore}.png`,
      `${plainUnderscore}_ger.png`,
      firstWord ? `${firstWord}.png` : ''
    ].filter(Boolean);

    const rows = [];
    if (footySlug) rows.push({ source: 'footylogos', url: `https://assets.footylogos.com/logos/${footySlug}/${footySlug}-logo-footylogos.svg` });
    if (logoTimesSlug) rows.push({ source: 'logodetimes', url: `https://logodetimes.com/wp-content/uploads/${logoTimesSlug}.png` });
    escudos.forEach(file => rows.push({ source: 'escudosfc', url: `https://escudosfc.com.br/images/${file}` }));

    const seen = new Set();
    return rows.filter(row => row.url && !seen.has(row.url) && seen.add(row.url));
  }

  function gameForCard(card) {
    const gameId = card.querySelector('[data-game]')?.dataset.game;
    const games = window.LuxSports?.state?.games || [];
    if (gameId) return games.find(g => g.id === gameId) || null;
    const text = norm(card.textContent);
    return games.find(g => text.includes(norm(g.home)) && text.includes(norm(g.away))) || null;
  }

  function flushLogo(url, ok) {
    const callbacks = pendingUrls.get(url) || [];
    pendingUrls.delete(url);
    callbacks.forEach(callback => {
      try { callback(ok); } catch (_) {}
    });
  }

  function pumpLogoQueue() {
    while (active < MAX_ACTIVE_LOGOS && queue.length) {
      const url = queue.shift();
      if (!url || readyUrls.has(url) || failedUrls.has(url)) continue;
      active += 1;
      const preload = new Image();
      preload.alt = '';
      preload.decoding = 'async';
      preload.fetchPriority = 'high';
      preload.referrerPolicy = 'no-referrer';
      preload.onload = () => {
        readyUrls.add(url);
        active -= 1;
        flushLogo(url, true);
        pumpLogoQueue();
      };
      preload.onerror = () => {
        failedUrls.add(url);
        active -= 1;
        flushLogo(url, false);
        pumpLogoQueue();
      };
      preload.src = url;
    }
  }

  function requestLogo(url) {
    return new Promise(resolve => {
      if (!url || failedUrls.has(url)) return resolve(false);
      if (readyUrls.has(url)) return resolve(true);
      if (pendingUrls.has(url)) {
        pendingUrls.get(url).push(resolve);
        return;
      }
      pendingUrls.set(url, [resolve]);
      queue.push(url);
      pumpLogoQueue();
    });
  }

  function getSupabaseClient() {
    try { return typeof supabaseClient !== 'undefined' ? supabaseClient : null; }
    catch (_) { return null; }
  }

  async function invokeCache(body) {
    const client = getSupabaseClient();
    if (!client?.functions?.invoke) return null;
    try {
      const { data, error } = await client.functions.invoke('team-logo-cache', { body });
      if (error) throw error;
      return data || null;
    } catch (error) {
      console.warn('[Lux Sports Logos] Cache global indisponível.', error);
      return null;
    }
  }

  async function primeGlobalCache(names) {
    const unique = [...new Set((names || []).map(name => String(name || '').trim()).filter(Boolean))];
    const wanted = unique.filter(name => {
      const key = norm(name);
      return key && !lookedUpKeys.has(key) && !lookupPendingKeys.has(key) && !localCache[key];
    });
    if (!wanted.length) return;

    wanted.forEach(name => lookupPendingKeys.add(norm(name)));
    const data = await invokeCache({ action: 'lookup', teams: wanted });

    if (data?.logos && typeof data.logos === 'object') {
      Object.entries(data.logos).forEach(([key, row]) => {
        if (!row?.url) return;
        globalRows.set(key, row);
        setLocal(row.name || key, row.url, row.source || 'global');
      });
    }

    wanted.forEach(name => {
      const key = norm(name);
      lookupPendingKeys.delete(key);
      lookedUpKeys.add(key);
    });
    scheduleDecorate();
  }

  async function reportGlobal(teamName, url, source) {
    const key = norm(teamName);
    if (!key || !url || reportedTeams.has(`${key}|${url}`)) return;
    reportedTeams.add(`${key}|${url}`);
    const data = await invokeCache({ action: 'report', team: teamName, url, source });
    if (data?.logo?.logo_url) {
      globalRows.set(key, { url: data.logo.logo_url, source: data.logo.source, name: data.logo.display_name });
      setLocal(teamName, data.logo.logo_url, data.logo.source || source);
    }
  }

  async function invalidateGlobal(teamName, url) {
    dropLocal(teamName, url);
    globalRows.delete(norm(teamName));
    await invokeCache({ action: 'invalidate', team: teamName, url });
  }

  async function markMissingGlobal(teamName) {
    const key = norm(teamName);
    if (!key || markedMissing.has(key)) return;
    markedMissing.add(key);
    await invokeCache({ action: 'mark_missing', team: teamName });
  }

  function showLogo(holder, teamName, url, source) {
    if (!holder?.isConnected) return;
    const current = holder.querySelector('[data-lux-team-logo]');
    if (current?.dataset.logoUrl === url) return;
    current?.remove();

    const img = document.createElement('img');
    img.dataset.luxTeamLogo = '1';
    img.dataset.logoUrl = url;
    img.dataset.logoSource = source || 'cache';
    img.src = url;
    img.alt = '';
    img.loading = 'eager';
    img.decoding = 'async';
    img.referrerPolicy = 'no-referrer';
    img.className = 'h-9 w-9 object-contain';
    img.onerror = () => {
      failedUrls.add(url);
      img.remove();
      holder.querySelector('[data-shield-fallback]')?.classList.remove('hidden');
      if (source === 'global' || source === 'local' || globalRows.get(norm(teamName))?.url === url) invalidateGlobal(teamName, url);
    };
    holder.querySelector('[data-shield-fallback]')?.classList.add('hidden');
    holder.prepend(img);
  }

  async function resolveTeam(teamName) {
    const key = norm(teamName);
    if (!key) return null;
    if (resolvingTeams.has(key)) return resolvingTeams.get(key);

    const task = (async () => {
      const local = localCache[key];
      if (local?.url) {
        const ok = await requestLogo(local.url);
        if (ok) return { url: local.url, source: local.source || 'local', cached: true };
        await invalidateGlobal(teamName, local.url);
      }

      const global = globalRows.get(key);
      if (global?.url) {
        const ok = await requestLogo(global.url);
        if (ok) {
          setLocal(teamName, global.url, global.source || 'global');
          return { url: global.url, source: global.source || 'global', cached: true };
        }
        await invalidateGlobal(teamName, global.url);
      }

      if (!lookedUpKeys.has(key) && lookupPendingKeys.has(key)) return null;

      const candidates = sourceCandidates(teamName);
      for (const candidate of candidates) {
        const ok = await requestLogo(candidate.url);
        if (!ok) continue;
        setLocal(teamName, candidate.url, candidate.source);
        reportGlobal(teamName, candidate.url, candidate.source);
        return { ...candidate, cached: false };
      }

      markMissingGlobal(teamName);
      return null;
    })().finally(() => resolvingTeams.delete(key));

    resolvingTeams.set(key, task);
    return task;
  }

  function applyLogo(teamBox, name) {
    const holder = teamBox?.querySelector('div');
    if (!holder || holder.querySelector('[data-lux-team-logo]')) return;
    const key = norm(name);
    if (!key) return;

    if (!localCache[key] && !globalRows.has(key) && !lookedUpKeys.has(key)) return;

    resolveTeam(name).then(result => {
      if (result?.url && holder?.isConnected) showLogo(holder, name, result.url, result.cached ? 'global' : result.source);
    });
  }

  function decorateCard(card) {
    const game = gameForCard(card);
    if (!game) return;
    const grid = card.children?.[1];
    if (!grid || grid.children.length < 3) return;
    applyLogo(grid.children[0], game.home);
    applyLogo(grid.children[2], game.away);

    const footer = card.lastElementChild;
    if (footer && !/escudos:\s*Lux/i.test(footer.textContent || '')) {
      footer.textContent = String(footer.textContent || '').replace(/\s*·\s*escudos:\s*FootyLogos/gi, '') + ' · escudos: Lux';
    }
  }

  function visibleTeams() {
    const names = [];
    document.querySelectorAll('#homeJogosContainer [data-sports-guide-card]').forEach(card => {
      const game = gameForCard(card);
      if (!game) return;
      names.push(game.home, game.away);
    });
    return names;
  }

  function decorate() {
    const names = visibleTeams();
    primeGlobalCache(names);
    document.querySelectorAll('#homeJogosContainer [data-sports-guide-card]').forEach(decorateCard);
  }

  function scheduleDecorate() {
    if (scheduled) return;
    scheduled = true;
    requestAnimationFrame(() => {
      scheduled = false;
      decorate();
    });
  }

  function boot() {
    ensureConnectionHints();
    decorate();
    const home = document.getElementById('homeJogosContainer');
    if (home) {
      const observer = new MutationObserver(scheduleDecorate);
      observer.observe(home, { childList: true });
    }
    window.LuxSportsLogos = {
      decorate,
      localCache: () => ({ ...localCache }),
      queueStatus: () => ({ active, queued: queue.length, ready: readyUrls.size, failed: failedUrls.size, max: MAX_ACTIVE_LOGOS }),
      sources: ['footylogos', 'logodetimes', 'escudosfc'],
      clearLocal: () => {
        localCache = {};
        try { localStorage.removeItem(LOCAL_KEY); } catch (_) {}
      }
    };
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot, { once: true });
  else boot();
})();