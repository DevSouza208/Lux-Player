(() => {
  const WORKER_BASE = 'https://lux-playlist-sync.professorsouza-tech.workers.dev';
  const BUTTON_VERSION = '20260912-admin-client-sync-1';

  const formatSyncTime = value => {
    if (!value) return '';
    try {
      const date = new Date(value);
      if (Number.isNaN(date.getTime())) return '';
      return date.toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' });
    } catch (_) {
      return '';
    }
  };

  const buttonClassesForStatus = status => {
    const base = 'p-2 rounded-lg transition-all border';
    if (status === 'success') return `${base} bg-emerald-950/60 hover:bg-emerald-900 text-emerald-300 border-emerald-800/50`;
    if (status === 'partial') return `${base} bg-amber-950/60 hover:bg-amber-900 text-amber-300 border-amber-800/50`;
    if (status === 'error') return `${base} bg-rose-950/60 hover:bg-rose-900 text-rose-300 border-rose-800/50`;
    return `${base} bg-sky-950/50 hover:bg-sky-900/70 text-sky-300 border-sky-800/40`;
  };

  async function syncClientCatalog(targetUsername, button) {
    if (currentUser?.role !== 'admin') return;
    if (!targetUsername || !button || button.disabled) return;

    const originalHtml = button.innerHTML;
    const originalTitle = button.title;
    const originalClass = button.className;

    button.disabled = true;
    button.className = 'p-2 rounded-lg border border-sky-500/50 bg-sky-500/10 text-sky-200 opacity-80 cursor-wait';
    button.title = `Sincronizando ${targetUsername}...`;
    button.innerHTML = '<i data-lucide="refresh-cw" class="w-4 h-4 animate-spin"></i>';
    lucide.createIcons();

    try {
      const response = await fetch(`${WORKER_BASE}/sync-account`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          username: currentUser.user,
          password: currentUser.pass,
          targetUsername
        })
      });

      let payload = null;
      try { payload = await response.json(); } catch (_) {}
      if (!response.ok || payload?.result?.status === 'error' || payload?.error) {
        throw new Error(payload?.error || payload?.result?.message || `Worker respondeu HTTP ${response.status}`);
      }

      const status = payload?.result?.status || 'success';
      button.className = buttonClassesForStatus(status);
      button.innerHTML = status === 'partial'
        ? '<i data-lucide="triangle-alert" class="w-4 h-4"></i>'
        : '<i data-lucide="check" class="w-4 h-4"></i>';
      button.title = status === 'partial'
        ? `Sincronização parcial de ${targetUsername}`
        : `${targetUsername} sincronizado com sucesso`;
      lucide.createIcons();

      setTimeout(() => {
        if (typeof window.loadAdminUsersList === 'function') window.loadAdminUsersList();
      }, 900);
    } catch (error) {
      button.className = buttonClassesForStatus('error');
      button.innerHTML = '<i data-lucide="circle-x" class="w-4 h-4"></i>';
      button.title = error?.message || 'Falha na sincronização';
      lucide.createIcons();
      alert(`Não foi possível sincronizar ${targetUsername}: ${error?.message || 'erro desconhecido'}`);
      setTimeout(() => {
        button.disabled = false;
        button.className = originalClass;
        button.innerHTML = originalHtml;
        button.title = originalTitle;
        lucide.createIcons();
      }, 1800);
    }
  }

  async function decorateClientRows() {
    const container = document.getElementById('adminUsersListContainer');
    if (!container || currentUser?.role !== 'admin') return;

    const { data, error } = await supabaseClient
      .from('usuarios')
      .select('usuario,lista_m3u,lista_m3u_sync_at,lista_m3u_sync_status,lista_m3u_sync_error')
      .order('nome', { ascending: true });

    if (error || !Array.isArray(data)) return;

    const rows = [...container.children].filter(row => row.querySelector?.('[data-edit-user]'));
    data.forEach(user => {
      const username = String(user.usuario || '');
      const row = rows.find(candidate => (candidate.textContent || '').includes(`(${username})`));
      if (!row || row.querySelector('[data-sync-user]')) return;

      const editButton = row.querySelector('[data-edit-user]');
      if (!editButton) return;

      const button = document.createElement('button');
      button.type = 'button';
      button.dataset.syncUser = username;
      button.className = buttonClassesForStatus(String(user.lista_m3u_sync_status || '').toLowerCase());
      const hasRemoteUrl = /^https?:\/\//i.test(String(user.lista_m3u || '').trim());
      button.disabled = !hasRemoteUrl;
      if (!hasRemoteUrl) button.className += ' opacity-30 cursor-not-allowed';

      const lastSync = formatSyncTime(user.lista_m3u_sync_at);
      const status = String(user.lista_m3u_sync_status || '').trim();
      const statusText = status ? ` • Status: ${status}` : '';
      const timeText = lastSync ? ` • Última: ${lastSync}` : '';
      const errorText = user.lista_m3u_sync_error ? ` • ${user.lista_m3u_sync_error}` : '';
      button.title = hasRemoteUrl
        ? `Sincronizar catálogo IPTV de ${username}${statusText}${timeText}${errorText}`
        : 'Este cliente não possui URL M3U HTTP/HTTPS para sincronizar';
      button.setAttribute('aria-label', `Sincronizar catálogo IPTV de ${username}`);
      button.innerHTML = '<i data-lucide="refresh-cw" class="w-4 h-4"></i>';
      button.onclick = event => {
        event.preventDefault();
        event.stopPropagation();
        syncClientCatalog(username, button);
      };

      editButton.parentElement.insertBefore(button, editButton);
    });

    lucide.createIcons();
  }

  const install = () => {
    if (window.__luxAdminClientSyncInstalled === BUTTON_VERSION) return true;
    if (typeof window.loadAdminUsersList !== 'function') return false;

    const original = window.loadAdminUsersList;
    if (original.__luxAdminClientSyncWrapped) {
      window.__luxAdminClientSyncInstalled = BUTTON_VERSION;
      return true;
    }

    const wrapped = async function () {
      const result = await original.apply(this, arguments);
      try { await decorateClientRows(); } catch (error) { console.warn('[Lux Play] Falha ao decorar sincronização de clientes:', error); }
      return result;
    };
    wrapped.__luxAdminClientSyncWrapped = true;
    window.loadAdminUsersList = wrapped;
    window.syncClientCatalog = syncClientCatalog;
    window.__luxAdminClientSyncInstalled = BUTTON_VERSION;
    return true;
  };

  if (!install()) {
    let attempts = 0;
    const timer = setInterval(() => {
      attempts += 1;
      if (install() || attempts >= 160) clearInterval(timer);
    }, 50);
  }
})();

