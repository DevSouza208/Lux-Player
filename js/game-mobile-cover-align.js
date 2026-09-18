(() => {
  'use strict';

  const VERSION = '20260918-cover-align1';
  if (window.__luxGameMobileCoverAlign === VERSION) return;
  window.__luxGameMobileCoverAlign = VERSION;

  let scheduled = false;

  function isCompact() {
    try { return window.matchMedia('(max-width:1023px)').matches; }
    catch (_) { return window.innerWidth <= 1023; }
  }

  function alignCoverWithTitle() {
    scheduled = false;
    const modal = document.getElementById('gameDetailsModal');
    const cover = document.getElementById('gameDetailsCover');
    const title = document.getElementById('gameDetailsTitle');
    if (!modal || !cover || !title || modal.classList.contains('hidden')) return;

    if (!isCompact()) {
      cover.style.transform = '';
      return;
    }

    // Measure from the natural grid position every time so resize/orientation
    // changes never accumulate offsets.
    cover.style.transform = 'none';
    const coverRect = cover.getBoundingClientRect();
    const titleRect = title.getBoundingClientRect();
    const offset = Math.round(titleRect.top - coverRect.top);

    // Guard against transient measurements while the modal is still mounting.
    if (!Number.isFinite(offset) || Math.abs(offset) > 140) return;
    cover.style.transform = `translateY(${offset}px)`;
  }

  function scheduleAlign() {
    if (scheduled) return;
    scheduled = true;
    requestAnimationFrame(() => requestAnimationFrame(alignCoverWithTitle));
  }

  const observer = new MutationObserver(scheduleAlign);

  function start() {
    observer.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['class']
    });
    window.addEventListener('resize', scheduleAlign, { passive: true });
    window.addEventListener('orientationchange', scheduleAlign, { passive: true });
    scheduleAlign();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true });
  else start();
})();
