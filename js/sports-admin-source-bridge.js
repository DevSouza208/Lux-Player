(() => {
  'use strict';

  const VERSION = '20260915-sports-admin-source1';
  if (window.__luxSportsAdminSourceBridge === VERSION) return;
  window.__luxSportsAdminSourceBridge = VERSION;

  const SPORTS_SRC = 'js/sports.js?v=20260915-sports-admin-source1';
  const GUIDE_RE = /(guia\s+de\s+jogos|jogos\s+do\s+dia)/i;
  let loadingSports = null;
  let lastRefreshAt = 0;
  let lastGuideCount = -1;

  function media() {
    try { return Array.isArray(allMediaItems) ? allMediaItems : []; }
    catch (_) { return []; }
  }

  function guideItems() {
    return media().filter(item => item?.type === 'live' && item?.url && GUIDE_RE.test(String(item?.group || '')));
  }

  function ensureSportsRuntime() {
    if (window.LuxSports?.refresh) {
      try { window.LuxSports.refresh(); } catch (_) {}
      return Promise.resolve(window.LuxSports);
    }
    if (loadingSports) return loadingSports;

    loadingSports = new Promise(resolve => {
      let script = document.querySelector('script[data-lux-sports-admin-runtime]');
      if (!script) {
        script = document.createElement('script');
        script.src = SPORTS_SRC;
        script.async = true;
        script.dataset.luxSportsAdminRuntime = '1';
        document.head.appendChild(script);
      }

      const finish = () => {
        try { window.LuxSports?.refresh?.(); } catch (_) {}
        resolve(window.LuxSports || null);
      };

      script.addEventListener('load', finish, { once: true });
      script.addEventListener('error', () => resolve(null), { once: true });
      if (window.LuxSports?.refresh) finish();
      else setTimeout(finish, 2500);
    }).finally(() => { loadingSports = null; });

    return loadingSports;
  }

  function adminNeedsRefresh() {
    const kind = document.getElementById('homeBannerKind');
    const select = document.getElementById('homeBannerSource');
    if (!kind || !select || kind.value !== 'sport') return false;
    if (select.options.length <= 1) return true;
    return /nenhum jogo carregado/i.test(String(select.options[0]?.textContent || ''));
  }

  function requestAdminRefresh() {
    if (!adminNeedsRefresh()) return;
    const now = Date.now();
    if (now - lastRefreshAt < 900) return;
    lastRefreshAt = now;
    const button = document.getElementById('homeBannerSourceRefresh');
    if (button && !button.disabled) button.click();
  }

  async function sync() {
    const items = guideItems();
    if (!items.length) return false;

    const changed = items.length !== lastGuideCount;
    lastGuideCount = items.length;

    await ensureSportsRuntime();
    try { window.LuxSports?.refresh?.(); } catch (_) {}

    const games = window.LuxSports?.state?.games;
    if (Array.isArray(games) && games.length) {
      if (changed || adminNeedsRefresh()) setTimeout(requestAdminRefresh, 30);
      return true;
    }
    return false;
  }

  document.addEventListener('click', event => {
    const target = event.target?.closest?.('#homeBannerSourceRefresh, [data-admin-tab="highlights"], #adminPanelBtn');
    if (!target) return;
    setTimeout(sync, 0);
  }, true);

  document.addEventListener('change', event => {
    if (event.target?.id !== 'homeBannerKind') return;
    if (event.target.value === 'sport') setTimeout(sync, 0);
  }, true);

  const observer = new MutationObserver(() => {
    if (adminNeedsRefresh()) sync();
  });
  observer.observe(document.documentElement, { childList: true, subtree: true });

  let attempts = 0;
  const timer = setInterval(() => {
    attempts += 1;
    sync().then(ready => {
      if (ready && attempts > 8 && !adminNeedsRefresh()) clearInterval(timer);
      else if (attempts >= 240) clearInterval(timer);
    }).catch(() => {});
  }, 500);

  window.addEventListener('beforeunload', () => {
    clearInterval(timer);
    observer.disconnect();
  }, { once: true });
})();
