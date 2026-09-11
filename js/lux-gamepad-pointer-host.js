(() => {
  'use strict';

  if (window.__luxGamepadPointerHostInstalled) return;
  window.__luxGamepadPointerHostInstalled = true;

  const state = {
    x: Math.round(window.innerWidth / 2),
    y: Math.round(window.innerHeight / 2),
    cursor: null,
    hideTimer: null,
    pressedTarget: null
  };

  function ensureCursor() {
    if (state.cursor?.isConnected) return state.cursor;
    const cursor = document.createElement('div');
    cursor.id = 'luxRemotePointer';
    cursor.setAttribute('aria-hidden', 'true');
    cursor.innerHTML = '<svg viewBox="0 0 24 24" width="24" height="24"><path d="M3 2.5 19.3 12l-7.2 1.6 3.7 6.3-3 1.7-3.6-6.3-4.8 5.4L3 2.5Z" fill="#fff" stroke="#4c1d95" stroke-width="1.5" stroke-linejoin="round"/></svg>';
    Object.assign(cursor.style, {
      position: 'fixed',
      left: '0',
      top: '0',
      width: '24px',
      height: '24px',
      zIndex: '2147483646',
      pointerEvents: 'none',
      filter: 'drop-shadow(0 2px 3px rgba(0,0,0,.65))',
      transform: `translate(${state.x}px, ${state.y}px)`,
      opacity: '0',
      transition: 'opacity .12s ease'
    });
    document.body.appendChild(cursor);
    state.cursor = cursor;
    return cursor;
  }

  function showCursor() {
    const cursor = ensureCursor();
    cursor.style.opacity = '1';
    clearTimeout(state.hideTimer);
    state.hideTimer = setTimeout(() => {
      if (state.cursor) state.cursor.style.opacity = '.22';
    }, 3500);
  }

  function clampPointer() {
    state.x = Math.max(2, Math.min(window.innerWidth - 4, state.x));
    state.y = Math.max(2, Math.min(window.innerHeight - 4, state.y));
  }

  function targetAtPointer() {
    return document.elementFromPoint(state.x, state.y) || document.body;
  }

  function mouseOptions(button = 0, buttons = 0) {
    return { bubbles: true, cancelable: true, view: window, clientX: state.x, clientY: state.y, button, buttons };
  }

  function dispatchMove() {
    const target = targetAtPointer();
    try { target.dispatchEvent(new PointerEvent('pointermove', { ...mouseOptions(0, 0), pointerId: 99, pointerType: 'mouse', isPrimary: true })); } catch (_) {}
    try { target.dispatchEvent(new MouseEvent('mousemove', mouseOptions(0, 0))); } catch (_) {}
  }

  function redraw() {
    clampPointer();
    const cursor = ensureCursor();
    cursor.style.transform = `translate(${state.x}px, ${state.y}px)`;
    showCursor();
    dispatchMove();
  }

  function leftButton(pressed) {
    showCursor();
    if (pressed) {
      state.pressedTarget = targetAtPointer();
      const target = state.pressedTarget;
      try { target.dispatchEvent(new PointerEvent('pointerdown', { ...mouseOptions(0, 1), pointerId: 99, pointerType: 'mouse', isPrimary: true })); } catch (_) {}
      try { target.dispatchEvent(new MouseEvent('mousedown', mouseOptions(0, 1))); } catch (_) {}
      return;
    }

    const target = targetAtPointer();
    try { target.dispatchEvent(new PointerEvent('pointerup', { ...mouseOptions(0, 0), pointerId: 99, pointerType: 'mouse', isPrimary: true })); } catch (_) {}
    try { target.dispatchEvent(new MouseEvent('mouseup', mouseOptions(0, 0))); } catch (_) {}
    try { target.click?.(); } catch (_) {
      try { target.dispatchEvent(new MouseEvent('click', mouseOptions(0, 0))); } catch (_) {}
    }
    state.pressedTarget = null;
  }

  function rightButton(pressed) {
    if (pressed) return;
    showCursor();
    const target = targetAtPointer();
    try { target.dispatchEvent(new MouseEvent('contextmenu', mouseOptions(2, 0))); } catch (_) {}
  }

  function scrollAtPointer(amount) {
    showCursor();
    let target = targetAtPointer();
    while (target && target !== document.body) {
      const style = getComputedStyle(target);
      const canScroll = target.scrollHeight > target.clientHeight + 2 && /(auto|scroll)/.test(style.overflowY);
      if (canScroll) {
        target.scrollBy({ top: Number(amount || 0) * 4, behavior: 'auto' });
        return;
      }
      target = target.parentElement;
    }
    window.scrollBy({ top: Number(amount || 0) * 4, behavior: 'auto' });
  }

  function routePointer(packet) {
    switch (packet.input) {
      case 'MOVE_X': state.x += Number(packet.value || 0); redraw(); break;
      case 'MOVE_Y': state.y += Number(packet.value || 0); redraw(); break;
      case 'CLICK_LEFT': leftButton(Boolean(packet.pressed)); break;
      case 'CLICK_RIGHT': rightButton(Boolean(packet.pressed)); break;
      case 'SCROLL_Y': scrollAtPointer(packet.value); break;
    }
  }

  function attachChannel(channel) {
    if (!channel || channel.__luxPointerAttached || channel.label !== 'lux-input') return;
    channel.__luxPointerAttached = true;
    channel.addEventListener('message', event => {
      try {
        const packet = JSON.parse(event.data);
        if (packet?.type === 'pointer') routePointer(packet);
      } catch (_) {}
    });
  }

  const proto = window.RTCPeerConnection?.prototype;
  if (!proto || typeof proto.createDataChannel !== 'function') return;
  const originalCreateDataChannel = proto.createDataChannel;
  proto.createDataChannel = function patchedCreateDataChannel(label, options) {
    const channel = originalCreateDataChannel.call(this, label, options);
    attachChannel(channel);
    return channel;
  };

  window.addEventListener('resize', () => { clampPointer(); if (state.cursor) redraw(); });
})();
