(() => {
  const APP_VERSION = '1.6.3';
  const FRIENDLY_UI_VERSION = '20260914-v163-friendly-ui-23';

  const replacements = [
    [/Verificando dados no Supabase\.\.\./gi, 'Entrando na sua conta...'],
    [/Não foi possível conectar ao Supabase\. Tente novamente\./gi, 'Não foi possível entrar agora. Verifique sua conexão e tente novamente.'],
    [/Erro ao carregar do Supabase\./gi, 'Não foi possível carregar os clientes.'],
    [/Erro de conexão com Supabase\./gi, 'Não foi possível carregar os clientes. Tente novamente.'],
    [/Consultando status públicos\.\.\./gi, 'Atualizando informações...'],
    [/Carregando os status públicos\.\.\./gi, 'Preparando informações...'],
    [/Configurando sua experiência\.\.\. O primeiro acesso pode demorar cerca de 1 min\./gi, 'Preparando tudo para você... No primeiro acesso pode levar um pouquinho mais.'],
    [/Carregando seus perfis\.\.\./gi, 'Preparando seus perfis...'],
    [/Carregando perfis\.\.\./gi, 'Preparando seus perfis...'],
    [/Carregando catálogo de jogos/gi, 'Preparando seus jogos'],
    [/Buscando dados do jogo\.\.\./gi, 'Procurando informações do jogo...'],
    [/Carregando guia de programação\.\.\./gi, 'Preparando a programação...'],
    [/Baixando categorias e canais\.\.\./gi, 'Preparando seus canais...'],
    [/Baixando catálogo e categorias\.\.\./gi, 'Organizando seu catálogo...'],
    [/Baixando catálogo HTTPS sincronizado\.\.\./gi, 'Preparando seu catálogo...'],
    [/Buscando temporadas\.\.\./gi, 'Preparando temporadas...'],
    [/Carregando sinopse\.\.\./gi, 'Preparando detalhes...'],
    [/Sincronizando temporadas e episódios\.\.\./gi, 'Carregando episódios...'],
    [/Sincronizando sua M3U \+ catálogo PHP\. Isso pode levar alguns segundos\.\.\./gi, 'Atualizando seu catálogo. Isso pode levar alguns instantes...'],
    [/Conversão concluída\. Recarregando o catálogo HTTPS\.\.\./gi, 'Catálogo atualizado. Preparando os novos conteúdos...'],
    [/Catálogo IPTV sincronizado e aplicado/gi, 'Catálogo atualizado com sucesso'],
    [/Sincronizando\.\.\./gi, 'Atualizando...'],
    [/Sincronizando ([^\n]+?)\.\.\./gi, 'Atualizando $1...'],
    [/Sincronização parcial de /gi, 'Atualização parcial de '],
    [/sincronizado com sucesso/gi, 'atualizado com sucesso'],
    [/Catálogo Xtream HTTPS sincronizado/gi, 'Catálogo atualizado'],
    [/Lista M3U HTTPS sincronizada/gi, 'Catálogo atualizado'],
    [/Arquivo M3U no Supabase/gi, 'Lista salva'],
    [/Lista M3U original \(fallback HTTP\)/gi, 'Lista principal'],
    [/Lista M3U original \(Electron\)/gi, 'Lista principal'],
    [/Este cliente não possui URL M3U HTTP\/HTTPS para sincronizar/gi, 'Este cliente ainda não possui uma lista configurada para atualização'],
    [/Sincronizar catálogo IPTV de ([^•]+)/gi, 'Atualizar catálogo de $1'],
    [/Sincronizar catálogo IPTV/gi, 'Atualizar catálogo'],
    [/fornecedor respondeu HTTP \d+/gi, 'O serviço de conteúdo não respondeu agora. Tente novamente.'],
    [/A URL não contém credenciais Xtream reconhecíveis/gi, 'A lista deste cliente não pôde ser preparada automaticamente.'],
    [/Worker respondeu HTTP \d+/gi, 'O serviço de atualização não respondeu como esperado'],
    [/Provided readable stream must have a known length[^\n]*/gi, 'Não foi possível concluir a atualização do catálogo. Tente novamente.']
  ];

  function friendlyText(value) {
    let text = String(value ?? '');
    if (!text) return text;
    text = text.replace(/versão\s+\d+(?:\.\d+){1,3}/gi, `versão ${APP_VERSION}`);
    for (const [pattern, replacement] of replacements) text = text.replace(pattern, replacement);
    return text;
  }

  function updateTextNode(node) {
    if (!node || node.nodeType !== Node.TEXT_NODE) return;
    const current = node.nodeValue || '';
    const next = friendlyText(current);
    if (next !== current) node.nodeValue = next;
  }

  function updateElement(element) {
    if (!(element instanceof Element)) return;
    for (const attr of ['title', 'aria-label', 'placeholder']) {
      if (!element.hasAttribute(attr)) continue;
      const current = element.getAttribute(attr) || '';
      const next = friendlyText(current);
      if (next !== current) element.setAttribute(attr, next);
    }
    for (const child of element.childNodes) {
      if (child.nodeType === Node.TEXT_NODE) updateTextNode(child);
    }
    element.querySelectorAll('*').forEach(child => {
      for (const attr of ['title', 'aria-label', 'placeholder']) {
        if (!child.hasAttribute(attr)) continue;
        const current = child.getAttribute(attr) || '';
        const next = friendlyText(current);
        if (next !== current) child.setAttribute(attr, next);
      }
      for (const textNode of child.childNodes) {
        if (textNode.nodeType === Node.TEXT_NODE) updateTextNode(textNode);
      }
    });
  }

  function applyVersionEverywhere() {
    const auth = document.getElementById('authScreen');
    if (auth) {
      const badge = [...auth.querySelectorAll('div')].find(el => /^versão\s+[\d.]+$/i.test((el.textContent || '').trim()));
      if (badge) badge.textContent = `versão ${APP_VERSION}`;
    }
    updateElement(document.body);
  }

  const mobileMedia = () => window.matchMedia?.('(max-width: 767px), (orientation: landscape) and (max-width: 1280px) and (max-height: 600px) and (pointer: coarse)')?.matches;

  // ============================================================
  // [LUX-AUTH-007] SESSÃO REVOGÁVEL + "MANTER CONECTADO"
  // [LUX-ARCH-002] SENHA NÃO PERSISTE NO NAVEGADOR
  // ============================================================
  // A senha é usada somente no login manual. Depois que auth-login confirma a
  // conta, o servidor devolve um token opaco `luxsess_...` e guarda apenas o hash.
  //
  // Sem "Manter conectado":
  // - token fica em sessionStorage;
  // - localStorage recebe apenas um marcador sem valor de autenticação;
  // - fechar a aba encerra o login automático.
  //
  // Com "Manter conectado":
  // - somente o token revogável fica no localStorage (nunca a senha);
  // - ele expira no servidor em até 30 dias;
  // - logout revoga a sessão no servidor.
  //
  // Compatibilidade temporária: o código legado continua usando a chave
  // `lux_auth_pass`, mas ela passa a conter token/marcador, nunca senha persistida.
  // RLS de `usuarios` continua DESLIGADO nesta etapa, como combinado.
  // ============================================================
  const SESSION_PASS_KEY = 'lux_auth_session_pass';
  const SESSION_USER_KEY = 'lux_auth_session_user';
  const LOCAL_PASS_KEY = 'lux_auth_pass';
  const LOCAL_USER_KEY = 'lux_auth_user';
  const LOCAL_REMEMBER_KEY = 'lux_auth_remember';
  const SESSION_MARKER = '__LUX_SESSION_ONLY__';

  const nativeStorageSetItem = Storage.prototype.setItem;
  const nativeStorageRemoveItem = Storage.prototype.removeItem;

  let pendingSessionCredential = '';
  let pendingRemember = false;
  let revokeSuppressed = false;

  const isSessionCredential = value => /^luxsess_[A-Za-z0-9_-]{40,200}$/.test(String(value || ''));

  function rememberInput() {
    return document.getElementById('authRemember');
  }

  function renderRememberOption() {
    const passInput = document.getElementById('authPass');
    const loginBtn = document.getElementById('loginBtn');
    if (!passInput || !loginBtn || document.getElementById('authRememberRow')) return;

    const row = document.createElement('label');
    row.id = 'authRememberRow';
    row.className = 'flex items-center justify-between gap-3 text-xs text-purple-200/80 cursor-pointer select-none';

    const left = document.createElement('span');
    left.className = 'flex items-center gap-2';
    const checkbox = document.createElement('input');
    checkbox.id = 'authRemember';
    checkbox.type = 'checkbox';
    checkbox.className = 'w-4 h-4 accent-purple-600 cursor-pointer';
    const label = document.createElement('span');
    label.textContent = 'Manter conectado';
    left.append(checkbox, label);

    const hint = document.createElement('span');
    hint.className = 'text-[10px] text-purple-400/60';
    hint.textContent = 'neste dispositivo';
    row.append(left, hint);
    loginBtn.parentElement?.insertBefore(row, loginBtn);

    const stored = localStorage.getItem(LOCAL_PASS_KEY) || '';
    checkbox.checked = isSessionCredential(stored) && localStorage.getItem(LOCAL_REMEMBER_KEY) === '1';
  }

  function clearStoredCredential({ keepUser = true, revoke = false } = {}) {
    const localCredential = localStorage.getItem(LOCAL_PASS_KEY) || '';
    const sessionCredential = sessionStorage.getItem(SESSION_PASS_KEY) || '';
    const credential = isSessionCredential(localCredential) ? localCredential : sessionCredential;
    const username = localStorage.getItem(LOCAL_USER_KEY) || sessionStorage.getItem(SESSION_USER_KEY) || '';

    if (revoke && username && isSessionCredential(credential)) revokeSession(username, credential);

    revokeSuppressed = true;
    try {
      nativeStorageRemoveItem.call(localStorage, LOCAL_PASS_KEY);
      nativeStorageRemoveItem.call(localStorage, LOCAL_REMEMBER_KEY);
      nativeStorageRemoveItem.call(sessionStorage, SESSION_PASS_KEY);
      nativeStorageRemoveItem.call(sessionStorage, SESSION_USER_KEY);
      if (!keepUser) nativeStorageRemoveItem.call(localStorage, LOCAL_USER_KEY);
    } finally {
      revokeSuppressed = false;
    }
  }

  function storeSessionCredential(username, credential, remember) {
    if (!username || !isSessionCredential(credential)) return;
    nativeStorageSetItem.call(sessionStorage, SESSION_PASS_KEY, credential);
    nativeStorageSetItem.call(sessionStorage, SESSION_USER_KEY, username);

    if (remember) {
      nativeStorageSetItem.call(localStorage, LOCAL_PASS_KEY, credential);
      nativeStorageSetItem.call(localStorage, LOCAL_REMEMBER_KEY, '1');
    } else {
      nativeStorageSetItem.call(localStorage, LOCAL_PASS_KEY, SESSION_MARKER);
      nativeStorageRemoveItem.call(localStorage, LOCAL_REMEMBER_KEY);
    }
  }

  function revokeSession(username, credential) {
    try {
      if (typeof supabaseClient === 'undefined' || !supabaseClient?.functions?.invoke) return;
      supabaseClient.functions.invoke('auth-login', {
        body: { action: 'logout', username, credential },
      }).catch(error => console.warn('[LUX-AUTH-007] A sessão expirará no servidor.', error));
    } catch (_) {}
  }

  function migrateLegacyStoredPassword() {
    try {
      const stored = localStorage.getItem(LOCAL_PASS_KEY) || '';
      const username = localStorage.getItem(LOCAL_USER_KEY) || '';

      if (isSessionCredential(stored)) {
        nativeStorageSetItem.call(localStorage, LOCAL_REMEMBER_KEY, '1');
        return;
      }

      // Versões anteriores podem ter deixado senha real no localStorage. Ela é
      // retirada imediatamente e sobrevive só nesta aba para uma última migração.
      if (stored && stored !== SESSION_MARKER) {
        nativeStorageSetItem.call(sessionStorage, SESSION_PASS_KEY, stored);
        if (username) nativeStorageSetItem.call(sessionStorage, SESSION_USER_KEY, username);
        nativeStorageSetItem.call(localStorage, LOCAL_PASS_KEY, SESSION_MARKER);
        nativeStorageRemoveItem.call(localStorage, LOCAL_REMEMBER_KEY);
        return;
      }

      if (stored === SESSION_MARKER && !sessionStorage.getItem(SESSION_PASS_KEY)) {
        nativeStorageRemoveItem.call(localStorage, LOCAL_PASS_KEY);
      }
    } catch (error) {
      console.warn('[LUX-ARCH-002] Não foi possível migrar a credencial legada.', error);
    }
  }

  function installCredentialStorage() {
    if (window.__luxEphemeralPasswordStorageInstalled) return true;
    if (typeof Storage === 'undefined') return false;

    migrateLegacyStoredPassword();

    Storage.prototype.setItem = function (key, value) {
      if (this === localStorage && key === LOCAL_PASS_KEY) {
        const requested = String(value ?? '');
        const credential = isSessionCredential(pendingSessionCredential)
          ? pendingSessionCredential
          : (isSessionCredential(requested) ? requested : '');

        if (credential) {
          const username = localStorage.getItem(LOCAL_USER_KEY)
            || sessionStorage.getItem(SESSION_USER_KEY)
            || document.getElementById('authEmail')?.value
            || '';
          const remember = pendingSessionCredential
            ? pendingRemember
            : localStorage.getItem(LOCAL_REMEMBER_KEY) === '1';
          storeSessionCredential(String(username).trim(), credential, remember);
          return;
        }

        if (requested === SESSION_MARKER) {
          return nativeStorageSetItem.call(localStorage, LOCAL_PASS_KEY, SESSION_MARKER);
        }

        // Fallback de compatibilidade durante a migração: uma senha que apareça
        // fora do fluxo novo nunca volta a ser persistida; fica apenas nesta aba.
        if (requested) {
          nativeStorageSetItem.call(sessionStorage, SESSION_PASS_KEY, requested);
          const username = localStorage.getItem(LOCAL_USER_KEY) || '';
          if (username) nativeStorageSetItem.call(sessionStorage, SESSION_USER_KEY, username);
        }
        nativeStorageRemoveItem.call(localStorage, LOCAL_REMEMBER_KEY);
        return nativeStorageSetItem.call(localStorage, LOCAL_PASS_KEY, SESSION_MARKER);
      }
      return nativeStorageSetItem.call(this, key, value);
    };

    Storage.prototype.removeItem = function (key) {
      if (this === localStorage && key === LOCAL_PASS_KEY) {
        const localCredential = localStorage.getItem(LOCAL_PASS_KEY) || '';
        const sessionCredential = sessionStorage.getItem(SESSION_PASS_KEY) || '';
        const credential = isSessionCredential(localCredential) ? localCredential : sessionCredential;
        const username = localStorage.getItem(LOCAL_USER_KEY) || sessionStorage.getItem(SESSION_USER_KEY) || '';
        if (!revokeSuppressed && username && isSessionCredential(credential)) revokeSession(username, credential);
        nativeStorageRemoveItem.call(sessionStorage, SESSION_PASS_KEY);
        nativeStorageRemoveItem.call(sessionStorage, SESSION_USER_KEY);
        nativeStorageRemoveItem.call(localStorage, LOCAL_REMEMBER_KEY);
      }
      return nativeStorageRemoveItem.call(this, key);
    };

    window.__luxEphemeralPasswordStorageInstalled = '20260914-revocable-session1';
    return true;
  }

  function installSessionLoginBridge() {
    if (window.__luxSessionLoginBridgeInstalled) return true;
    if (typeof window.handleLogin !== 'function') return false;

    const originalHandleLogin = window.handleLogin;
    window.handleLogin = async function () {
      const passInput = document.getElementById('authPass');
      if (passInput?.value === SESSION_MARKER) {
        const sessionCredential = sessionStorage.getItem(SESSION_PASS_KEY) || '';
        if (sessionCredential) passInput.value = sessionCredential;
        else {
          clearStoredCredential({ keepUser: true, revoke: false });
          passInput.value = '';
        }
      }

      const result = await originalHandleLogin.apply(this, arguments);

      // O monólito usa account.pass como credencial para outras Edge Functions.
      // Após o login, substituímos a senha transitória pelo token revogável.
      if (pendingSessionCredential) {
        try {
          if (typeof currentUser !== 'undefined' && currentUser) currentUser.pass = pendingSessionCredential;
        } catch (_) {}
        if (passInput) passInput.value = pendingSessionCredential;
      }

      pendingSessionCredential = '';
      pendingRemember = false;
      return result;
    };

    window.__luxSessionLoginBridgeInstalled = '20260914-session-login2';
    return true;
  }

  // ============================================================
  // [LUX-AUTH-006] LOGIN SERVER-SIDE — ÚNICO CAMINHO NO DEVELOP
  // ============================================================
  const installBackendAuthBridge = () => {
    if (window.__luxBackendAuthInstalled) return true;
    if (typeof window.fetchUsersFromSupabase !== 'function') return false;
    if (typeof supabaseClient === 'undefined' || !supabaseClient?.functions?.invoke) return false;

    const getCredentials = () => {
      let activeUser = null;
      try { activeUser = typeof currentUser !== 'undefined' ? currentUser : null; } catch (_) {}
      if (activeUser?.user && activeUser?.pass) {
        return { username: String(activeUser.user).trim(), password: String(activeUser.pass) };
      }
      return {
        username: String(document.getElementById('authEmail')?.value || '').trim(),
        password: String(document.getElementById('authPass')?.value || ''),
      };
    };

    window.fetchUsersFromSupabase = async function () {
      const { username, password } = getCredentials();
      if (!username || !password) return [];

      const storedRemember = localStorage.getItem(LOCAL_REMEMBER_KEY) === '1';
      const remember = isSessionCredential(password)
        ? storedRemember
        : Boolean(rememberInput()?.checked);

      const { data, error } = await supabaseClient.functions.invoke('auth-login', {
        body: { action: 'login', username, password, remember },
      });

      if (error) {
        console.error('[LUX-AUTH-007] Falha ao chamar auth-login:', error);
        throw new Error('auth_backend_request_failed');
      }
      if (data?.error) {
        console.error('[LUX-AUTH-007] auth-login respondeu erro:', data.error);
        throw new Error(data.error);
      }

      if (data?.ok === false && data?.reason === 'invalid_credentials') {
        if (isSessionCredential(password)) clearStoredCredential({ keepUser: true, revoke: false });
        return [];
      }
      if (data?.ok === false && data?.reason === 'expired') {
        if (isSessionCredential(password)) clearStoredCredential({ keepUser: true, revoke: true });
        return [];
      }
      if (!data?.ok || !data?.account || !isSessionCredential(data?.sessionCredential)) {
        console.error('[LUX-AUTH-007] Resposta inesperada de auth-login:', data);
        throw new Error('auth_backend_invalid_response');
      }

      pendingSessionCredential = data.sessionCredential;
      pendingRemember = Boolean(data.persistent);
      storeSessionCredential(username, data.sessionCredential, pendingRemember);

      // O handleLogin legado ainda compara `account.pass` com o campo digitado.
      // Mantemos a credencial de entrada somente durante essa comparação; logo após
      // o wrapper acima troca currentUser.pass pelo token revogável.
      return [{ ...data.account, senha: password }];
    };

    window.fetchUsersFromSupabase.__luxBackendAuth = true;
    window.__luxBackendAuthInstalled = '20260914-auth-session1';
    window.LuxBackendAuth = {
      version: '20260914-auth-session1',
      mode: 'backend-only-revocable-session',
      clear: () => clearStoredCredential({ keepUser: true, revoke: true }),
    };

    console.info('[Lux Play] Login com sessão revogável instalado.');
    return true;
  };

  const loadRuntimeStabilityFix = () => {
    if (document.querySelector('script[data-lux-runtime-stability]')) return;
    const script = document.createElement('script');
    script.src = 'js/runtime-stability-fix.js?v=20260917-stability5-client-ready';
    script.async = true;
    script.dataset.luxRuntimeStability = '1';
    document.head.appendChild(script);
  };

  const loadStreamSessionGuard = () => {
    if (document.querySelector('script[data-lux-stream-session-guard]')) return;
    const script = document.createElement('script');
    script.src = 'js/stream-session-guard.js?v=20260913-stream-guard2';
    script.async = true;
    script.dataset.luxStreamSessionGuard = '1';
    document.head.appendChild(script);
  };

  const loadAccountUiPolish = () => {
    if (document.querySelector('script[data-lux-account-ui-polish]')) return;
    const script = document.createElement('script');
    script.src = 'js/account-ui-polish.js?v=20260913-account-ui2';
    script.async = true;
    script.dataset.luxAccountUiPolish = '1';
    document.head.appendChild(script);
  };

  const loadGameDuplicateConsoleFix = () => {
    if (document.querySelector('script[data-lux-game-duplicate-console]')) return;
    const script = document.createElement('script');
    script.src = 'js/game-duplicate-console-fix.js?v=20260912-console-duplicate1';
    script.async = true;
    script.dataset.luxGameDuplicateConsole = '1';
    document.head.appendChild(script);
  };

  const loadSports = () => {
    if (document.querySelector('script[data-lux-sports]')) return;
    const script = document.createElement('script');
    script.src = 'js/sports.js?v=20260913-guide-clean1';
    script.async = true;
    script.dataset.luxSports = '1';
    document.head.appendChild(script);
  };

  const loadSportsHomeGuard = () => {
    if (document.querySelector('script[data-lux-sports-home-guard]')) return;
    const script = document.createElement('script');
    script.src = 'js/sports-home-guard.js?v=20260913-guide-clean1';
    script.async = true;
    script.dataset.luxSportsHomeGuard = '1';
    document.head.appendChild(script);
  };

  const loadMobileControlOpacity = () => {
    if (!mobileMedia() || document.querySelector('script[data-lux-mobile-control-opacity]')) return;
    const script = document.createElement('script');
    script.src = 'js/mobile-control-opacity.js?v=20260912-opacity1';
    script.async = true;
    script.dataset.luxMobileControlOpacity = '1';
    document.head.appendChild(script);
  };

  const loadMobileCustomControls = () => {
    if (!mobileMedia() || document.querySelector('script[data-lux-mobile-custom-controls]')) return;
    const script = document.createElement('script');
    script.src = 'js/mobile-custom-controls.js?v=20260912-custom1';
    script.async = true;
    script.dataset.luxMobileCustomControls = '1';
    document.head.appendChild(script);
  };

  const originalAlert = window.alert?.bind(window);
  if (originalAlert) window.alert = message => originalAlert(friendlyText(message));

  const observer = new MutationObserver(mutations => {
    for (const mutation of mutations) {
      if (mutation.type === 'characterData') {
        updateTextNode(mutation.target);
        continue;
      }
      if (mutation.type === 'attributes') {
        updateElement(mutation.target);
        continue;
      }
      mutation.addedNodes.forEach(node => {
        if (node.nodeType === Node.TEXT_NODE) updateTextNode(node);
        else if (node.nodeType === Node.ELEMENT_NODE) updateElement(node);
      });
    }
  });

  const start = () => {
    installCredentialStorage();
    installSessionLoginBridge();
    installBackendAuthBridge();
    renderRememberOption();
    applyVersionEverywhere();

    const authUser = localStorage.getItem(LOCAL_USER_KEY) || '';
    const authEmail = document.getElementById('authEmail');
    if (authUser && authEmail && !authEmail.value) authEmail.value = authUser;

    loadRuntimeStabilityFix();
    loadStreamSessionGuard();
    loadAccountUiPolish();
    loadGameDuplicateConsoleFix();
    loadSports();
    loadSportsHomeGuard();
    loadMobileControlOpacity();
    loadMobileCustomControls();
    observer.observe(document.documentElement, {
      subtree: true,
      childList: true,
      characterData: true,
      attributes: true,
      attributeFilter: ['title', 'aria-label', 'placeholder']
    });
    window.__luxFriendlyUiVersion = FRIENDLY_UI_VERSION;
    window.__luxAppVersion = APP_VERSION;
  };

  installCredentialStorage();
  installSessionLoginBridge();
  installBackendAuthBridge();

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true });
  else start();
})();