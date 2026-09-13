(() => {
  'use strict';
  if (window.__luxPlaylistFreshnessInstalled === '20260913-fresh1') return;
  window.__luxPlaylistFreshnessInstalled = '20260913-fresh1';

  const WORKER_BASE = 'https://lux-playlist-sync.professorsouza-tech.workers.dev';
  const MAX_AGE = 3 * 60 * 60 * 1000;
  const RETRY_AFTER_ERROR = 10 * 60 * 1000;
  const checkedUsers = new Map();
  let runningFor = '';
  let lastSeenUser = '';

  const now = () => Date.now();

  function saoPauloDay(value = Date.now()) {
    const date = value instanceof Date ? value : new Date(value);
    if (!Number.isFinite(date.getTime())) return '';
    try {
      return new Intl.DateTimeFormat('en-CA', {
        timeZone: 'America/Sao_Paulo',
        year: 'numeric', month: '2-digit', day: '2-digit'
      }).format(date);
    } catch (_) {
      return date.toISOString().slice(0, 10);
    }
  }

  function currentAccount() {
    try {
      if (!currentUser?.user || !currentUser?.pass) return null;
      return currentUser;
    } catch (_) {
      return null;
    }
  }

  function getClient() {
    try { return typeof supabaseClient !== 'undefined' ? supabaseClient : null; }
    catch (_) { return null; }
  }

  function isStale(row) {
    const syncedAt = row?.lista_m3u_sync_at ? new Date(row.lista_m3u_sync_at) : null;
    const validDate = syncedAt && Number.isFinite(syncedAt.getTime());
    if (!validDate) return true;
    if (String(row?.lista_m3u_sync_status || '').toLowerCase() !== 'success') return true;
    if (saoPauloDay(syncedAt) !== saoPauloDay()) return true;
    return now() - syncedAt.getTime() > MAX_AGE;
  }

  async function readSyncState(username) {
    const client = getClient();
    if (!client) return null;
    const { data, error } = await client
      .from('usuarios')
      .select('lista_m3u,lista_m3u_https,lista_m3u_sync_at,lista_m3u_sync_status')
      .eq('usuario', username)
      .maybeSingle();
    if (error) throw error;
    return data || null;
  }

  async function reloadFreshPlaylist(url) {
    if (!/^https?:\/\//i.test(String(url || ''))) return false;
    try {
      if (typeof loadPlaylist !== 'function') return false;
      await loadPlaylist(url);
      try {
        if (currentUser) currentUser.m3uHttpsUrl = url;
      } catch (_) {}
      try { window.LuxSports?.refresh?.(); } catch (_) {}
      return true;
    } catch (error) {
      console.warn('[Lux Playlist Freshness] A lista foi atualizada no servidor, mas não pôde ser recarregada nesta sessão.', error);
      return false;
    }
  }

  async function syncSelf(account) {
    const response = await fetch(`${WORKER_BASE}/sync-self`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      cache: 'no-store',
      body: JSON.stringify({ username: account.user, password: account.pass })
    });

    let payload = null;
    try { payload = await response.json(); } catch (_) {}
    if (!response.ok || payload?.error || payload?.result?.status === 'error') {
      throw new Error(payload?.error || payload?.result?.message || `Worker respondeu HTTP ${response.status}`);
    }
    return payload?.result || null;
  }

  async function refreshIfNeeded(force = false) {
    if (window.luxElectron) return { skipped: 'electron' };
    const account = currentAccount();
    if (!account) return { skipped: 'no-user' };
    const username = String(account.user || '').trim();
    if (!username || runningFor === username) return { skipped: 'running' };

    const lastCheck = Number(checkedUsers.get(username) || 0);
    if (!force && lastCheck && now() - lastCheck < 60 * 1000) return { skipped: 'checked' };
    checkedUsers.set(username, now());
    runningFor = username;

    try {
      const row = await readSyncState(username);
      if (!row || !/^https?:\/\//i.test(String(row.lista_m3u || '').trim())) return { skipped: 'no-remote-list' };
      if (!force && !isStale(row)) return { fresh: true, syncedAt: row.lista_m3u_sync_at };

      console.info('[Lux Playlist Freshness] Lista antiga detectada. Atualizando apenas a M3U...');
      const result = await syncSelf(account);
      const url = result?.url || row.lista_m3u_https || account.m3uHttpsUrl;
      const reloaded = await reloadFreshPlaylist(url);
      console.info('[Lux Playlist Freshness] M3U atualizada.', { syncedAt: result?.syncedAt, reloaded });
      checkedUsers.set(username, now());
      return { refreshed: true, reloaded, result };
    } catch (error) {
      console.warn('[Lux Playlist Freshness] Atualização automática indisponível.', error);
      checkedUsers.set(username, now() - 60 * 1000 + RETRY_AFTER_ERROR);
      return { error: error?.message || String(error) };
    } finally {
      if (runningFor === username) runningFor = '';
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
    setTimeout(() => refreshIfNeeded(false), 600);
  }

  window.LuxPlaylistFreshness = {
    check: () => refreshIfNeeded(false),
    force: () => refreshIfNeeded(true),
    staleAfterMs: MAX_AGE
  };

  watchAccount();
  setInterval(watchAccount, 1000);
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) refreshIfNeeded(false);
  });
})();
