(() => {
  'use strict';

  // ============================================================
  // [LUX-AUTH-DATE-001] + [LUX-IPTV-STREAM-002] + [LUX-ADMIN-013]
  // ACABAMENTO DE CONTA / PAINEL
  // ============================================================
  // Este módulo faz três tarefas visuais/administrativas sem alterar o catálogo:
  // 1. Exibe vencimento como DD/MM/AAAA no cabeçalho do usuário.
  // 2. No painel Admin, mostra "Streams: ativos/limite" ao lado de cada cliente.
  // 3. Carrega o dashboard "Funcionalidades" e seu importador/exportador CSV.
  //
  // IMPORTANTE:
  // - O valor salvo no banco continua em ISO (AAAA-MM-DD), que é o formato correto
  //   para banco e comparações. Só a APRESENTAÇÃO é convertida para pt-BR.
  // - A quantidade ativa vem da Edge Function stream-sessions e representa apenas
  //   reproduções IPTV com heartbeat recente, não usuários logados.
  // - O dashboard funcional vive em arquivos próprios para que esta camada permaneça
  //   pequena e possa ser removida/testada sem tocar no núcleo de script.js.
  // ============================================================

  if (window.__luxAccountUiPolishInstalled) return;
  window.__luxAccountUiPolishInstalled = '20260914-account-ui4';

  const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
  let streamStatusRequest = 0;
  let adminRefreshTimer = null;
  let adminObserver = null;
  let badgeObserver = null;

  const getClient = () => {
    try {
      return typeof supabaseClient !== 'undefined' ? supabaseClient : null;
    } catch (_) {
      return null;
    }
  };

  const getUser = () => {
    try {
      return typeof currentUser !== 'undefined' ? currentUser : null;
    } catch (_) {
      return null;
    }
  };

  function formatDatePtBr(value) {
    const raw = String(value || '').trim();
    const match = raw.match(DATE_RE);
    if (!match) return raw;
    return `${match[3]}/${match[2]}/${match[1]}`;
  }

  // Formata somente o badge visual. Não muda currentUser.dueDate nem o banco.
  function formatExpiryBadge() {
    const badge = document.getElementById('userExpiryBadge');
    if (!badge) return;
    const current = String(badge.textContent || '').trim();
    const match = current.match(/^Val:\s*(\d{4}-\d{2}-\d{2})$/i);
    if (!match) return;
    const formatted = `Val: ${formatDatePtBr(match[1])}`;
    if (formatted !== current) badge.textContent = formatted;
  }

  function observeExpiryBadge() {
    const badge = document.getElementById('userExpiryBadge');
    if (!badge || badge.dataset.luxDateObserver === '1') return;
    badge.dataset.luxDateObserver = '1';
    formatExpiryBadge();
    badgeObserver = new MutationObserver(formatExpiryBadge);
    badgeObserver.observe(badge, { childList: true, characterData: true, subtree: true });
  }

  function cleanUsernameFromRow(row) {
    const mono = row?.querySelector?.('.font-mono');
    const text = String(mono?.textContent || '').trim();
    return text.replace(/^\(/, '').replace(/\)$/, '').trim();
  }

  function renderStreamStatus(statuses = {}) {
    const container = document.getElementById('adminUsersListContainer');
    if (!container) return;

    [...container.children].forEach(row => {
      const username = cleanUsernameFromRow(row);
      if (!username) return;
      const info = statuses[username];
      if (!info) return;

      let badge = row.querySelector('[data-lux-stream-status]');
      if (!badge) {
        badge = document.createElement('span');
        badge.dataset.luxStreamStatus = '1';
        badge.className = 'ml-1 inline-flex items-center rounded-full border border-purple-800/60 bg-purple-950/50 px-1.5 py-0.5 text-[9px] font-bold text-purple-200';
        const detail = row.querySelector('p.text-slate-400') || row.querySelectorAll('p')[1] || row;
        detail.appendChild(document.createTextNode(' '));
        detail.appendChild(badge);
      }

      if (!info.managed) {
        badge.textContent = 'Streams: sem IPTV';
        badge.title = 'Esta conta não possui fonte IPTV gerenciada.';
        return;
      }

      const active = Math.max(0, Number(info.active) || 0);
      const limit = Math.max(1, Number(info.limit) || 3);
      badge.textContent = `Streams: ${active}/${limit}`;
      badge.title = active >= limit
        ? 'Fonte no limite de reproduções simultâneas.'
        : 'Reproduções IPTV ativas / limite configurado para a fonte.';
      badge.className = `ml-1 inline-flex items-center rounded-full border px-1.5 py-0.5 text-[9px] font-bold ${
        active >= limit
          ? 'border-rose-700/70 bg-rose-950/50 text-rose-200'
          : active > 0
            ? 'border-amber-700/70 bg-amber-950/40 text-amber-200'
            : 'border-emerald-800/60 bg-emerald-950/30 text-emerald-200'
      }`;
    });
  }

  async function refreshAdminStreamStatus() {
    const user = getUser();
    const client = getClient();
    const container = document.getElementById('adminUsersListContainer');
    if (!container || !client || user?.role !== 'admin' || !user?.user || !user?.pass) return;

    const request = ++streamStatusRequest;
    try {
      const { data, error } = await client.functions.invoke('stream-sessions', {
        body: { action: 'statusAll', username: user.user, password: user.pass }
      });
      if (request !== streamStatusRequest) return;
      if (error || data?.error) throw error || new Error(data.error);
      renderStreamStatus(data?.users || {});
    } catch (error) {
      if (request !== streamStatusRequest) return;
      console.warn('[Lux Play] Não foi possível atualizar o contador de streams do Admin.', error);
    }
  }

  function installAdminObserver() {
    const container = document.getElementById('adminUsersListContainer');
    if (!container || container.dataset.luxStreamObserver === '1') return;
    container.dataset.luxStreamObserver = '1';

    let debounce = null;
    adminObserver = new MutationObserver(() => {
      clearTimeout(debounce);
      debounce = setTimeout(refreshAdminStreamStatus, 120);
    });

    // Observamos somente mudanças nos filhos DIRETOS do container. Assim a criação/
    // atualização do nosso próprio badge não dispara uma nova chamada à API em loop.
    adminObserver.observe(container, { childList: true, subtree: false });

    // Atualiza periodicamente somente quando o painel de clientes está visível.
    adminRefreshTimer = setInterval(() => {
      if (container.offsetParent !== null) refreshAdminStreamStatus();
    }, 30_000);
  }

  function loadScriptOnce(selector, src, datasetName) {
    if (document.querySelector(selector)) return;
    const script = document.createElement('script');
    script.src = src;
    script.async = true;
    script.dataset[datasetName] = '1';
    document.head.appendChild(script);
  }

  // [LUX-ADMIN-013] Dashboard + import/export ficam isolados do monólito principal.
  function loadAdminFunctionalities() {
    loadScriptOnce(
      'script[data-lux-admin-functionalities]',
      'js/admin-functionalities.js?v=20260914-functionalities1',
      'luxAdminFunctionalities'
    );
    loadScriptOnce(
      'script[data-lux-admin-functionalities-import]',
      'js/admin-functionalities-import.js?v=20260914-functional-import1',
      'luxAdminFunctionalitiesImport'
    );
  }

  function install() {
    observeExpiryBadge();
    installAdminObserver();
    formatExpiryBadge();
    refreshAdminStreamStatus();
    loadAdminFunctionalities();
  }

  // O HTML já contém esses elementos, mas o polling curto também cobre carregamento
  // tardio em versões empacotadas/caches antigos sem acoplar este módulo ao bootstrap.
  let attempts = 0;
  const timer = setInterval(() => {
    attempts += 1;
    install();
    if ((document.getElementById('userExpiryBadge') && document.getElementById('adminUsersListContainer')) || attempts >= 120) {
      clearInterval(timer);
    }
  }, 100);

  install();
  window.LuxAccountUiPolish = { formatDatePtBr, refreshAdminStreamStatus };
})();