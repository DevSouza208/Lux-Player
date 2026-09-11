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

// Controles móveis ficam isolados do script principal.
(() => {
  const modules = [
    ['lux-gamepad-host', 'js/lux-gamepad-host.js?v=20260910-webrtc-pwa'],
    ['lux-remote-host', 'js/lux-remote-host.js?v=20260910-1']
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
