(() => {
  'use strict';

  const VERSION = '0.1.6';
  const SENSITIVITY = 1.35;
  const SCROLL_FACTOR = 1.8;
  const pointers = new Map();
  let gesture = null;

  function loadStyles() {
    if (document.querySelector('link[data-lux-touchpad]')) return;
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = `./touchpad.css?v=${VERSION}`;
    link.dataset.luxTouchpad = '1';
    document.head.appendChild(link);
  }

  function emit(input, value = null, pressed = null) {
    window.LuxController?.emitInput?.({
      type: 'pointer',
      input,
      value,
      pressed
    });
  }

  function haptic(ms = 8) {
    if (navigator.vibrate) navigator.vibrate(ms);
  }

  function centroid() {
    if (!pointers.size) return null;
    let x = 0;
    let y = 0;
    pointers.forEach(point => {
      x += point.x;
      y += point.y;
    });
    return { x: x / pointers.size, y: y / pointers.size };
  }

  function beginGesture() {
    gesture = {
      startedAt: performance.now(),
      moved: 0,
      maxPointers: pointers.size,
      lastCentroid: centroid()
    };
  }

  function finishGesture() {
    if (!gesture) return;
    const duration = performance.now() - gesture.startedAt;
    const isTap = gesture.moved < 11 && duration < 420;

    if (isTap && gesture.maxPointers >= 2) {
      emit('CLICK_RIGHT', null, true);
      emit('CLICK_RIGHT', null, false);
      haptic(12);
    } else if (isTap && gesture.maxPointers === 1) {
      emit('CLICK_LEFT', null, true);
      emit('CLICK_LEFT', null, false);
      haptic(8);
    }

    gesture = null;
  }

  function setupTouchpad() {
    const panel = document.getElementById('debugPanel');
    if (!panel || panel.dataset.touchpadReady === '1' || !window.LuxController?.emitInput) return false;

    panel.dataset.touchpadReady = '1';
    panel.className = 'touchpad-panel';
    panel.innerHTML = `
      <div class="touchpad-heading">
        <strong>Touchpad</strong>
        <span>Lux Mouse</span>
      </div>
      <div id="luxTouchpadSurface" class="touchpad-surface" role="application" aria-label="Touchpad do Lux Controller">
        <div class="touchpad-glyph">⌁</div>
        <div class="touchpad-copy">Arraste para mover</div>
      </div>
      <div class="touchpad-hint">Toque: clique · 2 dedos: direito / rolagem</div>`;

    const surface = document.getElementById('luxTouchpadSurface');
    if (!surface) return false;

    surface.addEventListener('contextmenu', event => event.preventDefault());

    surface.addEventListener('pointerdown', event => {
      event.preventDefault();
      try { surface.setPointerCapture(event.pointerId); } catch (_) {}
      pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
      if (!gesture) beginGesture();
      gesture.maxPointers = Math.max(gesture.maxPointers, pointers.size);
      gesture.lastCentroid = centroid();
      surface.classList.add('active');
    });

    surface.addEventListener('pointermove', event => {
      if (!pointers.has(event.pointerId) || !gesture) return;
      event.preventDefault();

      const previous = pointers.get(event.pointerId);
      const dx = event.clientX - previous.x;
      const dy = event.clientY - previous.y;
      pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });

      gesture.moved += Math.hypot(dx, dy);
      gesture.maxPointers = Math.max(gesture.maxPointers, pointers.size);

      if (pointers.size === 1 && gesture.maxPointers === 1) {
        if (Math.abs(dx) > 0.1) emit('MOVE_X', dx * SENSITIVITY);
        if (Math.abs(dy) > 0.1) emit('MOVE_Y', dy * SENSITIVITY);
        return;
      }

      if (pointers.size >= 2) {
        const current = centroid();
        const last = gesture.lastCentroid || current;
        const scrollY = current.y - last.y;
        gesture.lastCentroid = current;
        if (Math.abs(scrollY) > 0.3) emit('SCROLL_Y', scrollY * SCROLL_FACTOR);
      }
    });

    const release = event => {
      if (!pointers.has(event.pointerId)) return;
      event.preventDefault();
      pointers.delete(event.pointerId);
      if (gesture) gesture.lastCentroid = centroid();
      if (!pointers.size) {
        surface.classList.remove('active');
        finishGesture();
      }
    };

    surface.addEventListener('pointerup', release);
    surface.addEventListener('pointercancel', release);
    surface.addEventListener('lostpointercapture', release);

    return true;
  }

  function init() {
    loadStyles();
    if (setupTouchpad()) return;
    let attempts = 0;
    const timer = setInterval(() => {
      attempts += 1;
      if (setupTouchpad() || attempts > 60) clearInterval(timer);
    }, 100);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, { once: true });
  else init();
})();
