(() => {
  'use strict';

  if (!window.matchMedia('(max-width: 767px)').matches || window.__luxMobileEmulatorPolish) return;
  window.__luxMobileEmulatorPolish = true;

  const container = () => document.getElementById('emulatorContainer');
  const menu = () => document.querySelector('.lux-mobile-game-menu');
  let observer = null;

  const meta = el => `${el?.title || ''} ${el?.getAttribute?.('aria-label') || ''} ${el?.textContent || ''}`.trim();
  const buttons = () => [...(container()?.querySelectorAll('button, .ejs_menu_button') || [])];

  function classifyButton(button) {
    if (!button || button.closest('.lux-mobile-game-menu')) return;
    const raw = (button.textContent || '').trim();
    const info = meta(button);

    if (/^ESQ$/i.test(raw)) button.textContent = 'L';
    if (/^DIR$/i.test(raw)) button.textContent = 'R';

    const text = (button.textContent || '').trim();
    button.classList.toggle('lux-touch-L', /^L$/i.test(text));
    button.classList.toggle('lux-touch-R', /^R$/i.test(text));
    button.classList.toggle('lux-touch-A', /^A$/i.test(text));
    button.classList.toggle('lux-touch-B', /^B$/i.test(text));
    button.classList.toggle('lux-touch-select', /^select$/i.test(text));
    button.classList.toggle('lux-touch-start', /^start$/i.test(text));
    button.classList.toggle('lux-touch-up', /^(▲|↑)$/i.test(text) || /\bup\b/i.test(info));
    button.classList.toggle('lux-touch-down', /^(▼|↓)$/i.test(text) || /\bdown\b/i.test(info));
    button.classList.toggle('lux-touch-left', /^(◀|←)$/i.test(text) || /\bleft\b/i.test(info));
    button.classList.toggle('lux-touch-right', /^(▶|→)$/i.test(text) || /\bright\b/i.test(info));

    if (/^(Rápido|Rapido|Lento)$/i.test(text) || /fast\s*forward|slow\s*motion/i.test(info)) {
      button.classList.add('lux-native-speed-hidden');
    }
  }

  function markSurface() {
    const root = container();
    if (!root) return;
    root.querySelectorAll('canvas, video').forEach(surface => {
      surface.classList.add('lux-mobile-game-surface');
      if (surface.parentElement && surface.parentElement !== root) surface.parentElement.classList.add('lux-mobile-game-surface-wrap');
    });
  }

  function normalizeNativeUi() {
    const root = container();
    if (!root) return;
    buttons().forEach(classifyButton);
    markSurface();
  }

  function findNative(patterns) {
    for (const pattern of patterns) {
      const found = buttons().find(button => pattern.test(meta(button)));
      if (found) return found;
    }
    return null;
  }

  function clickNative(patterns, fallbackMessage) {
    normalizeNativeUi();
    const target = findNative(patterns);
    if (target) {
      target.click();
      return true;
    }
    if (fallbackMessage) alert(fallbackMessage);
    return false;
  }

  function closeLuxMenuWithoutResume() {
    const overlay = menu();
    if (!overlay) return;
    overlay.hidden = true;
    document.body.classList.remove('lux-mobile-overlay-open');
  }

  function polishLuxMenu() {
    const actions = document.querySelector('.lux-mobile-game-menu .lux-mobile-game-actions');
    if (!actions || actions.dataset.luxPolished === '1') return;
    actions.dataset.luxPolished = '1';
    actions.innerHTML = `
      <button type="button" class="primary" data-game-action="resume"><i data-lucide="play"></i> Continuar</button>
      <button type="button" data-lux-emulator-action="save"><i data-lucide="save"></i> Salvar jogo</button>
      <button type="button" data-lux-emulator-action="load"><i data-lucide="folder-open"></i> Carregar jogo</button>
      <button type="button" data-game-action="fast"><i data-lucide="fast-forward"></i> <span>Fast-forward</span></button>
      <button type="button" data-lux-emulator-action="cheats"><i data-lucide="sparkles"></i> Trapaças</button>
      <button type="button" data-lux-emulator-action="settings"><i data-lucide="settings"></i> Configurações</button>
      <button type="button" data-lux-emulator-action="reset"><i data-lucide="rotate-ccw"></i> Reiniciar</button>
      <button type="button" class="danger" data-game-action="exit"><i data-lucide="log-out"></i> Sair do jogo</button>`;
    try { window.lucide?.createIcons?.(); } catch (_) {}
  }

  function handleLuxAction(event) {
    const button = event.target.closest('[data-lux-emulator-action]');
    if (!button) return;
    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation();
    const action = button.dataset.luxEmulatorAction;
    closeLuxMenuWithoutResume();

    if (action === 'save') {
      clickNative([/armazenar\s+save\s*state/i, /store\s+save\s*state/i, /save\s*state/i, /salvar/i], 'A opção de salvar ainda não apareceu no emulador. Tente novamente em alguns segundos.');
      return;
    }
    if (action === 'load') {
      clickNative([/carregar\s+save\s*state/i, /load\s+save\s*state/i, /load\s*state/i, /carregar/i], 'Nenhum controle de carregamento foi encontrado ainda.');
      return;
    }
    if (action === 'cheats') {
      clickNative([/trapaç/i, /cheat/i], 'Este núcleo não disponibilizou o painel de trapaças.');
      return;
    }
    if (action === 'settings') {
      clickNative([/^ajustes$/i, /settings/i, /configura/i, /controles?/i, /controls?/i], 'As configurações do emulador ainda não ficaram disponíveis.');
      return;
    }
    if (action === 'reset') {
      clickNative([/^reset$/i, /reiniciar/i], 'O comando de reinício ainda não ficou disponível.');
    }
  }

  function attach() {
    const root = container();
    if (!root) return false;
    normalizeNativeUi();
    polishLuxMenu();
    observer?.disconnect();
    observer = new MutationObserver(() => {
      normalizeNativeUi();
      polishLuxMenu();
    });
    observer.observe(root, { childList: true, subtree: true, characterData: true });
    return true;
  }

  document.addEventListener('click', handleLuxAction, true);
  window.addEventListener('orientationchange', () => setTimeout(normalizeNativeUi, 180));
  window.addEventListener('resize', () => setTimeout(normalizeNativeUi, 80));

  new MutationObserver(() => {
    if (document.getElementById('emulatorModal')) attach();
    else { observer?.disconnect(); observer = null; }
  }).observe(document.body, { childList: true, subtree: true });

  attach();
})();
