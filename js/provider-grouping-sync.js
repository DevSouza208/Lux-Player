(() => {
  'use strict';

  const VERSION = '20260918-provider-grouping-sync2-admin-global';
  const WORKER_BASE = 'https://lux-playlist-sync.professorsouza-tech.workers.dev';

  if (window.__luxProviderGroupingSync === VERSION) return;
  window.__luxProviderGroupingSync = VERSION;

  let busy = false;

  const isAdmin = () => String(currentUser?.accountRole || currentUser?.role || '').trim().toLowerCase() === 'admin';
  const button = () => document.getElementById('adminCategorySyncButton');
  const status = () => document.getElementById('adminCategorySyncStatus');

  function setStatus(message, kind = 'normal') {
    const node = status();
    if (!node) return;
    node.textContent = message;
    node.className = 'min-h-[18px] text-[11px] ' + (
      kind === 'ok' ? 'text-emerald-300' :
      kind === 'error' ? 'text-rose-300' :
      kind === 'warn' ? 'text-amber-300' :
      'text-purple-300'
    );
  }

  async function syncAdminAccount() {
    const response = await fetch(`${WORKER_BASE}/sync-account`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        username: String(currentUser?.user || '').trim(),
        password: String(currentUser?.pass || ''),
        targetUsername: String(currentUser?.user || '').trim()
      })
    });

    const data = await response.json().catch(() => ({}));
    if (!response.ok || !data?.ok || data?.result?.status === 'error') {
      throw new Error(data?.error || data?.result?.message || `Worker respondeu HTTP ${response.status}`);
    }
    return data.result || {};
  }

  async function publishAdminGrouping() {
    const sender = typeof window.adminSendCategoriesToUsers === 'function'
      ? window.adminSendCategoriesToUsers
      : (typeof adminSendCategoriesToUsers === 'function' ? adminSendCategoriesToUsers : null);

    if (!sender) throw new Error('O publicador de categorias do admin ainda não está disponível.');
    await sender();
  }

  window.adminSyncProviderCatalogForAll = async function () {
    if (busy) return;
    if (!isAdmin()) {
      setStatus('Apenas o administrador pode atualizar o agrupamento oficial.', 'error');
      return;
    }

    const username = String(currentUser?.user || '').trim();
    const password = String(currentUser?.pass || '');
    if (!username || !password) {
      setStatus('Faça login novamente antes de atualizar o agrupamento.', 'error');
      return;
    }

    const action = button();
    busy = true;
    if (action) {
      action.disabled = true;
      action.textContent = 'Atualizando catálogo do admin...';
    }

    try {
      setStatus('Baixando o catálogo oficial do fornecedor para o admin...');
      const result = await syncAdminAccount();

      if (action) action.textContent = 'Aplicando agrupamento...';
      setStatus('Catálogo do admin atualizado. Aplicando o agrupamento oficial...');

      if (typeof window.LuxSyncedCatalog?.reload === 'function') {
        await window.LuxSyncedCatalog.reload();
      } else if (typeof window.loadMediaSourcesInPriority === 'function') {
        const loaded = await window.loadMediaSourcesInPriority();
        if (!loaded) throw new Error('O catálogo do admin foi atualizado, mas não pôde ser recarregado.');
      }

      if (!Array.isArray(allMediaItems) || !allMediaItems.length) {
        throw new Error('O catálogo do admin foi sincronizado, mas não há itens carregados para gerar o agrupamento.');
      }

      if (action) action.textContent = 'Publicando para todos...';
      setStatus('Publicando o agrupamento do admin para todas as contas...');
      await publishAdminGrouping();

      const partial = result?.status === 'partial';
      setStatus(
        partial
          ? 'Agrupamento do admin publicado para todos. A sincronização do catálogo terminou parcialmente.'
          : 'Agrupamento do admin publicado para todos. Os usuários receberão esse mapa no próximo carregamento.',
        partial ? 'warn' : 'ok'
      );
    } catch (error) {
      console.warn('[Lux Provider Sync] Falha ao publicar agrupamento global do admin:', error);
      setStatus(error?.message || 'Não foi possível publicar o agrupamento do admin.', 'error');
    } finally {
      busy = false;
      if (action) {
        action.disabled = false;
        action.textContent = 'Publicar meu agrupamento para todos';
      }
    }
  };

  function install() {
    const action = button();
    if (!action) return false;

    action.removeAttribute('onclick');
    action.onclick = event => {
      event?.preventDefault?.();
      window.adminSyncProviderCatalogForAll?.();
    };
    action.textContent = 'Publicar meu agrupamento para todos';
    action.title = 'Atualiza o catálogo do admin e publica o mesmo mapa de categorias para todas as contas';
    return true;
  }

  if (!install()) {
    let attempts = 0;
    const timer = setInterval(() => {
      attempts += 1;
      if (install() || attempts >= 160) clearInterval(timer);
    }, 50);
  }
})();
