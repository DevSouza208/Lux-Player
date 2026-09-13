(() => {
  'use strict';

  if (window.__luxSportsHomeGuardInstalled) return;
  window.__luxSportsHomeGuardInstalled = '20260912-sports-home-guard1';

  let containerObserver = null;
  let attempts = 0;

  function hasSportsRender(container) {
    return Boolean(container?.querySelector('[data-lux-sports-card], [data-lux-sports-empty]'));
  }

  function ensureSportsOwnsHome() {
    const api = window.LuxSports;
    const container = document.getElementById('homeJogosContainer');
    if (!api?.state?.loaded || !container || typeof api.render !== 'function') return false;

    if (!hasSportsRender(container)) {
      queueMicrotask(() => {
        try { api.render(); } catch (error) { console.warn('[Lux Sports Guard]', error); }
      });
    }

    if (!containerObserver) {
      containerObserver = new MutationObserver(() => {
        if (!window.LuxSports?.state?.loaded) return;
        if (!hasSportsRender(container)) {
          queueMicrotask(() => {
            try { window.LuxSports?.render?.(); } catch (_) {}
          });
        }
      });
      containerObserver.observe(container, { childList: true, subtree: false });
    }

    return true;
  }

  const timer = setInterval(() => {
    attempts += 1;
    if (ensureSportsOwnsHome() || attempts >= 240) clearInterval(timer);
  }, 50);

  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) ensureSportsOwnsHome();
  });
})();