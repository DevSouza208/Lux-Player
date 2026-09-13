(() => {
  'use strict';
  if (window.__luxSportsHomeGuardInstalled === '20260912-guide5') return;
  window.__luxSportsHomeGuardInstalled = '20260912-guide5';

  let observer = null;
  let attempts = 0;

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

  const timer = setInterval(() => {
    attempts += 1;
    if (ensureOwner() || attempts >= 240) clearInterval(timer);
  }, 50);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) ensureOwner(); });
})();
