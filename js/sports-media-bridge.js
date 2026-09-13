(() => {
  'use strict';

  const VERSION = '20260913-bridge4-simple';
  if (window.__luxSportsMediaBridgeInstalled === VERSION) return;
  window.__luxSportsMediaBridgeInstalled = VERSION;

  let lastSignature = '';
  let timer = null;

  const norm = value => String(value || '').trim();

  function mediaItems() {
    try {
      return Array.isArray(allMediaItems) ? allMediaItems : [];
    } catch (_) {
      return [];
    }
  }

  function guideItems() {
    try {
      if (window.LuxSports?.guideItems) return window.LuxSports.guideItems() || [];
      return mediaItems().filter(item => {
        const group = String(item?.group || '');
        return item?.type === 'live' &&
          item?.url &&
          /(guia\s+de\s+jogos|jogos\s+do\s+dia)/i.test(group);
      });
    } catch (_) {
      return [];
    }
  }

  function signature(items) {
    if (!items.length) return '0';
    return items
      .map(item => `${norm(item.name)}|${norm(item.url)}|${norm(item.logo)}|${norm(item.group)}`)
      .join('\n');
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
      if (!document.hidden) syncSports(true);
    });

    document.getElementById('navHome')?.addEventListener('click', () => {
      setTimeout(() => syncSports(true), 0);
    });

    window.addEventListener('lux:media-updated', () => syncSports(true));
    window.addEventListener('lux:playlist-updated', () => syncSports(true));

    window.LuxSportsMediaBridge = {
      refresh: () => syncSports(true),
      signature: () => lastSignature,
      mode: 'simple-media-events',
      destroy: () => {
        if (timer) clearInterval(timer);
        timer = null;
      }
    };
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start, { once: true });
  } else {
    start();
  }
})();