// [LUX-ADMIN-015] Carrega o módulo de fontes secundárias sem alterar o script principal.
(() => {
  if (document.querySelector('script[data-lux-secondary-content-sources]')) return;
  const script = document.createElement('script');
  script.src = 'js/secondary-content-sources.js?v=20260914-secondary-sources-1';
  script.async = true;
  script.setAttribute('data-lux-secondary-content-sources', '1');
  document.head.appendChild(script);
})();

// [LUX-IPTV-036] Organiza automaticamente as fontes secundárias por idioma.
(() => {
  if (document.querySelector('script[data-lux-secondary-locale-filter]')) return;
  const script = document.createElement('script');
  script.src = 'js/secondary-locale-filter.js?v=20260914-secondary-locale1';
  script.async = true;
  script.setAttribute('data-lux-secondary-locale-filter', '1');
  document.head.appendChild(script);
})();

// [LUX-IPTV-037] Segura conteúdo sem idioma confiável até aprovação do admin.
(() => {
  if (document.querySelector('script[data-lux-secondary-locale-approval]')) return;
  const script = document.createElement('script');
  script.src = 'js/secondary-locale-approval.js?v=20260914-secondary-locale-approval1';
  script.async = true;
  script.setAttribute('data-lux-secondary-locale-approval', '1');
  document.head.appendChild(script);
})();

// [LUX-IPTV-038] Providers ficam entre a lista principal e as M3Us secundárias.
(() => {
  const loadProviderLayer = () => {
    if (window.LuxProviderSources || document.querySelector('script[data-lux-provider-content-sources]')) return;
    const script = document.createElement('script');
    script.src = 'js/provider-content-sources.js?v=20260914-provider-layer-1';
    script.async = true;
    script.setAttribute('data-lux-provider-content-sources', '1');
    document.head.appendChild(script);
  };

  const secondaryScript = document.querySelector('script[data-lux-secondary-content-sources]');
  if (window.LuxSecondarySources) {
    loadProviderLayer();
  } else if (secondaryScript) {
    secondaryScript.addEventListener('load', loadProviderLayer, { once: true });
    setTimeout(loadProviderLayer, 3000);
  } else {
    setTimeout(loadProviderLayer, 800);
  }
})();

// [LUX-IPTV-039] Não segura o splash/login enquanto M3Us externas são baixadas.
(() => {
  const loadNonBlockingLayer = () => {
    if (document.querySelector('script[data-lux-secondary-background-loader]')) return;
    const script = document.createElement('script');
    script.src = 'js/secondary-background-loader.js?v=20260914-secondary-background-2';
    script.async = true;
    script.setAttribute('data-lux-secondary-background-loader', '1');
    document.head.appendChild(script);
  };

  const providerScript = document.querySelector('script[data-lux-provider-content-sources]');
  if (window.LuxProviderSources) {
    loadNonBlockingLayer();
  } else if (providerScript) {
    providerScript.addEventListener('load', loadNonBlockingLayer, { once: true });
    setTimeout(loadNonBlockingLayer, 3500);
  } else {
    setTimeout(loadNonBlockingLayer, 1200);
  }
})();

// [LUX-IPTV-040] Busca real de catálogo em providers PT-BR suportados.
(() => {
  const loadProviderSearch = () => {
    if (window.LuxProviderSearch || document.querySelector('script[data-lux-provider-search-ui]')) return;
    const script = document.createElement('script');
    script.src = 'js/provider-search-ui.js?v=20260914-provider-search-1';
    script.async = true;
    script.setAttribute('data-lux-provider-search-ui', '1');
    document.head.appendChild(script);
  };

  const providerScript = document.querySelector('script[data-lux-provider-content-sources]');
  if (window.LuxProviderSources) {
    loadProviderSearch();
  } else if (providerScript) {
    providerScript.addEventListener('load', loadProviderSearch, { once: true });
    setTimeout(loadProviderSearch, 3500);
  } else {
    setTimeout(loadProviderSearch, 1200);
  }
})();
