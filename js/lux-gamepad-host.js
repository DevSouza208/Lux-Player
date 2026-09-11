(() => {
  'use strict';

  const state = { code: null };

  function randomCode() {
    let code = '';
    do {
      code = String(Math.floor(100000 + Math.random() * 900000));
    } while (/^(123456|654321|111111|222222|333333|444444|555555|666666|777777|888888|999999|000000)$/.test(code));
    return code;
  }

  function ensureCode() {
    if (!state.code) state.code = randomCode();
    return state.code;
  }

  function controllerUrl() {
    return `${location.origin}/controller/?code=${ensureCode()}`;
  }

  function closeLuxGamepadSetup() {
    document.getElementById('luxGamepadSetupModal')?.remove();
  }

  function copyControllerLink() {
    const url = controllerUrl();
    navigator.clipboard?.writeText(url).then(() => {
      const status = document.getElementById('luxGamepadCopyStatus');
      if (status) status.textContent = 'Link copiado.';
    }).catch(() => {
      prompt('Copie o link do Lux Controller:', url);
    });
  }

  function regenerateLuxGamepadSession() {
    state.code = randomCode();
    renderModalValues();
  }

  function renderModalValues() {
    const code = ensureCode();
    const codeEl = document.getElementById('luxGamepadRoomCode');
    const linkEl = document.getElementById('luxGamepadControllerLink');
    if (codeEl) codeEl.textContent = `${code.slice(0, 3)} ${code.slice(3)}`;
    if (linkEl) linkEl.value = controllerUrl();
  }

  function openLuxGamepadSetup() {
    closeLuxGamepadSetup();
    const modal = document.createElement('div');
    modal.id = 'luxGamepadSetupModal';
    modal.className = 'fixed inset-0 z-[70] flex items-center justify-center bg-black/80 backdrop-blur-md p-4';
    modal.innerHTML = `
      <div class="w-full max-w-lg rounded-3xl border border-purple-800/60 bg-[#120c1f] p-6 shadow-2xl">
        <div class="flex items-start justify-between gap-4">
          <div>
            <p class="text-[10px] font-bold uppercase tracking-[0.18em] text-purple-400">Lux Controller</p>
            <h2 class="mt-1 text-xl font-black text-white">Configurar gamepads</h2>
            <p class="mt-1 text-xs text-purple-300/70">Use o celular como controle. A conexão real com o emulador entra na próxima etapa.</p>
          </div>
          <button onclick="closeLuxGamepadSetup()" class="rounded-xl bg-purple-950/60 p-2 text-purple-300 hover:bg-rose-600 hover:text-white" aria-label="Fechar">✕</button>
        </div>

        <div class="mt-5 rounded-2xl border border-purple-800/50 bg-[#0d0817] p-5 text-center">
          <p class="text-[10px] font-bold uppercase tracking-widest text-purple-400">Código da sessão</p>
          <div id="luxGamepadRoomCode" class="mt-2 text-4xl font-black tracking-[0.20em] text-white"></div>
          <p class="mt-2 text-[11px] text-purple-300/60">A sessão continuará válida enquanto o Lux Play estiver aberto.</p>
        </div>

        <div class="mt-4 grid grid-cols-2 gap-3">
          <div class="rounded-2xl border border-purple-900/50 bg-purple-950/30 p-4"><span class="text-xs font-bold text-white">Jogador 1</span><p class="mt-1 text-[11px] text-purple-400">⚪ Aguardando controle</p></div>
          <div class="rounded-2xl border border-purple-900/50 bg-purple-950/30 p-4"><span class="text-xs font-bold text-white">Jogador 2</span><p class="mt-1 text-[11px] text-purple-400">⚪ Aguardando controle</p></div>
        </div>

        <label class="mt-4 block text-[10px] font-bold uppercase tracking-wide text-purple-400">Link do controle</label>
        <div class="mt-1 flex gap-2">
          <input id="luxGamepadControllerLink" readonly class="min-w-0 flex-1 rounded-xl border border-purple-900/60 bg-[#0d0817] px-3 py-2 text-xs text-purple-200 outline-none">
          <button onclick="copyControllerLink()" class="rounded-xl border border-purple-700/60 bg-purple-950/60 px-3 py-2 text-xs font-bold text-purple-200 hover:bg-purple-800">Copiar</button>
        </div>
        <p id="luxGamepadCopyStatus" class="mt-1 h-4 text-[10px] text-emerald-300"></p>

        <div class="mt-4 flex flex-wrap gap-2">
          <button onclick="window.open(controllerUrl(), '_blank', 'noopener')" class="flex-1 rounded-xl bg-purple-600 px-4 py-3 text-xs font-bold text-white hover:bg-purple-500">Abrir Lux Controller</button>
          <button onclick="regenerateLuxGamepadSession()" class="rounded-xl border border-purple-800/60 bg-purple-950/50 px-4 py-3 text-xs font-bold text-purple-200 hover:bg-purple-900">Novo código</button>
        </div>
      </div>`;
    modal.addEventListener('click', event => { if (event.target === modal) closeLuxGamepadSetup(); });
    document.body.appendChild(modal);
    renderModalValues();
  }

  function injectButton() {
    const games = document.getElementById('gamesSection');
    if (!games || document.getElementById('luxGamepadSetupBtn')) return;
    const consoleFilter = [...games.querySelectorAll('select')].find(select => (select.getAttribute('onchange') || '').includes("setGamesFilter('console'"));
    if (!consoleFilter) return;
    const button = document.createElement('button');
    button.id = 'luxGamepadSetupBtn';
    button.type = 'button';
    button.onclick = openLuxGamepadSetup;
    button.className = 'bg-purple-600 hover:bg-purple-500 border border-purple-400/40 text-white rounded-lg px-3 py-1.5 text-[11px] font-bold transition-colors flex items-center gap-1.5';
    button.innerHTML = '<i data-lucide="smartphone" class="w-3.5 h-3.5"></i><span>Lux Gamepad</span>';
    consoleFilter.parentElement?.insertBefore(button, consoleFilter);
    window.lucide?.createIcons?.();
  }

  function init() {
    const games = document.getElementById('gamesSection');
    if (!games) return;
    injectButton();
    const observer = new MutationObserver(() => injectButton());
    observer.observe(games, { childList: true, subtree: true });
  }

  window.openLuxGamepadSetup = openLuxGamepadSetup;
  window.closeLuxGamepadSetup = closeLuxGamepadSetup;
  window.copyControllerLink = copyControllerLink;
  window.regenerateLuxGamepadSession = regenerateLuxGamepadSession;
  window.controllerUrl = controllerUrl;

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, { once: true });
  else init();
})();
