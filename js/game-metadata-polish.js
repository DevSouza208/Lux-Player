(() => {
  'use strict';

  const VERSION = '20260917-game-metadata-polish1';
  if (window.__luxGameMetadataPolishVersion === VERSION) return;
  window.__luxGameMetadataPolishVersion = VERSION;

  const style = document.createElement('style');
  style.textContent = `
    #gameMetadataResults.lux-metadata-grid {
      display: grid !important;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: .55rem !important;
    }
    #gameMetadataResults.lux-metadata-grid > button {
      width: 100%;
      min-height: 72px;
      margin-top: 0 !important;
    }
    @media (max-width: 760px) {
      #gameMetadataResults.lux-metadata-grid {
        grid-template-columns: minmax(0, 1fr);
      }
    }
  `;
  document.head.appendChild(style);

  let autoSearchTimer = null;
  let lastAutoQuery = '';

  function ensureConsoleOptions() {
    const select = document.getElementById('gameAdminConsole');
    if (!select) return;

    const options = [
      ['arcade', 'Arcade'],
      ['mastersystem', 'Master System'],
      ['megadrive', 'Mega Drive'],
      ['n64', 'Nintendo 64'],
      ['nes', 'NES'],
      ['snes', 'SNES'],
      ['gba', 'Game Boy Advance'],
      ['gbc', 'Game Boy Color'],
      ['gb', 'Game Boy'],
      ['psp', 'PlayStation Portable']
    ];

    for (const [value, label] of options) {
      if (select.querySelector(`option[value="${value}"]`)) continue;
      const option = document.createElement('option');
      option.value = value;
      option.textContent = label;
      select.appendChild(option);
    }
  }

  function polishMetadataResults() {
    const results = document.getElementById('gameMetadataResults');
    if (!results) return;
    const cards = results.querySelectorAll(':scope > button');
    results.classList.toggle('lux-metadata-grid', cards.length > 0);
    if (cards.length) {
      results.classList.remove('space-y-2');
      cards.forEach(card => card.classList.add('min-w-0'));
    }
  }

  function queueAutoSearch(delay = 450) {
    const title = document.getElementById('gameAdminTitle');
    if (!title) return;
    const query = title.value.trim();
    if (query.length < 2) return;

    clearTimeout(autoSearchTimer);
    autoSearchTimer = setTimeout(() => {
      const current = title.value.trim();
      if (current.length < 2 || current === lastAutoQuery) return;
      lastAutoQuery = current;
      if (typeof window.searchGameMetadata === 'function') {
        Promise.resolve(window.searchGameMetadata()).finally(() => polishMetadataResults());
      }
    }, delay);
  }

  function installTitleListener() {
    const title = document.getElementById('gameAdminTitle');
    if (!title || title.dataset.luxMetadataAutoSearch === '1') return;
    title.dataset.luxMetadataAutoSearch = '1';
    title.addEventListener('input', () => queueAutoSearch(700));
  }

  function installFunctionPatches() {
    ensureConsoleOptions();
    installTitleListener();

    if (typeof window.searchGameMetadata === 'function' && !window.searchGameMetadata.__luxMetadataPolish) {
      const original = window.searchGameMetadata;
      const patched = async function (...args) {
        ensureConsoleOptions();
        const result = await original.apply(this, args);
        polishMetadataResults();
        return result;
      };
      patched.__luxMetadataPolish = VERSION;
      patched.__luxMetadataPolishOriginal = original;
      window.searchGameMetadata = patched;
    }

    if (typeof window.adminEditGame === 'function' && !window.adminEditGame.__luxMetadataPolish) {
      const original = window.adminEditGame;
      const patched = function (...args) {
        // Arcade já pode estar salvo no catálogo. A opção precisa existir ANTES
        // do editor atribuir select.value, senão o navegador deixa o campo vazio.
        ensureConsoleOptions();
        lastAutoQuery = '';
        const result = original.apply(this, args);
        installTitleListener();
        queueAutoSearch(180);
        return result;
      };
      patched.__luxMetadataPolish = VERSION;
      patched.__luxMetadataPolishOriginal = original;
      window.adminEditGame = patched;
    }

    if (typeof window.fillGameTitleFromRom === 'function' && !window.fillGameTitleFromRom.__luxMetadataPolish) {
      const original = window.fillGameTitleFromRom;
      const patched = function (...args) {
        ensureConsoleOptions();
        lastAutoQuery = '';
        const result = original.apply(this, args);
        Promise.resolve(result).finally(() => queueAutoSearch(220));
        return result;
      };
      patched.__luxMetadataPolish = VERSION;
      patched.__luxMetadataPolishOriginal = original;
      window.fillGameTitleFromRom = patched;
    }
  }

  const observer = new MutationObserver(() => {
    ensureConsoleOptions();
    installTitleListener();
    polishMetadataResults();
  });

  const watch = () => {
    const modal = document.getElementById('gameUploadModal');
    if (modal) observer.observe(modal, { childList: true, subtree: true });
  };

  installFunctionPatches();
  watch();

  const interval = setInterval(() => {
    installFunctionPatches();
    if (window.adminEditGame?.__luxMetadataPolish && window.searchGameMetadata?.__luxMetadataPolish) {
      clearInterval(interval);
    }
  }, 100);
  setTimeout(() => clearInterval(interval), 15000);

  document.addEventListener('DOMContentLoaded', () => {
    installFunctionPatches();
    watch();
  }, { once: true });
})();
