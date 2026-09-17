(() => {
  'use strict';

  const VERSION = '20260917-rom-manual-clear1';
  const INSTALL_ATTEMPTS = 240;

  if (window.__luxRomManualClearVersion === VERSION) return;
  window.__luxRomManualClearVersion = VERSION;

  function currentGame() {
    try { return typeof currentGameDetails !== 'undefined' ? currentGameDetails : null; }
    catch (_) { return null; }
  }

  function setStorageUi(local, busy = false) {
    const cloud = document.getElementById('gameStorageCloud');
    const localButton = document.getElementById('gameStorageLocal');
    const clear = document.getElementById('gameClearTempButton');

    cloud?.classList.toggle('active', !local);
    localButton?.classList.toggle('active', Boolean(local));
    if (cloud) cloud.disabled = busy;
    if (localButton) localButton.disabled = busy;
    if (clear) clear.disabled = busy || !local;
  }

  function install() {
    const cache = window.LuxRomCache;
    const original = window.clearCurrentGameTemporaryFiles;
    if (!cache?.__luxHybridStoragePatched || typeof cache.remove !== 'function' || typeof cache.status !== 'function' || typeof original !== 'function') return false;
    if (original.__luxRomManualClearPatched) return true;

    const patched = async function () {
      const game = currentGame();
      if (!game || game.external) return;

      const before = await cache.status(game).catch(() => null);
      if (!before) {
        setStorageUi(false, false);
        return;
      }

      const locationText = before.storage === 'directory'
        ? 'A ROM será removida da pasta escolhida no seu dispositivo.'
        : 'A cópia local da ROM será removida deste navegador.';
      const confirmed = window.confirm?.(`Limpar a cópia local deste jogo?\n\n${locationText}\n\nSaves, progresso, favoritos e avaliações não serão apagados.`) ?? true;
      if (!confirmed) return;

      const clearButton = document.getElementById('gameClearTempButton');
      const previousHtml = clearButton?.innerHTML || '';
      setStorageUi(true, true);
      if (clearButton) clearButton.textContent = 'Limpando ROM...';

      try {
        await cache.remove(game);
        const after = await cache.status(game).catch(() => null);
        if (after) throw new Error('A ROM ainda aparece no armazenamento local após a remoção.');

        setStorageUi(false, false);
        if (clearButton) {
          clearButton.textContent = 'ROM removida';
          setTimeout(() => {
            if (!clearButton.isConnected) return;
            clearButton.innerHTML = previousHtml;
            clearButton.disabled = true;
            try { window.lucide?.createIcons?.(); } catch (_) {}
          }, 900);
        }
        console.info('[Lux ROM Clear] ROM local removida; saves permaneceram intactos.');
      } catch (error) {
        setStorageUi(true, false);
        if (clearButton) clearButton.innerHTML = previousHtml;
        try { window.lucide?.createIcons?.(); } catch (_) {}

        if (error?.name === 'AbortError') return;
        console.warn('[Lux ROM Clear] Não foi possível remover a ROM local:', error);
        window.alert?.(error?.message || 'Não foi possível remover a ROM local deste jogo.');
      }
    };

    patched.__luxRomManualClearPatched = VERSION;
    patched.__luxRomManualClearOriginal = original;
    window.clearCurrentGameTemporaryFiles = patched;
    return true;
  }

  let attempts = 0;
  const timer = setInterval(() => {
    attempts += 1;
    if (install() || attempts >= INSTALL_ATTEMPTS) clearInterval(timer);
  }, 50);

  install();
})();
