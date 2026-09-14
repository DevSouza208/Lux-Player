(() => {
  'use strict';

  // ============================================================
  // [LUX-AUTH-005] BRIDGE DE LOGIN BACKEND
  // ============================================================
  // Este arquivo substitui somente a função que antes fazia:
  //   SELECT * FROM usuarios
  //
  // O restante do fluxo de login continua no script.js. Isso reduz o risco de
  // regressão porque handleLogin(), perfis, validade e carregamento do catálogo
  // permanecem exatamente como estavam.
  //
  // Fluxo novo:
  // 1. handleLogin() chama fetchUsersFromSupabase();
  // 2. este bridge envia APENAS usuário/senha para `auth-login`;
  // 3. a Edge Function consulta uma única conta no servidor;
  // 4. recebe somente os dados daquela conta, sem senha do banco;
  // 5. devolvemos uma lista de 1 item para manter compatibilidade temporária com
  //    parseSupabaseUsers() e com o restante do código legado.
  //
  // PROTEGIDO:
  // Não habilitar RLS em `usuarios` apenas por causa deste arquivo. O painel Admin
  // ainda possui operações diretas nessa tabela e será migrado em etapa própria.
  // ============================================================

  if (window.__luxBackendAuthInstalled) return;
  window.__luxBackendAuthInstalled = '20260914-auth-backend1';

  let attempts = 0;

  const getClient = () => {
    try {
      return typeof supabaseClient !== 'undefined' ? supabaseClient : null;
    } catch (_) {
      return null;
    }
  };

  const getCurrentUser = () => {
    try {
      return typeof currentUser !== 'undefined' ? currentUser : null;
    } catch (_) {
      return null;
    }
  };

  // O mesmo método atende dois cenários:
  // - login inicial: lê os campos da tela de autenticação;
  // - "Recarregar Dados": usa a credencial já mantida pelo fluxo legado atual.
  const getCredentials = () => {
    const activeUser = getCurrentUser();
    if (activeUser?.user && activeUser?.pass) {
      return {
        username: String(activeUser.user).trim(),
        password: String(activeUser.pass),
      };
    }

    return {
      username: String(document.getElementById('authEmail')?.value || '').trim(),
      password: String(document.getElementById('authPass')?.value || ''),
    };
  };

  const fetchSingleAccountFromBackend = async () => {
    const client = getClient();
    const { username, password } = getCredentials();

    if (!client) throw new Error('Cliente Supabase ainda não está disponível.');
    if (!username || !password) return [];

    const { data, error } = await client.functions.invoke('auth-login', {
      body: { username, password },
    });

    // Erro de rede/backend continua sendo erro real. O handleLogin original já
    // possui tratamento visual para indisponibilidade.
    if (error) throw error;
    if (data?.error) throw new Error(data.error);

    // Credencial inválida vira [] para que o handleLogin ORIGINAL continue
    // exibindo "Usuário ou senha incorretos" sem precisarmos duplicar a UI aqui.
    if (data?.ok === false && data?.reason === 'invalid_credentials') return [];
    if (!data?.ok || !data?.account) return [];

    // Compatibilidade temporária:
    // parseSupabaseUsers() ainda espera a coluna `senha`. Não estamos recebendo a
    // senha armazenada do servidor; usamos a senha que o próprio usuário acabou de
    // digitar (ou que o fluxo legado já mantinha localmente).
    return [{ ...data.account, senha: password }];
  };

  const install = () => {
    const client = getClient();
    if (!client || typeof window.fetchUsersFromSupabase !== 'function') return false;
    if (window.fetchUsersFromSupabase.__luxBackendAuth) return true;

    const originalFetchUsers = window.fetchUsersFromSupabase;

    const backendFetchUsers = async function () {
      return fetchSingleAccountFromBackend();
    };

    backendFetchUsers.__luxBackendAuth = true;
    backendFetchUsers.__luxLegacyFetchUsers = originalFetchUsers;

    // Em scripts clássicos do navegador, a função global e window.<nome> apontam
    // para o mesmo binding. Assim handleLogin() e reloadUserData() passam a usar
    // esta implementação sem reescrever o monólito script.js.
    window.fetchUsersFromSupabase = backendFetchUsers;

    window.LuxBackendAuth = {
      version: '20260914-auth-backend1',
      loginRequest: fetchSingleAccountFromBackend,
      legacyFetchUsers: originalFetchUsers,
    };

    console.info('[Lux Play] Login backend instalado.');
    return true;
  };

  if (install()) return;

  const timer = setInterval(() => {
    attempts += 1;
    if (install() || attempts >= 240) clearInterval(timer);
  }, 25);
})();
