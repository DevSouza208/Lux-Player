(() => {
  'use strict';
  if (window.__luxSourceHubLoaderInstalled) return;
  window.__luxSourceHubLoaderInstalled = '20260916-drive-hq3';

  function load(src, marker) {
    if (document.querySelector(`script[data-${marker}]`)) return;
    const script = document.createElement('script');
    script.src = src;
    script.async = false;
    script.dataset[marker.replace(/-([a-z])/g, (_, c) => c.toUpperCase())] = '1';
    document.head.appendChild(script);
  }

  load('js/lux-source-hub.js?v=20260915-drive-hq2', 'lux-source-hub');
  load('js/lux-source-hub-admin.js?v=20260916-drive-hq3', 'lux-source-hub-admin');
})();
