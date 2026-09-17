(() => {
  'use strict';

  const VERSION = '20260917-r2-only-roms2';
  const GATEWAY_ROOT = 'https://lux-r2-gateway.professorsouza-tech.workers.dev/r2/roms';
  const GATEWAY_SYNC = 'https://lux-r2-gateway.professorsouza-tech.workers.dev/api/games/sync';

  if (window.__luxR2OnlyRomsVersion === VERSION) return;
  window.__luxR2OnlyRomsVersion = VERSION;

  function encodePath(path = '') {
    return String(path || '')
      .split('/')
      .filter(Boolean)
      .map(part => encodeURIComponent(part))
      .join('/');
  }

  function pathFromGatewayUrl(value = '') {
    const raw = String(value || '').trim();
    if (!raw) return '';
    try {
      const url = new URL(raw, window.location.href);
      const marker = '/r2/roms/';
      const index = url.pathname.indexOf(marker);
      if (url.origin !== new URL(GATEWAY_ROOT).origin || index < 0) return '';
      return decodeURIComponent(url.pathname.slice(index + marker.length)).replace(/^\/+/, '');
    } catch (_) {
      return '';
    }
  }

  function canonicalR2Path(game) {
    const candidates = [game?.r2_path, game?.r2Path, game?.rom_path, pathFromGatewayUrl(game?.r2_url), pathFromGatewayUrl(game?.r2Url), pathFromGatewayUrl(game?.rom_url)];
    for (const candidate of candidates) {
      const path = String(candidate || '').trim().replace(/^\/+/, '');
      if (!path || /^roms\//i.test(path)) continue;
      const parts = path.split('/').filter(Boolean);
      if (parts.length < 2) continue;
      return parts.join('/');
    }
    return '';
  }

  function r2Url(path) {
    const clean = String(path || '').trim().replace(/^\/+/, '');
    return clean ? `${GATEWAY_ROOT}/${encodePath(clean)}` : '';
  }

  function isSupabaseRomUrl(value = '') {
    const raw = String(value || '').toLowerCase();
    return raw.includes('.supabase.co/storage/v1/object/') && raw.includes('/games/');
  }

  if (typeof loadGamesCatalog === 'function' && !loadGamesCatalog.__luxR2OnlyPatched) {
    const originalLoadGamesCatalog = loadGamesCatalog;
    const patchedLoadGamesCatalog = async function (...args) {
      const rows = await originalLoadGamesCatalog.apply(this, args);
      const source = Array.isArray(rows) ? rows : (Array.isArray(gamesCatalog) ? gamesCatalog : []);
      const r2Games = [];

      for (const game of source) {
        const path = canonicalR2Path(game);
        if (!path) continue;
        const url = r2Url(path);
        r2Games.push({
          ...game,
          rom_path: path,
          rom_url: url,
          r2_path: path,
          r2_url: url
        });
      }

      gamesCatalog = r2Games;
      return gamesCatalog;
    };
    patchedLoadGamesCatalog.__luxR2OnlyPatched = VERSION;
    patchedLoadGamesCatalog.__luxR2OnlyOriginal = originalLoadGamesCatalog;
    loadGamesCatalog = patchedLoadGamesCatalog;
  }

  async function syncGamesCatalogOneByOne() {
    if (!currentUser || currentUser.role !== 'admin') return;
    const confirmed = window.confirm('Ler todas as ROMs do bucket luxroms uma por vez? Cada chamada do Worker processará apenas 1 objeto para evitar excesso de subrequests.');
    if (!confirmed) return;

    const button = document.getElementById('gameR2SyncButton');
    const status = document.getElementById('gameR2SyncStatus');
    if (button) button.disabled = true;
    if (status) {
      status.className = 'mt-3 min-h-[18px] text-xs text-purple-300';
      status.textContent = 'Iniciando varredura do R2, 1 ROM por vez...';
    }

    let cursor = null;
    let processed = 0;
    let created = 0;
    let updated = 0;
    let skipped = 0;

    try {
      while (true) {
        const response = await fetch(GATEWAY_SYNC, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ username: currentUser.user, password: currentUser.pass, cursor })
        });
        const result = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(result.error || `Gateway HTTP ${response.status}`);

        processed += Number(result.processed) || 0;
        created += Number(result.created) || 0;
        updated += Number(result.updated) || 0;
        skipped += Number(result.skipped) || 0;

        if (status) {
          const currentName = result.title || result.key || 'objeto sem ROM válida';
          status.textContent = `Varrendo R2: ${processed} objeto(s) processado(s) · ${currentName}`;
        }

        if (result.done) break;
        const nextCursor = String(result.nextCursor || '');
        if (!nextCursor) throw new Error('O gateway não devolveu o cursor da próxima ROM.');
        if (nextCursor === cursor) throw new Error('A varredura não avançou para a próxima ROM.');
        cursor = nextCursor;

        await new Promise(resolve => setTimeout(resolve, 80));
      }

      await loadGamesCatalog();
      await renderGamesCatalog();
      if (status) {
        status.className = 'mt-3 min-h-[18px] text-xs text-emerald-300';
        status.textContent = `Varredura concluída: ${processed} objeto(s), ${created} novo(s), ${updated} atualizado(s) e ${skipped} ignorado(s).`;
      }
    } catch (error) {
      console.error('Falha ao sincronizar jogos do R2 um por um:', error);
      if (status) {
        status.className = 'mt-3 min-h-[18px] text-xs text-rose-300';
        const message = typeof gameImportErrorMessage === 'function' ? gameImportErrorMessage(error) : (error?.message || 'erro desconhecido');
        status.textContent = `Varredura interrompida após ${processed} objeto(s): ${message}`;
      }
    } finally {
      if (button) button.disabled = false;
    }
  }

  syncGamesCatalogOneByOne.__luxR2SequentialSync = VERSION;
  window.syncGamesCatalogFromR2 = syncGamesCatalogOneByOne;
  try { syncGamesCatalogFromR2 = syncGamesCatalogOneByOne; } catch (_) {}

  if (typeof adminImportGame === 'function') {
    const blockedImport = async function () {
      const message = 'ROMs agora usam somente Cloudflare R2. Envie o arquivo ao bucket luxroms e depois clique em “Ler ROMs do R2”.';
      try { if (typeof setGameAdminStatus === 'function') setGameAdminStatus(message); } catch (_) {}
      window.alert?.(message);
      return undefined;
    };
    blockedImport.__luxR2OnlyPatched = VERSION;
    adminImportGame = blockedImport;
  }

  if (typeof toggleGameUploadModal === 'function') {
    const blockedUploadModal = function () {
      window.alert?.('O upload de ROM pelo Supabase foi desativado. Gerencie as ROMs no bucket luxroms do R2 e sincronize o catálogo pelo painel Admin.');
    };
    blockedUploadModal.__luxR2OnlyPatched = VERSION;
    toggleGameUploadModal = blockedUploadModal;
  }

  if (typeof adminDeleteGame === 'function') {
    const blockedDelete = async function (id, event) {
      event?.stopPropagation?.();
      const game = Array.isArray(gamesCatalog) ? gamesCatalog.find(item => String(item.id) === String(id)) : null;
      const path = canonicalR2Path(game);
      window.alert?.(`ROMs são gerenciadas somente no R2. Remova ${path ? `“${path}”` : 'o arquivo correspondente'} do bucket luxroms e depois clique em “Ler ROMs do R2”.`);
      return undefined;
    };
    blockedDelete.__luxR2OnlyPatched = VERSION;
    adminDeleteGame = blockedDelete;
  }

  window.LuxR2OnlyRoms = {
    version: VERSION,
    gatewayRoot: GATEWAY_ROOT,
    canonicalR2Path,
    r2Url,
    isSupabaseRomUrl,
    syncOneByOne: syncGamesCatalogOneByOne
  };

  function hardenAdminUi() {
    const uploadButton = document.querySelector('#adminTabGames button[onclick*="toggleGameUploadModal"]');
    if (uploadButton) {
      uploadButton.textContent = 'ROMs no R2';
      uploadButton.title = 'Envie ROMs ao bucket luxroms e sincronize o catálogo';
    }
  }

  hardenAdminUi();
  document.addEventListener('DOMContentLoaded', hardenAdminUi, { once: true });
  console.info('[Lux Games] R2-only ativo: ROMs do Supabase são ignoradas e a sincronização varre o R2 uma ROM por requisição.');
})();