(() => {
  'use strict';

  const VERSION = '20260915-game-local-cache1';
  const OVERLAY_ID = 'luxGameCacheOverlay';
  const STYLE_ID = 'luxGameCacheOverlayStyle';

  if (window.__luxGameLocalCacheFlow === VERSION) return;
  window.__luxGameLocalCacheFlow = VERSION;

  function currentGame() {
    try { return typeof currentGameDetails !== 'undefined' ? currentGameDetails : null; }
    catch (_) { return null; }
  }

  function normalizedConsole(game) {
    return String(game?.console || game?.consoleLabel || '')
      .toLowerCase()
      .replace(/[^a-z0-9]/g, '');
  }

  function isN64(game) {
    const value = normalizedConsole(game);
    return value === 'n64' || value === 'nintendo64';
  }

  function shouldAutoCache(game) {
    return !!(game && !game.external && !game.localUrl && game.url && window.LuxRomCache);
  }

  function ensureStyle() {
    if (document.getElementById(STYLE_ID)) return;
    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = `
      #${OVERLAY_ID}{position:fixed;inset:0;z-index:2147483400;display:flex;align-items:center;justify-content:center;padding:24px;background:#09060e;color:#fff}
      #${OVERLAY_ID}.hidden{display:none!important}
      #${OVERLAY_ID} .lux-game-cache-card{width:min(440px,100%);padding:30px 26px;border:1px solid rgba(126,34,206,.6);border-radius:28px;background:#120c1f;box-shadow:0 24px 70px rgba(0,0,0,.42);text-align:center}
      #${OVERLAY_ID} .lux-game-cache-icon{width:68px;height:68px;margin:0 auto 18px;border-radius:22px;display:grid;place-items:center;font-size:30px;background:rgba(147,51,234,.18);border:1px solid rgba(168,85,247,.28)}
      #${OVERLAY_ID} .lux-game-cache-title{font-size:20px;font-weight:900;letter-spacing:-.02em}
      #${OVERLAY_ID} .lux-game-cache-game{margin-top:5px;font-size:13px;color:#c4b5fd}
      #${OVERLAY_ID} .lux-game-cache-status{margin-top:22px;font-size:13px;font-weight:700;color:#e9d5ff}
      #${OVERLAY_ID} .lux-game-cache-track{height:8px;margin-top:12px;overflow:hidden;border-radius:999px;background:rgba(88,28,135,.42)}
      #${OVERLAY_ID} .lux-game-cache-bar{width:3%;height:100%;border-radius:inherit;background:linear-gradient(90deg,#7c3aed,#c084fc);transition:width .18s ease}
      #${OVERLAY_ID} .lux-game-cache-meta{margin-top:10px;font-size:11px;color:#a78bfa}
      #${OVERLAY_ID} .lux-game-cache-note{margin-top:20px;font-size:11px;line-height:1.55;color:#7e6b9f}
    `;
    document.head.appendChild(style);
  }

  function ensureOverlay(game) {
    ensureStyle();
    let overlay = document.getElementById(OVERLAY_ID);
    if (!overlay) {
      overlay = document.createElement('div');
      overlay.id = OVERLAY_ID;
      overlay.className = 'hidden';
      overlay.innerHTML = `
        <div class="lux-game-cache-card">
          <div class="lux-game-cache-icon">🎮</div>
          <div class="lux-game-cache-title">Preparando jogo</div>
          <div class="lux-game-cache-game"></div>
          <div class="lux-game-cache-status">Verificando arquivos temporários...</div>
          <div class="lux-game-cache-track"><div class="lux-game-cache-bar"></div></div>
          <div class="lux-game-cache-meta">0%</div>
          <div class="lux-game-cache-note">A ROM fica armazenada temporariamente neste dispositivo e pode ser removida após 7 dias sem uso.</div>
        </div>`;
      document.body.appendChild(overlay);
    }
    overlay.querySelector('.lux-game-cache-game').textContent = game?.name || 'Jogo';
    overlay.classList.remove('hidden');
    return overlay;
  }

  function updateOverlay(status, progress, meta) {
    const overlay = document.getElementById(OVERLAY_ID);
    if (!overlay) return;
    if (status) overlay.querySelector('.lux-game-cache-status').textContent = status;
    if (Number.isFinite(progress)) {
      const value = Math.max(0, Math.min(1, progress));
      overlay.querySelector('.lux-game-cache-bar').style.width = `${Math.max(3, Math.round(value * 100))}%`;
      overlay.querySelector('.lux-game-cache-meta').textContent = meta || `${Math.round(value * 100)}%`;
    } else if (meta) {
      overlay.querySelector('.lux-game-cache-meta').textContent = meta;
    }
  }

  function hideOverlay(delay = 120) {
    const overlay = document.getElementById(OVERLAY_ID);
    if (!overlay) return;
    setTimeout(() => overlay.classList.add('hidden'), delay);
  }

  async function cachedStatus(game) {
    if (!game || !window.LuxRomCache?.status) return null;
    try { return await window.LuxRomCache.status(game); }
    catch (_) { return null; }
  }

  async function prepareGame(game) {
    if (!shouldAutoCache(game)) return { cached: false, skipped: true };

    const existing = await cachedStatus(game);
    if (existing) return { cached: true, skipped: false, size: existing.size || 0 };

    ensureOverlay(game);
    updateOverlay('Baixando ROM para este dispositivo...', 0.03, 'Preparando download');

    await window.LuxRomCache.download(game, ratio => {
      const progress = Number.isFinite(ratio) ? ratio : 0;
      updateOverlay(
        'Baixando ROM para este dispositivo...',
        0.03 + progress * 0.90,
        progress > 0 ? `${Math.round(progress * 100)}% da ROM` : 'Baixando...'
      );
    });

    const saved = await cachedStatus(game);
    if (!saved) throw new Error('A ROM foi baixada, mas não ficou disponível no cache local.');
    return { cached: false, skipped: false, size: saved.size || 0 };
  }

  async function refreshClearButton(game = currentGame()) {
    const button = document.getElementById('gameClearTempButton');
    if (!button || !game || game.external) return;
    const status = await cachedStatus(game);
    button.disabled = !status;
    button.classList.toggle('opacity-50', !status);
    button.classList.toggle('cursor-not-allowed', !status);
    const label = button.querySelector('span');
    if (label) label.textContent = status ? 'Limpar arquivos temporários deste jogo' : 'Nenhum arquivo temporário deste jogo';
  }

  function addClearButton(game) {
    if (!game || game.external) return;
    const actions = document.getElementById('gameDetailsActions');
    if (!actions || document.getElementById('gameClearTempButton')) return;

    const button = document.createElement('button');
    button.id = 'gameClearTempButton';
    button.type = 'button';
    button.className = 'w-full mb-2 border border-purple-800/60 bg-purple-950/40 text-purple-200 hover:bg-purple-900/60 py-2.5 rounded-xl text-xs font-bold transition-all flex justify-center items-center gap-2';
    button.innerHTML = '<i data-lucide="trash-2" class="w-4 h-4"></i><span>Verificando arquivos temporários...</span>';
    button.onclick = () => window.clearCurrentGameTemporaryFiles?.();

    const downloadButton = document.getElementById('gameDownloadButton');
    if (downloadButton?.parentNode === actions) downloadButton.insertAdjacentElement('afterend', button);
    else actions.prepend(button);
    try { window.lucide?.createIcons?.(); } catch (_) {}
    refreshClearButton(game);
  }

  window.clearCurrentGameTemporaryFiles = async function () {
    const game = currentGame();
    if (!game || game.external || !window.LuxRomCache?.remove) return;

    const exists = await cachedStatus(game);
    if (!exists) {
      await refreshClearButton(game);
      return;
    }

    const confirmed = window.confirm?.('Remover a ROM temporária deste jogo deste dispositivo? Saves, progresso e favoritos não serão apagados.') ?? true;
    if (!confirmed) return;

    try {
      await window.LuxRomCache.remove(game);
      await refreshClearButton(game);
      const download = document.getElementById('gameDownloadButton');
      const label = download?.querySelector('span');
      if (label) label.textContent = 'Baixar para jogar localmente';
      if (download) download.disabled = false;
      window.alert?.('Arquivos temporários deste jogo foram removidos.');
    } catch (error) {
      console.warn('[Lux Cache] Não foi possível limpar os arquivos temporários:', error);
      window.alert?.('Não foi possível limpar os arquivos temporários deste jogo.');
    }
  };

  function patchStartGameFromDetails() {
    const original = window.startGameFromDetails;
    if (typeof original !== 'function' || original.__luxGameLocalCachePatched) return false;

    const patched = async function (...args) {
      const game = currentGame();
      if (!shouldAutoCache(game) || isN64(game)) return original.apply(this, args);

      try {
        const status = await cachedStatus(game);
        if (!status) {
          await prepareGame(game);
          updateOverlay('Tudo pronto!', 1, 'ROM salva neste dispositivo');
        }
        const result = await original.apply(this, args);
        if (!status) hideOverlay(140);
        return result;
      } catch (error) {
        console.warn('[Lux Cache] Falha ao preparar ROM local; abrindo pela fonte original:', error);
        updateOverlay('Não foi possível salvar a ROM local.', 1, 'Abrindo pela fonte original');
        hideOverlay(600);
        return original.apply(this, args);
      }
    };

    patched.__luxGameLocalCachePatched = VERSION;
    patched.__luxGameLocalCacheOriginal = original;
    window.startGameFromDetails = patched;
    return true;
  }

  function patchGameDetailsActions() {
    const original = window.updateGameDetailsActions;
    if (typeof original !== 'function' || original.__luxGameCacheActionsPatched) return false;

    const patched = function (game) {
      const result = original.apply(this, arguments);
      addClearButton(game);
      return result;
    };

    patched.__luxGameCacheActionsPatched = VERSION;
    window.updateGameDetailsActions = patched;
    return true;
  }

  function patchManualDownload() {
    const original = window.downloadCurrentGame;
    if (typeof original !== 'function' || original.__luxGameCacheDownloadPatched) return false;

    const patched = async function (...args) {
      const result = await original.apply(this, args);
      await refreshClearButton(currentGame());
      return result;
    };

    patched.__luxGameCacheDownloadPatched = VERSION;
    window.downloadCurrentGame = patched;
    return true;
  }

  let attempts = 0;
  const timer = setInterval(() => {
    attempts += 1;
    const a = patchStartGameFromDetails();
    const b = patchGameDetailsActions();
    const c = patchManualDownload();
    if ((a && b && c) || attempts >= 240) clearInterval(timer);
  }, 50);

  window.addEventListener('beforeunload', () => clearInterval(timer), { once: true });
})();
