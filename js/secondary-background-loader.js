(() => {
  'use strict';

  const VERSION = '20260916-secondary-background-drive3';
  if (window.__luxSecondaryBackgroundLoaderInstalled === VERSION) return;
  window.__luxSecondaryBackgroundLoaderInstalled = VERSION;

  // O pipeline antigo de revisão/idioma continua aposentado. Este loader só
  // mantém a limpeza do runtime legado e conecta as fontes atuais do Lux.
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

  function loadScript(src, marker) {
    if (document.querySelector(`script[data-${marker}]`)) return;
    const script = document.createElement('script');
    script.src = src;
    script.async = false;
    script.setAttribute(`data-${marker}`, '1');
    document.head.appendChild(script);
  }

  try { window.__luxSecondaryModalObserver?.disconnect?.(); } catch (_) {}
  try { window.__luxAdminSyncLayoutObserver?.disconnect?.(); } catch (_) {}
  window.__luxSecondaryModalObserver = null;
  window.__luxAdminSyncLayoutObserver = null;

  retireLegacyWrapper();
  setTimeout(retireLegacyWrapper, 0);

  loadScript('js/drive-secondary-source-ui.js?v=20260916-2', 'lux-drive-secondary-source-ui');
  // Este é o loader que já faz parte do runtime real do Lux. A biblioteca
  // publicada do Drive entra por aqui, sem depender do bootstrap administrativo.
  loadScript('js/reading-source-library.js?v=20260916-source-reading3', 'lux-reading-source-library-runtime');

  window.LuxLegacySecondaryRuntime = Object.freeze({ version: VERSION, retired: true });
})();