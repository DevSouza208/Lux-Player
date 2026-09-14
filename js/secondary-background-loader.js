(() => {
  'use strict';

  const VERSION = '20260914-secondary-background-2';
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
      if (current.__luxNonBlockingBase) {
        current = current.__luxNonBlockingBase;
        continue;
      }
      break;
    }
    return current;
  }

  let backgroundRun = null;
  function runComplementInBackground() {
    if (backgroundRun) return backgroundRun;
    backgroundRun = new Promise(resolve => setTimeout(resolve, 0))
      .then(async () => {
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
      })
      .finally(() => { backgroundRun = null; });
    return backgroundRun;
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
    console.info('[LUX-IPTV-039] Complementos externos carregam em segundo plano.');
    return true;
  }

  // Secondary/provider modules chegam de forma assíncrona e podem embrulhar a função
  // depois deste arquivo. Reaplicamos a proteção por alguns segundos para garantir
  // que a camada mais externa continue não bloqueante antes e depois do login.
  let attempts = 0;
  install();
  const timer = setInterval(() => {
    attempts += 1;
    install();
    if (attempts >= 120) clearInterval(timer);
  }, 100);
})();
