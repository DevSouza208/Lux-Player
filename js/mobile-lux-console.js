(() => {
  'use strict';

  if (!window.matchMedia('(max-width: 767px)').matches || window.__luxConsoleMobileStage1Installed) return;
  window.__luxConsoleMobileStage1Installed = true;

  const applyStage1 = () => {
    const modal = document.getElementById('emulatorModal');
    if (!modal) return false;
    modal.classList.add('lux-console-mobile-stage1');
    document.body.classList.add('lux-console-open');
    return true;
  };

  const cleanup = () => {
    if (!document.getElementById('emulatorModal')) {
      document.body.classList.remove('lux-console-open');
    }
  };

  const observer = new MutationObserver(() => {
    if (!applyStage1()) cleanup();
  });

  observer.observe(document.body, { childList: true, subtree: true });
  applyStage1();
})();
