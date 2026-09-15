(() => {
  'use strict';

  const VERSION = '20260915-sm64-compat1';
  const STANDARD_SIZE = 8 * 1024 * 1024;
  const KNOWN_SM64_SHA1 = new Map([
    ['9BEF1128717F958171A4AFAC3ED78EE2BB4E86CE', 'USA'],
    ['8A20A5C83D6CEB0F0506CFC9FA20D8F438CAFE51', 'Japan'],
    ['3F319AE697533A255A1003D09202379D78D5A2E0', 'Japan Shindou']
  ]);

  if (window.__luxSm64CompatVersion === VERSION) return;
  window.__luxSm64CompatVersion = VERSION;

  const isIOS = /iPad|iPhone|iPod/i.test(navigator.userAgent || '') ||
    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

  const normalize = value => String(value || '')
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

  function activeGame() {
    try {
      if (typeof pendingEmulatorGame !== 'undefined' && pendingEmulatorGame) return pendingEmulatorGame;
      if (typeof activeEmulatorGame !== 'undefined' && activeEmulatorGame) return activeEmulatorGame;
      if (typeof currentGameDetails !== 'undefined' && currentGameDetails) return currentGameDetails;
    } catch (_) {}
    return null;
  }

  function isSm64(game) {
    if (!game) return false;
    if (String(game.id || '') === '679') return true;
    return normalize(game.name || game.title) === 'super mario 64';
  }

  function isN64(game) {
    const value = normalize(game?.console || game?.consoleLabel).replace(/\s+/g, '');
    return value === 'n64' || value === 'nintendo64';
  }

  function hex(buffer) {
    return [...new Uint8Array(buffer)].map(byte => byte.toString(16).padStart(2, '0')).join('').toUpperCase();
  }

  async function sha1(blob) {
    if (!crypto?.subtle?.digest) return '';
    return hex(await crypto.subtle.digest('SHA-1', await blob.arrayBuffer()));
  }

  function canonicalHeader(bytes) {
    if (!bytes || bytes.length < 0x40) return null;
    const magic = [...bytes.slice(0, 4)];
    const out = new Uint8Array(bytes.length);

    if (magic[0] === 0x80 && magic[1] === 0x37 && magic[2] === 0x12 && magic[3] === 0x40) {
      out.set(bytes);
      return { format: 'z64', bytes: out };
    }

    if (magic[0] === 0x37 && magic[1] === 0x80 && magic[2] === 0x40 && magic[3] === 0x12) {
      for (let i = 0; i + 1 < bytes.length; i += 2) {
        out[i] = bytes[i + 1];
        out[i + 1] = bytes[i];
      }
      return { format: 'v64', bytes: out };
    }

    if (magic[0] === 0x40 && magic[1] === 0x12 && magic[2] === 0x37 && magic[3] === 0x80) {
      for (let i = 0; i + 3 < bytes.length; i += 4) {
        out[i] = bytes[i + 3];
        out[i + 1] = bytes[i + 2];
        out[i + 2] = bytes[i + 1];
        out[i + 3] = bytes[i];
      }
      return { format: 'n64', bytes: out };
    }
    return null;
  }

  async function inspect(blob) {
    const head = new Uint8Array(await blob.slice(0, 0x40).arrayBuffer());
    const canonical = canonicalHeader(head);
    let internalTitle = '';
    if (canonical) {
      internalTitle = new TextDecoder('ascii')
        .decode(canonical.bytes.slice(0x20, 0x34))
        .replace(/\0/g, '').trim();
    }

    const first = blob.size >= STANDARD_SIZE ? blob.slice(0, STANDARD_SIZE) : blob;
    const firstSha1 = await sha1(first).catch(() => '');
    return {
      size: blob.size,
      format: canonical?.format || 'unknown',
      internalTitle,
      firstSha1,
      knownRevision: KNOWN_SM64_SHA1.get(firstSha1) || ''
    };
  }

  function exposeDiagnostic(game, diagnostic, mode) {
    const info = {
      gameId: game?.id ?? null,
      title: game?.name || game?.title || '',
      mode,
      ...diagnostic,
      at: new Date().toISOString()
    };
    window.LuxN64Compat = window.LuxN64Compat || {};
    window.LuxN64Compat.version = VERSION;
    window.LuxN64Compat.lastDiagnostic = info;
    console.info('[Lux N64][SM64] Diagnóstico da ROM:', info);
  }

  function patchRomCache() {
    const cache = window.LuxRomCache;
    if (!cache || typeof cache.get !== 'function' || typeof cache.getBlob !== 'function') return false;
    if (cache.get.__luxSm64CompatPatched) return true;

    const originalGet = cache.get.bind(cache);
    const patchedGet = async function (game) {
      if (!isSm64(game) || !isN64(game)) return originalGet(game);

      try {
        const record = await cache.getBlob(game);
        if (!record?.blob) return originalGet(game);

        const diagnostic = await inspect(record.blob);
        game.__luxN64CoreProfile = isIOS ? 'parallel-n64' : 'mupen64plus_next';

        if (diagnostic.size === STANDARD_SIZE && diagnostic.knownRevision) {
          exposeDiagnostic(game, diagnostic, 'known-clean');
          return {
            url: URL.createObjectURL(record.blob),
            size: record.blob.size,
            lastUsedAt: record.lastUsedAt,
            compatMode: 'known-clean'
          };
        }

        if (
          diagnostic.size > STANDARD_SIZE &&
          diagnostic.knownRevision &&
          normalize(diagnostic.internalTitle) === 'super mario 64'
        ) {
          const standardImage = record.blob.slice(0, STANDARD_SIZE, 'application/octet-stream');
          exposeDiagnostic(game, diagnostic, 'standard-8m-view');
          console.warn(
            `[Lux N64][SM64] ROM com ${(diagnostic.size / 1048576).toFixed(1)} MiB; ` +
            `os primeiros 8 MiB correspondem ao dump conhecido ${diagnostic.knownRevision}. ` +
            'Usando uma visão temporária de 8 MiB sem alterar o arquivo original.'
          );
          return {
            url: URL.createObjectURL(standardImage),
            size: standardImage.size,
            lastUsedAt: record.lastUsedAt,
            compatMode: 'standard-8m-view'
          };
        }

        exposeDiagnostic(game, diagnostic, 'nonstandard');
        console.warn(
          '[Lux N64][SM64] A ROM não corresponde a um dump padrão conhecido; ' +
          'o arquivo original será usado sem cortes.',
          diagnostic
        );
        return originalGet(game);
      } catch (error) {
        console.warn('[Lux N64][SM64] Falha no diagnóstico de compatibilidade:', error);
        return originalGet(game);
      }
    };

    patchedGet.__luxSm64CompatPatched = VERSION;
    patchedGet.__luxSm64CompatOriginal = originalGet;
    cache.get = patchedGet;
    return true;
  }

  function patchCoreResolver() {
    if (typeof window.getEmulatorCore !== 'function') return false;
    if (window.getEmulatorCore.__luxN64ProfilePatched) return true;

    const original = window.getEmulatorCore;
    const patched = function (consoleType) {
      const game = activeGame();
      if (isN64(game) && game?.__luxN64CoreProfile) return game.__luxN64CoreProfile;
      if (isSm64(game) && isN64(game)) return isIOS ? 'parallel-n64' : 'mupen64plus_next';
      return original.apply(this, arguments);
    };

    patched.__luxN64ProfilePatched = VERSION;
    patched.__luxN64ProfileOriginal = original;
    window.getEmulatorCore = patched;
    return true;
  }

  let attempts = 0;
  const timer = setInterval(() => {
    attempts += 1;
    const cacheOk = patchRomCache();
    const coreOk = patchCoreResolver();
    if ((cacheOk && coreOk) || attempts >= 240) clearInterval(timer);
  }, 50);

  window.addEventListener('beforeunload', () => clearInterval(timer), { once: true });
})();
