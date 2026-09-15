(() => {
  'use strict';
  if (window.__luxSportsHomeGuardInstalled === '20260914-sports-hidden1') return;
  window.__luxSportsHomeGuardInstalled = '20260914-sports-hidden1';

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

  if (!SPORTS_HOME_ENABLED) {
    if (!applySportsVisibility()) {
      const observer = new MutationObserver(() => {
        if (applySportsVisibility()) observer.disconnect();
      });
      observer.observe(document.documentElement, { childList: true, subtree: true });
    }
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
    if (ensureOwner() || attempts >= 240) clearInterval(timer);
  }, 50);
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) ensureOwner();
  });
})();
