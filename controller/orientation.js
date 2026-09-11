(() => {
  'use strict';

  if (window.__luxOrientationInstalled) return;
  window.__luxOrientationInstalled = true;

  const gamepadScreen = document.getElementById('controllerScreen');
  const joinScreen = document.getElementById('joinScreen');
  const connectBtn = document.getElementById('connectBtn');
  const disconnectBtn = document.getElementById('disconnectBtn');
  let connectWatchdog = null;

  function isStandalone() {
    return window.matchMedia?.('(display-mode: standalone)').matches || window.navigator.standalone === true;
  }

  function isGamepadActive() {
    return Boolean(gamepadScreen?.classList.contains('active'));
  }

  function isLandscape() {
    return window.matchMedia?.('(orientation: landscape)').matches || window.innerWidth > window.innerHeight;
  }

  function ensurePortraitGuard() {
    let guard = document.getElementById('luxPortraitGuard');
    if (guard) return guard;

    guard = document.createElement('div');
    guard.id = 'luxPortraitGuard';
    guard.setAttribute('aria-live', 'polite');
    guard.innerHTML = '<div style="font-size:3rem;line-height:1">↻</div><strong style="font-size:1rem">Gire o celular para a vertical</strong><span style="font-size:.78rem;color:#aaa0be">Lux Controller e Lux Control usam o celular em pé.</span>';
    Object.assign(guard.style, {
      position: 'fixed',
      inset: '0',
      zIndex: '2147483647',
      display: 'none',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      gap: '10px',
      padding: '24px',
      textAlign: 'center',
      background: '#0d0d12',
      color: '#f7f3ff',
      fontFamily: 'Inter,system-ui,-apple-system,"Segoe UI",sans-serif',
      touchAction: 'none'
    });
    document.body.appendChild(guard);
    return guard;
  }

  function updateGuard() {
    const guard = ensurePortraitGuard();
    guard.style.display = !isGamepadActive() && isLandscape() ? 'flex' : 'none';
  }

  async function tryLock(orientation) {
    try {
      if (screen.orientation?.lock) await screen.orientation.lock(orientation);
    } catch (_) {
      // iOS e alguns navegadores não permitem lock; o guard visual cobre o fallback.
    }
  }

  async function enterLandscape(fromUserGesture = false) {
    document.body.classList.add('mode-gamepad');

    if (fromUserGesture && !isStandalone() && !document.fullscreenElement && document.documentElement.requestFullscreen) {
      try { await document.documentElement.requestFullscreen(); } catch (_) {}
    }

    await tryLock('landscape');
    updateGuard();
  }

  async function enterPortrait() {
    document.body.classList.remove('mode-gamepad');
    try { screen.orientation?.unlock?.(); } catch (_) {}
    await tryLock('portrait');

    if (document.fullscreenElement && document.exitFullscreen) {
      try { await document.exitFullscreen(); } catch (_) {}
    }

    updateGuard();
  }

  function syncMode() {
    clearTimeout(connectWatchdog);
    connectWatchdog = null;
    if (isGamepadActive()) enterLandscape(false);
    else enterPortrait();
  }

  connectBtn?.addEventListener('click', () => {
    enterLandscape(true);
    clearTimeout(connectWatchdog);
    connectWatchdog = setTimeout(() => {
      if (!isGamepadActive()) enterPortrait();
    }, 13500);
  }, { capture: true });

  disconnectBtn?.addEventListener('click', () => enterPortrait(), { capture: true });

  if (gamepadScreen) {
    new MutationObserver(syncMode).observe(gamepadScreen, { attributes: true, attributeFilter: ['class'] });
  }

  if (joinScreen && connectBtn) {
    new MutationObserver(() => {
      if (!isGamepadActive() && joinScreen.classList.contains('active') && !connectBtn.disabled) enterPortrait();
    }).observe(connectBtn, { attributes: true, attributeFilter: ['disabled'] });
  }

  window.addEventListener('orientationchange', updateGuard);
  window.addEventListener('resize', updateGuard);
  window.addEventListener('pageshow', syncMode);

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', syncMode, { once: true });
  else syncMode();
})();
