(() => {
  'use strict';
  const VERSION = '20260915-secondary-locale-retired1';
  if (window.__luxSecondaryLocaleInstalled === VERSION) return;
  window.__luxSecondaryLocaleInstalled = VERSION;

  // Recurso aposentado: nenhuma classificação PT/internacional é aplicada ao catálogo.
  // Mantemos apenas uma API neutra para código antigo não quebrar durante a transição.
  window.LuxSecondaryLocale = Object.freeze({
    version: VERSION,
    retired: true,
    classify: () => 'unclassified',
    organizeCatalog: () => ({ changed: 0, removed: 0, retired: true }),
    internationalGroup: ''
  });
})();