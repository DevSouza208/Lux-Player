(() => {
  'use strict';

  const VERSION = '20260918-section-fade1';
  if (window.__luxSectionTransitionLoaderInstalled === VERSION) return;

  const HOME_SECTION = 'home';
  const DURATION_MS = 180;
  let installed = false;
  let lastSection = HOME_SECTION;

  function currentSectionValue() {
    try {
      if (typeof currentSection !== 'undefined') return String(currentSection || HOME_SECTION);
    } catch (_) {}
    return lastSection;
  }

  function prefersReducedMotion() {
    try {
      return window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches === true;
    } catch (_) {
      return false;
    }
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

  function animateSection(section) {
    const dashboard = document.getElementById('mainDashboard');
    if (!dashboard || prefersReducedMotion()) return;

    try {
      dashboard.getAnimations?.().forEach(animation => {
        if (animation?.id === 'lux-section-enter') animation.cancel();
      });

      const animation = dashboard.animate(
        [
          { opacity: 0.72, transform: 'translateY(5px)' },
          { opacity: 1, transform: 'translateY(0)' }
        ],
        {
          duration: DURATION_MS,
          easing: 'cubic-bezier(.2,.8,.2,1)',
          fill: 'none'
        }
      );
      animation.id = 'lux-section-enter';
    } catch (_) {}
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
      lastSection = target;

      const result = original.apply(this, arguments);

      if (target !== previous) {
        animateSection(target);
        warmVisibleArtwork();
        window.LuxDevkit?.info('SECTION', 'transicao', 'Transição suave aplicada', {
          from: previous,
          to: target,
          durationMs: DURATION_MS
        });
      }

      return result;
    };

    wrapped.__luxSectionTransitionLoader = VERSION;
    window.setSection = wrapped;
    installed = true;
    window.__luxSectionTransitionLoaderInstalled = VERSION;

    // Compatibilidade temporária com chamadas antigas. Não existe mais overlay/loading.
    window.LuxSectionLoader = {
      version: VERSION,
      show: () => 0,
      hide: () => {},
      warm: warmVisibleArtwork,
      animate: animateSection
    };

    // Remove qualquer overlay antigo que tenha sobrevivido em cache/DOM.
    try { document.getElementById('luxSectionTransitionLoader')?.remove(); } catch (_) {}

    return true;
  }

  if (!install()) {
    let attempts = 0;
    const timer = setInterval(() => {
      attempts += 1;
      if (install() || attempts >= 240) clearInterval(timer);
    }, 25);
  }
})();

(() => {
  if (document.querySelector('script[data-lux-sports-admin-source]')) return;
  const script = document.createElement('script');
  script.src = 'js/sports-admin-source-bridge.js?v=20260915-sports-admin-source1';
  script.async = true;
  script.dataset.luxSportsAdminSource = '1';
  document.head.appendChild(script);
})();
