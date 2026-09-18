(() => {
  'use strict';

  const VERSION = '20260918-provider-grouping-sync1';
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

  async function syncAccount(targetUsername) {
    const response = await fetch(`${WORKER_BASE}/sync-account`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        username: String(currentUser?.user || '').trim(),
        password: String(currentUser?.pass || ''),
        targetUsername
      })
    });

    const data = await response.json().catch(() => ({}));
    if (!response.ok || !data?.ok || data?.result?.status === 'error') {
      throw new Error(data?.error || data?.result?.message || `Worker respondeu HTTP ${response.status}`);
    }
    return data.result || {};
  }

  window.adminSyncProviderCatalogForAll = async function () {
    if (busy) return;
    if (!isAdmin()) {
      setStatus('Apenas o administrador pode atualizar o catálogo do fornecedor.', 'error');
      return;
    }

    const username = String(currentUser?.user || '').trim();
    const password = String(currentUser?.pass || '');
    if (!username || !password) {
      setStatus('Faça login novamente antes de atualizar o catálogo.', 'error');
      return;
    }

    const action = button();
    busy = true;
    if (action) {
      action.disabled = true;
      action.textContent = 'Preparando atualização...';
    }

    try {
      const { data, error } = await supabaseClient
        .from('usuarios')
        .select('usuario,lista_m3u')
        .order('usuario', { ascending: true });
      if (error) throw error;

      const users = (Array.isArray(data) ? data : []).filter(user =>
        user?.usuario && /^https?:\/\//i.test(String(user.lista_m3u || '').trim())
      );
      if (!users.length) throw new Error('Nenhuma conta com lista HTTP/HTTPS foi encontrada.');

      let success = 0;
      let partial = 0;
      const failures = [];

      for (let index = 0; index < users.length; index += 1) {
        const target = String(users[index].usuario || '').trim();
        if (action) action.textContent = `Atualizando ${index + 1}/${users.length}...`;
        setStatus(`Atualizando lista + agrupamento de ${target} (${index + 1}/${users.length})...`);

        try {
          const result = await syncAccount(target);
          if (result.status === 'partial') partial += 1;
          else success += 1;
        } catch (syncError) {
          failures.push({ user: target, message: syncError?.message || 'Falha desconhecida' });
          console.warn('[Lux Provider Sync] Falha em', target, syncError);
        }
      }

      // A conta que está aberta pode aplicar o snapshot novo sem exigir logout.
      if (typeof window.LuxSyncedCatalog?.reload === 'function') {
        try { await window.LuxSyncedCatalog.reload(); }
        catch (reloadError) { console.warn('[Lux Provider Sync] Catálogo sincronizado, mas a recarga local falhou:', reloadError); }
      }

      if (failures.length) {
        const first = failures[0];
        setStatus(
          `Atualização concluída: ${success} ok, ${partial} parcial, ${failures.length} com erro. Primeiro erro: ${first.user} — ${first.message}`,
          success || partial ? 'warn' : 'error'
        );
      } else {
        setStatus(`Catálogo atualizado para todos: ${success} ok${partial ? `, ${partial} parcial` : ''}.`, partial ? 'warn' : 'ok');
      }
    } catch (error) {
      console.warn('[Lux Provider Sync] Falha na atualização global:', error);
      setStatus(error?.message || 'Não foi possível atualizar o catálogo do fornecedor.', 'error');
    } finally {
      busy = false;
      if (action) {
        action.disabled = false;
        action.textContent = 'Atualizar catálogo para todos';
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
    action.textContent = 'Atualizar catálogo para todos';
    action.title = 'Força o Worker a atualizar a lista, categorias e catálogo IPTV de todas as contas';
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
