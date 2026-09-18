(() => {
  'use strict';

  const VERSION = '20260918-https-snapshot-compat1';
  const SRC = 'js/iptv-https-snapshot.js?v=20260918-https-snapshot-clean1';

  if (window.__luxSyncedCatalogCompat === VERSION) return;
  window.__luxSyncedCatalogCompat = VERSION;

  const expose = () => {
    if (!window.LuxHttpsIptv) return false;
    window.LuxSyncedCatalog = {
      version: VERSION,
      manifestUrl: () => window.LuxHttpsIptv.manifestUrl,
      reload: () => window.LuxHttpsIptv.reload()
    };
    return true;
  };

  if (!expose() && !document.querySelector('script[data-lux-https-snapshot]')) {
    const script = document.createElement('script');
    script.src = SRC;
    script.async = false;
    script.dataset.luxHttpsSnapshot = '1';
    script.addEventListener('load', expose, { once: true });
    document.head.appendChild(script);
  }

  let attempts = 0;
  const timer = setInterval(() => {
    attempts += 1;
    if (expose() || attempts >= 160) clearInterval(timer);
  }, 50);
})();
