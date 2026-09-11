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

// Mantém o número exibido na tela de login alinhado ao package.json da versão 1.5.0.
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

// Módulos isolados do script principal.
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

// UX dedicada a celular. Não carrega JS e não aplica CSS em desktop/tablet >= 768px.
(() => {
  if (!window.matchMedia('(max-width: 767px)').matches) return;

  const styles = [
    ['lux-mobile-ux', 'css/mobile-ux.css?v=20260911-2'],
    ['lux-mobile-emulator-fix', 'css/mobile-emulator-fix.css?v=20260911-1']
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

  const loadMobileUx = () => {
    if (document.querySelector('script[data-lux-mobile-ux]')) return;
    const script = document.createElement('script');
    script.src = 'js/mobile-ux.js?v=20260911-2';
    script.dataset.luxMobileUx = '1';
    document.body.appendChild(script);
  };

  // Espera os módulos principais (emulador/leitor) terminarem de carregar para poder
  // envolvê-los sem alterar a implementação desktop.
  if (document.readyState === 'complete') loadMobileUx();
  else window.addEventListener('load', loadMobileUx, { once: true });
})();
