(() => {
  'use strict';

  if (window.__luxOrientationInstalled) return;
  window.__luxOrientationInstalled = true;

  const gamepadScreen = document.getElementById('controllerScreen');
  const connectBtn = document.getElementById('connectBtn');

  function isStandalone() {
    return window.matchMedia?.('(display-mode: standalone)').matches || window.navigator.standalone === true;
  }

  function isLandscape() {
    return window.matchMedia?.('(orientation: landscape)').matches || window.innerWidth > window.innerHeight;
  }

  function isGamepadMode() {
    return document.body.dataset.luxMode === 'gamepad' || Boolean(gamepadScreen?.classList.contains('active'));
  }

  function ensureGuard() {
    let guard = document.getElementById('luxOrientationGuard');
    if (guard) return guard;
    guard = document.createElement('div');
    guard.id = 'luxOrientationGuard';
    Object.assign(guard.style, {
      position: 'fixed', inset: '0', zIndex: '2147483646', display: 'none',
      flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: '10px',
      padding: '24px', textAlign: 'center', background: '#0d0d12', color: '#f7f3ff',
      fontFamily: 'Inter,system-ui,-apple-system,"Segoe UI",sans-serif', touchAction: 'none'
    });
    document.body.appendChild(guard);
    return guard;
  }

  function updateGuard() {
    const guard = ensureGuard();
    const gamepad = isGamepadMode();
    const wrong = gamepad ? !isLandscape() : isLandscape();
    if (!wrong) { guard.style.display = 'none'; return; }
    guard.innerHTML = gamepad
      ? '<div style="font-size:3rem;line-height:1">↻</div><strong style="font-size:1rem">Gire o celular para a horizontal</strong><span style="font-size:.78rem;color:#aaa0be">O Lux Pad foi feito para jogar com o celular deitado.</span>'
      : '<div style="font-size:3rem;line-height:1">↻</div><strong style="font-size:1rem">Gire o celular para a vertical</strong><span style="font-size:.78rem;color:#aaa0be">Lux Controller e Lux Control usam o celular em pé.</span>';
    guard.style.display = 'flex';
  }

  async function tryLock(orientation) {
    try { if (screen.orientation?.lock) await screen.orientation.lock(orientation); } catch (_) {}
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

  function syncMode(fromUserGesture = false) {
    if (isGamepadMode()) enterLandscape(fromUserGesture);
    else enterPortrait();
  }

  connectBtn?.addEventListener('click', () => syncMode(true), { capture: true });
  if (gamepadScreen) new MutationObserver(() => syncMode(false)).observe(gamepadScreen, { attributes: true, attributeFilter: ['class'] });
  new MutationObserver(() => syncMode(false)).observe(document.body, { attributes: true, attributeFilter: ['data-lux-mode'] });
  window.addEventListener('luxmodechange', () => syncMode(true));
  window.addEventListener('orientationchange', updateGuard);
  window.addEventListener('resize', updateGuard);
  window.addEventListener('pageshow', () => syncMode(false));

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => syncMode(false), { once: true });
  else syncMode(false);
})();
