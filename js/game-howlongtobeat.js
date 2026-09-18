(() => {
  'use strict';

  const VERSION = '20260918-hltb5';
  const CACHE_PREFIX = 'lux-hltb-duration:';
  const CACHE_TTL = 7 * 24 * 60 * 60 * 1000;
  const CARD_ID = 'gameDetailsHltb';
  const STYLE_ID = 'gameDetailsHltbStyle';

  if (window.__luxHowLongToBeatVersion === VERSION) return;
  window.__luxHowLongToBeatVersion = VERSION;

  let activeKey = '';
  let requestId = 0;
  let scheduled = false;

  function currentGame() {
    try {
      return typeof currentGameDetails !== 'undefined' ? currentGameDetails : null;
    } catch (_) {
      return null;
    }
  }

  function client() {
    try {
      return typeof supabaseClient !== 'undefined' ? supabaseClient : null;
    } catch (_) {
      return null;
    }
  }

  function normalize(value = '') {
    return String(value || '')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, ' ')
      .trim();
  }

  function gameTitle(game) {
    return String(game?.name || game?.title || '').trim();
  }

  function gameKey(game) {
    return `${String(game?.id || '')}|${normalize(gameTitle(game))}|${normalize(game?.console || '')}`;
  }

  function cacheKey(game) {
    return CACHE_PREFIX + encodeURIComponent(gameKey(game));
  }

  function readCache(game) {
    try {
      const raw = localStorage.getItem(cacheKey(game));
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      if (!parsed?.savedAt || Date.now() - parsed.savedAt > CACHE_TTL) {
        localStorage.removeItem(cacheKey(game));
        return null;
      }
      return parsed.duration || null;
    } catch (_) {
      return null;
    }
  }

  function writeCache(game, duration) {
    try {
      localStorage.setItem(cacheKey(game), JSON.stringify({ savedAt: Date.now(), duration }));
    } catch (_) {}
  }

  function formatHours(value) {
    const hours = Number(value);
    if (!Number.isFinite(hours) || hours <= 0) return '--';
    const totalMinutes = Math.round(hours * 60);
    const wholeHours = Math.floor(totalMinutes / 60);
    const minutes = totalMinutes % 60;
    if (!wholeHours) return `${minutes}min`;
    if (!minutes) return `${wholeHours}h`;
    return `${wholeHours}h ${minutes}min`;
  }

  function safeHltbUrl(value, game) {
    try {
      const url = new URL(String(value || ''), 'https://howlongtobeat.com');
      if (url.protocol === 'https:' && /(^|\.)howlongtobeat\.com$/i.test(url.hostname)) return url.href;
    } catch (_) {}
    return `https://howlongtobeat.com/?q=${encodeURIComponent(gameTitle(game))}`;
  }

  function isCompactDetails() {
    try { return window.matchMedia('(max-width:1023px)').matches; }
    catch (_) { return window.innerWidth <= 1023; }
  }

  function ensureStyle() {
    if (document.getElementById(STYLE_ID)) return;
    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = `
      #${CARD_ID}{margin-top:14px;border:1px solid rgba(126,34,206,.48);border-radius:18px;background:linear-gradient(135deg,rgba(46,16,101,.28),rgba(18,12,31,.72));padding:14px 15px}
      #${CARD_ID} .lux-hltb-head{display:flex;align-items:center;justify-content:space-between;gap:12px;margin-bottom:11px}
      #${CARD_ID} .lux-hltb-title{display:flex;align-items:center;gap:7px;color:#e9d5ff;font-size:11px;font-weight:900;text-transform:uppercase;letter-spacing:.07em}
      #${CARD_ID} .lux-hltb-source{font-size:10px;font-weight:800;color:#a78bfa;text-decoration:none;white-space:nowrap}
      #${CARD_ID} .lux-hltb-source:hover{color:#ddd6fe;text-decoration:underline}
      #${CARD_ID} .lux-hltb-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:8px}
      #${CARD_ID} .lux-hltb-stat{min-width:0;border:1px solid rgba(88,28,135,.48);border-radius:13px;background:rgba(9,6,14,.46);padding:10px 11px}
      #${CARD_ID} .lux-hltb-label{display:block;color:#9f8bbd;font-size:10px;font-weight:800;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
      #${CARD_ID} .lux-hltb-value{display:block;margin-top:3px;color:#fff;font-size:17px;font-weight:900;letter-spacing:-.02em}
      #${CARD_ID} .lux-hltb-note{margin-top:9px;color:#78658f;font-size:9px;line-height:1.4}
      #${CARD_ID}.lux-hltb-loading .lux-hltb-stat{animation:luxHltbPulse 1.15s ease-in-out infinite alternate}
      #gameDetailsPlayTime.lux-game-playtime-pill{display:flex;align-items:center;justify-content:center;gap:6px;margin-top:10px;padding:8px 10px;border:1px solid rgba(88,28,135,.56);border-radius:999px;background:rgba(46,16,101,.28);color:#d8c8ef;font-size:11px;font-weight:800;line-height:1.2}
      #gameDetailsPlayTime.lux-game-playtime-pill::before{content:'◷';color:#c084fc;font-size:12px}
      #gameDetailsSaveStatus.lux-game-save-status{margin-top:8px;color:#c4b5fd;font-size:11px;line-height:1.4}
      @keyframes luxHltbPulse{from{opacity:.56}to{opacity:1}}
      @media(max-width:1023px){
        #gameDetailsModal .lux-game-details-grid #gameDetailsPlayTime.lux-game-playtime-pill{grid-column:1!important;grid-row:2!important;width:100%;margin:0!important;align-self:start}
        #gameDetailsModal .lux-game-details-grid #gameDetailsStoragePanel{grid-column:1/-1!important;grid-row:3!important}
        #gameDetailsModal .lux-game-details-grid #${CARD_ID}{grid-column:1/-1!important;grid-row:4!important;width:100%!important;margin-top:0!important}
        #gameDetailsModal .lux-game-details-grid #gameDetailsAboutSection{grid-column:1/-1!important;grid-row:5!important}
        #gameDetailsModal .lux-game-details-grid #gameDetailsReviewsSection{grid-column:1/-1!important;grid-row:6!important}

        #gameDetailsModal .lux-game-details-grid.lux-has-save-status #gameDetailsSaveStatus.lux-game-save-status{grid-column:1/-1!important;grid-row:3!important;display:flex;align-items:center;justify-content:center;gap:8px;width:100%;margin:0!important;padding:10px 12px;border:1px solid rgba(88,28,135,.55);border-radius:13px;background:rgba(46,16,101,.22);color:#c4b5fd;font-size:10px;font-weight:800;text-align:center}
        #gameDetailsModal .lux-game-details-grid.lux-has-save-status #gameDetailsSaveStatus.lux-game-save-status::before{content:'☁';font-size:13px;color:#c084fc}
        #gameDetailsModal .lux-game-details-grid.lux-has-save-status #gameDetailsStoragePanel{grid-row:4!important}
        #gameDetailsModal .lux-game-details-grid.lux-has-save-status #${CARD_ID}{grid-row:5!important}
        #gameDetailsModal .lux-game-details-grid.lux-has-save-status #gameDetailsAboutSection{grid-row:6!important}
        #gameDetailsModal .lux-game-details-grid.lux-has-save-status #gameDetailsReviewsSection{grid-row:7!important}
      }
      @media(max-width:560px){
        #${CARD_ID} .lux-hltb-grid{grid-template-columns:repeat(3,minmax(0,1fr));gap:5px}
        #${CARD_ID} .lux-hltb-stat{padding:8px 7px;text-align:center}
        #${CARD_ID} .lux-hltb-label{font-size:9px}
        #${CARD_ID} .lux-hltb-value{font-size:14px}
        #gameDetailsPlayTime.lux-game-playtime-pill{padding:7px 6px;font-size:9px}
        #gameDetailsSaveStatus.lux-game-save-status{padding:9px 8px;font-size:9px}
      }
    `;
    document.head.appendChild(style);
  }

  function detailsAnchor() {
    return document.querySelector('.game-details-primary-actions');
  }

  function detailsGrid() {
    return document.getElementById('gameDetailsCover')?.parentElement || null;
  }

  function detailsMain() {
    const actions = detailsAnchor();
    return actions?.closest?.('.min-w-0.flex.flex-col') || document.getElementById('gameDetailsTitle')?.parentElement || null;
  }

  function ensureCard() {
    ensureStyle();
    let card = document.getElementById(CARD_ID);
    if (card) return card;
    const anchor = detailsAnchor();
    if (!anchor) return null;
    card = document.createElement('section');
    card.id = CARD_ID;
    anchor.insertAdjacentElement('afterend', card);
    return card;
  }

  function removeLegacyLinks() {
    const card = document.getElementById(CARD_ID);
    document.querySelectorAll('a[href*="howlongtobeat.com"]').forEach(link => {
      if (!card?.contains(link)) link.remove();
    });
  }

  function findSaveStatusCandidates() {
    const actions = detailsAnchor();
    const candidates = [...document.querySelectorAll('.lux-game-save-status')];
    if (actions) {
      actions.querySelectorAll('p').forEach(node => {
        const text = String(node.textContent || '').trim();
        if (text.startsWith('Saves sincronizados') || text.startsWith('Nuvem indisponível')) candidates.push(node);
      });
    }
    return [...new Set(candidates)];
  }

  function polishPlayTime() {
    const items = [...document.querySelectorAll('#gameDetailsPlayTime')];
    if (!items.length) return;
    const playTime = items.at(-1);
    items.slice(0, -1).forEach(node => node.remove());
    playTime.classList.add('lux-game-playtime-pill');

    const actions = detailsAnchor();
    const grid = detailsGrid();
    const storage = document.getElementById('gameDetailsStoragePanel');
    if (isCompactDetails() && grid) {
      if (playTime.parentElement !== grid) grid.insertBefore(playTime, storage || grid.children[1] || null);
    } else if (actions && playTime.parentElement !== actions) {
      actions.appendChild(playTime);
    }
  }

  function polishSaveStatus() {
    const grid = detailsGrid();
    const candidates = findSaveStatusCandidates();
    if (!candidates.length) {
      grid?.classList.remove('lux-has-save-status');
      return;
    }
    const status = candidates.at(-1);
    candidates.slice(0, -1).forEach(node => node.remove());
    status.id = 'gameDetailsSaveStatus';
    status.classList.add('lux-game-save-status');

    const actions = detailsAnchor();
    const storage = document.getElementById('gameDetailsStoragePanel');
    const card = document.getElementById(CARD_ID);
    if (isCompactDetails() && grid) {
      grid.classList.add('lux-has-save-status');
      if (status.parentElement !== grid || status.nextElementSibling !== storage) {
        grid.insertBefore(status, storage || card || document.getElementById('gameDetailsAboutSection') || null);
      }
    } else {
      grid?.classList.remove('lux-has-save-status');
      if (actions && status.parentElement !== actions) actions.appendChild(status);
    }
  }

  function polishDetailsChrome() {
    ensureStyle();
    removeLegacyLinks();
    polishPlayTime();
    polishSaveStatus();
  }

  function renderLoading() {
    const card = ensureCard();
    if (!card) return;
    card.className = 'lux-hltb-loading';
    card.innerHTML = `
      <div class="lux-hltb-head"><span class="lux-hltb-title">⏱ Tempo médio para zerar</span><span class="lux-hltb-source">HowLongToBeat</span></div>
      <div class="lux-hltb-grid">
        <div class="lux-hltb-stat"><span class="lux-hltb-label">História</span><span class="lux-hltb-value">…</span></div>
        <div class="lux-hltb-stat"><span class="lux-hltb-label">+ Extras</span><span class="lux-hltb-value">…</span></div>
        <div class="lux-hltb-stat"><span class="lux-hltb-label">100%</span><span class="lux-hltb-value">…</span></div>
      </div>`;
    polishDetailsChrome();
  }

  function renderDuration(duration, game) {
    const card = ensureCard();
    if (!card) return;
    const sourceUrl = safeHltbUrl(duration?.url, game);
    card.className = '';
    card.innerHTML = `
      <div class="lux-hltb-head">
        <span class="lux-hltb-title">⏱ Tempo médio para zerar</span>
        <a class="lux-hltb-source" href="${sourceUrl}" target="_blank" rel="noopener noreferrer">HowLongToBeat ↗</a>
      </div>
      <div class="lux-hltb-grid">
        <div class="lux-hltb-stat"><span class="lux-hltb-label">História principal</span><span class="lux-hltb-value">${formatHours(duration?.main)}</span></div>
        <div class="lux-hltb-stat"><span class="lux-hltb-label">Principal + extras</span><span class="lux-hltb-value">${formatHours(duration?.main_extra)}</span></div>
        <div class="lux-hltb-stat"><span class="lux-hltb-label">Complecionista</span><span class="lux-hltb-value">${formatHours(duration?.completionist)}</span></div>
      </div>
      <div class="lux-hltb-note">Estimativas da comunidade · ${String(duration?.title || gameTitle(game)).replace(/[&<>]/g, '')}</div>`;
    polishDetailsChrome();
  }

  function renderFallback(game) {
    const card = ensureCard();
    if (!card) return;
    const url = safeHltbUrl('', game);
    card.className = '';
    card.innerHTML = `
      <div class="lux-hltb-head">
        <span class="lux-hltb-title">⏱ Tempo médio para zerar</span>
        <a class="lux-hltb-source" href="${url}" target="_blank" rel="noopener noreferrer">Pesquisar no HowLongToBeat ↗</a>
      </div>
      <div class="lux-hltb-grid">
        <div class="lux-hltb-stat"><span class="lux-hltb-label">História principal</span><span class="lux-hltb-value">--</span></div>
        <div class="lux-hltb-stat"><span class="lux-hltb-label">Principal + extras</span><span class="lux-hltb-value">--</span></div>
        <div class="lux-hltb-stat"><span class="lux-hltb-label">Complecionista</span><span class="lux-hltb-value">--</span></div>
      </div>
      <div class="lux-hltb-note">Dados de duração indisponíveis para este jogo.</div>`;
    polishDetailsChrome();
  }

  async function fetchDuration(game) {
    const api = client();
    if (!api?.functions?.invoke) throw new Error('Cliente de metadados indisponível.');
    const { data, error } = await api.functions.invoke('game-metadata', {
      body: {
        action: 'duration',
        query: gameTitle(game),
        console: String(game?.console || '')
      }
    });
    if (error) throw error;
    if (data?.error) throw new Error(data.error);
    return data?.duration || null;
  }

  async function refresh(game, force = false) {
    if (!game || !gameTitle(game) || !detailsAnchor()) return;
    const key = gameKey(game);
    activeKey = key;
    const currentRequest = ++requestId;

    if (!force) {
      const cached = readCache(game);
      if (cached) {
        renderDuration(cached, game);
        return;
      }
    }

    renderLoading();
    try {
      const duration = await fetchDuration(game);
      if (currentRequest !== requestId || activeKey !== key) return;
      if (!duration || (!duration.main && !duration.main_extra && !duration.completionist)) {
        renderFallback(game);
        return;
      }
      writeCache(game, duration);
      renderDuration(duration, game);
    } catch (error) {
      if (currentRequest !== requestId || activeKey !== key) return;
      console.warn('[Lux Games] HowLongToBeat indisponível:', error);
      renderFallback(game);
    }
  }

  function detectGameDetails() {
    scheduled = false;
    polishDetailsChrome();
    const game = currentGame();
    if (!game || !detailsAnchor()) return;
    const key = gameKey(game);
    if (key === activeKey && document.getElementById(CARD_ID)) return;
    refresh(game);
  }

  function scheduleDetect() {
    if (scheduled) return;
    scheduled = true;
    setTimeout(detectGameDetails, 50);
  }

  const observer = new MutationObserver(scheduleDetect);
  const start = () => {
    observer.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['class'] });
    window.addEventListener('resize', scheduleDetect, { passive: true });
    window.addEventListener('orientationchange', scheduleDetect, { passive: true });
    scheduleDetect();
  };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true });
  else start();

  window.LuxHowLongToBeat = {
    version: VERSION,
    refresh: () => refresh(currentGame(), true),
    clearCache(game = currentGame()) {
      if (!game) return;
      try { localStorage.removeItem(cacheKey(game)); } catch (_) {}
      activeKey = '';
    }
  };
})();