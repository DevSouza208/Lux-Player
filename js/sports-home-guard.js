(() => {
  'use strict';
  if (window.__luxSportsHomeGuardInstalled === '20260915-sports-hidden-data6') return;
  window.__luxSportsHomeGuardInstalled = '20260915-sports-hidden-data6';

  const SPORTS_HOME_ENABLED = false;

  function getSportsSection() {
    const container = document.getElementById('homeJogosContainer');
    return container?.closest('.space-y-3') || null;
  }

  function applySportsVisibility() {
    const section = getSportsSection();
    if (!section) return false;
    section.style.display = SPORTS_HOME_ENABLED ? '' : 'none';
    section.dataset.luxSportsHidden = SPORTS_HOME_ENABLED ? '0' : '1';
    return true;
  }

  function ensureScript(marker, src) {
    if (document.querySelector(`script[data-${marker}]`)) return;
    const script = document.createElement('script');
    script.src = src;
    script.async = true;
    script.setAttribute(`data-${marker}`, '1');
    document.head.appendChild(script);
  }

  function loadSportsDataEngine() {
    if (!window.LuxSports) ensureScript('lux-sports-data', 'js/sports.js?v=20260913-guide-fast1');
    if (!window.__luxSportsGuideFixesInstalled) ensureScript('lux-sports-guide-fixes', 'js/sports-guide-fixes.js?v=20260914-1');
    if (!window.LuxSportsLogos) ensureScript('lux-sports-logo-data', 'js/sports-global-mapping.js?v=20260913-footy-fast2');

    if (!window.LuxHomeRails) ensureScript('lux-home-content-rails', 'js/home-content-rails.js?v=20260915-home-content-rails-2');

    // A faixa de séries calcula a seleção uma vez por dia e depois reutiliza
    // o cache local. Só refaz quando muda o dia, falta cache ou o Admin salva
    // uma nova seleção de séries.
    if (!window.__luxHomeSeries2026) ensureScript('lux-home-series-2026', 'js/home-series-2026.js?v=20260915-4');
  }

  function enrichHiddenSportsData() {
    const games = window.LuxSports?.state?.games;
    const footyUrl = window.LuxSportsLogos?.footyUrl;
    if (!Array.isArray(games) || typeof footyUrl !== 'function') return false;
    games.forEach(game => {
      if (!game.home_logo && game.home) game.home_logo = footyUrl(game.home);
      if (!game.away_logo && game.away) game.away_logo = footyUrl(game.away);
    });
    return true;
  }

  loadSportsDataEngine();

  if (!SPORTS_HOME_ENABLED) {
    if (!applySportsVisibility()) {
      const observer = new MutationObserver(() => {
        if (applySportsVisibility()) observer.disconnect();
      });
      observer.observe(document.documentElement, { childList: true, subtree: true });
    }

    let attempts = 0;
    const dataTimer = setInterval(() => {
      attempts += 1;
      loadSportsDataEngine();
      enrichHiddenSportsData();
      if (attempts >= 240) clearInterval(dataTimer);
    }, 250);
    return;
  }

  let observer = null;
  let attempts = 0;

  function loadGuideFixes() {
    if (document.querySelector('script[data-lux-sports-guide-fixes]')) return;
    const script = document.createElement('script');
    script.src = 'js/sports-guide-fixes.js?v=20260914-1';
    script.async = true;
    script.dataset.luxSportsGuideFixes = '1';
    document.head.appendChild(script);
  }

  function loadLogoDecorator() {
    if (document.querySelector('script[data-lux-sports-logos]')) return;
    const script = document.createElement('script');
    script.src = 'js/sports-global-mapping.js?v=20260913-footy-fast2';
    script.async = true;
    script.dataset.luxSportsLogos = '1';
    document.head.appendChild(script);
  }

  function ensureOwner() {
    const api = window.LuxSports;
    const container = document.getElementById('homeJogosContainer');
    if (!api?.state?.loaded || !container || typeof api.render !== 'function') return false;
    if (!container.querySelector('[data-sports-guide-card], [data-lux-sports-empty]')) queueMicrotask(() => api.render());
    if (!observer) {
      observer = new MutationObserver(() => {
        if (!window.LuxSports?.state?.loaded) return;
        if (!container.querySelector('[data-sports-guide-card], [data-lux-sports-empty]')) queueMicrotask(() => window.LuxSports?.render?.());
      });
      observer.observe(container, { childList: true });
    }
    return true;
  }

  loadGuideFixes();
  loadLogoDecorator();
  const timer = setInterval(() => {
    attempts += 1;
    loadGuideFixes();
    loadSportsDataEngine();
    enrichHiddenSportsData();
    if (ensureOwner() || attempts >= 240) clearInterval(timer);
  }, 50);
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) ensureOwner();
  });
})();