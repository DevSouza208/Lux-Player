(() => {
  'use strict';

  const VERSION = '20260918-provider-sync-https-only1';
  const WORKER_BASE = 'https://lux-playlist-sync.professorsouza-tech.workers.dev';
  const GLOBAL_ACCOUNT = 'admin';
  const SNAPSHOT_SRC = 'js/iptv-https-snapshot.js?v=20260918-https-snapshot-clean1';

  if (window.__luxProviderHttpsSync === VERSION) return;
  window.__luxProviderHttpsSync = VERSION;

  let busy = false;

  const ensureSnapshotModule = () => {
    if (window.LuxHttpsIptv) return true;
    if (!document.querySelector('script[data-lux-https-snapshot]')) {
      const script = document.createElement('script');
      script.src = SNAPSHOT_SRC;
      script.async = false;
      script.dataset.luxHttpsSnapshot = '1';
      document.head.appendChild(script);
    }
    return false;
  };

  const button = () => document.getElementById('adminCategorySyncButton');
  const status = () => document.getElementById('adminCategorySyncStatus');

  const setStatus = (message, kind = 'normal') => {
    const node = status();
    if (!node) return;
    node.textContent = message;
    node.className = 'min-h-[18px] text-[11px] ' + (
      kind === 'ok' ? 'text-emerald-300' :
      kind === 'error' ? 'text-rose-300' :
      kind === 'warn' ? 'text-amber-300' :
      'text-purple-300'
    );
  };

  const isAdmin = () => String(currentUser?.accountRole || currentUser?.role || '').trim().toLowerCase() === 'admin';

  const waitForSnapshotModule = async () => {
    ensureSnapshotModule();
    for (let attempt = 0; attempt < 100; attempt += 1) {
      if (window.LuxHttpsIptv?.reload) return window.LuxHttpsIptv;
      await new Promise(resolve => setTimeout(resolve, 50));
    }
    throw new Error('O leitor HTTPS do Lux não ficou disponível.');
  };

  window.adminSyncProviderCatalogForAll = async function () {
    if (busy) return;
    if (!isAdmin()) {
      setStatus('Apenas o administrador pode atualizar a IPTV HTTPS.', 'error');
      return;
    }

    const username = String(currentUser?.user || '').trim();
    const credential = String(currentUser?.pass || '');
    if (!username || !credential) {
      setStatus('Faça login novamente antes de atualizar.', 'error');
      return;
    }

    const action = button();
    busy = true;
    if (action) {
      action.disabled = true;
      action.textContent = 'Atualizando IPTV HTTPS...';
    }

    const started = performance.now();
    window.LuxDevkit?.running?.('IPTV-HTTPS', 'sync-admin', 'Cloudflare baixando lista + dados oficiais...', {
      target: GLOBAL_ACCOUNT
    });

    try {
      setStatus('Cloudflare está baixando novamente a lista e os dados do fornecedor...');
      const response = await fetch(`${WORKER_BASE}/sync-account`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, credential, targetUsername: GLOBAL_ACCOUNT })
      });

      const payload = await response.json().catch(() => ({}));
      if (!response.ok || !payload?.ok || payload?.result?.status === 'error') {
        throw new Error(payload?.error || payload?.result?.message || `Worker respondeu HTTP ${response.status}`);
      }

      const result = payload.result || {};
      setStatus('Cloudflare terminou. Aplicando o snapshot HTTPS no Lux...');
      const snapshot = await waitForSnapshotModule();
      await snapshot.reload();

      if (typeof window.setSection === 'function') window.setSection(currentSection || 'home');

      const partial = result.status === 'partial';
      setStatus(
        partial
          ? 'A lista foi atualizada, mas parte dos dados do fornecedor falhou. O último snapshot completo continua protegido.'
          : 'IPTV HTTPS atualizada e aplicada. Todos usam o snapshot global do admin.',
        partial ? 'warn' : 'ok'
      );

      window.LuxDevkit?.success?.(
        'IPTV-HTTPS',
        'sync-admin',
        partial ? 'Sincronização parcial concluída' : 'Snapshot global atualizado',
        Math.round(performance.now() - started),
        {
          status: result.status || 'success',
          playlistBytes: result.playlistBytes || null,
          snapshot: window.__luxHttpsSnapshotStats || null
        }
      );
    } catch (error) {
      setStatus(error?.message || 'Falha ao atualizar a IPTV HTTPS.', 'error');
      window.LuxDevkit?.emit?.({
        category: 'IPTV-HTTPS',
        status: 'error',
        label: 'sync-admin',
        message: error?.message || 'Falha desconhecida',
        durationMs: Math.round(performance.now() - started)
      });
    } finally {
      busy = false;
      if (action) {
        action.disabled = false;
        action.textContent = 'Atualizar IPTV HTTPS';
      }
    }
  };

  const installButton = () => {
    const action = button();
    if (!action) return false;
    action.removeAttribute('onclick');
    action.onclick = event => {
      event?.preventDefault?.();
      window.adminSyncProviderCatalogForAll?.();
    };
    action.textContent = 'Atualizar IPTV HTTPS';
    action.title = 'Força o Cloudflare a baixar novamente a lista e os dados oficiais do fornecedor';
    return true;
  };

  ensureSnapshotModule();
  installButton();

  let attempts = 0;
  const timer = setInterval(() => {
    attempts += 1;
    ensureSnapshotModule();
    if (installButton() && window.LuxHttpsIptv && attempts >= 20) clearInterval(timer);
    if (attempts >= 160) clearInterval(timer);
  }, 100);
})();
