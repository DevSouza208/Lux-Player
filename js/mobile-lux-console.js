(() => {
  'use strict';

  if (!window.matchMedia('(max-width: 767px)').matches || window.__luxConsoleMobileStage1Installed) return;
  window.__luxConsoleMobileStage1Installed = true;

  const DIRECTION_INDEX = { up: 4, down: 5, left: 6, right: 7 };
  const activePointers = new Map();

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

  const ensureDpad = modal => {
    if (!modal) return null;
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
      modal.appendChild(dpad);
      dpad.querySelectorAll('[data-direction]').forEach(bindDpadButton);
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

    // On iOS/Safari the EmulatorJS resume button needs to receive the real user
    // gesture. Starting the loader here removes Lux's extra confirmation, so the
    // only tap the user makes is on the EmulatorJS action styled as Lux "JOGAR".
    modal.dataset.luxMobileSessionStarted = '1';
    window.startEmulatorSession();
    wrapGameStartForDpad();
  };

  const applyStage1 = () => {
    const modal = document.getElementById('emulatorModal');
    if (!modal) return false;
    modal.classList.add('lux-console-mobile-stage1');
    document.body.classList.add('lux-console-open');
    ensureDpad(modal);
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
