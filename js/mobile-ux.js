(() => {
  'use strict';

  const mobileQuery = window.matchMedia('(max-width: 767px)');
  if (!mobileQuery.matches || window.__luxMobileUxInstalled) return;
  window.__luxMobileUxInstalled = true;
  document.body.classList.add('lux-mobile-ux');

  const $ = id => document.getElementById(id);
  const icon = name => `<i data-lucide="${name}" aria-hidden="true"></i>`;

  function refreshIcons() { try { window.lucide?.createIcons?.(); } catch (_) {} }
  function overlay(open) { document.body.classList.toggle('lux-mobile-overlay-open', !!open); }

  function closeSheet(sheet) {
    if (!sheet) return;
    sheet.hidden = true;
    overlay(false);
  }

  function createSheet(id, title) {
    let sheet = $(id);
    if (sheet) return sheet;
    sheet = document.createElement('div');
    sheet.id = id;
    sheet.className = 'lux-mobile-sheet';
    sheet.hidden = true;
    sheet.innerHTML = `<div class="lux-mobile-sheet-card" role="dialog" aria-modal="true" aria-label="${title}">
      <div class="lux-mobile-sheet-head"><h2>${title}</h2><button type="button" class="lux-mobile-sheet-close" aria-label="Fechar">✕</button></div>
      <div class="lux-mobile-sheet-body"></div>
    </div>`;
    document.body.appendChild(sheet);
    sheet.querySelector('.lux-mobile-sheet-close').onclick = () => closeSheet(sheet);
    sheet.addEventListener('click', event => { if (event.target === sheet) closeSheet(sheet); });
    return sheet;
  }

  function openReadingFilters() {
    const sheet = createSheet('luxMobileReadingFilters', 'Filtros da biblioteca');
    const body = sheet.querySelector('.lux-mobile-sheet-body');
    const category = $('readingCategory');
    const author = $('readingAuthor');
    const sort = $('readingSort');
    const importCategory = $('readingImportCategory');
    const options = select => select ? [...select.options].map(option => `<option value="${String(option.value).replaceAll('"', '&quot;')}">${option.textContent}</option>`).join('') : '';

    body.innerHTML = `<label class="lux-mobile-filter-field">Gênero<select id="luxReadingCategoryMirror">${options(category)}</select></label>
      <label class="lux-mobile-filter-field">Autor<select id="luxReadingAuthorMirror">${options(author)}</select></label>
      <label class="lux-mobile-filter-field">Ordenação<select id="luxReadingSortMirror">${options(sort)}</select></label>
      <label class="lux-mobile-filter-field">Importar como<select id="luxReadingImportMirror">${options(importCategory)}</select></label>
      <button id="luxReadingApply" type="button" class="lux-mobile-sheet-primary">Aplicar filtros</button>
      <button id="luxReadingImportFileMobile" type="button" class="lux-mobile-sheet-secondary">＋ Importar arquivos</button>
      <button id="luxReadingImportFolderMobile" type="button" class="lux-mobile-sheet-secondary">Importar pasta de imagens</button>`;

    const mirrors = [
      [$('luxReadingCategoryMirror'), category],
      [$('luxReadingAuthorMirror'), author],
      [$('luxReadingSortMirror'), sort],
      [$('luxReadingImportMirror'), importCategory]
    ];
    mirrors.forEach(([mirror, original]) => { if (mirror && original) mirror.value = original.value; });

    $('luxReadingApply').onclick = () => {
      mirrors.forEach(([mirror, original]) => {
        if (!mirror || !original || mirror.value === original.value) return;
        original.value = mirror.value;
        original.dispatchEvent(new Event('change', { bubbles: true }));
      });
      closeSheet(sheet);
    };
    $('luxReadingImportFileMobile').onclick = () => { closeSheet(sheet); $('readingImportFile')?.click(); };
    $('luxReadingImportFolderMobile').onclick = () => { closeSheet(sheet); $('readingImportFolder')?.click(); };
    sheet.hidden = false;
    overlay(true);
  }

  function enhanceReadingSection() {
    const tools = $('readingSection')?.querySelector('.reading-tools');
    if (!tools || tools.querySelector('.lux-mobile-reading-filter-button')) return;
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'lux-mobile-reading-filter-button';
    button.innerHTML = `${icon('sliders-horizontal')} Filtros`;
    button.onclick = openReadingFilters;
    tools.appendChild(button);
    refreshIcons();
  }

  function enhanceGameDetails() {
    const modal = $('gameDetailsModal');
    if (!modal || modal.dataset.luxMobileEnhanced) return;
    modal.dataset.luxMobileEnhanced = '1';
    const synopsis = $('gameDetailsSynopsis');
    if (synopsis) {
      const toggle = document.createElement('button');
      toggle.type = 'button';
      toggle.className = 'lux-mobile-synopsis-toggle';
      toggle.textContent = 'Ler mais';
      toggle.onclick = () => {
        const open = modal.classList.toggle('lux-synopsis-open');
        toggle.textContent = open ? 'Mostrar menos' : 'Ler mais';
      };
      synopsis.after(toggle);
    }
  }

  // Preserve only the mobile catalog/details improvements. EmulatorJS is left untouched.
  if (typeof openGameDetails === 'function') {
    const original = openGameDetails;
    openGameDetails = function (...args) {
      const result = original.apply(this, args);
      enhanceGameDetails();
      return result;
    };
  }

  const reading = $('readingSection');
  if (reading) new MutationObserver(() => queueMicrotask(enhanceReadingSection)).observe(reading, { childList: true, subtree: true });
  const splash = $('loadingSplash');
  if (splash) new MutationObserver(() => {
    document.body.classList.toggle('lux-mobile-overlay-open', !splash.classList.contains('hidden'));
  }).observe(splash, { attributes: true, attributeFilter: ['class'] });

  enhanceReadingSection();
})();
