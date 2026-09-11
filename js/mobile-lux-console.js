(() => {
  'use strict';

  if (!window.matchMedia('(max-width: 767px)').matches || window.__luxConsoleMobileInstalled) return;
  window.__luxConsoleMobileInstalled = true;

  let emulatorObserver = null;
  let bodyObserver = null;

  const modal = () => document.getElementById('emulatorModal');
  const container = () => document.getElementById('emulatorContainer');

  function classifyNativeButton(button) {
    if (!button || button.dataset.luxConsoleClassified === '1') return;
    const raw = (button.textContent || '').trim();
    const info = `${button.title || ''} ${button.getAttribute?.('aria-label') || ''} ${raw}`.trim();

    if (/^ESQ$/i.test(raw)) button.textContent = 'L';
    if (/^DIR$/i.test(raw)) button.textContent = 'R';

    const text = (button.textContent || '').trim();
    const set = name => button.classList.add(name);

    if (/^L$/i.test(text)) set('lux-console-L');
    else if (/^R$/i.test(text)) set('lux-console-R');
    else if (/^A$/i.test(text)) set('lux-console-A');
    else if (/^B$/i.test(text)) set('lux-console-B');
    else if (/^select$/i.test(text)) set('lux-console-select');
    else if (/^start$/i.test(text)) set('lux-console-start');
    else if (/^(▲|↑)$/i.test(text) || /\bup\b/i.test(info)) set('lux-console-up');
    else if (/^(▼|↓)$/i.test(text) || /\bdown\b/i.test(info)) set('lux-console-down');
    else if (/^(◀|←)$/i.test(text) || /\bleft\b/i.test(info)) set('lux-console-left');
    else if (/^(▶|→)$/i.test(text) || /\bright\b/i.test(info)) set('lux-console-right');

    button.dataset.luxConsoleClassified = '1';
  }

  function skinNativeControls() {
    const root = container();
    if (!root) return;
    root.querySelectorAll('button').forEach(classifyNativeButton);
  }

  function addBranding(host) {
    const panel = host.firstElementChild;
    const header = panel?.firstElementChild;
    if (!panel || !header) return;

    panel.classList.add('lux-console-panel');
    header.classList.add('lux-console-header');
    panel.children?.[1]?.classList.add('lux-console-screen');
    panel.lastElementChild?.classList.add('lux-console-footer');

    if (!header.querySelector('.lux-console-brand')) {
      const brand = document.createElement('div');
      brand.className = 'lux-console-brand';
      brand.innerHTML = '<span class="lux-console-mark">L</span><span><strong>LUX</strong> CONSOLE</span>';
      header.appendChild(brand);
    }

    if (!panel.querySelector('.lux-console-led')) {
      const led = document.createElement('span');
      led.className = 'lux-console-led';
      led.setAttribute('aria-hidden', 'true');
      panel.appendChild(led);
    }

    if (!panel.querySelector('.lux-console-speaker-left')) {
      const left = document.createElement('span');
      left.className = 'lux-console-speaker lux-console-speaker-left';
      left.setAttribute('aria-hidden', 'true');
      panel.appendChild(left);
      const right = document.createElement('span');
      right.className = 'lux-console-speaker lux-console-speaker-right';
      right.setAttribute('aria-hidden', 'true');
      panel.appendChild(right);
    }

    if (!header.querySelector('.lux-console-quick-actions')) {
      const actions = document.createElement('div');
      actions.className = 'lux-console-quick-actions';
      actions.innerHTML = `
        <button type="button" class="lux-console-quick" data-lux-console-action="controls" aria-label="Configurações de controles" title="Controles">⚙</button>
        <button type="button" class="lux-console-quick lux-console-power" data-lux-console-action="exit" aria-label="Salvar e sair" title="Salvar e sair">⏻</button>`;
      header.appendChild(actions);
      actions.querySelector('[data-lux-console-action="controls"]').onclick = () => {
        if (typeof openEmulatorControls === 'function') openEmulatorControls();
      };
      actions.querySelector('[data-lux-console-action="exit"]').onclick = () => {
        if (typeof requestCloseGameEmulator === 'function') requestCloseGameEmulator();
      };
    }
  }

  function decorate() {
    const host = modal();
    if (!host) return false;
    host.classList.add('lux-console-mobile');
    document.body.classList.add('lux-console-open');
    addBranding(host);
    skinNativeControls();

    emulatorObserver?.disconnect();
    const root = container();
    if (root) {
      emulatorObserver = new MutationObserver(() => skinNativeControls());
      emulatorObserver.observe(root, { childList: true, subtree: true });
    }
    return true;
  }

  function cleanup() {
    emulatorObserver?.disconnect();
    emulatorObserver = null;
    document.body.classList.remove('lux-console-open');
  }

  bodyObserver = new MutationObserver(() => {
    if (modal()) decorate();
    else cleanup();
  });
  bodyObserver.observe(document.body, { childList: true, subtree: true });

  window.addEventListener('orientationchange', () => setTimeout(skinNativeControls, 180));
  decorate();
})();
