(() => {
  'use strict';

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

      // Nunca deixa o slow-motion competir com o fast-forward.
      if (enabling) {
        try { manager?.toggleSlowMotion?.(0); } catch (_) {}
        try { if (emulator) emulator.isSlowMotion = false; } catch (_) {}
      }

      const result = original.apply(this, args);

      // Ao desligar o fast-forward, força explicitamente o estado normal (1x).
      if (typeof emulatorFastForward !== 'undefined' && !emulatorFastForward) normalSpeed();
      return result;
    };

    patched.__luxNormalSpeedPatched = true;
    toggleEmulatorFastForward = patched;
    return true;
  }

  // O EmulatorJS é carregado dinamicamente. Normaliza cada nova instância assim que
  // o gameManager fica disponível para evitar herdar slow-motion/estado de 0.5x.
  const timer = setInterval(() => {
    patchToggle();
    const emulator = window.EJS_emulator;
    if (!emulator || !emulator.gameManager || normalized.has(emulator)) return;
    if (normalSpeed()) normalized.add(emulator);
  }, 200);

  window.addEventListener('beforeunload', () => clearInterval(timer), { once: true });
})();
