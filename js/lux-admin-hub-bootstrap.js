(() => {
  'use strict';
  if (window.__luxAdminHubBootstrapInstalled) return;
  window.__luxAdminHubBootstrapInstalled = '20260917-12';
  const scripts = [
    ['js/admin-panel-polish.js?v=20260916-admin-hub3', 'lux-admin-hub'],
    ['js/lux-source-hub-loader.js?v=20260916-drive-hq5', 'lux-source-loader'],
    ['js/home-featured-live-channel-picker.js?v=20260915-featured-live-picker1', 'lux-featured-live-picker'],
    ['js/profile-entry-fastboot.js?v=20260917-profile-fastboot1', 'lux-profile-entry-fastboot'],
    ['js/mobile-profile-entry-fix.js?v=20260917-mobile-profile-entry2', 'lux-mobile-profile-entry-fix'],
    ['js/game-metadata-polish.js?v=20260917-game-metadata-polish1', 'lux-game-metadata-polish'],
    ['js/game-r2-metadata-save.js?v=20260917-r2-metadata-save1', 'lux-game-r2-metadata-save']
  ];
  scripts.forEach(([src, marker]) => {
    if (document.querySelector(`script[data-${marker}]`)) return;
    const script = document.createElement('script'); script.src = src; script.async = false;
    script.setAttribute(`data-${marker}`, '1'); document.head.appendChild(script);
  });
})();