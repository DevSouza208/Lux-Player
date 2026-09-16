(() => {
  'use strict';

  const VERSION = '20260916-secondary-background-drive2';
  if (window.__luxSecondaryBackgroundLoaderInstalled === VERSION) return;
  window.__luxSecondaryBackgroundLoaderInstalled = VERSION;

  // O pipeline antigo de revisão/idioma continua aposentado. Este loader só
  // mantém a limpeza do runtime legado e conecta a UI administrativa do Drive.
  function unwrapLoadFunction(fn) {
    let current = fn;
    const seen = new Set();
    while (typeof current === 'function' && !seen.has(current)) {
      seen.add(current);
      if (current.__luxProviderLayerOriginal) { current = current.__luxProviderLayerOriginal; continue; }
      if (current.__luxSecondarySourcesOriginal) { current = current.__luxSecondarySourcesOriginal; continue; }
      if (current.__luxNonBlockingBase) { current = current.__luxNonBlockingBase; continue; }
      break;
    }
    return current;
  }

  function retireLegacyWrapper() {
    const current = window.loadMediaSourcesInPriority;
    if (typeof current !== 'function') return false;
    const base = unwrapLoadFunction(current);
    if (typeof base === 'function' && base !== current) window.loadMediaSourcesInPriority = base;
    return true;
  }

  try { window.__luxSecondaryModalObserver?.disconnect?.(); } catch (_) {}
  try { window.__luxAdminSyncLayoutObserver?.disconnect?.(); } catch (_) {}
  window.__luxSecondaryModalObserver = null;
  window.__luxAdminSyncLayoutObserver = null;

  retireLegacyWrapper();
  setTimeout(retireLegacyWrapper, 0);

  if (!document.querySelector('script[data-lux-drive-secondary-source-ui]')) {
    const script = document.createElement('script');
    script.src = 'js/drive-secondary-source-ui.js?v=20260916-2';
    script.async = false;
    script.dataset.luxDriveSecondarySourceUi = '1';
    document.head.appendChild(script);
  }

  window.LuxLegacySecondaryRuntime = Object.freeze({ version: VERSION, retired: true });
})();