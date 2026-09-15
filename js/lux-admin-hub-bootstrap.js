(() => {
  'use strict';
  if (window.__luxAdminHubBootstrapInstalled) return;
  window.__luxAdminHubBootstrapInstalled = '20260915-1';
  const scripts = [
    ['js/admin-panel-polish.js?v=20260915-admin-hub2', 'lux-admin-hub'],
    ['js/lux-source-hub-loader.js?v=20260915-drive-hq1', 'lux-source-loader']
  ];
  scripts.forEach(([src, marker]) => {
    if (document.querySelector(`script[data-${marker}]`)) return;
    const script = document.createElement('script');
    script.src = src;
    script.async = false;
    script.setAttribute(`data-${marker}`, '1');
    document.head.appendChild(script);
  });
})();
