(() => {
  'use strict';

  const VERSION = '20260913-server-snapshot2';
  if (window.__luxPlaylistFreshnessInstalled === VERSION) return;
  window.__luxPlaylistFreshnessInstalled = VERSION;

  const loadSnapshotLoader = () => {
    if (document.querySelector('script[data-lux-user-snapshot-loader]')) return;
    const script = document.createElement('script');
    script.src = 'js/user-snapshot-loader.js?v=20260913-user-snapshot-loader1';
    script.async = true;
    script.dataset.luxUserSnapshotLoader = '1';
    document.head.appendChild(script);
  };
  loadSnapshotLoader();

  const CHECK_INTERVAL = 60 * 1000;
  let running = false;
  let lastSeenUser = '';
  const lastApplied = new Map();

  function currentAccount() {
    try {
      if (!currentUser?.user) return null;
      return currentUser;
    } catch (_) {
      return null;
    }
  }

  function getClient() {
    try {
      return typeof supabaseClient !== 'undefined' ? supabaseClient : null;
    } catch (_) {
      return null;
    }
  }

  async function readSyncState(username) {
    const client = getClient();
    if (!client) return null;

    const { data, error } = await client
      .from('usuarios')
      .select('lista_m3u_https,lista_m3u_sync_at,lista_m3u_sync_status,lista_m3u_sync_error')
      .eq('usuario', username)
      .maybeSingle();

    if (error) throw error;
    return data || null;
  }

  async function applyPublishedSnapshot(row, account, force = false) {
    const url = String(row?.lista_m3u_https || '').trim();
    const status = String(row?.lista_m3u_sync_status || '').toLowerCase();
    const syncedAt = String(row?.lista_m3u_sync_at || '');
    if (status !== 'success' || !/^https:\/\//i.test(url)) return false;

    const signature = `${url}|${syncedAt}`;
    const username = String(account?.user || '').trim();
    const currentUrl = String(account?.m3uHttpsUrl || '').trim();

    if (!force && lastApplied.get(username) === signature && currentUrl === url) {
      return false;
    }

    const changed = currentUrl !== url || lastApplied.get(username) !== signature;
    account.m3uHttpsUrl = url;
    try {
      if (currentUser) currentUser.m3uHttpsUrl = url;
    } catch (_) {}

    lastApplied.set(username, signature);
    if (!changed && !force) return false;

    if (window.LuxSyncedCatalog?.reload) {
      try {
        const loaded = await window.LuxSyncedCatalog.reload();
        if (loaded?.count) {
          try {
            if (typeof window.setSection === 'function' && typeof currentSection !== 'undefined') {
              window.setSection(currentSection || 'home');
            }
          } catch (_) {}
          console.info('[Lux Snapshot] Nova versão HTTPS aplicada.', {
            username,
            syncedAt,
            count: loaded.count
          });
          return true;
        }
      } catch (error) {
        console.warn('[Lux Snapshot] A nova versão foi publicada, mas não pôde ser aplicada agora.', error);
      }
    }

    return false;
  }

  async function checkPublishedSnapshot(force = false) {
    if (window.luxElectron || running) return { skipped: true };

    const account = currentAccount();
    if (!account) return { skipped: true };

    const username = String(account.user || '').trim();
    if (!username) return { skipped: true };

    running = true;
    try {
      const row = await readSyncState(username);
      if (!row) return { skipped: true };

      const applied = await applyPublishedSnapshot(row, account, force);
      return {
        applied,
        syncedAt: row.lista_m3u_sync_at || null,
        status: row.lista_m3u_sync_status || null,
        error: row.lista_m3u_sync_error || null
      };
    } catch (error) {
      console.warn('[Lux Snapshot] Não foi possível consultar a versão publicada.', error);
      return { error: error?.message || String(error) };
    } finally {
      running = false;
    }
  }

  function watchAccount() {
    const account = currentAccount();
    const username = String(account?.user || '');

    if (!username) {
      lastSeenUser = '';
      return;
    }

    if (username === lastSeenUser) return;
    lastSeenUser = username;

    setTimeout(() => checkPublishedSnapshot(false), 800);
  }

  window.LuxPlaylistFreshness = {
    check: () => checkPublishedSnapshot(false),
    force: () => checkPublishedSnapshot(true),
    mode: 'server-published-snapshots'
  };

  watchAccount();
  setInterval(watchAccount, 1000);
  setInterval(() => checkPublishedSnapshot(false), CHECK_INTERVAL);

  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) checkPublishedSnapshot(false);
  });
})();