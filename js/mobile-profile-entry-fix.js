(() => {
  'use strict';

  const VERSION = '20260917-mobile-profile-entry2';
  if (window.__luxMobileProfileEntryFix === VERSION) return;
  window.__luxMobileProfileEntryFix = VERSION;

  let entering = false;
  let watchdog = null;

  function splashVisible() {
    const splash = document.getElementById('loadingSplash');
    return !!splash && !splash.classList.contains('hidden');
  }

  function picker() {
    return document.getElementById('profilePicker');
  }

  function dashboardReady() {
    const dashboard = document.getElementById('mainDashboard');
    return !!dashboard && !dashboard.classList.contains('hidden');
  }

  function hasActiveProfile() {
    try { return Boolean(typeof currentUser !== 'undefined' && currentUser?.profile); }
    catch (_) { return false; }
  }

  function hideSplash() {
    try {
      if (typeof window.hideSplashScreen === 'function') window.hideSplashScreen();
      else document.getElementById('loadingSplash')?.classList.add('hidden');
    } catch (_) {
      try { document.getElementById('loadingSplash')?.classList.add('hidden'); } catch (_) {}
    }
  }

  function showPicker(message = '') {
    const target = picker();
    if (!target) return;
    try {
      if (typeof window.transitionScreen === 'function') window.transitionScreen(target, true);
      else target.classList.remove('hidden', 'screen-hidden-up', 'screen-hidden-down');
    } catch (_) {
      target.classList.remove('hidden', 'screen-hidden-up', 'screen-hidden-down');
    }
    if (message) {
      const status = document.getElementById('profilePickerStatus');
      if (status) status.textContent = message;
    }
  }

  function recoverFromStuckSplash() {
    if (!entering || !splashVisible()) return;
    console.warn('[Lux Play] Entrada do perfil excedeu o tempo esperado; liberando a interface.');
    hideSplash();

    // startApp reveals the dashboard before its optional cloud/catalog jobs finish.
    // If that already happened, keep the selected profile and let those jobs finish
    // in the background. Otherwise return to the real profile picker.
    if (!dashboardReady() || !hasActiveProfile()) {
      showPicker('A abertura demorou mais que o esperado. Tente escolher o perfil novamente.');
    }
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
        hideSplash();
        if (!dashboardReady() || !hasActiveProfile()) {
          showPicker(error?.message || 'Não foi possível abrir o perfil. Tente novamente.');
        }
        throw error;
      }
    };
    wrapped.__luxMobileProfileEntryWrapped = VERSION;
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