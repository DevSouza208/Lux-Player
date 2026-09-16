(() => {
  'use strict';

  const VERSION = '20260916-manual-login1';
  if (window.__luxManualLoginInstalled === VERSION) return;
  window.__luxManualLoginInstalled = VERSION;

  const LOCAL_USER_KEY = 'lux_auth_user';
  const LOCAL_PASS_KEY = 'lux_auth_pass';
  const SESSION_USER_KEY = 'lux_auth_session_user';
  const SESSION_PASS_KEY = 'lux_auth_session_pass';
  const SESSION_MARKER = '__LUX_SESSION_ONLY__';
  const REMEMBER_KEY = 'lux_remember_login';
  const REMEMBER_USER_KEY = 'lux_remember_user';
  const REMEMBER_PASS_KEY = 'lux_remember_pass';

  function safeGet(key) {
    try { return localStorage.getItem(key) || ''; } catch (_) { return ''; }
  }

  function safeSet(key, value) {
    try {
      if (value) localStorage.setItem(key, value);
      else localStorage.removeItem(key);
    } catch (_) {}
  }

  function clearAutomaticSessionState() {
    // O login volta a ser sempre explícito. Tokens/sessões antigas não podem mais
    // esconder a tela de login nem disparar handleLogin durante a inicialização.
    try {
      const legacyPass = localStorage.getItem(LOCAL_PASS_KEY) || '';
      if (legacyPass === SESSION_MARKER || /^luxsess_[A-Za-z0-9_-]{40,200}$/.test(legacyPass)) {
        localStorage.removeItem(LOCAL_PASS_KEY);
      }
      localStorage.removeItem(LOCAL_USER_KEY);
      sessionStorage.removeItem(SESSION_USER_KEY);
      sessionStorage.removeItem(SESSION_PASS_KEY);
    } catch (_) {}
    delete document.documentElement.dataset.luxAutoLoginPending;
  }

  function forceLoginVisible() {
    const splash = document.getElementById('loadingSplash');
    if (splash) {
      splash.classList.add('hidden', 'screen-hidden-up');
      splash.classList.remove('screen-visible');
    }
    const auth = document.getElementById('authScreen');
    if (auth) {
      auth.classList.remove('hidden', 'screen-hidden-up', 'screen-hidden-down');
      auth.classList.add('screen-visible');
    }
  }

  function ensureRememberControl() {
    const pass = document.getElementById('authPass');
    if (!pass || document.getElementById('luxRememberLogin')) return;

    const row = document.createElement('label');
    row.className = 'flex items-center gap-2 text-xs text-purple-300/80 cursor-pointer select-none';
    row.innerHTML = '<input id="luxRememberLogin" type="checkbox" class="accent-purple-600 w-3.5 h-3.5"><span>Manter conectado</span>';
    pass.closest('div')?.insertAdjacentElement('afterend', row);

    const remember = safeGet(REMEMBER_KEY) === '1';
    const checkbox = row.querySelector('#luxRememberLogin');
    checkbox.checked = remember;
    if (remember) {
      const user = document.getElementById('authEmail');
      if (user) user.value = safeGet(REMEMBER_USER_KEY);
      pass.value = safeGet(REMEMBER_PASS_KEY);
    }

    checkbox.addEventListener('change', () => {
      if (!checkbox.checked) {
        safeSet(REMEMBER_KEY, '');
        safeSet(REMEMBER_USER_KEY, '');
        safeSet(REMEMBER_PASS_KEY, '');
      }
    });
  }

  function installLoginPersistence() {
    if (typeof window.handleLogin !== 'function') return false;
    const original = window.handleLogin;
    if (original.__luxManualLoginWrapped) return true;

    const wrapped = async function () {
      const user = String(document.getElementById('authEmail')?.value || '').trim();
      const pass = String(document.getElementById('authPass')?.value || '');
      const remember = Boolean(document.getElementById('luxRememberLogin')?.checked);

      // Persistimos apenas o que o usuário explicitamente pediu para lembrar.
      // Isso serve somente para preencher o formulário; nunca dispara login sozinho.
      if (remember && user && pass) {
        safeSet(REMEMBER_KEY, '1');
        safeSet(REMEMBER_USER_KEY, user);
        safeSet(REMEMBER_PASS_KEY, pass);
      } else if (!remember) {
        safeSet(REMEMBER_KEY, '');
        safeSet(REMEMBER_USER_KEY, '');
        safeSet(REMEMBER_PASS_KEY, '');
      }

      return original.apply(this, arguments);
    };
    wrapped.__luxManualLoginWrapped = VERSION;
    window.handleLogin = wrapped;
    return true;
  }

  function start() {
    clearAutomaticSessionState();
    forceLoginVisible();
    ensureRememberControl();

    let attempts = 0;
    const timer = setInterval(() => {
      attempts += 1;
      ensureRememberControl();
      if (installLoginPersistence() || attempts >= 200) clearInterval(timer);
    }, 25);
  }

  // Não existe mais auto-login neste módulo. Toda abertura começa na tela de login.
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true });
  else start();
})();
