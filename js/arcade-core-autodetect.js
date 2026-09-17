(() => {
  'use strict';

  const VERSION = '20260917-arcade-core-auto5';
  const ENGINE_PREFIX = 'nostalgist:';
  const MAME2003PLUS_ENGINE = `${ENGINE_PREFIX}mame2003_plus`;
  const MAME2000_ENGINE = `${ENGINE_PREFIX}mame2000`;
  const FBNEO_ENGINE = `${ENGINE_PREFIX}fbneo`;
  const CORE_CANDIDATES = [
    MAME2003PLUS_ENGINE,
    MAME2000_ENGINE,
    FBNEO_ENGINE,
    'fbalpha2012_cps2',
    'fbalpha2012_cps1'
  ];

  const NOSTALGIST_TIMEOUT_MS = 30000;
  const NOSTALGIST_VALIDATION_MS = 3600;
  const EJS_ATTEMPT_TIMEOUT_MS = 16000;
  const RETRY_GAP_MS = 280;
  const NOSTALGIST_SRC = 'https://cdn.jsdelivr.net/npm/nostalgist@0.22.0';
  const NOSTALGIST_CONTENT_DIR = '/home/web_user/retroarch/userdata/content';

  let probeToken = 0;
  let installed = false;
  let nostalgistLoaderPromise = null;
  let activeNostalgist = null;

  function isArcade(game) {
    return String(game?.console || '').trim().toLowerCase() === 'arcade';
  }

  function gameIdentity(game) {
    return String(
      game?.rom_path || game?.r2_path || game?.romPath || game?.r2Path
      || game?.source_file_name || game?.sourceFileName || game?.id || game?.name || ''
    ).trim();
  }

  function romFileName(game) {
    const raw = String(
      game?.source_file_name || game?.sourceFileName || game?.rom_path || game?.r2_path
      || game?.romPath || game?.r2Path || game?.url || game?.name || 'arcade.zip'
    );
    let name = raw.split('?')[0].split('#')[0].split('/').pop() || 'arcade.zip';
    try { name = decodeURIComponent(name); } catch (_) {}
    if (!/\.zip$/i.test(name)) name += '.zip';
    return name.toLowerCase();
  }

  function preferredCoreStorageKey(game) {
    return `lux-play:arcade-core:v5:${encodeURIComponent(gameIdentity(game))}`;
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
    try { localStorage.setItem(preferredCoreStorageKey(game), core); } catch (_) {}
  }

  function clearPreferredCore(game) {
    try { localStorage.removeItem(preferredCoreStorageKey(game)); } catch (_) {}
  }

  function orderedCandidates(game) {
    const preferred = readPreferredCore(game);
    return preferred
      ? [preferred, ...CORE_CANDIDATES.filter(core => core !== preferred)]
      : [...CORE_CANDIDATES];
  }

  function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  function candidateLabel(candidate) {
    if (candidate === MAME2003PLUS_ENGINE) return 'MAME 2003-Plus';
    if (candidate === MAME2000_ENGINE) return 'MAME 2000';
    if (candidate === FBNEO_ENGINE) return 'FBNeo';
    if (candidate === 'fbalpha2012_cps2') return 'FB Alpha CPS2';
    if (candidate === 'fbalpha2012_cps1') return 'FB Alpha CPS1';
    return candidate;
  }

  function setArcadeStatus(game, text) {
    const title = document.getElementById('emulatorGameTitle');
    if (title) title.textContent = text || game?.name || 'Arcade';
  }

  async function stopNostalgist() {
    const instance = activeNostalgist || window.__luxArcadeNostalgist || null;
    activeNostalgist = null;
    window.__luxArcadeNostalgist = null;
    if (!instance) return;
    try { await instance.exit?.(); } catch (_) {}
  }

  async function teardownAttempt() {
    await stopNostalgist();
    try { window.EJS_emulator?.pause?.(); } catch (_) {}
    try { window.EJS_emulator?.callEvent?.('exit'); } catch (_) {}
    try { window.EJS_emulator?.destroy?.(); } catch (_) {}
    document.getElementById('ejs-script')?.remove();

    const container = document.getElementById('emulatorContainer');
    if (container) container.innerHTML = '';

    for (const key of ['EJS_emulator', 'EJS_load', 'EJS_onGameStart', 'EJS_gameParentUrl']) {
      try { delete window[key]; } catch (_) { window[key] = undefined; }
    }

    await sleep(RETRY_GAP_MS);
  }

  async function ensureNostalgist() {
    if (window.Nostalgist?.prepare && window.Nostalgist?.launch) return window.Nostalgist;
    if (nostalgistLoaderPromise) return nostalgistLoaderPromise;

    nostalgistLoaderPromise = new Promise((resolve, reject) => {
      const existing = document.querySelector('script[data-lux-nostalgist]');
      if (existing) {
        const started = Date.now();
        const poll = setInterval(() => {
          if (window.Nostalgist?.prepare && window.Nostalgist?.launch) {
            clearInterval(poll);
            resolve(window.Nostalgist);
          } else if (Date.now() - started > 12000) {
            clearInterval(poll);
            reject(new Error('Nostalgist não ficou disponível.'));
          }
        }, 50);
        return;
      }

      const script = document.createElement('script');
      script.src = NOSTALGIST_SRC;
      script.async = true;
      script.dataset.luxNostalgist = '1';
      script.onload = () => {
        if (window.Nostalgist?.prepare && window.Nostalgist?.launch) resolve(window.Nostalgist);
        else reject(new Error('Nostalgist carregou sem expor a API esperada.'));
      };
      script.onerror = () => reject(new Error('Falha ao carregar o runtime Arcade.'));
      document.head.appendChild(script);
    }).catch(error => {
      nostalgistLoaderPromise = null;
      throw error;
    });

    return nostalgistLoaderPromise;
  }

  async function materializeArcadeRom(game) {
    if (window.LuxArcadeRomBlob?.materialize) {
      return window.LuxArcadeRomBlob.materialize(game);
    }

    const source = game.localUrl || game.url;
    if (!source) throw new Error('ROM sem URL disponível.');
    const response = await fetch(source, { cache: 'no-store' });
    if (!response.ok) throw new Error(`Falha ao baixar ROM (${response.status}).`);
    const blob = await response.blob();
    if (blob.size < 64) throw new Error('ROM vazia ou inválida.');
    return { blob, fileName: romFileName(game) };
  }

  function installRuntimeGuard(onFault) {
    let fired = false;
    const matches = value => /memory access out of bounds|out of bounds memory access|wasm.*runtimeerror|abort\(|unreachable/i.test(String(value || ''));

    const fail = (message, event) => {
      if (!matches(message)) return false;
      try { event?.preventDefault?.(); } catch (_) {}
      try { event?.stopImmediatePropagation?.(); } catch (_) {}
      if (!fired) {
        fired = true;
        onFault(new Error(String(message || 'Arcade WebAssembly crash')));
      }
      return true;
    };

    const onError = event => fail(event?.message || event?.error?.message || event?.error, event);
    const onRejection = event => fail(event?.reason?.message || event?.reason, event);
    window.addEventListener('error', onError, true);
    window.addEventListener('unhandledrejection', onRejection, true);

    return () => {
      window.removeEventListener('error', onError, true);
      window.removeEventListener('unhandledrejection', onRejection, true);
    };
  }

  function hasFatalArcadeLog(logs) {
    const text = logs.join('\n');
    return /failed to load content|failed to open|could not load|content.*failed|required files are missing|required files.*not found|romset.*not found|unknown romset|fatal error/i.test(text);
  }

  function firstFatalArcadeLog(logs) {
    return logs.find(line => /failed to load content|failed to open|could not load|content.*failed|required files are missing|required files.*not found|romset.*not found|unknown romset|fatal error/i.test(line)) || '';
  }

  async function finishSuccessfulStart(game, candidate, engine = 'nostalgist') {
    savePreferredCore(game, candidate);
    setArcadeStatus(game, game.name || 'Arcade');
    startGamePlayTimer(game);

    const controlsButton = document.getElementById('emulatorControlsBtn');
    const fastForwardButton = document.getElementById('emulatorFastForward');

    if (engine === 'emulatorjs') {
      controlsButton?.classList.remove('hidden');
      if (fastForwardButton) {
        fastForwardButton.disabled = false;
        fastForwardButton.textContent = 'Fast-forward';
        fastForwardButton.title = '';
      }
      try {
        if (game.loadSource !== 'state' && game.loadSource !== 'new') await loadNativeGameSave(game);
        await loadRequestedGameSlot();
      } catch (error) {
        console.warn('[Lux Arcade] Jogo iniciou, mas houve falha ao restaurar save:', error);
      }
    } else {
      controlsButton?.classList.add('hidden');
      if (fastForwardButton) {
        fastForwardButton.disabled = true;
        fastForwardButton.textContent = candidateLabel(candidate);
        fastForwardButton.title = `Arcade usando ${candidateLabel(candidate)}`;
      }
    }

    console.info(`[Lux Arcade] Motor aprendido para ${game.name || gameIdentity(game)}: ${candidateLabel(candidate)}`);
  }

  async function prepareNostalgistWithForcedContent(Nostalgist, core, rom, canvas, logs) {
    const fileName = String(rom.fileName || 'arcade.zip').toLowerCase();
    const contentPath = `${NOSTALGIST_CONTENT_DIR}/${fileName}`;

    const instance = await Nostalgist.prepare({
      core,
      rom: { fileName, fileContent: rom.blob },
      element: canvas,
      cache: { core: true, rom: false, bios: false, shader: false },
      respondToGlobalEvents: true,
      retroarchConfig: {
        input_autodetect_enable: true,
        input_auto_game_focus: true,
        log_verbosity: true,
        menu_driver: 'null'
      },
      emscriptenModule: {
        print(value) {
          const line = String(value || '');
          logs.push(line);
          console.debug('[Lux Arcade/RA]', line);
        },
        printErr(value) {
          const line = String(value || '');
          logs.push(line);
          console.warn('[Lux Arcade/RA]', line);
        }
      }
    });

    const FS = instance.getEmscriptenFS();
    let stat = null;
    try { stat = FS.stat(contentPath); } catch (_) {}
    if (!stat || !Number(stat.size)) {
      try { instance.exit?.(); } catch (_) {}
      throw new Error(`ROM não apareceu no filesystem do RetroArch: ${contentPath}`);
    }

    const Module = instance.getEmscriptenModule();
    const oldArgs = Array.isArray(Module.arguments) ? [...Module.arguments] : [];

    // Some MAME/Arcade Emscripten builds expose Module.arguments = [] themselves.
    // Nostalgist only injects the ROM path when Module.arguments is absent, so those
    // builds start RetroArch with no content and land on the "Load Content" menu.
    // Force the content path explicitly before start(). Nostalgist will append -c cfg.
    Module.arguments = [contentPath];

    console.info('[Lux Arcade] Conteúdo Arcade forçado no RetroArch.', {
      fileName,
      contentPath,
      size: stat.size,
      previousArguments: oldArgs,
      forcedArguments: [...Module.arguments]
    });

    await instance.start();
    return { instance, contentPath };
  }

  async function tryNostalgistCore(game, candidate, index, total, token) {
    await teardownAttempt();
    if (token !== probeToken) return false;

    const label = candidateLabel(candidate);
    const core = candidate.slice(ENGINE_PREFIX.length);
    setArcadeStatus(game, `${game.name || 'Arcade'} · testando ${label} (${index + 1}/${total})`);

    const container = document.getElementById('emulatorContainer');
    if (!container) return false;

    const canvas = document.createElement('canvas');
    canvas.id = 'luxArcadeNostalgistCanvas';
    canvas.style.width = '100%';
    canvas.style.height = '100%';
    canvas.style.display = 'block';
    container.innerHTML = '';
    container.appendChild(canvas);

    const logs = [];
    let timeoutId = null;
    let runtimeFaultReject;
    const runtimeFaultPromise = new Promise((_, reject) => { runtimeFaultReject = reject; });
    const removeRuntimeGuard = installRuntimeGuard(error => {
      console.warn(`[Lux Arcade] ${label} caiu em ${game.name || gameIdentity(game)}; tentando próximo core.`);
      runtimeFaultReject(error);
      stopNostalgist().catch(() => {});
    });

    try {
      const Nostalgist = await ensureNostalgist();
      if (token !== probeToken) return false;

      setArcadeStatus(game, `${game.name || 'Arcade'} · preparando ROM para ${label}`);
      const rom = await materializeArcadeRom(game);
      if (token !== probeToken) return false;

      const preparePromise = prepareNostalgistWithForcedContent(Nostalgist, core, rom, canvas, logs)
        .then(result => {
          activeNostalgist = result.instance;
          window.__luxArcadeNostalgist = result.instance;
          return result;
        });

      const timeoutPromise = new Promise((_, reject) => {
        timeoutId = setTimeout(
          () => reject(new Error(`timeout após ${Math.round(NOSTALGIST_TIMEOUT_MS / 1000)}s`)),
          NOSTALGIST_TIMEOUT_MS
        );
      });

      const { instance, contentPath } = await Promise.race([
        preparePromise,
        timeoutPromise,
        runtimeFaultPromise
      ]);

      if (timeoutId) clearTimeout(timeoutId);
      if (token !== probeToken) return false;

      setArcadeStatus(game, `${game.name || 'Arcade'} · validando ${label}`);
      await Promise.race([sleep(NOSTALGIST_VALIDATION_MS), runtimeFaultPromise]);

      if (hasFatalArcadeLog(logs)) {
        throw new Error(firstFatalArcadeLog(logs) || `${label} recusou a ROM`);
      }

      const status = typeof instance?.getStatus === 'function' ? instance.getStatus() : 'running';
      if (status !== 'running' && status !== 'paused') {
        throw new Error(`RetroArch terminou com status ${status}`);
      }

      console.info('[Lux Arcade] Core permaneceu ativo com conteúdo forçado.', {
        core,
        contentPath,
        status
      });

      await finishSuccessfulStart(game, candidate, 'nostalgist');
      return true;
    } catch (error) {
      if (timeoutId) clearTimeout(timeoutId);
      console.warn(`[Lux Arcade] ${label} rejeitado para ${game.name || gameIdentity(game)}: ${error?.message || error}`);
      await stopNostalgist();
      if (container) container.innerHTML = '';
      return false;
    } finally {
      removeRuntimeGuard();
    }
  }

  function configureEjsAttempt(game, core) {
    window.EJS_player = '#emulatorContainer';
    window.EJS_gameUrl = game.url || game.localUrl;
    window.EJS_core = core;
    window.EJS_threads = false;
    window.EJS_pathtodata = 'https://cdn.emulatorjs.org/stable/data/';
    window.EJS_color = '#7c3aed';
    window.EJS_gameName = getGameSaveKey(game);
    window.EJS_defaultOptions = { 'save-state-location': 'browser' };
    window.EJS_startOnLoaded = true;
  }

  async function tryEjsCore(game, core, index, total, token) {
    await teardownAttempt();
    if (token !== probeToken) return false;

    setArcadeStatus(game, `${game.name || 'Arcade'} · testando ${candidateLabel(core)} (${index + 1}/${total})`);
    configureEjsAttempt(game, core);

    return new Promise(resolve => {
      let settled = false;
      let timer = null;

      const finish = (success, reason = '') => {
        if (settled) return;
        settled = true;
        if (timer) clearTimeout(timer);
        if (!success) {
          console.warn(`[Lux Arcade] ${core} não iniciou ${game.name || gameIdentity(game)}: ${reason || 'falha desconhecida'}`);
        }
        resolve(success);
      };

      window.EJS_onGameStart = async () => {
        if (token !== probeToken || settled) return;
        await sleep(900);
        if (token !== probeToken || settled) return;
        finish(true);
        await finishSuccessfulStart(game, core, 'emulatorjs');
      };

      const script = document.createElement('script');
      script.id = 'ejs-script';
      script.src = 'https://cdn.emulatorjs.org/stable/data/loader.js';
      script.async = true;
      script.onerror = () => finish(false, 'loader.js não carregou');
      timer = setTimeout(
        () => finish(false, `timeout após ${Math.round(EJS_ATTEMPT_TIMEOUT_MS / 1000)}s`),
        EJS_ATTEMPT_TIMEOUT_MS
      );
      document.body.appendChild(script);
    });
  }

  async function tryCandidate(game, candidate, index, total, token) {
    if (candidate.startsWith(ENGINE_PREFIX)) {
      return tryNostalgistCore(game, candidate, index, total, token);
    }
    return tryEjsCore(game, candidate, index, total, token);
  }

  async function runArcadeProbe(game) {
    const token = ++probeToken;
    document.getElementById('emulatorIntro')?.classList.add('hidden');

    const candidates = orderedCandidates(game);
    const remembered = readPreferredCore(game);
    console.info('[Lux Arcade] Procurando motor compatível v5.', {
      game: game.name || gameIdentity(game),
      romFile: romFileName(game),
      remembered: remembered || null,
      candidates: candidates.map(candidateLabel)
    });

    for (let index = 0; index < candidates.length; index += 1) {
      const candidate = candidates[index];
      const success = await tryCandidate(game, candidate, index, candidates.length, token);
      if (token !== probeToken) return;
      if (success) return;
      if (remembered && candidate === remembered) clearPreferredCore(game);
    }

    await teardownAttempt();
    if (token !== probeToken) return;

    setArcadeStatus(game, game.name || 'Arcade');
    const container = document.getElementById('emulatorContainer');
    if (container) {
      container.innerHTML = `
        <div class="flex h-full min-h-[260px] items-center justify-center p-6 text-center">
          <div class="max-w-md rounded-2xl border border-rose-900/50 bg-rose-950/20 p-5 text-rose-100">
            <p class="font-bold">Nenhum motor Arcade conseguiu iniciar esta ROM.</p>
            <p class="mt-2 text-xs text-rose-200/80">Testados: ${CORE_CANDIDATES.map(candidateLabel).join(', ')}.</p>
            <p class="mt-2 text-[10px] text-rose-200/60">Agora o Lux força o ZIP como conteúdo do RetroArch; se todos recusarem, o próximo suspeito é incompatibilidade de romset/parent/BIOS.</p>
          </div>
        </div>`;
    }
  }

  function install() {
    if (installed || window.__luxArcadeCoreAutodetectVersion === VERSION) return true;
    if (typeof window.startEmulatorSession !== 'function') return false;

    const originalStart = window.startEmulatorSession;
    const patchedStart = function (...args) {
      let game = null;
      try { game = typeof pendingEmulatorGame !== 'undefined' ? pendingEmulatorGame : null; } catch (_) {}
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
        stopNostalgist().catch(() => {});
        return originalClose.apply(this, args);
      };
      patchedClose.__luxArcadeCoreAutodetect = VERSION;
      patchedClose.__luxArcadeCoreAutodetectOriginal = originalClose;
      window.closeGameEmulator = patchedClose;
    }

    window.LuxArcadeCores = {
      version: VERSION,
      cores: [...CORE_CANDIDATES],
      labels: CORE_CANDIDATES.map(candidateLabel),
      preferred: readPreferredCore,
      clear: clearPreferredCore,
      forget(game) { clearPreferredCore(game); },
      identify: gameIdentity,
      romFileName,
      engine() { return activeNostalgist ? 'nostalgist' : 'emulatorjs'; }
    };

    installed = true;
    window.__luxArcadeCoreAutodetectVersion = VERSION;
    console.info('[Lux Arcade] Detecção automática v5 ativa.', CORE_CANDIDATES.map(candidateLabel));
    return true;
  }

  if (!install()) {
    const interval = setInterval(() => {
      if (install()) clearInterval(interval);
    }, 50);
    setTimeout(() => clearInterval(interval), 15000);
  }
})();