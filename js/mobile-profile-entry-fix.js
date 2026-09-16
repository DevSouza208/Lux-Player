(() => {
  'use strict';

  const VERSION = '20260916-mobile-profile-entry1';
  if (window.__luxMobileProfileEntryFix === VERSION) return;
  window.__luxMobileProfileEntryFix = VERSION;

  let entering = false;
  let watchdog = null;

  function splashVisible() {
    const splash = document.getElementById('loadingSplash');
    return !!splash && !splash.classList.contains('hidden');
  }

  function pickerVisible() {
    const picker = document.getElementById('profilePickerModal');
    return !!picker && !picker.classList.contains('hidden');
  }

  function dashboardReady() {
    const dashboard = document.getElementById('mainDashboard');
    return !!dashboard && !dashboard.classList.contains('hidden');
  }

  function recoverFromStuckSplash() {
    if (!entering || !splashVisible()) return;
    console.warn('[Lux Play] Entrada do perfil excedeu o tempo esperado; liberando a interface.');
    try { document.getElementById('loadingSplash')?.classList.add('hidden'); } catch (_) {}
    try { document.getElementById('profilePickerModal')?.classList.remove('hidden'); } catch (_) {}
    entering = false;
  }

  function armWatchdog() {
    clearTimeout(watchdog);
    watchdog = setTimeout(recoverFromStuckSplash, 12000);
  }

  function finishEntry() {
    clearTimeout(watchdog);
    entering = false;
  }

  function install() {
    const fn = window.activateAccountProfile;
    if (typeof fn !== 'function') return false;
    if (fn.__luxMobileProfileEntryWrapped) return true;

    const wrapped = async function(profile) {
      if (entering) return;
      entering = true;
      armWatchdog();
      try {
        const result = await fn.apply(this, arguments);
        finishEntry();
        return result;
      } catch (error) {
        finishEntry();
        console.error('[Lux Play] Falha ao abrir perfil.', error);
        try { document.getElementById('loadingSplash')?.classList.add('hidden'); } catch (_) {}
        try { document.getElementById('profilePickerModal')?.classList.remove('hidden'); } catch (_) {}
        throw error;
      }
    };
    wrapped.__luxMobileProfileEntryWrapped = true;
    wrapped.__luxMobileProfileEntryOriginal = fn;
    window.activateAccountProfile = wrapped;
    return true;
  }

  let attempts = 0;
  const timer = setInterval(() => {
    attempts += 1;
    if (install() || attempts >= 240) clearInterval(timer);
  }, 50);
  install();

  document.addEventListener('visibilitychange', () => {
    if (!document.hidden && entering && splashVisible()) armWatchdog();
  });
})();