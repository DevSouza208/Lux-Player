(() => {
  'use strict';

  if (!window.matchMedia('(max-width: 767px)').matches || window.__luxConsoleMobileStage1Installed) return;
  window.__luxConsoleMobileStage1Installed = true;

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

    // On iOS/Safari the EmulatorJS resume button needs to receive the real user
    // gesture. Starting the loader here removes Lux's extra confirmation, so the
    // only tap the user makes is on the EmulatorJS action styled as Lux "JOGAR".
    modal.dataset.luxMobileSessionStarted = '1';
    window.startEmulatorSession();
  };

  const applyStage1 = () => {
    const modal = document.getElementById('emulatorModal');
    if (!modal) return false;
    modal.classList.add('lux-console-mobile-stage1');
    document.body.classList.add('lux-console-open');
    startMobileSessionOnce(modal);
    polishSafariResumePopup();
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

  observer.observe(document.body, { childList: true, subtree: true });
  applyStage1();
})();
