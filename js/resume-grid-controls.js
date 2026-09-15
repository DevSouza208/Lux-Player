(() => {
  'use strict';

  const VERSION = '20260915-resume-grid-controls-2';
  if (window.__luxResumeGridControlsInstalled === VERSION) return;
  window.__luxResumeGridControlsInstalled = VERSION;

  function isResumeGridActive() {
    try {
      return activeCategory === 'Continuar Assistindo' && ['movies', 'series'].includes(currentSection);
    } catch (_) {
      return false;
    }
  }

  function removeResumeItem(item) {
    if (!item) return;
    try {
      if (item.type === 'series') {
        const seriesId = item.series_id ?? item.id;
        if (typeof removeSeriesResumeState === 'function') removeSeriesResumeState(seriesId);
      } else if (typeof removeResumeData === 'function') {
        removeResumeData(item);
      }
    } catch (error) {
      console.warn('[LUX-RESUME-GRID] Não foi possível remover item do histórico.', error);
      return;
    }

    try { if (typeof renderHomeResume === 'function') renderHomeResume(); } catch (_) {}
    try { if (typeof renderCategories === 'function') renderCategories(); } catch (_) {}
    try { if (typeof filterMedia === 'function') filterMedia(); } catch (_) {}
  }

  function decorateGrid() {
    const grid = document.getElementById('vodGridContainer');
    if (!grid) return false;

    if (!isResumeGridActive()) {
      grid.querySelectorAll('.lux-resume-grid-remove').forEach(button => button.remove());
      return true;
    }

    let items = [];
    try {
      items = Array.isArray(currentFilteredItems) ? currentFilteredItems : [];
    } catch (_) {}

    [...grid.children].forEach((card, index) => {
      const item = items[index];
      if (!item || card.querySelector('.lux-resume-grid-remove')) return;

      const poster = card.firstElementChild;
      if (!poster) return;
      if (getComputedStyle(poster).position === 'static') poster.style.position = 'relative';

      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'lux-resume-grid-remove absolute right-2 w-7 h-7 rounded-full bg-black/70 hover:bg-rose-600 text-white flex items-center justify-center opacity-0 group-hover:opacity-100 transition-all z-30 shadow';
      button.style.top = item.isAdult ? '2.75rem' : '0.5rem';
      button.title = 'Remover do Continuar Assistindo';
      button.setAttribute('aria-label', 'Remover do Continuar Assistindo');
      button.innerHTML = '<i data-lucide="trash-2" class="w-3.5 h-3.5"></i>';
      button.onclick = event => {
        event.preventDefault();
        event.stopPropagation();
        removeResumeItem(item);
      };
      poster.appendChild(button);
    });

    try { window.lucide?.createIcons?.(); } catch (_) {
      try { if (typeof lucide !== 'undefined') lucide.createIcons(); } catch (_) {}
    }
    return true;
  }

  const observer = new MutationObserver(() => queueMicrotask(decorateGrid));

  function install() {
    const grid = document.getElementById('vodGridContainer');
    if (!grid) return false;
    if (!grid.dataset.luxResumeGridObserved) {
      grid.dataset.luxResumeGridObserved = '1';
      observer.observe(grid, { childList: true, subtree: true });
    }
    decorateGrid();
    return true;
  }

  document.addEventListener('click', () => setTimeout(decorateGrid, 0), true);

  let attempts = 0;
  const timer = setInterval(() => {
    attempts += 1;
    if (install() && attempts >= 20) clearInterval(timer);
    if (attempts >= 160) clearInterval(timer);
  }, 100);
})();
