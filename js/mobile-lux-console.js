(() => {
  'use strict';

  if (!window.matchMedia('(max-width: 767px)').matches || window.__luxConsoleMobileStage1Installed) return;
  window.__luxConsoleMobileStage1Installed = true;

  const DIRECTION_INDEX = { up: 4, down: 5, left: 6, right: 7 };
  const activePointers = new Map();

  const layerDefinitions = [
    ['luxConsoleBackgroundLayer', 'lux-console-layer lux-console-background-layer'],
    ['luxConsoleBezelLayer', 'lux-console-layer lux-console-bezel-layer'],
    ['luxConsoleControlsLayer', 'lux-console-layer lux-console-controls-layer'],
    ['luxConsoleContextLayer', 'lux-console-layer lux-console-context-layer'],
    ['luxConsoleAlertsLayer', 'lux-console-layer lux-console-alerts-layer']
  ];

  const sendDirection = (direction, pressed) => {
    const index = DIRECTION_INDEX[direction];
    const manager = window.EJS_emulator?.gameManager;
    if (typeof index !== 'number' || !manager || typeof manager.simulateInput !== 'function') return false;
    try {
      manager.simulateInput(0, index, pressed ? 1 : 0);
      return true;
    } catch (error) {
      console.warn('Lux D-pad: não foi possível enviar o input ao EmulatorJS.', error);
      return false;
    }
  };

  const releasePointer = pointerId => {
    const direction = activePointers.get(pointerId);
    if (!direction) return;
    activePointers.delete(pointerId);
    sendDirection(direction, false);
    document.querySelector(`#luxConsoleDpad [data-direction="${direction}"]`)?.classList.remove('lux-dpad-pressed');
  };

  const releaseAllDirections = () => {
    [...activePointers.keys()].forEach(releasePointer);
    Object.keys(DIRECTION_INDEX).forEach(direction => sendDirection(direction, false));
  };

  const bindDpadButton = button => {
    if (!button || button.dataset.luxBound === '1') return;
    button.dataset.luxBound = '1';
    const direction = button.dataset.direction;

    button.addEventListener('pointerdown', event => {
      event.preventDefault();
      if (!direction || activePointers.has(event.pointerId)) return;
      activePointers.set(event.pointerId, direction);
      button.classList.add('lux-dpad-pressed');
      sendDirection(direction, true);
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

  const ensureDpad = controlsLayer => {
    if (!controlsLayer) return null;
    let dpad = document.getElementById('luxConsoleDpad');
    if (!dpad) {
      dpad = document.createElement('div');
      dpad.id = 'luxConsoleDpad';
      dpad.className = 'lux-console-dpad lux-console-dpad-hidden';
      dpad.setAttribute('aria-label', 'Direcional do jogo');
      dpad.innerHTML = `
        <button type="button" class="lux-dpad-button lux-dpad-up" data-direction="up" aria-label="Cima"><span>▲</span></button>
        <button type="button" class="lux-dpad-button lux-dpad-left" data-direction="left" aria-label="Esquerda"><span>◀</span></button>
        <span class="lux-dpad-center" aria-hidden="true"><span></span></span>
        <button type="button" class="lux-dpad-button lux-dpad-right" data-direction="right" aria-label="Direita"><span>▶</span></button>
        <button type="button" class="lux-dpad-button lux-dpad-down" data-direction="down" aria-label="Baixo"><span>▼</span></button>
      `;
      controlsLayer.appendChild(dpad);
      dpad.querySelectorAll('[data-direction]').forEach(bindDpadButton);
    } else if (dpad.parentElement !== controlsLayer) {
      controlsLayer.appendChild(dpad);
    }
    return dpad;
  };

  const showDpad = () => {
    document.getElementById('luxConsoleDpad')?.classList.remove('lux-console-dpad-hidden');
  };

  const hideDpad = () => {
    releaseAllDirections();
    document.getElementById('luxConsoleDpad')?.classList.add('lux-console-dpad-hidden');
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

  const wrapGameStartForDpad = () => {
    const original = window.EJS_onGameStart;
    if (original?.__luxDpadWrapped) return;
    const wrapped = (...args) => {
      try { original?.(...args); }
      finally { showDpad(); }
    };
    wrapped.__luxDpadWrapped = true;
    window.EJS_onGameStart = wrapped;
  };

  const startMobileSessionOnce = modal => {
    if (!modal || modal.dataset.luxMobileSessionStarted === '1') return;
    const intro = document.getElementById('emulatorIntro');
    if (!intro || intro.classList.contains('hidden')) return;
    if (typeof window.startEmulatorSession !== 'function') return;

    modal.dataset.luxMobileSessionStarted = '1';
    window.startEmulatorSession();
    wrapGameStartForDpad();
  };

  const applyStage1 = () => {
    const modal = document.getElementById('emulatorModal');
    if (!modal) return false;

    modal.classList.add('lux-console-mobile-stage1');
    document.body.classList.add('lux-console-open');

    const layers = ensureLayerSystem(modal);
    ensureDpad(layers?.controls);
    startMobileSessionOnce(modal);
    polishSafariResumePopup();
    return true;
  };

  const cleanup = () => {
    if (!document.getElementById('emulatorModal')) {
      hideDpad();
      document.body.classList.remove('lux-console-open');
    }
  };

  const observer = new MutationObserver(() => {
    if (!applyStage1()) cleanup();
  });

  window.addEventListener('pointerup', event => releasePointer(event.pointerId), { passive: true });
  window.addEventListener('pointercancel', event => releasePointer(event.pointerId), { passive: true });
  window.addEventListener('blur', releaseAllDirections);
  document.addEventListener('visibilitychange', () => { if (document.hidden) releaseAllDirections(); });

  observer.observe(document.body, { childList: true, subtree: true });
  applyStage1();
})();
