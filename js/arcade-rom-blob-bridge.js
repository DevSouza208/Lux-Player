(() => {
  'use strict';

  const VERSION = '20260917-arcade-rom-blob1';
  const INSTALL_TIMEOUT_MS = 15000;

  if (window.__luxArcadeRomBlobBridgeVersion === VERSION) return;

  function isArcade(game) {
    return String(game?.console || '').trim().toLowerCase() === 'arcade';
  }

  function currentPendingGame() {
    try { return typeof pendingEmulatorGame !== 'undefined' ? pendingEmulatorGame : null; }
    catch (_) { return null; }
  }

  function setPendingGame(game) {
    try { pendingEmulatorGame = game; } catch (_) {}
    try { activeEmulatorGame = game; } catch (_) {}
  }

  function setStatus(game, message) {
    const title = document.getElementById('emulatorGameTitle');
    if (title) title.textContent = `${game?.name || 'Arcade'} · ${message}`;
  }

  function isBlob(value) {
    return typeof Blob !== 'undefined' && value instanceof Blob;
  }

  async function fetchArcadeRom(game) {
    if (isBlob(game?.localUrl)) return game.localUrl;

    const source = game?.localUrl || game?.url;
    if (!source) throw new Error('ROM Arcade sem URL disponível.');
    if (isBlob(source)) return source;
    if (typeof source !== 'string') throw new Error('Fonte da ROM Arcade em formato desconhecido.');

    setStatus(game, 'preparando ROM...');
    const response = await fetch(source, { cache: 'no-store' });
    if (!response.ok) throw new Error(`Falha ao baixar a ROM (${response.status}).`);

    const blob = await response.blob();
    if (!blob || blob.size < 22) throw new Error('A ROM baixada está vazia ou inválida.');

    const header = new Uint8Array(await blob.slice(0, 4).arrayBuffer());
    const isZip = header[0] === 0x50 && header[1] === 0x4b && (header[2] === 0x03 || header[2] === 0x05 || header[2] === 0x07);
    if (!isZip) {
      throw new Error(`O arquivo recebido não parece ser um ZIP de Arcade (${blob.size} bytes).`);
    }

    console.info('[Lux Arcade] ROM materializada para MAME.', {
      game: game?.name || game?.id,
      bytes: blob.size,
      type: blob.type || 'application/zip'
    });
    return blob;
  }

  function install() {
    const current = window.startEmulatorSession;
    if (typeof current !== 'function') return false;
    if (current.__luxArcadeRomBlobBridge === VERSION) return true;
    if (!current.__luxArcadeCoreAutodetect) return false;

    const wrapped = async function (...args) {
      const game = currentPendingGame();
      if (!isArcade(game)) return current.apply(this, args);

      try {
        const blob = await fetchArcadeRom(game);
        const preparedGame = { ...game, localUrl: blob };
        setPendingGame(preparedGame);
        setStatus(preparedGame, 'ROM pronta');
        return await current.apply(this, args);
      } catch (error) {
        console.error('[Lux Arcade] Não foi possível preparar os bytes da ROM para o MAME:', error);
        setStatus(game, 'falha ao preparar ROM');
        alert(`Não foi possível preparar esta ROM Arcade para o MAME.\n\n${error?.message || error}`);
        return undefined;
      }
    };

    wrapped.__luxArcadeRomBlobBridge = VERSION;
    wrapped.__luxArcadeRomBlobBridgeOriginal = current;
    window.startEmulatorSession = wrapped;
    window.__luxArcadeRomBlobBridgeVersion = VERSION;
    console.info('[Lux Arcade] Ponte binária ativa: ZIP real será entregue ao MAME.');
    return true;
  }

  if (!install()) {
    const startedAt = Date.now();
    const interval = setInterval(() => {
      if (install() || Date.now() - startedAt > INSTALL_TIMEOUT_MS) clearInterval(interval);
    }, 50);
  }
})();