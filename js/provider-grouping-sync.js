(() => {
  'use strict';

  const VERSION = '20260918-provider-grouping-sync4-http-mirror';
  const WORKER_BASE = 'https://lux-playlist-sync.professorsouza-tech.workers.dev';
  const DEV_CATEGORY = 'IPTV-GLOBAL';

  if (window.__luxProviderGroupingSync === VERSION) return;
  window.__luxProviderGroupingSync = VERSION;

  let busy = false;

  const isAdmin = () => String(currentUser?.accountRole || currentUser?.role || '').trim().toLowerCase() === 'admin';
  const button = () => document.getElementById('adminCategorySyncButton');
  const status = () => document.getElementById('adminCategorySyncStatus');

  function devRunning(label, message, data = null) {
    window.LuxDevkit?.running?.(DEV_CATEGORY, label, message, data);
    return performance.now();
  }

  function devSuccess(label, message, startedAt, data = null) {
    window.LuxDevkit?.success?.(
      DEV_CATEGORY,
      label,
      message,
      Math.round(performance.now() - startedAt),
      data
    );
  }

  function devError(label, error, startedAt = null, data = null) {
    window.LuxDevkit?.emit?.({
      category: DEV_CATEGORY,
      status: 'error',
      label,
      message: error?.message || String(error || 'Falha desconhecida'),
      durationMs: startedAt == null ? undefined : Math.round(performance.now() - startedAt),
      data
    });
  }

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

  function sourceCandidatesFromCore(user = currentUser) {
    if (!user || typeof window.getMediaSourceCandidates !== 'function') return [];
    try {
      return window.getMediaSourceCandidates(user) || [];
    } catch (_) {
      return [];
    }
  }

  function canonicalSourceCandidates(user = currentUser) {
    const candidates = sourceCandidatesFromCore(user);
    const originalUrl = String(user?.m3uUrl || '').trim();
    const httpsUrl = String(user?.m3uHttpsUrl || '').trim();
    const isElectron = Boolean(window.luxElectron);

    const httpsMirror = candidates.filter(source =>
      source?.kind === 'm3u-url' && httpsUrl && String(source.value || '') === httpsUrl
    );
    const original = candidates.filter(source =>
      source?.kind === 'm3u-url' && originalUrl && String(source.value || '') === originalUrl
    );
    const localStorageSources = candidates.filter(source => source?.kind === 'm3u-storage');
    const xtream = candidates.filter(source => source?.kind === 'xtream');
    const remaining = candidates.filter(source =>
      !httpsMirror.includes(source) &&
      !original.includes(source) &&
      !localStorageSources.includes(source) &&
      !xtream.includes(source)
    );

    // Regra oficial:
    // navegador/PWA consome a cópia HTTPS integral da lista HTTP;
    // Electron pode consumir o HTTP original diretamente.
    if (isElectron) {
      return [...original, ...httpsMirror, ...localStorageSources, ...xtream, ...remaining];
    }
    return [...httpsMirror, ...localStorageSources, ...xtream, ...original, ...remaining];
  }

  async function loadCanonicalMediaSources() {
    const candidates = canonicalSourceCandidates();
    const failures = [];

    window.__luxSyncedXtreamActive = false;
    window.LuxDevkit?.info?.('IPTV', 'ordem-fontes', 'M3U espelhada é a fonte canônica', {
      candidates: candidates.map(source => ({ kind: source.kind, label: source.label }))
    });

    if (!candidates.length) {
      if (typeof window.clearMediaSourceState === 'function') window.clearMediaSourceState();
      return false;
    }

    for (const source of candidates) {
      const started = performance.now();
      try {
        window.LuxDevkit?.running?.('IPTV', `fonte-${source.kind}`, source.label || source.kind);

        let result;
        if (source.kind === 'xtream') {
          result = await window.loadFromXtreamApi(source.server, source.user, source.pass);
        } else {
          result = await window.loadPlaylist(source.value);
        }

        const count = Number(result?.count ?? allMediaItems.length);
        if (!count) throw new Error('A fonte não retornou nenhum item utilizável.');

        if (typeof window.setMediaSourceState === 'function') {
          window.setMediaSourceState(source.kind, source.label || source.kind, count);
        }

        window.__luxSyncedXtreamActive = false;
        window.LuxDevkit?.success?.(
          'IPTV',
          `fonte-${source.kind}`,
          source.kind === 'm3u-url' ? 'M3U integral carregada' : 'Fonte fallback carregada',
          Math.round(performance.now() - started),
          { count, groupedCount: result?.groupedCount ?? null }
        );
        return true;
      } catch (error) {
        failures.push(`${source.label || source.kind}: ${error?.message || 'falha desconhecida'}`);
        window.LuxDevkit?.warn?.('IPTV', `fonte-${source.kind}`, error?.message || 'Fonte indisponível');
        console.warn('[Lux Play] Fonte indisponível:', source.label || source.kind, error);
      }
    }

    if (typeof window.clearMediaSourceState === 'function') window.clearMediaSourceState();
    console.warn('[Lux Play] Nenhuma fonte principal carregada.', failures);
    return false;
  }

  function installCanonicalSourcePriority() {
    if (typeof window.getMediaSourceCandidates !== 'function') return false;
    if (typeof window.loadPlaylist !== 'function' || typeof window.loadFromXtreamApi !== 'function') return false;

    if (window.loadMediaSourcesInPriority?.__luxHttpMirrorPriority === VERSION) return true;

    const patched = async function () {
      return loadCanonicalMediaSources();
    };
    patched.__luxHttpMirrorPriority = VERSION;
    window.loadMediaSourcesInPriority = patched;

    if (typeof window.resolveUserCredentials === 'function') {
      const resolvePatched = function (user = currentUser) {
        const source = canonicalSourceCandidates(user)[0];
        if (!source) return { isXc: false, url: '' };
        if (source.kind === 'xtream') {
          return { isXc: true, server: source.server, user: source.user, pass: source.pass };
        }
        return { isXc: false, url: source.value };
      };
      resolvePatched.__luxHttpMirrorPriority = VERSION;
      window.resolveUserCredentials = resolvePatched;
    }

    window.__luxSyncedXtreamActive = false;
    return true;
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
    const totalStarted = devRunning('publicar-agrupamento', 'Publicação global iniciada', { admin: username });
    busy = true;
    if (action) {
      action.disabled = true;
      action.textContent = 'Atualizando catálogo do admin...';
    }

    try {
      setStatus('Espelhando a lista HTTP completa do fornecedor para HTTPS...');
      const syncStarted = devRunning('sincronizar-admin', 'Espelhando lista HTTP integral...', { admin: username });
      const result = await syncAdminAccount();
      devSuccess('sincronizar-admin', 'Lista HTTP integral espelhada no Cloudflare', syncStarted, {
        status: result?.status || 'success',
        playlistBytes: result?.playlistBytes || null
      });

      if (action) action.textContent = 'Aplicando lista HTTPS...';
      setStatus('Lista HTTPS atualizada. Recarregando exatamente o conteúdo espelhado...');

      const reloadStarted = devRunning('recarregar-catalogo', 'Carregando M3U HTTPS integral...');
      installCanonicalSourcePriority();
      const loaded = await loadCanonicalMediaSources();
      if (!loaded) throw new Error('A lista foi espelhada, mas o Lux não conseguiu carregar a M3U HTTPS.');

      if (!Array.isArray(allMediaItems) || !allMediaItems.length) {
        throw new Error('A lista HTTPS foi carregada, mas não há itens utilizáveis no catálogo.');
      }
      devSuccess('recarregar-catalogo', 'M3U HTTPS integral aplicada no player', reloadStarted, {
        items: allMediaItems.length
      });

      if (action) action.textContent = 'Publicando para todos...';
      setStatus('Publicando o agrupamento atual como fallback para todas as contas...');

      const publishStarted = devRunning('enviar-agrupamento', 'Publicando mapa de categorias como fallback...');
      await publishAdminGrouping();
      const categoryCount = Object.keys(currentUser?.categoryMap || {}).length;
      devSuccess('enviar-agrupamento', 'Agrupamento fallback publicado', publishStarted, {
        categories: categoryCount,
        items: allMediaItems.length
      });

      const partial = result?.status === 'partial';
      setStatus(
        partial
          ? 'Lista HTTPS aplicada e agrupamento publicado. A sincronização do fornecedor terminou parcialmente.'
          : 'Lista HTTP completa espelhada em HTTPS e aplicada. Os usuários usarão essa rota no próximo carregamento.',
        partial ? 'warn' : 'ok'
      );
      devSuccess('publicar-agrupamento', 'Publicação global concluída', totalStarted, {
        status: partial ? 'partial' : 'success',
        categories: categoryCount,
        items: allMediaItems.length
      });
    } catch (error) {
      console.warn('[Lux Provider Sync] Falha ao publicar agrupamento global do admin:', error);
      setStatus(error?.message || 'Não foi possível atualizar a lista espelhada.', 'error');
      devError('publicar-agrupamento', error, totalStarted);
    } finally {
      busy = false;
      if (action) {
        action.disabled = false;
        action.textContent = 'Atualizar lista HTTPS para todos';
      }
    }
  };

  function installAdminButton() {
    const action = button();
    if (!action) return false;

    action.removeAttribute('onclick');
    action.onclick = event => {
      event?.preventDefault?.();
      window.adminSyncProviderCatalogForAll?.();
    };
    action.textContent = 'Atualizar lista HTTPS para todos';
    action.title = 'Espelha a lista HTTP integral no Cloudflare e mantém o agrupamento original da M3U';
    return true;
  }

  function installAll() {
    const sourceOk = installCanonicalSourcePriority();
    const buttonOk = installAdminButton();
    return sourceOk && buttonOk;
  }

  installAll();

  // O synced-catalog antigo também tenta instalar um wrapper. Reafirmamos a
  // prioridade da M3U por alguns segundos durante o boot para evitar corrida de carga.
  let attempts = 0;
  const timer = setInterval(() => {
    attempts += 1;
    const done = installAll();
    if (done && attempts >= 30) clearInterval(timer);
    if (attempts >= 120) clearInterval(timer);
  }, 100);
})();
