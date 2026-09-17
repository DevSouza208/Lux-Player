(() => {
  'use strict';

  const VERSION = '20260916-r2-rom-cache3';
  const OVERLAY_ID = 'luxGameCacheOverlay';
  const STYLE_ID = 'luxGameCacheOverlayStyle';

  if (window.__luxGameLocalCacheFlow === VERSION) return;
  window.__luxGameLocalCacheFlow = VERSION;

  function currentGame() {
    try { return typeof currentGameDetails !== 'undefined' ? currentGameDetails : null; }
    catch (_) { return null; }
  }

  function normalizedConsole(game) {
    return String(game?.console || game?.consoleLabel || '').toLowerCase().replace(/[^a-z0-9]/g, '');
  }

  function isN64(game) {
    const value = normalizedConsole(game);
    return value === 'n64' || value === 'nintendo64';
  }

  function resolvedSource(game) {
    try { return window.LuxRomCache?.resolveSource?.(game) || null; }
    catch (_) { return null; }
  }

  function shouldAutoCache(game) {
    if (!game || game.external || game.localUrl || !window.LuxRomCache) return false;
    const source = resolvedSource(game);
    return !!source?.url;
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
      #${OVERLAY_ID} .lux-game-cache-note{margin-top:20px;font-size:11px;line-height:1.55;color:#9f8bbd}
      #gameDetailsCover{position:relative}
      #gameDetailsFavoriteHeart{position:absolute;top:12px;right:12px;z-index:4;width:42px;height:42px;border-radius:999px;display:grid;place-items:center;background:rgba(12,8,20,.88);border:1px solid rgba(126,34,206,.55);color:#ddd6fe;backdrop-filter:blur(8px);transition:.18s ease}
      #gameDetailsFavoriteHeart:hover{transform:scale(1.06);color:#fb7185;border-color:rgba(251,113,133,.7)}
      #gameDetailsFavoriteHeart.is-favorite{color:#fb7185;border-color:rgba(251,113,133,.7);background:rgba(76,5,25,.82)}
      .lux-game-storage-panel{margin-top:12px;display:grid;gap:8px}
      .lux-game-storage-toggle{display:grid;grid-template-columns:1fr 1fr;gap:4px;padding:4px;border-radius:14px;background:#0c0814;border:1px solid rgba(88,28,135,.68)}
      .lux-game-storage-option{display:flex;align-items:center;justify-content:center;gap:7px;border:0;border-radius:10px;padding:10px 8px;background:transparent;color:#8b7ba8;font-size:12px;font-weight:800;transition:.18s ease}
      .lux-game-storage-option.active{background:#2e1065;color:#f3e8ff;box-shadow:0 6px 18px rgba(88,28,135,.32)}
      .lux-game-storage-option:disabled{opacity:.55;cursor:wait}
      .lux-game-cache-clear{display:flex;width:100%;align-items:center;justify-content:center;gap:7px;border:1px solid rgba(88,28,135,.55);border-radius:12px;padding:9px 10px;background:rgba(46,16,101,.25);color:#c4b5fd;font-size:11px;font-weight:800;transition:.18s ease}
      .lux-game-cache-clear:hover:not(:disabled){background:rgba(88,28,135,.42);color:#fff}
      .lux-game-cache-clear:disabled{opacity:.42;cursor:not-allowed}
      #gameDetailsAboutSection,#gameDetailsReviewsSection{grid-column:1/-1;width:100%;border-top:1px solid rgba(88,28,135,.42);padding-top:22px}
      #gameDetailsAboutSection{margin-top:2px}
      #gameDetailsReviewsSection{margin-top:2px;padding-bottom:4px}
      .lux-game-section-title{font-size:12px;font-weight:900;text-transform:uppercase;letter-spacing:.09em;color:#c084fc;margin-bottom:12px}
      #gameDetailsAboutMeta{display:flex;flex-wrap:wrap;gap:8px;margin:0 0 16px}
      #gameDetailsAboutSynopsis{margin-top:0}
      #gameDetailsAboutSynopsis #gameDetailsSynopsis{max-height:none;overflow:visible;font-size:14px;line-height:1.75}
      #gameDetailsReviewsSection #gameDetailsRating{margin-top:0;min-height:0}
      @media(max-width:767px){#gameDetailsAboutSection,#gameDetailsReviewsSection{grid-column:1}.lux-game-storage-panel{max-width:330px;margin-left:auto;margin-right:auto}}
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
          <div class="lux-game-cache-status">Verificando jogo...</div>
          <div class="lux-game-cache-track"><div class="lux-game-cache-bar"></div></div>
          <div class="lux-game-cache-meta">0%</div>
          <div class="lux-game-cache-note"><strong>O primeiro carregamento pode demorar um pouco mais.</strong><br>Estamos baixando e preparando o jogo para rodar no seu dispositivo.</div>
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
    } else if (meta) overlay.querySelector('.lux-game-cache-meta').textContent = meta;
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
    const source = resolvedSource(game);
    updateOverlay(source?.source === 'r2' ? 'Baixando ROM...' : 'Baixando jogo...', 0.03, 'Preparando download');
    await window.LuxRomCache.download(game, ratio => {
      const progress = Number.isFinite(ratio) ? ratio : 0;
      updateOverlay('Baixando ROM...', 0.03 + progress * 0.90, progress > 0 ? `${Math.round(progress * 100)}%` : 'Baixando...');
    });
    const saved = await cachedStatus(game);
    if (!saved) throw new Error('A ROM foi baixada, mas não ficou disponível no armazenamento local.');
    return { cached: false, skipped: false, size: saved.size || 0 };
  }

  function favoriteState(game) {
    try { return typeof isGameFavorite === 'function' ? Boolean(isGameFavorite(game)) : false; }
    catch (_) { return false; }
  }

  function ensureFavoriteHeart(game) {
    const cover = document.getElementById('gameDetailsCover');
    if (!cover || game?.external) return;
    cover.classList.add('relative');
    let button = document.getElementById('gameDetailsFavoriteHeart');
    if (!button) {
      button = document.createElement('button');
      button.id = 'gameDetailsFavoriteHeart';
      button.type = 'button';
      cover.appendChild(button);
    }
    const favorite = favoriteState(game);
    button.className = favorite ? 'is-favorite' : '';
    button.title = favorite ? 'Remover dos favoritos' : 'Adicionar aos favoritos';
    button.setAttribute('aria-label', button.title);
    button.setAttribute('aria-pressed', String(favorite));
    button.innerHTML = `<i data-lucide="heart" class="w-5 h-5 ${favorite ? 'fill-current' : ''}"></i>`;
    button.onclick = event => {
      event.preventDefault();
      event.stopPropagation();
      if (typeof window.toggleCurrentGameFavorite === 'function') window.toggleCurrentGameFavorite(event);
      setTimeout(() => ensureFavoriteHeart(currentGame()), 0);
    };
  }

  function ensureStoragePanel(game) {
    const cover = document.getElementById('gameDetailsCover');
    if (!cover) return null;
    const column = cover.parentElement;
    if (!column) return null;
    let panel = document.getElementById('gameDetailsStoragePanel');
    if (!panel) {
      panel = document.createElement('div');
      panel.id = 'gameDetailsStoragePanel';
      panel.className = 'lux-game-storage-panel';
      panel.innerHTML = `
        <div class="lux-game-storage-toggle" role="group" aria-label="Local da ROM">
          <button id="gameStorageCloud" type="button" class="lux-game-storage-option"><i data-lucide="cloud" class="w-4 h-4"></i><span>Nuvem</span></button>
          <button id="gameStorageLocal" type="button" class="lux-game-storage-option"><i data-lucide="smartphone" class="w-4 h-4"></i><span>Local</span></button>
        </div>
        <button id="gameClearTempButton" type="button" class="lux-game-cache-clear"><i data-lucide="trash-2" class="w-3.5 h-3.5"></i><span>Limpar cache</span></button>`;
      cover.insertAdjacentElement('afterend', panel);
    }
    const cloud = document.getElementById('gameStorageCloud');
    const local = document.getElementById('gameStorageLocal');
    const clear = document.getElementById('gameClearTempButton');
    if (game.external) {
      cloud?.classList.remove('active');
      local?.classList.add('active');
      if (cloud) cloud.disabled = true;
      if (local) local.disabled = true;
      if (clear) clear.disabled = true;
      return panel;
    }
    if (cloud) cloud.onclick = () => window.setCurrentGameStorageMode?.('cloud');
    if (local) local.onclick = () => window.setCurrentGameStorageMode?.('local');
    if (clear) clear.onclick = () => window.clearCurrentGameTemporaryFiles?.();
    return panel;
  }

  async function refreshStoragePanel(game = currentGame()) {
    const cloud = document.getElementById('gameStorageCloud');
    const local = document.getElementById('gameStorageLocal');
    const clear = document.getElementById('gameClearTempButton');
    if (!game || !cloud || !local) return;
    if (game.external) {
      cloud.classList.remove('active'); local.classList.add('active');
      cloud.disabled = true; local.disabled = true; if (clear) clear.disabled = true;
      return;
    }
    const status = await cachedStatus(game);
    if (currentGame() !== game) return;
    cloud.classList.toggle('active', !status);
    local.classList.toggle('active', Boolean(status));
    cloud.disabled = false; local.disabled = false;
    if (clear) clear.disabled = !status;
    try { window.lucide?.createIcons?.(); } catch (_) {}
  }

  function moveDetailsSections() {
    const modal = document.getElementById('gameDetailsModal');
    const cover = document.getElementById('gameDetailsCover');
    const rating = document.getElementById('gameDetailsRating');
    const synopsis = document.getElementById('gameDetailsSynopsis');
    const consoleTag = document.getElementById('gameDetailsConsole');
    if (!modal || !cover || !rating || !synopsis || !consoleTag) return;
    const grid = cover.parentElement;
    if (!grid) return;

    let about = document.getElementById('gameDetailsAboutSection');
    if (!about) {
      about = document.createElement('section');
      about.id = 'gameDetailsAboutSection';
      about.innerHTML = '<h3 class="lux-game-section-title">Sobre o jogo</h3><div id="gameDetailsAboutMeta"></div><div id="gameDetailsAboutSynopsis"></div>';
      grid.appendChild(about);
    }
    const meta = document.getElementById('gameDetailsAboutMeta');
    const aboutSynopsis = document.getElementById('gameDetailsAboutSynopsis');
    const tagRow = consoleTag.parentElement;
    const synopsisWrap = synopsis.parentElement;
    if (tagRow && meta && tagRow !== meta) meta.append(...Array.from(tagRow.children));
    if (tagRow && tagRow !== meta && !tagRow.children.length) tagRow.remove();
    if (synopsisWrap && aboutSynopsis && synopsisWrap !== aboutSynopsis) aboutSynopsis.appendChild(synopsisWrap);

    let reviews = document.getElementById('gameDetailsReviewsSection');
    if (!reviews) {
      reviews = document.createElement('section');
      reviews.id = 'gameDetailsReviewsSection';
      reviews.innerHTML = '<h3 class="lux-game-section-title">Avaliações da comunidade</h3>';
      grid.appendChild(reviews);
    }
    if (rating.parentElement !== reviews) reviews.appendChild(rating);
  }

  function cleanLegacyActions() {
    const actions = document.getElementById('gameDetailsActions');
    if (!actions) return;
    const favorite = actions.querySelector('button[onclick*="toggleCurrentGameFavorite"]');
    const download = document.getElementById('gameDownloadButton');
    favorite?.remove();
    download?.remove();
    actions.classList.add('game-details-primary-actions');
  }

  async function applyGameDetailsRedesign(game) {
    if (!game) return;
    ensureStyle();
    cleanLegacyActions();
    ensureFavoriteHeart(game);
    ensureStoragePanel(game);
    moveDetailsSections();
    await refreshStoragePanel(game);
    try { window.lucide?.createIcons?.(); } catch (_) {}
  }

  window.setCurrentGameStorageMode = async function (mode) {
    const game = currentGame();
    if (!game || game.external || !window.LuxRomCache) return;
    const cloud = document.getElementById('gameStorageCloud');
    const local = document.getElementById('gameStorageLocal');
    if (cloud) cloud.disabled = true;
    if (local) local.disabled = true;
    try {
      if (mode === 'local') {
        const existing = await cachedStatus(game);
        if (!existing) {
          ensureOverlay(game);
          await prepareGame(game);
          updateOverlay('Tudo pronto!', 1, 'Jogo disponível localmente');
          hideOverlay(220);
        }
      } else if (mode === 'cloud') {
        const existing = await cachedStatus(game);
        if (existing) await window.LuxRomCache.remove(game);
      }
    } catch (error) {
      console.warn('[Lux ROM Cache] Falha ao alterar armazenamento:', error);
      hideOverlay(300);
    } finally {
      await refreshStoragePanel(game);
    }
  };

  window.clearCurrentGameTemporaryFiles = async function () {
    const game = currentGame();
    if (!game || game.external || !window.LuxRomCache?.remove) return;
    const exists = await cachedStatus(game);
    if (!exists) { await refreshStoragePanel(game); return; }
    const confirmed = window.confirm?.('Limpar o cache deste jogo? Saves, progresso e favoritos não serão apagados.') ?? true;
    if (!confirmed) return;
    try {
      await window.LuxRomCache.remove(game);
      await refreshStoragePanel(game);
    } catch (error) {
      console.warn('[Lux ROM Cache] Não foi possível limpar o cache:', error);
      window.alert?.('Não foi possível limpar o cache deste jogo.');
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
          updateOverlay('Iniciando emulador...', 1, 'Tudo pronto');
        }
        const result = await original.apply(this, args);
        if (!status) hideOverlay(180);
        return result;
      } catch (error) {
        console.warn('[Lux ROM Cache] Falha ao preparar ROM local; usando a fonte disponível:', error);
        updateOverlay('Não foi possível preparar a cópia local.', 1, 'Tentando abrir pela nuvem');
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
      Promise.resolve(applyGameDetailsRedesign(game)).catch(error => console.warn('[Lux Game Details] Falha no redesign:', error));
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
      await refreshStoragePanel(currentGame());
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
