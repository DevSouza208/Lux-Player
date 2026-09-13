(() => {
  'use strict';

  const VERSION = '20260913-user-snapshot-bootstrap1';
  if (window.__luxSyncedCatalogBootstrap === VERSION) return;
  window.__luxSyncedCatalogBootstrap = VERSION;

  const load = () => {
    if (document.querySelector('script[data-lux-user-snapshot-loader]')) return;
    const script = document.createElement('script');
    script.src = 'js/user-snapshot-loader.js?v=20260913-user-snapshot-loader1';
    script.async = true;
    script.dataset.luxUserSnapshotLoader = '1';
    document.head.appendChild(script);
  };

  // O catálogo global/reconciliado foi aposentado. O navegador lê apenas a
  // versão HTTPS individual já publicada pelo servidor; se ela ainda não
  // existir, o loader mantém a lista HTTPS anterior até a nova ficar pronta.
  load();
})();