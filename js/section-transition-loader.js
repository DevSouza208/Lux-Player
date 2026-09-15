(() => {
  'use strict';

  const VERSION = '20260915-section-loader1';
  if (window.__luxSectionTransitionLoaderInstalled === VERSION) return;

  const MIN_DURATION = 1000;
  const HOME_SECTION = 'home';
  const LABELS = {
    live: {
      title: 'Preparando seus canais',
      subtitle: 'Organizando a programação...'
    },
    movies: {
      title: 'Preparando seus filmes',
      subtitle: 'Carregando capas e destaques...'
    },
    series: {
      title: 'Preparando suas séries',
      subtitle: 'Carregando capas e temporadas...'
    },
    games: {
      title: 'Preparando seus jogos',
      subtitle: 'Preparando sua biblioteca retrô...'
    },
    reading: {
      title: 'Preparando sua leitura',
      subtitle: 'Organizando sua biblioteca...'
    }
  };

  let transitionToken = 0;
  let installed = false;
  let lastSection = HOME_SECTION;

  function currentSectionValue() {
    try {
      if (typeof currentSection !== 'undefined') return String(currentSection || HOME_SECTION);
    } catch (_) {}
    return lastSection;
  }

  function ensureStyles() {
    if (document.getElementById('luxSectionTransitionLoaderStyle')) return;
    const style = document.createElement('style');
    style.id = 'luxSectionTransitionLoaderStyle';
    style.textContent = `
      #luxSectionTransitionLoader {
        position: fixed;
        inset: 0;
        z-index: 2147483000;
        display: flex;
        align-items: center;
        justify-content: center;
        background: #09060e;
        opacity: 0;
        visibility: hidden;
        pointer-events: none;
        transition: opacity 120ms ease, visibility 0s linear 120ms;
      }
      #luxSectionTransitionLoader[data-visible="1"] {
        opacity: 1;
        visibility: visible;
        pointer-events: all;
        transition: opacity 90ms ease;
      }
      #luxSectionTransitionLoader .lux-section-loader-content {
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        gap: 18px;
        padding: 32px;
        text-align: center;
      }
      #luxSectionTransitionLoader .lux-section-loader-icon {
        width: 68px;
        height: 68px;
        border-radius: 22px;
        border: 1px solid rgba(147, 51, 234, .35);
        background: rgba(38, 20, 61, .72);
        display: grid;
        place-items: center;
        box-shadow: 0 14px 38px rgba(0, 0, 0, .28);
      }
      #luxSectionTransitionLoader .lux-section-loader-ring {
        width: 31px;
        height: 31px;
        border-radius: 999px;
        border: 3px solid rgba(196, 181, 253, .25);
        border-top-color: rgba(196, 181, 253, .9);
        animation: lux-section-loader-spin .72s linear infinite;
      }
      #luxSectionTransitionLoader .lux-section-loader-title {
        margin: 0;
        color: #e9ddf7;
        font-size: 20px;
        line-height: 1.15;
        font-weight: 800;
      }
      #luxSectionTransitionLoader .lux-section-loader-subtitle {
        margin: -8px 0 0;
        color: rgba(192, 132, 252, .72);
        font-size: 16px;
        line-height: 1.25;
        font-weight: 500;
      }
      @keyframes lux-section-loader-spin { to { transform: rotate(360deg); } }
      @media (max-width: 767px) {
        #luxSectionTransitionLoader .lux-section-loader-icon { width: 60px; height: 60px; border-radius: 19px; }
        #luxSectionTransitionLoader .lux-section-loader-ring { width: 28px; height: 28px; }
        #luxSectionTransitionLoader .lux-section-loader-title { font-size: 18px; }
        #luxSectionTransitionLoader .lux-section-loader-subtitle { font-size: 14px; }
      }
      @media (prefers-reduced-motion: reduce) {
        #luxSectionTransitionLoader { transition: none; }
        #luxSectionTransitionLoader .lux-section-loader-ring { animation-duration: 1.2s; }
      }
    `;
    document.head.appendChild(style);
  }

  function ensureOverlay() {
    ensureStyles();
    let overlay = document.getElementById('luxSectionTransitionLoader');
    if (overlay) return overlay;

    overlay = document.createElement('div');
    overlay.id = 'luxSectionTransitionLoader';
    overlay.dataset.visible = '0';
    overlay.setAttribute('aria-hidden', 'true');
    overlay.innerHTML = `
      <div class="lux-section-loader-content" role="status" aria-live="polite">
        <div class="lux-section-loader-icon" aria-hidden="true">
          <div class="lux-section-loader-ring"></div>
        </div>
        <p class="lux-section-loader-title">Preparando conteúdo</p>
        <p class="lux-section-loader-subtitle">Só um instante...</p>
      </div>
    `;
    document.body.appendChild(overlay);
    return overlay;
  }

  function sectionCopy(section) {
    return LABELS[section] || {
      title: 'Preparando conteúdo',
      subtitle: 'Só um instante...'
    };
  }

  function show(section) {
    const overlay = ensureOverlay();
    const copy = sectionCopy(section);
    const title = overlay.querySelector('.lux-section-loader-title');
    const subtitle = overlay.querySelector('.lux-section-loader-subtitle');
    if (title) title.textContent = copy.title;
    if (subtitle) subtitle.textContent = copy.subtitle;
    overlay.dataset.visible = '1';
    overlay.setAttribute('aria-hidden', 'false');
    document.documentElement.dataset.luxSectionLoading = section;
    return ++transitionToken;
  }

  function hide(token) {
    if (token !== transitionToken) return;
    const overlay = document.getElementById('luxSectionTransitionLoader');
    if (!overlay) return;
    overlay.dataset.visible = '0';
    overlay.setAttribute('aria-hidden', 'true');
    delete document.documentElement.dataset.luxSectionLoading;
  }

  function warmVisibleArtwork() {
    requestAnimationFrame(() => requestAnimationFrame(() => {
      const candidates = [...document.querySelectorAll('#mainDashboard img')]
        .filter(image => {
          const rect = image.getBoundingClientRect();
          if (rect.width <= 0 || rect.height <= 0) return false;
          if (rect.bottom < 0 || rect.top > window.innerHeight) return false;
          const style = getComputedStyle(image);
          return style.display !== 'none' && style.visibility !== 'hidden';
        })
        .slice(0, 14);

      candidates.forEach((image, index) => {
        try {
          image.loading = 'eager';
          image.decoding = 'async';
          if (index < 6) image.fetchPriority = 'high';
          image.decode?.().catch(() => {});
        } catch (_) {}
      });
    }));
  }

  function install() {
    if (installed) return true;
    if (typeof window.setSection !== 'function') return false;

    const original = window.setSection;
    if (original.__luxSectionTransitionLoader) {
      installed = true;
      window.__luxSectionTransitionLoaderInstalled = VERSION;
      return true;
    }

    const wrapped = function(section) {
      const target = String(section || HOME_SECTION);
      const previous = currentSectionValue();

      if (target === HOME_SECTION || target === previous) {
        lastSection = target;
        return original.apply(this, arguments);
      }

      const startedAt = performance.now();
      const token = show(target);
      lastSection = target;

      let result;
      try {
        result = original.apply(this, arguments);
      } catch (error) {
        const remaining = Math.max(0, MIN_DURATION - (performance.now() - startedAt));
        setTimeout(() => hide(token), remaining);
        throw error;
      }

      warmVisibleArtwork();
      const remaining = Math.max(0, MIN_DURATION - (performance.now() - startedAt));
      setTimeout(() => hide(token), remaining);
      return result;
    };

    wrapped.__luxSectionTransitionLoader = VERSION;
    window.setSection = wrapped;
    installed = true;
    window.__luxSectionTransitionLoaderInstalled = VERSION;
    window.LuxSectionLoader = {
      version: VERSION,
      show: section => show(String(section || 'content')),
      hide,
      warm: warmVisibleArtwork
    };
    return true;
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', ensureOverlay, { once: true });
  } else {
    ensureOverlay();
  }

  if (!install()) {
    let attempts = 0;
    const timer = setInterval(() => {
      attempts += 1;
      if (install() || attempts >= 240) clearInterval(timer);
    }, 25);
  }
})();
