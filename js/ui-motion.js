const screenAnimations = new WeakMap();

async function transitionScreen(element, show) {
  if (!element) return;
  screenAnimations.get(element)?.cancel();
  if (!show && element.classList.contains('hidden')) return;
  element.classList.remove('hidden', 'screen-hidden-up', 'screen-hidden-down');
  element.classList.add('screen-visible');
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const frames = show
    ? [{ opacity: 0, transform: 'translateY(12px) scale(.99)' }, { opacity: 1, transform: 'none' }]
    : [{ opacity: 1, transform: 'none' }, { opacity: 0, transform: 'translateY(-8px) scale(.995)' }];
  const animation = element.animate(frames, { duration: reduced ? 0 : 300, easing: 'cubic-bezier(.2,.8,.2,1)', fill: 'both' });
  screenAnimations.set(element, animation);
  try { await animation.finished; } catch (_) { return; }
  if (screenAnimations.get(element) !== animation) return;
  if (!show) element.classList.add('hidden');
  animation.cancel();
  screenAnimations.delete(element);
}

function animateDashboardEntry() {
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  document.getElementById('mainDashboard')?.animate(
    [{ opacity: .35, transform: 'translateY(8px)' }, { opacity: 1, transform: 'none' }],
    { duration: 320, easing: 'cubic-bezier(.2,.8,.2,1)' }
  );
}

(() => {
  const applyVersion = () => {
    const auth = document.getElementById('authScreen');
    if (!auth) return;
    const badge = [...auth.querySelectorAll('div')].find(el => /^versão\s+[\d.]+$/i.test((el.textContent || '').trim()));
    if (badge) badge.textContent = 'versão 1.5.0';
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', applyVersion, { once: true });
  else applyVersion();
})();

(() => {
  const ensureLink = (rel, href, extra = {}) => {
    let link = document.head.querySelector(`link[rel="${rel}"][data-lux-pwa-meta]`);
    if (!link) {
      link = document.createElement('link');
      link.rel = rel;
      link.dataset.luxPwaMeta = '1';
      document.head.appendChild(link);
    }
    link.href = href;
    Object.entries(extra).forEach(([key, value]) => link.setAttribute(key, value));
  };
  const ensureMeta = (name, content) => {
    let meta = document.head.querySelector(`meta[name="${name}"][data-lux-pwa-meta]`);
    if (!meta) {
      meta = document.createElement('meta');
      meta.name = name;
      meta.dataset.luxPwaMeta = '1';
      document.head.appendChild(meta);
    }
    meta.content = content;
  };

  ensureLink('manifest', 'manifest.webmanifest?v=20260911-icons1');
  ensureLink('icon', 'lux-play-icon.svg?v=20260911-icons1', { type: 'image/svg+xml' });
  ensureLink('apple-touch-icon', 'icon.png?v=20260911-icons1');
  ensureMeta('theme-color', '#09060e');
  ensureMeta('apple-mobile-web-app-capable', 'yes');
  ensureMeta('apple-mobile-web-app-status-bar-style', 'black-translucent');
})();

(() => {
  const modules = [
    ['lux-gamepad-host', 'js/lux-gamepad-host.js?v=20260910-v151'],
    ['lux-remote-host', 'js/lux-remote-host.js?v=20260910-v151'],
    ['lux-emulator-speed', 'js/emulator-speed-fix.js?v=20260911-v1']
  ];
  modules.forEach(([name, src]) => {
    if (document.querySelector(`script[data-${name}]`)) return;
    const script = document.createElement('script');
    script.src = src;
    script.dataset[name.replaceAll('-', '')] = '1';
    script.setAttribute(`data-${name}`, '1');
    script.async = true;
    document.head.appendChild(script);
  });
})();

(() => {
  if (!window.matchMedia('(max-width: 767px)').matches) return;

  const styles = [
    ['lux-mobile-ux', 'css/mobile-ux.css?v=20260911-nativeemu1'],
    ['lux-mobile-console', 'css/mobile-lux-console.css?v=20260911-viewmodes1'],
    ['lux-mobile-controls', 'css/mobile-lux-controls.css?v=20260911-viewmodes1'],
    ['lux-mobile-landscape-tune', 'css/mobile-lux-landscape-tune.css?v=20260911-landscape1'],
    ['lux-mobile-ergonomics-tune', 'css/mobile-lux-ergonomics-tune.css?v=20260911-ergonomics2'],
    ['lux-mobile-context', 'css/mobile-lux-context.css?v=20260911-context1'],
    ['lux-mobile-final-tune', 'css/mobile-lux-final-tune.css?v=20260911-final2'],
    ['lux-mobile-settings', 'css/mobile-lux-settings.css?v=20260911-settings1']
  ];
  styles.forEach(([name, href]) => {
    if (document.querySelector(`link[data-${name}]`)) return;
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = href;
    link.media = '(max-width: 767px)';
    link.setAttribute(`data-${name}`, '1');
    document.head.appendChild(link);
  });

  const loadMobileScripts = () => {
    const scripts = [
      ['lux-mobile-ux', 'js/mobile-ux.js?v=20260911-nativeemu1'],
      ['lux-mobile-console', 'js/mobile-lux-console.js?v=20260911-viewmodes1'],
      ['lux-mobile-actions', 'js/mobile-lux-actions.js?v=20260911-actions2'],
      ['lux-mobile-settings', 'js/mobile-lux-settings.js?v=20260911-settings1']
    ];
    scripts.forEach(([name, src]) => {
      if (document.querySelector(`script[data-${name}]`)) return;
      const script = document.createElement('script');
      script.src = src;
      script.setAttribute(`data-${name}`, '1');
      document.body.appendChild(script);
    });
  };

  if (document.readyState === 'complete') loadMobileScripts();
  else window.addEventListener('load', loadMobileScripts, { once: true });
})();
