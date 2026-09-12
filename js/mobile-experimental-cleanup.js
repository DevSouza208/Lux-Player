(() => {
  'use strict';

  if (window.__luxExperimentalControlsCleanupInstalled) return;
  window.__luxExperimentalControlsCleanupInstalled = true;

  const junkSelectors = [
    '#luxVisibleMobileRotateButton',
    '#luxEmulatorRotateButton',
    '.lux-visible-mobile-rotate-button',
    '.lux-emulator-rotate-button',
    '#luxEmulatorOrientationSetting',
    '.lux-orientation-setting-card',
    '[data-lux-rotate-setting]',
    '.lux-controls-opacity-card',
    '.lux-controls-opacity-slider'
  ].join(',');

  const resetBrandButton = () => {
    document.querySelectorAll('#emulatorModal .lux-console-brand-button').forEach(button => {
      const wasRotate = button.dataset.luxRotateBrand === '1'
        || /girar tela/i.test(button.getAttribute('aria-label') || '')
        || /girar tela/i.test(button.title || '')
        || !!button.querySelector('svg');
      if (!wasRotate) return;

      const clean = document.createElement('button');
      clean.type = 'button';
      clean.className = 'lux-console-brand-button';
      clean.tabIndex = -1;
      clean.disabled = true;
      clean.setAttribute('aria-hidden', 'true');
      clean.innerHTML = '<img src="lux-play-icon.svg" alt="">';
      button.replaceWith(clean);
    });
  };

  const clearVirtualRotation = () => {
    document.documentElement.classList.remove('lux-virtual-orientation-active');
    document.getElementById('luxGameplayRotationFitStyle')?.remove();

    const modal = document.getElementById('emulatorModal');
    if (!modal) return;

    const hadVirtualRotation = modal.classList.contains('lux-virtual-orientation')
      || modal.classList.contains('lux-virtual-landscape')
      || modal.classList.contains('lux-virtual-portrait')
      || /rotate\(/i.test(modal.style.transform || '');

    modal.classList.remove(
      'lux-virtual-orientation',
      'lux-virtual-landscape',
      'lux-virtual-portrait',
      'lux-landscape-gameplay-fitted'
    );

    if (hadVirtualRotation) {
      ['left', 'top', 'right', 'bottom', 'width', 'height', 'maxWidth', 'maxHeight', 'transform', 'transformOrigin', 'inset']
        .forEach(prop => modal.style[prop] = '');
      [
        '--lux-screen-left', '--lux-screen-top', '--lux-screen-width', '--lux-screen-height',
        '--lux-visible-screen-left', '--lux-visible-screen-top', '--lux-visible-screen-width', '--lux-visible-screen-height'
      ].forEach(prop => modal.style.removeProperty(prop));
    }
  };

  const cleanup = () => {
    try { screen.orientation?.unlock?.(); } catch (_) {}

    try {
      localStorage.removeItem('lux-play:console-orientation');
      localStorage.removeItem('lux-play:console-controls-opacity');
    } catch (_) {}

    document.documentElement.style.removeProperty('--lux-game-controls-opacity');
    document.querySelectorAll(junkSelectors).forEach(node => node.remove());

    document.querySelectorAll('script').forEach(script => {
      const src = script.getAttribute('src') || '';
      if (/mobile-(rotate-setting-button|remove-rotate-overlay|controls-opacity)\.js/i.test(src)) script.remove();
    });

    document.querySelectorAll('link[rel="stylesheet"]').forEach(link => {
      const href = link.getAttribute('href') || '';
      if (/mobile-controls-opacity\.css/i.test(href)) link.remove();
    });

    clearVirtualRotation();
    resetBrandButton();
  };

  // Keep old cached handlers harmless if an already-open PWA still has them in memory.
  window.setEmulatorOrientation = () => false;
  window.toggleEmulatorOrientation = () => false;

  cleanup();
  const observer = new MutationObserver(cleanup);
  observer.observe(document.documentElement, { childList: true, subtree: true });

  window.addEventListener('pageshow', cleanup);
  window.addEventListener('orientationchange', () => setTimeout(cleanup, 50));
  [0, 100, 300, 800, 1800, 3500].forEach(delay => setTimeout(cleanup, delay));
})();
