(() => {
  'use strict';
  if (window.__luxSportsHomeGuardInstalled === '20260912-guide6') return;
  window.__luxSportsHomeGuardInstalled = '20260912-guide6';

  let observer = null;
  let attempts = 0;

  function loadExtras() {
    const extras = [
      ['lux-sports-global-mapping','js/sports-global-mapping.js?v=20260912-map1'],
      ['lux-sports-admin','js/sports-admin.js?v=20260912-sportsadmin1']
    ];
    extras.forEach(([name,src])=>{
      if(document.querySelector(`script[data-${name}]`)) return;
      const script=document.createElement('script');
      script.src=src;
      script.async=true;
      script.setAttribute(`data-${name}`,'1');
      document.head.appendChild(script);
    });
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

  loadExtras();
  const timer = setInterval(() => {
    attempts += 1;
    if (ensureOwner() || attempts >= 240) clearInterval(timer);
  }, 50);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) { ensureOwner(); window.LuxSportsMapping?.refresh?.(); } });
})();