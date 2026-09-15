(() => {
  'use strict';

  const VERSION = '20260915-mobile-n64-controls-1';
  const MOBILE_MEDIA = '(max-width: 767px), (orientation: landscape) and (max-width: 1280px) and (max-height: 600px) and (pointer: coarse)';
  if (!window.matchMedia(MOBILE_MEDIA).matches || window.__luxMobileN64Controls === VERSION) return;
  window.__luxMobileN64Controls = VERSION;

  const AXIS = { STICK_X: 16, STICK_Y: 17, C_X: 18, C_Y: 19 };
  const AXIS_MAX = 0x7fff;
  const cPointers = new Map();
  let stickPointer = null;

  function normalizeSystem(value) {
    const name = String(value || '').toLowerCase().replace(/[^a-z0-9]/g, '');
    if (name === 'n64' || name === 'nintendo64' || name === 'nintendo64n64') return 'n64';
    return name;
  }

  function currentSystem() {
    try {
      if (typeof activeEmulatorGame !== 'undefined' && activeEmulatorGame?.console) return normalizeSystem(activeEmulatorGame.console);
      if (typeof pendingEmulatorGame !== 'undefined' && pendingEmulatorGame?.console) return normalizeSystem(pendingEmulatorGame.console);
    } catch (_) {}
    const modal = document.getElementById('emulatorModal');
    const systemClass = [...(modal?.classList || [])].find(name => name.startsWith('lux-console-system-'));
    if (systemClass) return normalizeSystem(systemClass.replace('lux-console-system-', ''));
    return normalizeSystem(document.getElementById('emulatorIntroConsole')?.textContent);
  }

  function manager() {
    const value = window.EJS_emulator?.gameManager;
    return value && typeof value.simulateInput === 'function' ? value : null;
  }

  function sendAxis(index, value) {
    const gameManager = manager();
    if (!gameManager) return false;
    try {
      gameManager.simulateInput(0, index, Math.round(Number(value) || 0));
      return true;
    } catch (error) {
      console.warn('Lux N64 mobile: não foi possível enviar o eixo ao EmulatorJS.', error);
      return false;
    }
  }

  function releaseC(pointerId) {
    const active = cPointers.get(pointerId);
    if (!active) return;
    cPointers.delete(pointerId);
    const sameAxisStillPressed = [...cPointers.values()].some(item => item.axis === active.axis);
    if (!sameAxisStillPressed) sendAxis(active.axis, 0);
    active.element?.classList.remove('lux-control-pressed');
  }

  function bindCButton(button) {
    if (!button || button.dataset.luxN64Bound === '1') return;
    button.dataset.luxN64Bound = '1';
    const axis = Number(button.dataset.axis);
    const value = Number(button.dataset.axisValue);
    if (!Number.isFinite(axis) || !Number.isFinite(value)) return;

    button.addEventListener('pointerdown', event => {
      event.preventDefault();
      event.stopPropagation();
      if (cPointers.has(event.pointerId)) return;
      cPointers.set(event.pointerId, { axis, value, element: button });
      button.classList.add('lux-control-pressed');
      try { button.setPointerCapture?.(event.pointerId); } catch (_) {}
      sendAxis(axis, value);
    });
    button.addEventListener('pointerup', event => releaseC(event.pointerId));
    button.addEventListener('pointercancel', event => releaseC(event.pointerId));
    button.addEventListener('lostpointercapture', event => releaseC(event.pointerId));
  }

  function stickElements() {
    const base = document.getElementById('luxN64AnalogBase');
    return { base, knob: base?.querySelector('.lux-n64-analog-knob') || null };
  }

  function updateStick(event) {
    const { base, knob } = stickElements();
    if (!base || !knob) return;
    const rect = base.getBoundingClientRect();
    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;
    const radius = Math.max(1, Math.min(rect.width, rect.height) / 2);
    let x = (event.clientX - cx) / radius;
    let y = (event.clientY - cy) / radius;
    const length = Math.hypot(x, y);
    if (length > 1) {
      x /= length;
      y /= length;
    }

    // Pequena zona morta para o stick voltar ao centro sem drift.
    if (Math.abs(x) < 0.055) x = 0;
    if (Math.abs(y) < 0.055) y = 0;

    knob.style.transform = `translate(${x * 58}%, ${y * 58}%)`;
    sendAxis(AXIS.STICK_X, x * AXIS_MAX);
    sendAxis(AXIS.STICK_Y, y * AXIS_MAX);
  }

  function releaseStick(pointerId = null) {
    if (stickPointer === null) return;
    if (pointerId !== null && pointerId !== stickPointer) return;
    stickPointer = null;
    const { knob } = stickElements();
    if (knob) knob.style.transform = 'translate(0, 0)';
    sendAxis(AXIS.STICK_X, 0);
    sendAxis(AXIS.STICK_Y, 0);
  }

  function bindAnalog(base) {
    if (!base || base.dataset.luxN64Bound === '1') return;
    base.dataset.luxN64Bound = '1';
    base.addEventListener('pointerdown', event => {
      event.preventDefault();
      event.stopPropagation();
      if (stickPointer !== null) return;
      stickPointer = event.pointerId;
      try { base.setPointerCapture?.(event.pointerId); } catch (_) {}
      updateStick(event);
    });
    base.addEventListener('pointermove', event => {
      if (event.pointerId !== stickPointer) return;
      event.preventDefault();
      updateStick(event);
    });
    base.addEventListener('pointerup', event => releaseStick(event.pointerId));
    base.addEventListener('pointercancel', event => releaseStick(event.pointerId));
    base.addEventListener('lostpointercapture', event => releaseStick(event.pointerId));
  }

  function renderExtras(layer) {
    if (!layer || currentSystem() !== 'n64') return false;
    if (!document.getElementById('luxN64AnalogZone')) {
      layer.insertAdjacentHTML('beforeend', `
        <div id="luxN64AnalogZone" class="lux-n64-analog-zone" aria-label="Analógico do Nintendo 64">
          <div id="luxN64AnalogBase" class="lux-n64-analog-base">
            <div class="lux-n64-analog-ring" aria-hidden="true"></div>
            <div class="lux-n64-analog-knob" aria-hidden="true"></div>
          </div>
          <span class="lux-n64-control-caption">ANALÓGICO</span>
        </div>
        <div id="luxN64CZone" class="lux-n64-c-zone" aria-label="Botões C do Nintendo 64">
          <button type="button" class="lux-game-control lux-n64-c-button lux-n64-c-up" data-axis="${AXIS.C_Y}" data-axis-value="-${AXIS_MAX}" aria-label="C para cima"><span>C▲</span></button>
          <button type="button" class="lux-game-control lux-n64-c-button lux-n64-c-left" data-axis="${AXIS.C_X}" data-axis-value="-${AXIS_MAX}" aria-label="C para esquerda"><span>C◀</span></button>
          <button type="button" class="lux-game-control lux-n64-c-button lux-n64-c-right" data-axis="${AXIS.C_X}" data-axis-value="${AXIS_MAX}" aria-label="C para direita"><span>C▶</span></button>
          <button type="button" class="lux-game-control lux-n64-c-button lux-n64-c-down" data-axis="${AXIS.C_Y}" data-axis-value="${AXIS_MAX}" aria-label="C para baixo"><span>C▼</span></button>
        </div>`);
    }
    layer.querySelectorAll('.lux-n64-c-button').forEach(bindCButton);
    bindAnalog(document.getElementById('luxN64AnalogBase'));
    return true;
  }

  function removeExtras() {
    releaseStick();
    [...cPointers.keys()].forEach(releaseC);
    document.getElementById('luxN64AnalogZone')?.remove();
    document.getElementById('luxN64CZone')?.remove();
  }

  function ensureStyles() {
    if (document.getElementById('luxMobileN64Styles')) return;
    const style = document.createElement('style');
    style.id = 'luxMobileN64Styles';
    style.textContent = `
      @media ${MOBILE_MEDIA} {
        #emulatorModal.lux-console-system-n64 .lux-n64-analog-zone,
        #emulatorModal.lux-console-system-n64 .lux-n64-c-zone {
          position: absolute;
          z-index: 8;
          pointer-events: auto;
          touch-action: none;
          user-select: none;
          -webkit-user-select: none;
        }

        #emulatorModal.lux-console-system-n64 .lux-n64-analog-zone {
          left: 31vw;
          top: max(calc(var(--lux-visible-screen-top) + var(--lux-visible-screen-height) + 112px), 54dvh);
          width: 112px;
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: 5px;
        }
        #emulatorModal.lux-console-system-n64 .lux-n64-analog-base {
          position: relative;
          width: 104px;
          height: 104px;
          border-radius: 50%;
          border: 1px solid rgba(216,180,254,.42);
          background: radial-gradient(circle at 50% 50%, rgba(70,33,108,.88) 0 32%, rgba(26,12,45,.95) 33% 68%, rgba(53,24,86,.92) 69% 100%);
          box-shadow: inset 0 8px 22px rgba(0,0,0,.36), 0 8px 24px rgba(0,0,0,.22), 0 0 16px rgba(168,85,247,.12);
        }
        #emulatorModal.lux-console-system-n64 .lux-n64-analog-ring {
          position: absolute;
          inset: 15px;
          border-radius: 50%;
          border: 1px solid rgba(216,180,254,.18);
          pointer-events: none;
        }
        #emulatorModal.lux-console-system-n64 .lux-n64-analog-knob {
          position: absolute;
          left: 31px;
          top: 31px;
          width: 42px;
          height: 42px;
          border-radius: 50%;
          border: 1px solid rgba(255,255,255,.20);
          background: radial-gradient(circle at 35% 28%, rgba(179,116,255,.98), rgba(86,34,143,.96) 52%, rgba(39,15,67,.98));
          box-shadow: 0 7px 14px rgba(0,0,0,.42), inset 0 1px 0 rgba(255,255,255,.22);
          pointer-events: none;
          will-change: transform;
        }
        #emulatorModal.lux-console-system-n64 .lux-n64-control-caption {
          color: rgba(216,180,254,.70);
          font-size: 8px;
          font-weight: 900;
          letter-spacing: .12em;
          pointer-events: none;
        }

        #emulatorModal.lux-console-system-n64 .lux-n64-c-zone {
          right: clamp(8px, 2.5vw, 16px);
          top: max(calc(var(--lux-visible-screen-top) + var(--lux-visible-screen-height) + 72px), 48dvh);
          width: 122px;
          height: 122px;
        }
        #emulatorModal.lux-console-system-n64 .lux-n64-c-button {
          position: absolute;
          width: 42px;
          height: 42px;
          border-radius: 50%;
          display: grid;
          place-items: center;
          padding: 0;
          border-color: rgba(253,224,71,.65);
          background: linear-gradient(180deg, rgba(202,138,4,.95), rgba(113,63,18,.98));
          color: #fff7b0;
          font-size: 10px;
          box-shadow: inset 0 1px 0 rgba(255,255,255,.20), 0 7px 15px rgba(0,0,0,.26), 0 0 12px rgba(250,204,21,.14);
        }
        #emulatorModal.lux-console-system-n64 .lux-n64-c-up { left: 40px; top: 0; }
        #emulatorModal.lux-console-system-n64 .lux-n64-c-left { left: 0; top: 40px; }
        #emulatorModal.lux-console-system-n64 .lux-n64-c-right { right: 0; top: 40px; }
        #emulatorModal.lux-console-system-n64 .lux-n64-c-down { left: 40px; bottom: 0; }

        /* O N64 precisa de D-pad + analógico + A/B + C; compacta os blocos originais para caber sem sobreposição. */
        #emulatorModal.lux-console-system-n64:not(.lux-console-view-custom) .lux-console-dpad {
          transform: scale(.68);
          transform-origin: top left;
        }
        #emulatorModal.lux-console-system-n64:not(.lux-console-view-custom) .lux-console-face {
          right: clamp(15px, 5vw, 24px);
          top: max(calc(var(--lux-visible-screen-top) + var(--lux-visible-screen-height) + 196px), 68dvh);
          width: 106px;
          height: 92px;
        }
        #emulatorModal.lux-console-system-n64:not(.lux-console-view-custom) .lux-console-face-2 .lux-face-button {
          width: 49px;
          height: 49px;
          font-size: 18px;
        }
        #emulatorModal.lux-console-system-n64:not(.lux-console-view-custom) .lux-console-face-2 .lux-face-button-1 { left: 0; bottom: 0; }
        #emulatorModal.lux-console-system-n64:not(.lux-console-view-custom) .lux-console-face-2 .lux-face-button-2 { right: 0; top: 0; }

        @media (orientation: landscape) {
          #emulatorModal.lux-console-system-n64 .lux-n64-analog-zone {
            left: max(17vw, calc(env(safe-area-inset-left) + 120px));
            top: auto;
            bottom: max(5dvh, env(safe-area-inset-bottom));
            width: 96px;
          }
          #emulatorModal.lux-console-system-n64 .lux-n64-analog-base { width: 88px; height: 88px; }
          #emulatorModal.lux-console-system-n64 .lux-n64-analog-knob { left: 27px; top: 27px; width: 34px; height: 34px; }
          #emulatorModal.lux-console-system-n64 .lux-n64-c-zone {
            right: max(3vw, env(safe-area-inset-right));
            top: auto;
            bottom: 18dvh;
            width: 108px;
            height: 108px;
          }
          #emulatorModal.lux-console-system-n64 .lux-n64-c-button { width: 38px; height: 38px; font-size: 9px; }
          #emulatorModal.lux-console-system-n64 .lux-n64-c-up { left: 35px; }
          #emulatorModal.lux-console-system-n64 .lux-n64-c-left { top: 35px; }
          #emulatorModal.lux-console-system-n64 .lux-n64-c-right { top: 35px; }
          #emulatorModal.lux-console-system-n64 .lux-n64-c-down { left: 35px; }
          #emulatorModal.lux-console-system-n64:not(.lux-console-view-custom) .lux-console-dpad {
            transform: scale(.62);
          }
          #emulatorModal.lux-console-system-n64:not(.lux-console-view-custom) .lux-console-face {
            right: max(15vw, calc(env(safe-area-inset-right) + 112px));
            top: auto;
            bottom: 5dvh;
            width: 94px;
            height: 82px;
          }
          #emulatorModal.lux-console-system-n64:not(.lux-console-view-custom) .lux-console-face-2 .lux-face-button {
            width: 44px;
            height: 44px;
          }
        }
      }
    `;
    document.head.appendChild(style);
  }

  function sync() {
    const modal = document.getElementById('emulatorModal');
    if (!modal) {
      removeExtras();
      return false;
    }
    if (currentSystem() !== 'n64') {
      removeExtras();
      return false;
    }

    // Garante a classe mesmo quando o nome do console veio como "Nintendo 64".
    modal.classList.add('lux-console-system-n64');
    const layer = document.getElementById('luxConsoleControlsLayer');
    if (!layer) return false;
    return renderExtras(layer);
  }

  ensureStyles();
  const observer = new MutationObserver(() => sync());
  observer.observe(document.documentElement, { childList: true, subtree: true, attributes: true, attributeFilter: ['class'] });

  window.addEventListener('pointerup', event => {
    releaseC(event.pointerId);
    releaseStick(event.pointerId);
  }, { passive: true });
  window.addEventListener('pointercancel', event => {
    releaseC(event.pointerId);
    releaseStick(event.pointerId);
  }, { passive: true });
  window.addEventListener('blur', () => {
    releaseStick();
    [...cPointers.keys()].forEach(releaseC);
  });
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) return;
    releaseStick();
    [...cPointers.keys()].forEach(releaseC);
  });

  sync();
})();
