(() => {
  'use strict';

  const VERSION = '20260915-auto-login-resilience1';
  if (window.__luxAutoLoginResilienceInstalled === VERSION) return;
  window.__luxAutoLoginResilienceInstalled = VERSION;

  const LOCAL_USER_KEY = 'lux_auth_user';
  const LOCAL_PASS_KEY = 'lux_auth_pass';
  const SESSION_USER_KEY = 'lux_auth_session_user';
  const SESSION_PASS_KEY = 'lux_auth_session_pass';
  const SESSION_MARKER = '__LUX_SESSION_ONLY__';
  const MAX_ATTEMPTS = 3;

  let autoLoginPending = false;
  let wrappersInstalled = false;

  const isSessionCredential = value => /^luxsess_[A-Za-z0-9_-]{40,200}$/.test(String(value || ''));
  const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

  function storedAuth() {
    try {
      const localUser = localStorage.getItem(LOCAL_USER_KEY) || '';
      const sessionUser = sessionStorage.getItem(SESSION_USER_KEY) || '';
      const localCredential = localStorage.getItem(LOCAL_PASS_KEY) || '';
      const sessionCredential = sessionStorage.getItem(SESSION_PASS_KEY) || '';
      const credential = isSessionCredential(localCredential)
        ? localCredential
        : (localCredential === SESSION_MARKER && isSessionCredential(sessionCredential) ? sessionCredential : '');
      return {
        username: String(localUser || sessionUser || '').trim(),
        credential,
      };
    } catch (_) {
      return { username: '', credential: '' };
    }
  }

  function hasAutomaticSession() {
    const auth = storedAuth();
    return Boolean(auth.username && isSessionCredential(auth.credential));
  }

  function splashStatus(text) {
    const status = document.getElementById('splashStatusMessage');
    if (status) status.textContent = text;
  }

  function showAutomaticSplash() {
    if (!hasAutomaticSession()) return false;
    autoLoginPending = true;
    document.documentElement.dataset.luxAutoLoginPending = '1';

    const auth = document.getElementById('authScreen');
    if (auth) {
      auth.classList.add('hidden');
      auth.classList.remove('screen-visible');
    }

    const splash = document.getElementById('loadingSplash');
    if (splash) {
      splash.classList.remove('hidden', 'screen-hidden-up', 'screen-hidden-down');
      splash.classList.add('screen-visible');
    }

    const user = storedAuth().username || 'Usuário';
    const name = document.getElementById('splashUserName');
    if (name) name.textContent = user;
    splashStatus('Entrando automaticamente...');
    return true;
  }

  function clearVisibleLoginFields() {
    const user = document.getElementById('authEmail');
    const pass = document.getElementById('authPass');
    if (user) user.value = '';
    if (pass) pass.value = '';
  }

  function finishAutomaticLogin(success) {
    if (!autoLoginPending && document.documentElement.dataset.luxAutoLoginPending !== '1') return;

    const splash = document.getElementById('loadingSplash');
    if (splash) {
      splash.classList.add('hidden');
      splash.classList.remove('screen-visible');
      splash.classList.add('screen-hidden-up');
    }

    if (!success) {
      clearVisibleLoginFields();
      const auth = document.getElementById('authScreen');
      if (auth) {
        auth.classList.remove('hidden', 'screen-hidden-up', 'screen-hidden-down');
        auth.classList.add('screen-visible');
      }
      const status = document.getElementById('authStatusText');
      if (status) {
        status.textContent = 'Falha no login automático. Digite seu usuário e senha para entrar.';
        status.className = 'text-xs text-center text-rose-400 font-medium';
      }
      const button = document.getElementById('loginBtn');
      if (button) button.disabled = false;
    }

    autoLoginPending = false;
    delete document.documentElement.dataset.luxAutoLoginPending;
  }

  function signedIn() {
    try { return Boolean(typeof currentUser !== 'undefined' && currentUser); }
    catch (_) { return false; }
  }

  function installWrappers() {
    if (wrappersInstalled) return true;
    if (typeof window.fetchUsersFromSupabase !== 'function' || typeof window.handleLogin !== 'function') return false;

    const originalFetchUsers = window.fetchUsersFromSupabase;
    if (!originalFetchUsers.__luxAutoLoginRetryWrapped) {
      const wrappedFetchUsers = async function () {
        const pass = String(document.getElementById('authPass')?.value || storedAuth().credential || '');
        const automatic = autoLoginPending || document.documentElement.dataset.luxAutoLoginPending === '1';
        const sessionAttempt = automatic && isSessionCredential(pass);
        const attempts = sessionAttempt ? MAX_ATTEMPTS : 1;
        let lastError = null;

        for (let attempt = 1; attempt <= attempts; attempt++) {
          if (sessionAttempt) {
            splashStatus(attempt === 1
              ? 'Entrando automaticamente...'
              : `Reconectando... tentativa ${attempt} de ${attempts}`);
          }

          try {
            const result = await originalFetchUsers.apply(this, arguments);
            // [] significa credencial realmente inválida/expirada; não insistimos.
            return result;
          } catch (error) {
            lastError = error;
            if (!sessionAttempt || attempt >= attempts) break;
            await sleep(350 * attempt);
          }
        }

        throw lastError || new Error('auto_login_failed');
      };
      wrappedFetchUsers.__luxAutoLoginRetryWrapped = VERSION;
      window.fetchUsersFromSupabase = wrappedFetchUsers;
    }

    const originalHandleLogin = window.handleLogin;
    if (!originalHandleLogin.__luxAutoLoginResilienceWrapped) {
      const wrappedHandleLogin = async function () {
        const automatic = autoLoginPending || document.documentElement.dataset.luxAutoLoginPending === '1';
        try {
          return await originalHandleLogin.apply(this, arguments);
        } finally {
          if (automatic) finishAutomaticLogin(signedIn());
        }
      };
      wrappedHandleLogin.__luxAutoLoginResilienceWrapped = VERSION;
      window.handleLogin = wrappedHandleLogin;
    }

    wrappersInstalled = true;
    window.LuxAutoLoginResilience = {
      version: VERSION,
      attempts: MAX_ATTEMPTS,
      retry() {
        if (!hasAutomaticSession() || typeof window.handleLogin !== 'function') return false;
        showAutomaticSplash();
        const auth = storedAuth();
        const user = document.getElementById('authEmail');
        const pass = document.getElementById('authPass');
        if (user) user.value = auth.username;
        if (pass) pass.value = auth.credential;
        window.handleLogin();
        return true;
      }
    };
    return true;
  }

  // Esconde o formulário assim que possível. O listener legado ainda pode preencher
  // os inputs por baixo, mas eles nunca ficam visíveis ao usuário durante o auto-login.
  showAutomaticSplash();

  const start = () => {
    if (installWrappers()) return;
    let attempts = 0;
    const timer = setInterval(() => {
      attempts += 1;
      if (installWrappers() || attempts >= 200) {
        clearInterval(timer);
        if (!wrappersInstalled && autoLoginPending) finishAutomaticLogin(false);
      }
    }, 25);
  };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true });
  else start();
})();
