(() => {
  'use strict';

  function hideLegacyLog() {
    const panel = document.getElementById('debugPanel');
    if (!panel) return;
    panel.style.display = 'none';
    panel.setAttribute('aria-hidden', 'true');
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', hideLegacyLog, { once: true });
  else hideLegacyLog();
})();
