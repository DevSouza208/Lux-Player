(() => {
  'use strict';
  if (window.__luxSportsHomeGuardInstalled === '20260913-guide-fast1') return;
  window.__luxSportsHomeGuardInstalled = '20260913-guide-fast1';

  let observer = null;
  let attempts = 0;

  function loadLogoDecorator() {
    if (document.querySelector('script[data-lux-sports-logos]')) return;
    const script = document.createElement('script');
    script.src = 'js/sports-global-mapping.js?v=20260913-footy-fast1';
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

  loadLogoDecorator();
  const timer = setInterval(() => {
    attempts += 1;
    if (ensureOwner() || attempts >= 240) clearInterval(timer);
  }, 50);
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) ensureOwner();
  });
})();