(() => {
  'use strict';

  const VERSION = '20260915-secondary-background-retired1';
  if (window.__luxSecondaryBackgroundLoaderInstalled === VERSION) return;
  window.__luxSecondaryBackgroundLoaderInstalled = VERSION;

  // O antigo pipeline de fontes secundárias/revisão de idioma foi aposentado.
  // Nada de grouping, locale preview, aprovação, observers globais ou polling
  // deve rodar no login/Home. O novo Source Hub é administrativo e independente.

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

  // Limpa observers antigos caso uma versão anterior tenha sido executada
  // antes da atualização/service worker entregar este arquivo.
  try { window.__luxSecondaryModalObserver?.disconnect?.(); } catch (_) {}
  try { window.__luxAdminSyncLayoutObserver?.disconnect?.(); } catch (_) {}
  window.__luxSecondaryModalObserver = null;
  window.__luxAdminSyncLayoutObserver = null;

  retireLegacyWrapper();
  setTimeout(retireLegacyWrapper, 0);

  window.LuxLegacySecondaryRuntime = Object.freeze({
    version: VERSION,
    retired: true
  });
})();