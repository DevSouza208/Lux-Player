(() => {
  'use strict';
  if (window.__luxAdminHubBootstrapInstalled) return;
  window.__luxAdminHubBootstrapInstalled = '20260916-6';
  const scripts = [
    ['js/admin-panel-polish.js?v=20260916-admin-hub3', 'lux-admin-hub'],
    ['js/lux-source-hub-loader.js?v=20260916-drive-hq3', 'lux-source-loader'],
    ['js/home-featured-live-channel-picker.js?v=20260915-featured-live-picker1', 'lux-featured-live-picker'],
    ['js/reading-source-library.js?v=20260916-source-reading1', 'lux-reading-source-library'],
    ['js/mobile-profile-entry-fix.js?v=20260916-mobile-profile-entry1', 'lux-mobile-profile-entry-fix']
  ];
  scripts.forEach(([src, marker]) => {
    if (document.querySelector(`script[data-${marker}]`)) return;
    const script = document.createElement('script'); script.src = src; script.async = false;
    script.setAttribute(`data-${marker}`, '1'); document.head.appendChild(script);
  });
})();