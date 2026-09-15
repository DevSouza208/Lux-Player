(() => {
  'use strict';
  // Providers de conteúdo foram aposentados. Mantemos este arquivo como ponte
  // temporária porque builds antigos ainda o carregam em cache.
  window.__luxProviderContentSourcesInstalled = 'retired-20260915';
  window.LuxProviderContentSources = null;

  if (document.querySelector('script[data-lux-admin-hub]')) return;
  const script = document.createElement('script');
  script.src = 'js/admin-panel-polish.js?v=20260915-admin-hub2';
  script.async = false;
  script.dataset.luxAdminHub = '1';
  document.head.appendChild(script);
})();