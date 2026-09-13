(() => {
  'use strict';
  if (window.__luxSportsMediaBridgeInstalled === '20260913-bridge1') return;
  window.__luxSportsMediaBridgeInstalled = '20260913-bridge1';

  let lastSignature = '';
  let timer = null;

  const norm = value => String(value || '').trim();

  function guideItems() {
    try {
      if (window.LuxSports?.guideItems) return window.LuxSports.guideItems() || [];
      if (!Array.isArray(allMediaItems)) return [];
      return allMediaItems.filter(item => {
        const group = String(item?.group || '');
        return item?.type === 'live' && item?.url && /(guia\s+de\s+jogos|jogos\s+do\s+dia)/i.test(group);
      });
    } catch (_) {
      return [];
    }
  }

  function signature(items) {
    if (!items.length) return '0';
    return items.map(item => `${norm(item.name)}|${norm(item.url)}|${norm(item.logo)}`).join('\n');
  }

  function syncSports(force = false) {
    if (document.hidden && !force) return false;
    const items = guideItems();
    const next = signature(items);
    if (!force && next === lastSignature) return false;
    lastSignature = next;
    try { window.LuxSports?.refresh?.(); } catch (_) {}
    return true;
  }

  function start() {
    syncSports(true);
    timer = setInterval(() => syncSports(false), 2000);

    document.addEventListener('visibilitychange', () => {
      if (!document.hidden) syncSports(false);
    });

    document.getElementById('navHome')?.addEventListener('click', () => {
      setTimeout(() => syncSports(true), 0);
    });

    window.addEventListener('lux:media-updated', () => syncSports(true));
    window.addEventListener('lux:playlist-updated', () => syncSports(true));

    window.LuxSportsMediaBridge = {
      refresh: () => syncSports(true),
      signature: () => lastSignature,
      destroy: () => { if (timer) clearInterval(timer); }
    };
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true });
  else start();
})();
