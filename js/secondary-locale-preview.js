(() => {
  'use strict';
  // A antiga revisão/prévia de idioma do catálogo secundário foi aposentada.
  // O loader continua encontrando este arquivo para compatibilidade com caches antigos,
  // mas ele não faz mais varredura, classificação ou chamadas de idioma.
  window.__luxSecondaryLocalePreviewInstalled = 'retired-20260915';
  window.LuxSecondaryLocalePreview = null;

  if (document.querySelector('script[data-lux-admin-hub]')) return;
  const script = document.createElement('script');
  script.src = 'js/admin-panel-polish.js?v=20260915-admin-hub2';
  script.async = false;
  script.dataset.luxAdminHub = '1';
  document.head.appendChild(script);
})();