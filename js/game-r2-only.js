(() => {
  'use strict';

  const VERSION = '20260917-r2-only-roms4';
  const GATEWAY_ROOT = 'https://lux-r2-gateway.professorsouza-tech.workers.dev/r2/roms';
  const GATEWAY_SYNC = 'https://lux-r2-gateway.professorsouza-tech.workers.dev/api/games/sync';
  const SYNC_RETRY_DELAYS = [250, 700, 1500, 3000];
  const SYNC_BATCH_SIZE = 5;

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

  function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  async function requestSyncStep(payload, maxAttempts = SYNC_RETRY_DELAYS.length + 1) {
    let lastError = null;
    for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
      try {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 20000);
        let response;
        try {
          response = await fetch(GATEWAY_SYNC, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
            signal: controller.signal
          });
        } finally {
          clearTimeout(timer);
        }
        const result = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(result.error || `Gateway HTTP ${response.status}`);
        return result;
      } catch (error) {
        lastError = error;
        if (attempt >= maxAttempts - 1) break;
        await sleep(SYNC_RETRY_DELAYS[Math.min(attempt, SYNC_RETRY_DELAYS.length - 1)]);
      }
    }
    throw lastError || new Error('Falha desconhecida ao sincronizar.');
  }

  function renderFailureReport(status, failures) {
    const previous = document.getElementById('gameR2SyncFailures');
    previous?.remove();
    if (!status || !failures.length) return;

    const details = document.createElement('details');
    details.id = 'gameR2SyncFailures';
    details.className = 'mt-3 rounded-xl border border-rose-800/50 bg-rose-950/20 px-3 py-2 text-[11px] text-rose-200';

    const summary = document.createElement('summary');
    summary.className = 'cursor-pointer font-bold';
    summary.textContent = `${failures.length} ROM(s) não sincronizada(s) — clique para ver`;
    details.appendChild(summary);

    const list = document.createElement('div');
    list.className = 'mt-2 max-h-56 space-y-2 overflow-y-auto';
    failures.forEach((failure, index) => {
      const row = document.createElement('div');
      row.className = 'rounded-lg border border-rose-900/40 bg-black/20 px-2 py-1.5';
      const name = failure.title || failure.key || `Objeto ${index + 1}`;
      const stage = failure.stage ? ` · ${failure.stage}` : '';
      row.textContent = `${name}${stage}: ${failure.error || 'Erro desconhecido'}`;
      list.appendChild(row);
    });
    details.appendChild(list);

    status.insertAdjacentElement('afterend', details);
  }

  function collectFailures(result, failures) {
    const batchFailures = Array.isArray(result?.failures)
      ? result.failures
      : (result?.failure ? [result.failure] : []);

    for (const failure of batchFailures) {
      failures.push({
        key: String(failure?.key || result?.key || ''),
        title: String(failure?.title || result?.title || ''),
        stage: String(failure?.stage || ''),
        error: String(failure?.error || 'Erro desconhecido')
      });
    }
  }

  async function syncGamesCatalogOneByOne() {
    if (!currentUser || currentUser.role !== 'admin') return;
    const confirmed = window.confirm(`Ler todas as ROMs do bucket luxroms em lotes de ${SYNC_BATCH_SIZE}? Já cadastradas serão puladas e falhas isoladas não interromperão a varredura.`);
    if (!confirmed) return;

    const button = document.getElementById('gameR2SyncButton');
    const status = document.getElementById('gameR2SyncStatus');
    document.getElementById('gameR2SyncFailures')?.remove();

    if (button) button.disabled = true;
    if (status) {
      status.className = 'mt-3 min-h-[18px] text-xs text-purple-300';
      status.textContent = `Iniciando varredura do R2, até ${SYNC_BATCH_SIZE} ROMs por chamada...`;
    }

    let cursor = null;
    let processed = 0;
    let created = 0;
    let existing = 0;
    let skipped = 0;
    let failed = 0;
    let stoppedEarly = false;
    const failures = [];

    try {
      while (true) {
        let result;
        try {
          result = await requestSyncStep({
            username: currentUser.user,
            password: currentUser.pass,
            cursor,
            batchSize: SYNC_BATCH_SIZE
          });
        } catch (error) {
          try {
            result = await requestSyncStep({
              username: currentUser.user,
              password: currentUser.pass,
              cursor,
              batchSize: SYNC_BATCH_SIZE,
              action: 'skip',
              reason: error?.message || 'Falha de transporte após tentativas.'
            }, 3);
          } catch (skipError) {
            failures.push({
              key: cursor ? `cursor:${cursor.slice(0, 24)}…` : 'primeiro lote',
              title: '',
              stage: 'advance-failed',
              error: skipError?.message || error?.message || 'Não foi possível avançar o cursor.'
            });
            failed += 1;
            stoppedEarly = true;
            break;
          }
        }

        processed += Number(result.processed) || 0;
        created += Number(result.created) || 0;
        existing += Number(result.existing) || 0;
        skipped += Number(result.skipped) || 0;
        failed += Number(result.failed) || 0;
        collectFailures(result, failures);

        if (status) {
          const currentName = result.lastTitle || result.title || result.lastKey || result.key || result.failure?.title || result.failure?.key || 'lote processado';
          status.textContent = `Varrendo R2: ${processed} objeto(s) · ${created} novo(s) · ${existing} já existente(s) · ${failed} falha(s) · ${currentName}`;
        }

        if (result.done) break;

        const nextCursor = String(result.nextCursor || '');
        if (!nextCursor) {
          failures.push({
            key: result.lastKey || result.key || '',
            title: result.lastTitle || result.title || '',
            stage: 'cursor',
            error: 'O gateway não devolveu o cursor do próximo lote.'
          });
          failed += 1;
          stoppedEarly = true;
          break;
        }
        if (nextCursor === cursor) {
          failures.push({
            key: result.lastKey || result.key || '',
            title: result.lastTitle || result.title || '',
            stage: 'cursor',
            error: 'A varredura não avançou para o próximo lote.'
          });
          failed += 1;
          stoppedEarly = true;
          break;
        }

        cursor = nextCursor;
        await sleep(120);
      }

      await loadGamesCatalog();
      await renderGamesCatalog();

      if (status) {
        status.className = `mt-3 min-h-[18px] text-xs ${failed ? 'text-amber-300' : 'text-emerald-300'}`;
        const ending = stoppedEarly ? ' Varredura encerrada antes do fim.' : '';
        status.textContent = `Varredura ${stoppedEarly ? 'parcial' : 'concluída'}: ${processed} objeto(s), ${created} novo(s), ${existing} já existente(s), ${skipped} ignorado(s) e ${failed} falha(s).${ending}`;
      }

      renderFailureReport(status, failures);
      if (failures.length) console.warn('[Lux Games] ROMs não sincronizadas:', failures);
    } catch (error) {
      console.error('Falha inesperada na varredura do R2:', error);
      failures.push({ key: '', title: '', stage: 'unexpected', error: error?.message || 'erro desconhecido' });
      renderFailureReport(status, failures);
      if (status) {
        status.className = 'mt-3 min-h-[18px] text-xs text-rose-300';
        status.textContent = `Varredura interrompida após ${processed} objeto(s): ${error?.message || 'erro desconhecido'}`;
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
    syncOneByOne: syncGamesCatalogOneByOne,
    batchSize: SYNC_BATCH_SIZE
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
  console.info(`[Lux Games] R2-only resiliente: sincronização em lotes de ${SYNC_BATCH_SIZE}, pula existentes e registra falhas.`);
})();