(() => {
  'use strict';

  const isStandalone = window.matchMedia?.('(display-mode: standalone)').matches || window.navigator.standalone === true;
  const isPhone = /iPhone|iPod|Android.*Mobile/i.test(navigator.userAgent || '') ||
    (navigator.maxTouchPoints > 1 && Math.min(screen.width || 9999, screen.height || 9999) <= 768);

  // One-time recovery for the standalone PWA only. We intentionally clear only
  // EmulatorJS' downloaded-core cache. Lux saves and downloaded ROMs live in
  // separate stores and are left untouched.
  if (isStandalone && isPhone) {
    const RECOVERY_KEY = 'lux-play:pwa-emulator-recovery-v2';
    let alreadyRecovered = false;
    try { alreadyRecovered = localStorage.getItem(RECOVERY_KEY) === '1'; } catch (_) {}

    if (!alreadyRecovered) {
      try {
        const request = indexedDB.deleteDatabase('EmulatorJS-Cache');
        request.onsuccess = request.onerror = request.onblocked = () => {};
      } catch (_) {}

      if ('caches' in window) {
        caches.keys().then(names => Promise.allSettled(names.map(name => caches.delete(name)))).catch(() => {});
      }

      try {
        Object.keys(localStorage).forEach(key => {
          if (!/^lux-play:/i.test(key)) return;
          if (/orientation|rotate|rotation|landscape/i.test(key)) localStorage.removeItem(key);
        });
        localStorage.setItem(RECOVERY_KEY, '1');
      } catch (_) {}
    }
  }

  // Rotation experiments are deliberately disabled while the landscape UI is rebuilt.
  // Remove only emulator-specific legacy assets/elements; the separate Lux Controller
  // PWA keeps its own orientation logic untouched.
  const removeLegacyRotationArtifacts = () => {
    document.querySelectorAll(
      '#luxVisibleMobileRotateButton, #luxEmulatorRotateButton, .lux-visible-mobile-rotate-button, .lux-emulator-rotate-button, #luxEmulatorOrientationSetting, [data-lux-rotate-setting]'
    ).forEach(node => node.remove());

    document.querySelectorAll('link[href]').forEach(link => {
      const href = String(link.getAttribute('href') || '');
      if (/mobile-lux-landscape-tune|mobile-lux-landscape-final|mobile-lux-ergonomics-tune|mobile-lux-158-polish/i.test(href)) {
        link.remove();
      }
    });

    const modal = document.getElementById('emulatorModal');
    if (modal) {
      modal.style.removeProperty('transform');
      modal.style.removeProperty('transform-origin');
      modal.style.removeProperty('width');
      modal.style.removeProperty('height');
    }

    const container = document.getElementById('emulatorContainer');
    if (container) {
      container.style.removeProperty('transform');
      container.style.removeProperty('transform-origin');
    }
  };

  removeLegacyRotationArtifacts();
  const cleanupObserver = new MutationObserver(removeLegacyRotationArtifacts);
  cleanupObserver.observe(document.documentElement, { childList: true, subtree: true });

  if (window.__luxEmulatorSpeedFixInstalled) return;
  window.__luxEmulatorSpeedFixInstalled = true;

  const normalized = new WeakSet();

  function normalSpeed() {
    const emulator = window.EJS_emulator;
    const manager = emulator?.gameManager;
    if (!emulator || !manager) return false;

    try { manager.toggleFastForward?.(0); } catch (_) {}
    try { manager.toggleSlowMotion?.(0); } catch (_) {}
    try { manager.setFastForwardRatio?.(3); } catch (_) {}
    try { manager.setSlowMotionRatio?.(2); } catch (_) {}

    try { emulator.isFastForward = false; } catch (_) {}
    try { emulator.isSlowMotion = false; } catch (_) {}

    return true;
  }

  function patchToggle() {
    if (typeof toggleEmulatorFastForward !== 'function' || toggleEmulatorFastForward.__luxNormalSpeedPatched) return false;

    const original = toggleEmulatorFastForward;
    const patched = function (...args) {
      const emulator = window.EJS_emulator;
      const manager = emulator?.gameManager;
      const enabling = typeof emulatorFastForward !== 'undefined' ? !emulatorFastForward : true;

      if (enabling) {
        try { manager?.toggleSlowMotion?.(0); } catch (_) {}
        try { if (emulator) emulator.isSlowMotion = false; } catch (_) {}
      }

      const result = original.apply(this, args);
      if (typeof emulatorFastForward !== 'undefined' && !emulatorFastForward) normalSpeed();
      return result;
    };

    patched.__luxNormalSpeedPatched = true;
    toggleEmulatorFastForward = patched;
    return true;
  }

  const timer = setInterval(() => {
    patchToggle();
    removeLegacyRotationArtifacts();
    const emulator = window.EJS_emulator;
    if (!emulator || !emulator.gameManager || normalized.has(emulator)) return;
    if (normalSpeed()) normalized.add(emulator);
  }, 200);

  window.addEventListener('beforeunload', () => {
    clearInterval(timer);
    cleanupObserver.disconnect();
  }, { once: true });
})();
