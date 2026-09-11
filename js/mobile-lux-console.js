(() => {
  'use strict';

  if (!window.matchMedia('(max-width: 767px)').matches || window.__luxConsoleMobileStage1Installed) return;
  window.__luxConsoleMobileStage1Installed = true;

  const consoleLayouts = {
    gba: { shoulders: ['L', 'R'], face: ['B', 'A'], start: true, select: true },
    gb: { shoulders: [], face: ['B', 'A'], start: true, select: true },
    gbc: { shoulders: [], face: ['B', 'A'], start: true, select: true },
    nes: { shoulders: [], face: ['B', 'A'], start: true, select: true },
    snes: { shoulders: ['L', 'R'], face: ['Y', 'X', 'B', 'A'], start: true, select: true },
    megadrive: { shoulders: [], face: ['X', 'Y', 'Z', 'A', 'B', 'C'], start: true, select: false, sixFace: true },
    genesis: { shoulders: [], face: ['X', 'Y', 'Z', 'A', 'B', 'C'], start: true, select: false, sixFace: true },
    n64: { shoulders: ['L', 'Z', 'R'], face: ['B', 'A'], cButtons: true, start: true, select: false, analog: true }
  };

  const getCurrentConsole = () => {
    try {
      if (typeof activeEmulatorGame !== 'undefined' && activeEmulatorGame?.console) return String(activeEmulatorGame.console).toLowerCase();
      if (typeof pendingEmulatorGame !== 'undefined' && pendingEmulatorGame?.console) return String(pendingEmulatorGame.console).toLowerCase();
    } catch (_) {}
    const fallback = document.getElementById('emulatorIntroConsole')?.textContent || '';
    return fallback.trim().toLowerCase().replaceAll(' ', '');
  };

  const visualButton = (label, className, extra = '') => `<button type="button" class="lux-hud-control ${className}" disabled tabindex="-1" aria-hidden="true" ${extra}>${label}</button>`;

  const renderShoulders = layout => {
    if (!layout.shoulders?.length) return '';
    return `<div class="lux-hud-shoulders lux-hud-shoulders-${layout.shoulders.length}">${layout.shoulders.map((label, index) => visualButton(label, `lux-hud-shoulder lux-hud-shoulder-${index + 1}`)).join('')}</div>`;
  };

  const renderFaceButtons = layout => {
    const className = layout.sixFace ? 'lux-hud-face lux-hud-face-six' : `lux-hud-face lux-hud-face-${layout.face.length}`;
    return `<div class="${className}">${layout.face.map((label, index) => visualButton(label, `lux-hud-face-button lux-hud-face-button-${index + 1}`)).join('')}</div>`;
  };

  const renderCButtons = layout => layout.cButtons ? `<div class="lux-hud-c-buttons" aria-hidden="true">
    ${visualButton('▲', 'lux-hud-c lux-hud-c-up')}
    ${visualButton('◀', 'lux-hud-c lux-hud-c-left')}
    ${visualButton('▶', 'lux-hud-c lux-hud-c-right')}
    ${visualButton('▼', 'lux-hud-c lux-hud-c-down')}
  </div>` : '';

  const renderAnalog = layout => layout.analog ? `<div class="lux-hud-analog" aria-hidden="true"><span></span></div>` : '';

  const renderCenterButtons = layout => {
    const buttons = [];
    if (layout.select) buttons.push(visualButton('SELECT', 'lux-hud-system lux-hud-select'));
    if (layout.start) buttons.push(visualButton('START', 'lux-hud-system lux-hud-start'));
    return buttons.length ? `<div class="lux-hud-system-row">${buttons.join('')}</div>` : '';
  };

  const ensureHud = modal => {
    if (!modal) return null;
    const type = getCurrentConsole() || 'gba';
    const layout = consoleLayouts[type] || consoleLayouts.gba;
    let hud = document.getElementById('luxConsoleHud');
    if (hud && hud.dataset.console === type) return hud;
    hud?.remove();

    hud = document.createElement('div');
    hud.id = 'luxConsoleHud';
    hud.className = `lux-console-hud lux-console-hud-${type}`;
    hud.dataset.console = type;
    hud.setAttribute('aria-hidden', 'true');
    hud.innerHTML = `
      ${renderShoulders(layout)}
      <div class="lux-hud-dpad" aria-hidden="true">
        ${visualButton('▲', 'lux-hud-dpad-button lux-hud-dpad-up')}
        ${visualButton('◀', 'lux-hud-dpad-button lux-hud-dpad-left')}
        <span class="lux-hud-dpad-center"></span>
        ${visualButton('▶', 'lux-hud-dpad-button lux-hud-dpad-right')}
        ${visualButton('▼', 'lux-hud-dpad-button lux-hud-dpad-down')}
      </div>
      ${renderAnalog(layout)}
      ${renderFaceButtons(layout)}
      ${renderCButtons(layout)}
      ${renderCenterButtons(layout)}
      <button type="button" class="lux-hud-menu" disabled tabindex="-1" aria-hidden="true"><span>◆</span></button>
    `;
    modal.appendChild(hud);
    return hud;
  };

  const syncHudVisibility = () => {
    const hud = document.getElementById('luxConsoleHud');
    if (!hud) return;
    const intro = document.getElementById('emulatorIntro');
    const introVisible = !!intro && !intro.classList.contains('hidden');
    const resumeVisible = [...document.querySelectorAll('#emulatorContainer .lux-ejs-resume-popup')].some(popup => getComputedStyle(popup).display !== 'none');
    hud.classList.toggle('lux-console-hud-hidden', introVisible || resumeVisible);
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

  const startMobileSessionOnce = modal => {
    if (!modal || modal.dataset.luxMobileSessionStarted === '1') return;
    const intro = document.getElementById('emulatorIntro');
    if (!intro || intro.classList.contains('hidden')) return;
    if (typeof window.startEmulatorSession !== 'function') return;

    modal.dataset.luxMobileSessionStarted = '1';
    window.startEmulatorSession();
  };

  const applyStage1 = () => {
    const modal = document.getElementById('emulatorModal');
    if (!modal) return false;
    modal.classList.add('lux-console-mobile-stage1');
    document.body.classList.add('lux-console-open');
    ensureHud(modal);
    startMobileSessionOnce(modal);
    polishSafariResumePopup();
    syncHudVisibility();
    return true;
  };

  const cleanup = () => {
    if (!document.getElementById('emulatorModal')) {
      document.body.classList.remove('lux-console-open');
    }
  };

  const observer = new MutationObserver(() => {
    if (!applyStage1()) cleanup();
  });

  observer.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['class', 'style'] });
  applyStage1();
})();
