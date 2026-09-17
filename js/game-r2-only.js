(() => {
  'use strict';

  const VERSION = '20260917-r2-only-roms1';
  const GATEWAY_ROOT = 'https://lux-r2-gateway.professorsouza-tech.workers.dev/r2/roms';

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

  // Nunca mais permita que o painel envie ROMs para Supabase Storage.
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

  // Não apague mais arquivos pelo Supabase. A origem de verdade agora é o R2;
  // remova o objeto no R2 e sincronize para o catálogo refletir a exclusão.
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

  // Garante que qualquer registro que ainda vaze do legado nunca seja tratado como fonte válida.
  window.LuxR2OnlyRoms = {
    version: VERSION,
    gatewayRoot: GATEWAY_ROOT,
    canonicalR2Path,
    r2Url,
    isSupabaseRomUrl
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
  console.info('[Lux Games] R2-only ativo: ROMs do Supabase são ignoradas e uploads legados foram bloqueados.');
})();