(() => {
  'use strict';

  const VERSION = '20260914-secondary-background-1';
  if (window.__luxSecondaryBackgroundLoaderInstalled === VERSION) return;
  window.__luxSecondaryBackgroundLoaderInstalled = VERSION;

  function unwrapLoadFunction(fn) {
    let current = fn;
    const seen = new Set();
    while (typeof current === 'function' && !seen.has(current)) {
      seen.add(current);
      if (current.__luxProviderLayerOriginal) {
        current = current.__luxProviderLayerOriginal;
        continue;
      }
      if (current.__luxSecondarySourcesOriginal) {
        current = current.__luxSecondarySourcesOriginal;
        continue;
      }
      break;
    }
    return current;
  }

  function runComplementInBackground() {
    setTimeout(async () => {
      try {
        if (window.LuxSecondarySources?.mergeIntoCurrentCatalog) {
          await window.LuxSecondarySources.mergeIntoCurrentCatalog({ refreshUi: true });
        }
      } catch (error) {
        console.warn('[LUX-IPTV-039] Fontes secundárias falharam em segundo plano:', error);
      }

      try {
        if (window.LuxProviderSources?.mergeIntoCurrentCatalog) {
          await window.LuxProviderSources.mergeIntoCurrentCatalog({ refreshUi: true });
        }
      } catch (error) {
        console.warn('[LUX-IPTV-039] Providers falharam em segundo plano:', error);
      }
    }, 0);
  }

  function install() {
    const current = window.loadMediaSourcesInPriority;
    if (typeof current !== 'function') return false;
    if (current.__luxNonBlockingSources) return true;

    const base = unwrapLoadFunction(current);
    if (typeof base !== 'function') return false;

    const wrapped = async function () {
      const principalLoaded = await base.apply(this, arguments);
      runComplementInBackground();
      return principalLoaded;
    };

    wrapped.__luxNonBlockingSources = true;
    wrapped.__luxNonBlockingBase = base;
    window.loadMediaSourcesInPriority = wrapped;
    console.info('[LUX-IPTV-039] Complementos externos agora carregam em segundo plano.');
    return true;
  }

  let attempts = 0;
  if (!install()) {
    const timer = setInterval(() => {
      attempts += 1;
      if (install() || attempts >= 240) clearInterval(timer);
    }, 50);
  }
})();
