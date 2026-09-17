(() => {
  'use strict';

  const VERSION = '20260917-arcade-core-auto1';
  const CORE_CANDIDATES = [
    'fbneo',
    'mame2003_plus',
    'mame2003',
    'fbalpha2012_cps2',
    'fbalpha2012_cps1'
  ];
  const ATTEMPT_TIMEOUT_MS = 20000;
  const RETRY_GAP_MS = 180;

  let probeToken = 0;
  let installed = false;

  function isArcade(game) {
    return String(game?.console || '').trim().toLowerCase() === 'arcade';
  }

  function gameIdentity(game) {
    return String(
      game?.rom_path
      || game?.r2_path
      || game?.romPath
      || game?.r2Path
      || game?.sourceFileName
      || game?.id
      || game?.name
      || ''
    ).trim();
  }

  function preferredCoreStorageKey(game) {
    return `lux-play:arcade-core:v1:${encodeURIComponent(gameIdentity(game))}`;
  }

  function readPreferredCore(game) {
    try {
      const core = localStorage.getItem(preferredCoreStorageKey(game)) || '';
      return CORE_CANDIDATES.includes(core) ? core : '';
    } catch (_) {
      return '';
    }
  }

  function savePreferredCore(game, core) {
    if (!CORE_CANDIDATES.includes(core)) return;
    try {
      localStorage.setItem(preferredCoreStorageKey(game), core);
    } catch (_) {}
  }

  function clearPreferredCore(game) {
    try {
      localStorage.removeItem(preferredCoreStorageKey(game));
    } catch (_) {}
  }

  function orderedCandidates(game) {
    const preferred = readPreferredCore(game);
    if (!preferred) return [...CORE_CANDIDATES];
    return [preferred, ...CORE_CANDIDATES.filter(core => core !== preferred)];
  }

  function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  function setArcadeStatus(game, text) {
    const title = document.getElementById('emulatorGameTitle');
    if (title) title.textContent = text || game?.name || 'Arcade';
  }

  async function teardownAttempt() {
    try { window.EJS_emulator?.pause?.(); } catch (_) {}
    try { window.EJS_emulator?.callEvent?.('exit'); } catch (_) {}
    try { window.EJS_emulator?.destroy?.(); } catch (_) {}

    document.getElementById('ejs-script')?.remove();
    const container = document.getElementById('emulatorContainer');
    if (container) container.innerHTML = '';

    for (const key of ['EJS_emulator', 'EJS_load', 'EJS_onGameStart']) {
      try { delete window[key]; } catch (_) { window[key] = undefined; }
    }

    await sleep(RETRY_GAP_MS);
  }

  function configureAttempt(game, core) {
    window.EJS_player = '#emulatorContainer';
    window.EJS_gameUrl = game.localUrl || game.url;
    window.EJS_core = core;
    window.EJS_threads = false;
    window.EJS_pathtodata = 'https://cdn.emulatorjs.org/stable/data/';
    window.EJS_color = '#7c3aed';
    window.EJS_gameName = getGameSaveKey(game);
    window.EJS_defaultOptions = { 'save-state-location': 'browser' };
    window.EJS_startOnLoaded = true;
  }

  async function finishSuccessfulStart(game, core) {
    savePreferredCore(game, core);
    setArcadeStatus(game, game.name || 'Arcade');
    document.getElementById('emulatorControlsBtn')?.classList.remove('hidden');
    startGamePlayTimer(game);

    try {
      if (game.loadSource !== 'state' && game.loadSource !== 'new') {
        await loadNativeGameSave(game);
      }
      await loadRequestedGameSlot();
    } catch (error) {
      console.warn('[Lux Arcade] Jogo iniciou, mas houve falha ao restaurar save:', error);
    }

    console.info(`[Lux Arcade] Núcleo aprendido para ${game.name || gameIdentity(game)}: ${core}`);
  }

  async function tryCore(game, core, index, total, token) {
    await teardownAttempt();
    if (token !== probeToken) return false;

    setArcadeStatus(game, `${game.name || 'Arcade'} · testando ${core} (${index + 1}/${total})`);
    configureAttempt(game, core);

    return new Promise(resolve => {
      let settled = false;
      let timer = null;

      const finish = (success, reason = '') => {
        if (settled) return;
        settled = true;
        if (timer) clearTimeout(timer);
        if (!success) console.warn(`[Lux Arcade] ${core} não iniciou ${game.name || gameIdentity(game)}: ${reason || 'falha desconhecida'}`);
        resolve(success);
      };

      window.EJS_onGameStart = async () => {
        if (token !== probeToken || settled) return;
        finish(true);
        await finishSuccessfulStart(game, core);
      };

      const script = document.createElement('script');
      script.id = 'ejs-script';
      script.src = 'https://cdn.emulatorjs.org/stable/data/loader.js';
      script.async = true;
      script.onerror = () => finish(false, 'loader.js não carregou');

      timer = setTimeout(() => finish(false, `timeout após ${Math.round(ATTEMPT_TIMEOUT_MS / 1000)}s`), ATTEMPT_TIMEOUT_MS);
      document.body.appendChild(script);
    });
  }

  async function runArcadeProbe(game) {
    const token = ++probeToken;
    document.getElementById('emulatorIntro')?.classList.add('hidden');

    const candidates = orderedCandidates(game);
    const remembered = readPreferredCore(game);

    console.info('[Lux Arcade] Procurando núcleo compatível.', {
      game: game.name || gameIdentity(game),
      remembered: remembered || null,
      candidates
    });

    for (let index = 0; index < candidates.length; index += 1) {
      const core = candidates[index];
      const success = await tryCore(game, core, index, candidates.length, token);
      if (token !== probeToken) return;
      if (success) return;

      if (remembered && core === remembered) {
        clearPreferredCore(game);
        console.warn(`[Lux Arcade] Núcleo salvo ${core} deixou de funcionar; preferência removida.`);
      }
    }

    await teardownAttempt();
    if (token !== probeToken) return;

    setArcadeStatus(game, game.name || 'Arcade');
    const container = document.getElementById('emulatorContainer');
    if (container) {
      container.innerHTML = `
        <div class="flex h-full min-h-[260px] items-center justify-center p-6 text-center">
          <div class="max-w-md rounded-2xl border border-rose-900/50 bg-rose-950/20 p-5 text-rose-100">
            <p class="font-bold">Nenhum núcleo Arcade conseguiu iniciar esta ROM.</p>
            <p class="mt-2 text-xs text-rose-200/80">Testados: ${CORE_CANDIDATES.join(', ')}.</p>
          </div>
        </div>`;
    }
    console.error('[Lux Arcade] Nenhum núcleo compatível encontrado.', game.name || gameIdentity(game));
  }

  function install() {
    if (installed || window.__luxArcadeCoreAutodetectVersion === VERSION) return true;
    if (typeof window.startEmulatorSession !== 'function') return false;

    const originalStart = window.startEmulatorSession;
    const patchedStart = function (...args) {
      let game = null;
      try {
        game = typeof pendingEmulatorGame !== 'undefined' ? pendingEmulatorGame : null;
      } catch (_) {}

      if (!isArcade(game)) return originalStart.apply(this, args);
      return runArcadeProbe(game);
    };
    patchedStart.__luxArcadeCoreAutodetect = VERSION;
    patchedStart.__luxArcadeCoreAutodetectOriginal = originalStart;
    window.startEmulatorSession = patchedStart;

    if (typeof window.closeGameEmulator === 'function' && !window.closeGameEmulator.__luxArcadeCoreAutodetect) {
      const originalClose = window.closeGameEmulator;
      const patchedClose = function (...args) {
        probeToken += 1;
        return originalClose.apply(this, args);
      };
      patchedClose.__luxArcadeCoreAutodetect = VERSION;
      patchedClose.__luxArcadeCoreAutodetectOriginal = originalClose;
      window.closeGameEmulator = patchedClose;
    }

    window.LuxArcadeCores = {
      version: VERSION,
      cores: [...CORE_CANDIDATES],
      preferred: readPreferredCore,
      clear: clearPreferredCore,
      forget(game) { clearPreferredCore(game); },
      identify: gameIdentity
    };

    installed = true;
    window.__luxArcadeCoreAutodetectVersion = VERSION;
    console.info('[Lux Arcade] Detecção automática ativa.', CORE_CANDIDATES);
    return true;
  }

  if (!install()) {
    const interval = setInterval(() => {
      if (install()) clearInterval(interval);
    }, 50);
    setTimeout(() => clearInterval(interval), 15000);
  }
})();