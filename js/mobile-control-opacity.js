(() => {
  'use strict';

  const MOBILE_MEDIA = '(max-width: 767px), (orientation: landscape) and (max-width: 1280px) and (max-height: 600px) and (pointer: coarse)';
  if (!window.matchMedia(MOBILE_MEDIA).matches || window.__luxMobileControlOpacityInstalled) return;
  window.__luxMobileControlOpacityInstalled = true;

  const STORAGE_KEY = 'lux-play:console-control-transparency';
  const DEFAULT_TRANSPARENCY = 0;
  const MAX_TRANSPARENCY = 80;

  const clampTransparency = value => {
    const number = Number(value);
    if (!Number.isFinite(number)) return DEFAULT_TRANSPARENCY;
    return Math.min(MAX_TRANSPARENCY, Math.max(0, Math.round(number / 5) * 5));
  };

  const readTransparency = () => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      return stored === null ? DEFAULT_TRANSPARENCY : clampTransparency(stored);
    } catch (_) {
      return DEFAULT_TRANSPARENCY;
    }
  };

  const applyTransparency = value => {
    const transparency = clampTransparency(value);
    const opacity = Math.max(.2, 1 - (transparency / 100));
    const modal = document.getElementById('emulatorModal');
    if (modal) {
      modal.style.setProperty('--lux-control-opacity', opacity.toFixed(2));
      modal.dataset.luxControlTransparency = String(transparency);
    }
    return transparency;
  };

  const saveTransparency = value => {
    const transparency = applyTransparency(value);
    try { localStorage.setItem(STORAGE_KEY, String(transparency)); } catch (_) {}
    return transparency;
  };

  const ensureStyles = () => {
    if (document.getElementById('luxMobileControlOpacityStyles')) return;
    const style = document.createElement('style');
    style.id = 'luxMobileControlOpacityStyles';
    style.textContent = `
      @media ${MOBILE_MEDIA} {
        #emulatorModal.lux-console-mobile-stage1 .lux-game-control,
        #emulatorModal.lux-console-mobile-stage1 .lux-dpad-center {
          opacity: var(--lux-control-opacity, 1);
        }

        #emulatorModal.lux-console-mobile-stage1 .lux-control-pressed {
          opacity: var(--lux-control-opacity, 1);
        }

        #emulatorModal.lux-console-mobile-stage1 .lux-control-opacity-card {
          display: grid;
          gap: 8px;
        }

        #emulatorModal.lux-console-mobile-stage1 .lux-control-opacity-head {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 10px;
        }

        #emulatorModal.lux-console-mobile-stage1 .lux-control-opacity-head .lux-setting-label {
          margin-bottom: 0;
        }

        #emulatorModal.lux-console-mobile-stage1 .lux-control-opacity-value {
          color: #d8b4fe;
          font-size: 9px;
          font-weight: 900;
          font-variant-numeric: tabular-nums;
        }

        #emulatorModal.lux-console-mobile-stage1 .lux-control-opacity-slider {
          appearance: none;
          -webkit-appearance: none;
          width: 100%;
          height: 5px;
          margin: 5px 0 3px;
          border-radius: 999px;
          background: linear-gradient(90deg, rgba(147,51,234,.92), rgba(216,180,254,.28));
          outline: none;
          pointer-events: auto;
          touch-action: pan-x;
        }

        #emulatorModal.lux-console-mobile-stage1 .lux-control-opacity-slider::-webkit-slider-thumb {
          appearance: none;
          -webkit-appearance: none;
          width: 20px;
          height: 20px;
          border: 2px solid rgba(233,213,255,.92);
          border-radius: 50%;
          background: #9333ea;
          box-shadow: 0 0 0 4px rgba(147,51,234,.16), 0 2px 8px rgba(0,0,0,.32);
        }

        #emulatorModal.lux-console-mobile-stage1 .lux-control-opacity-slider::-moz-range-thumb {
          width: 18px;
          height: 18px;
          border: 2px solid rgba(233,213,255,.92);
          border-radius: 50%;
          background: #9333ea;
          box-shadow: 0 0 0 4px rgba(147,51,234,.16), 0 2px 8px rgba(0,0,0,.32);
        }

        #emulatorModal.lux-console-mobile-stage1 .lux-control-opacity-help {
          color: rgba(216,180,254,.58);
          font-size: 8px;
          line-height: 1.35;
        }
      }
    `;
    document.head.appendChild(style);
  };

  const injectSlider = sheet => {
    if (!sheet || sheet.querySelector('.lux-control-opacity-card')) return;
    const group = sheet.querySelector('.lux-setting-group');
    if (!group) return;

    const current = readTransparency();
    const card = document.createElement('div');
    card.className = 'lux-setting-card lux-control-opacity-card';
    card.innerHTML = `
      <div class="lux-control-opacity-head">
        <span class="lux-setting-label">Transparência dos botões</span>
        <span class="lux-control-opacity-value">${current}%</span>
      </div>
      <input class="lux-control-opacity-slider" type="range" min="0" max="${MAX_TRANSPARENCY}" step="5" value="${current}" aria-label="Transparência dos botões do emulador">
      <span class="lux-control-opacity-help">0% mantém o visual atual · 80% deixa os controles bem discretos.</span>
    `;

    const cheatsRow = group.querySelector('.lux-cheats-open');
    if (cheatsRow) group.insertBefore(card, cheatsRow);
    else group.appendChild(card);

    const slider = card.querySelector('.lux-control-opacity-slider');
    const valueLabel = card.querySelector('.lux-control-opacity-value');
    const update = event => {
      const next = saveTransparency(event.target.value);
      if (valueLabel) valueLabel.textContent = `${next}%`;
    };
    slider?.addEventListener('input', update);
    slider?.addEventListener('change', update);
  };

  ensureStyles();
  applyTransparency(readTransparency());

  const observer = new MutationObserver(mutations => {
    for (const mutation of mutations) {
      mutation.addedNodes.forEach(node => {
        if (!(node instanceof Element)) return;
        if (node.id === 'emulatorModal' || node.querySelector?.('#emulatorModal')) applyTransparency(readTransparency());
        if (node.matches('.lux-console-settings-sheet')) injectSlider(node);
        node.querySelectorAll?.('.lux-console-settings-sheet').forEach(injectSlider);
      });
    }
  });

  observer.observe(document.body, { childList: true, subtree: true });
  document.querySelectorAll('.lux-console-settings-sheet').forEach(injectSlider);

  window.LuxMobileControlOpacity = {
    get: readTransparency,
    set: saveTransparency
  };
})();
