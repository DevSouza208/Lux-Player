(() => {
  'use strict';

  if (!window.matchMedia("(max-width: 767px), (orientation: landscape) and (max-width: 1280px) and (max-height: 600px) and (pointer: coarse)").matches || window.__luxConsoleMobileStage1Installed) return;
  window.__luxConsoleMobileStage1Installed = true;

  const VIEW_MODE_KEY = 'lux-play:console-view-mode';

  const RETROPAD = {
    B: 0, Y: 1, SELECT: 2, START: 3,
    UP: 4, DOWN: 5, LEFT: 6, RIGHT: 7,
    A: 8, X: 9, L: 10, R: 11, L2: 12, R2: 13, L3: 14, R3: 15
  };

  const SYSTEM_LAYOUTS = {
    gba: {
      shoulders: [['L', RETROPAD.L], ['R', RETROPAD.R]],
      face: [['B', RETROPAD.B], ['A', RETROPAD.A]],
      system: [['SELECT', RETROPAD.SELECT], ['START', RETROPAD.START]]
    },
    gb: {
      shoulders: [],
      face: [['B', RETROPAD.B], ['A', RETROPAD.A]],
      system: [['SELECT', RETROPAD.SELECT], ['START', RETROPAD.START]]
    },
    gbc: {
      shoulders: [],
      face: [['B', RETROPAD.B], ['A', RETROPAD.A]],
      system: [['SELECT', RETROPAD.SELECT], ['START', RETROPAD.START]]
    },
    nes: {
      shoulders: [],
      face: [['B', RETROPAD.B], ['A', RETROPAD.A]],
      system: [['SELECT', RETROPAD.SELECT], ['START', RETROPAD.START]]
    },
    snes: {
      shoulders: [['L', RETROPAD.L], ['R', RETROPAD.R]],
      face: [['Y', RETROPAD.Y], ['X', RETROPAD.X], ['B', RETROPAD.B], ['A', RETROPAD.A]],
      system: [['SELECT', RETROPAD.SELECT], ['START', RETROPAD.START]]
    },
    megadrive: {
      shoulders: [],
      face: [['X', 10], ['Y', 9], ['Z', 11], ['A', 1], ['B', 0], ['C', 8]],
      system: [['START', 3]]
    },
    genesis: {
      shoulders: [],
      face: [['X', 10], ['Y', 9], ['Z', 11], ['A', 1], ['B', 0], ['C', 8]],
      system: [['START', 3]]
    },
    n64: {
      shoulders: [['L', 10], ['Z', 12], ['R', 11]],
      face: [['B', 1], ['A', 0]],
      system: [['START', 3]]
    }
  };

  const activePointers = new Map();

  const layerDefinitions = [
    ['luxConsoleBackgroundLayer', 'lux-console-layer lux-console-background-layer'],
    ['luxConsoleBezelLayer', 'lux-console-layer lux-console-bezel-layer'],
    ['luxConsoleControlsLayer', 'lux-console-layer lux-console-controls-layer'],
    ['luxConsoleContextLayer', 'lux-console-layer lux-console-context-layer'],
    ['luxConsoleAlertsLayer', 'lux-console-layer lux-console-alerts-layer']
  ];

  const currentSystem = () => {
    let type = '';
    try {
      if (typeof activeEmulatorGame !== 'undefined' && activeEmulatorGame?.console) type = activeEmulatorGame.console;
      else if (typeof pendingEmulatorGame !== 'undefined' && pendingEmulatorGame?.console) type = pendingEmulatorGame.console;
    } catch (_) {}
    if (!type) type = document.getElementById('emulatorIntroConsole')?.textContent || 'gba';
    return String(type).toLowerCase().replaceAll(' ', '');
  };

  const storedViewMode = () => {
    try {
      return localStorage.getItem(VIEW_MODE_KEY) === 'fullscreen' ? 'fullscreen' : 'frame';
    } catch (_) {
      return 'frame';
    }
  };

  const ensureViewMode = modal => {
    if (!modal) return;
    const alreadySet = modal.classList.contains('lux-console-view-frame') || modal.classList.contains('lux-console-view-fullscreen');
    if (alreadySet) return;
    const mode = storedViewMode();
    modal.classList.add(mode === 'fullscreen' ? 'lux-console-view-fullscreen' : 'lux-console-view-frame');
    modal.dataset.luxViewMode = mode;
  };

  const sendInput = (index, pressed) => {
    const manager = window.EJS_emulator?.gameManager;
    if (typeof index !== 'number' || !manager || typeof manager.simulateInput !== 'function') return false;
    try {
      manager.simulateInput(0, index, pressed ? 1 : 0);
      return true;
    } catch (error) {
      console.warn('Lux Console: não foi possível enviar o input ao EmulatorJS.', error);
      return false;
    }
  };

  const releasePointer = pointerId => {
    const active = activePointers.get(pointerId);
    if (!active) return;
    activePointers.delete(pointerId);
    sendInput(active.index, false);
    active.element?.classList.remove('lux-control-pressed');
  };

  const releaseAllInputs = () => {
    [...activePointers.keys()].forEach(releasePointer);
  };

  const bindInputButton = button => {
    if (!button || button.dataset.luxBound === '1') return;
    button.dataset.luxBound = '1';
    const index = Number(button.dataset.inputIndex);
    if (!Number.isFinite(index)) return;

    button.addEventListener('pointerdown', event => {
      event.preventDefault();
      if (activePointers.has(event.pointerId)) return;
      activePointers.set(event.pointerId, { index, element: button });
      button.classList.add('lux-control-pressed');
      sendInput(index, true);
    });
  };

  const findPlayerFrame = modal => {
    if (!modal) return null;
    const tagged = [...modal.children].find(child => child.classList?.contains('lux-console-player-frame'));
    if (tagged) return tagged;
    return [...modal.children].find(child => child.querySelector?.('#emulatorContainer')) || null;
  };

  const ensureLayer = (modal, id, className) => {
    let layer = document.getElementById(id);
    if (!layer) {
      layer = document.createElement('div');
      layer.id = id;
      layer.className = className;
      layer.setAttribute('aria-hidden', 'true');
      modal.appendChild(layer);
    }
    return layer;
  };

  const ensureLayerSystem = modal => {
    if (!modal) return null;

    const frame = findPlayerFrame(modal);
    if (!frame) return null;
    frame.classList.add('lux-console-player-frame');

    const screenSlot = [...frame.children].find(child => child.classList?.contains('flex-1'));
    if (screenSlot) screenSlot.classList.add('lux-console-screen-layer');

    let background = document.getElementById('luxConsoleBackgroundLayer');
    if (!background) {
      background = document.createElement('div');
      background.id = 'luxConsoleBackgroundLayer';
      background.className = 'lux-console-layer lux-console-background-layer';
      background.setAttribute('aria-hidden', 'true');
      modal.insertBefore(background, frame);
    }

    layerDefinitions.slice(1).forEach(([id, className]) => ensureLayer(modal, id, className));

    const bezel = document.getElementById('luxConsoleBezelLayer');
    if (bezel && !bezel.querySelector('.lux-console-bezel-window')) {
      const windowEl = document.createElement('div');
      windowEl.className = 'lux-console-bezel-window';
      windowEl.setAttribute('aria-hidden', 'true');
      bezel.appendChild(windowEl);
    }

    if (bezel && !bezel.querySelector('.lux-console-header-brand')) {
      const header = document.createElement('div');
      header.className = 'lux-console-header-brand';
      header.setAttribute('aria-hidden', 'true');
      header.innerHTML = `
        <img src="lux-play-icon.svg" alt="">
        <span class="lux-console-header-wordmark"><strong>LUX</strong><em>PLAY</em></span>
        <small>LUX CONSOLE</small>
      `;
      bezel.appendChild(header);
    }

    return {
      frame,
      screen: screenSlot,
      background,
      bezel,
      controls: document.getElementById('luxConsoleControlsLayer'),
      context: document.getElementById('luxConsoleContextLayer'),
      alerts: document.getElementById('luxConsoleAlertsLayer')
    };
  };

  const renderInputButton = (label, index, className) =>
    `<button type="button" class="lux-game-control ${className}" data-input-index="${index}" aria-label="${label}"><span>${label}</span></button>`;

  const renderDpad = () => `
    <div id="luxConsoleDpad" class="lux-console-dpad" aria-label="Direcional do jogo">
      ${renderInputButton('▲', RETROPAD.UP, 'lux-dpad-button lux-dpad-up')}
      ${renderInputButton('◀', RETROPAD.LEFT, 'lux-dpad-button lux-dpad-left')}
      <span class="lux-dpad-center" aria-hidden="true"><span></span></span>
      ${renderInputButton('▶', RETROPAD.RIGHT, 'lux-dpad-button lux-dpad-right')}
      ${renderInputButton('▼', RETROPAD.DOWN, 'lux-dpad-button lux-dpad-down')}
    </div>`;

  const renderShoulders = layout => {
    if (!layout.shoulders.length) return '';
    return `<div class="lux-console-shoulders lux-console-shoulders-${layout.shoulders.length}">${layout.shoulders
      .map(([label, index], position) => renderInputButton(label, index, `lux-shoulder lux-shoulder-${position + 1}`))
      .join('')}</div>`;
  };

  const renderFace = layout => {
    const count = layout.face.length;
    return `<div class="lux-console-face lux-console-face-${count}">${layout.face
      .map(([label, index], position) => renderInputButton(label, index, `lux-face-button lux-face-button-${position + 1}`))
      .join('')}</div>`;
  };

  const renderSystemButtons = layout => {
    if (!layout.system.length) return '';
    return `<div class="lux-console-system-buttons lux-console-system-buttons-${layout.system.length}">${layout.system
      .map(([label, index], position) => renderInputButton(label, index, `lux-system-button lux-system-button-${position + 1}`))
      .join('')}</div>`;
  };

  const renderBrandButton = () => `
    <button type="button" class="lux-console-brand-button" tabindex="-1" aria-hidden="true" disabled>
      <img src="lux-play-icon.svg" alt="">
    </button>`;

  const ensureGameplayControls = (modal, controlsLayer) => {
    if (!modal || !controlsLayer) return null;
    const system = currentSystem();
    const layout = SYSTEM_LAYOUTS[system] || SYSTEM_LAYOUTS.gba;

    [...modal.classList]
      .filter(name => name.startsWith('lux-console-system-'))
      .forEach(name => modal.classList.remove(name));
    modal.classList.add(`lux-console-system-${system}`);

    if (controlsLayer.dataset.system === system && controlsLayer.querySelector('#luxConsoleDpad')) return controlsLayer;

    releaseAllInputs();
    controlsLayer.dataset.system = system;
    controlsLayer.classList.add('lux-console-controls-hidden');
    controlsLayer.innerHTML = `
      ${renderShoulders(layout)}
      ${renderBrandButton()}
      ${renderDpad()}
      ${renderFace(layout)}
      ${renderSystemButtons(layout)}
    `;
    controlsLayer.querySelectorAll('[data-input-index]').forEach(bindInputButton);
    return controlsLayer;
  };

  const showControls = () => {
    document.getElementById('luxConsoleControlsLayer')?.classList.remove('lux-console-controls-hidden');
  };

  const hideControls = () => {
    releaseAllInputs();
    document.getElementById('luxConsoleControlsLayer')?.classList.add('lux-console-controls-hidden');
  };

  const polishSafariResumePopup = () => {
    document.querySelectorAll('#emulatorContainer .ejs_popup_container').forEach(popup => {
      const button = popup.querySelector('.ejs_menu_button');
      const title = popup.querySelector('h4');
      if (!button) return;

      const buttonText = (button.textContent || '').trim();
      const titleText = (title?.textContent || '').trim();
      const looksLikeResume = /resume|continuar|retomar|emulador|emulator/i.test(buttonText);
      const emptyPopupTitle = !titleText || /^undefined$/i.test(titleText);
      if (!looksLikeResume && !emptyPopupTitle) return;

      popup.classList.add('lux-ejs-resume-popup');
      if (title) title.textContent = '';
      if (button.dataset.luxResumeLabel !== '1') {
        button.dataset.luxResumeLabel = '1';
        button.textContent = '▶ JOGAR';
      }
    });
  };

  const wrapGameStartForControls = () => {
    const original = window.EJS_onGameStart;
    if (original?.__luxControlsWrapped) return;
    const wrapped = (...args) => {
      try { original?.(...args); }
      finally { showControls(); }
    };
    wrapped.__luxControlsWrapped = true;
    window.EJS_onGameStart = wrapped;
  };

  const startMobileSessionOnce = modal => {
    if (!modal || modal.dataset.luxMobileSessionStarted === '1') return;
    const intro = document.getElementById('emulatorIntro');
    if (!intro || intro.classList.contains('hidden')) return;
    if (typeof window.startEmulatorSession !== 'function') return;

    modal.dataset.luxMobileSessionStarted = '1';
    window.startEmulatorSession();
    wrapGameStartForControls();
  };

  const applyStage1 = () => {
    const modal = document.getElementById('emulatorModal');
    if (!modal) return false;

    modal.classList.add('lux-console-mobile-stage1');
    ensureViewMode(modal);
    document.body.classList.add('lux-console-open');

    const layers = ensureLayerSystem(modal);
    ensureGameplayControls(modal, layers?.controls);
    startMobileSessionOnce(modal);
    polishSafariResumePopup();
    return true;
  };

  const cleanup = () => {
    if (!document.getElementById('emulatorModal')) {
      hideControls();
      document.body.classList.remove('lux-console-open');
    }
  };

  const observer = new MutationObserver(() => {
    if (!applyStage1()) cleanup();
  });

  window.addEventListener('pointerup', event => releasePointer(event.pointerId), { passive: true });
  window.addEventListener('pointercancel', event => releasePointer(event.pointerId), { passive: true });
  window.addEventListener('blur', releaseAllInputs);
  document.addEventListener('visibilitychange', () => { if (document.hidden) releaseAllInputs(); });

  observer.observe(document.body, { childList: true, subtree: true });
  applyStage1();
})();
