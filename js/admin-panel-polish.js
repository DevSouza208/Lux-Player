(() => {
  'use strict';

  const VERSION = '20260915-admin-panel-polish1';
  if (window.__luxAdminPanelPolish === VERSION) return;
  window.__luxAdminPanelPolish = VERSION;

  const ICONS = {
    clientes: 'users', sources: 'database', games: 'gamepad-2', books: 'book-open',
    vods: 'film', avatars: 'image', functionalities: 'map', categories: 'tags',
    notifications: 'bell', settings: 'settings', sync: 'refresh-cw'
  };

  const LABELS = {
    clientes: 'Clientes', sources: 'Fontes', games: 'Jogos', books: 'Livros',
    vods: 'VODs', avatars: 'Avatares', functionalities: 'Funcionalidades',
    categories: 'Categorias', notifications: 'Avisos', settings: 'Configurações', sync: 'Sincronização'
  };

  function tabKey(button) { return String(button?.dataset?.adminTab || '').trim().toLowerCase(); }

  function removeProviders(root) {
    if (!root) return;
    root.querySelectorAll('[data-admin-tab="providers"], #adminTabProviders, [data-provider-admin], [data-content-providers]').forEach(node => node.remove());
    root.querySelectorAll('button, a, h2, h3, h4, strong').forEach(node => {
      const text = String(node.textContent || '').trim();
      if (/^providers?(?: de conte[uú]do)?$/i.test(text)) {
        const card = node.closest('[data-provider-admin], section[data-content-providers]');
        if (card) card.remove();
        else if (node.matches('button,a')) node.remove();
      }
    });
  }

  function injectStyles() {
    if (document.getElementById('luxAdminPolishStyles')) return;
    const style = document.createElement('style');
    style.id = 'luxAdminPolishStyles';
    style.textContent = `
      #adminModal .lux-admin-shell{display:grid;grid-template-columns:210px minmax(0,1fr);gap:14px;min-height:0;height:100%}
      #adminModal .lux-admin-sidebar{min-height:0;display:flex;flex-direction:column;border:1px solid rgba(126,34,206,.28);background:linear-gradient(180deg,rgba(24,15,41,.96),rgba(13,8,23,.96));border-radius:20px;padding:12px}
      #adminModal .lux-admin-brand{padding:8px 8px 14px;border-bottom:1px solid rgba(126,34,206,.22);margin-bottom:10px}
      #adminModal .lux-admin-brand small{display:block;color:#a78bfa;font-size:9px;letter-spacing:.16em;text-transform:uppercase;font-weight:800}
      #adminModal .lux-admin-brand strong{display:block;color:#fff;font-size:15px;margin-top:3px}
      #adminModal .lux-admin-tabs{display:flex!important;flex-direction:column!important;gap:5px!important;overflow:auto!important;padding:0!important;background:transparent!important;border:0!important}
      #adminModal .lux-admin-tabs .admin-tab-btn{width:100%;display:flex;align-items:center;gap:9px;text-align:left;border-radius:12px!important;padding:9px 10px!important;font-size:11px!important;background:transparent!important;border:1px solid transparent!important;color:#c4b5fd!important;box-shadow:none!important}
      #adminModal .lux-admin-tabs .admin-tab-btn:hover{background:rgba(88,28,135,.22)!important;color:white!important}
      #adminModal .lux-admin-tabs .admin-tab-btn.lux-admin-active{background:linear-gradient(135deg,#7c3aed,#5b21b6)!important;border-color:rgba(196,181,253,.2)!important;color:#fff!important}
      #adminModal .lux-admin-tab-icon{width:15px;height:15px;flex:0 0 auto}
      #adminModal .lux-admin-content{min-width:0;min-height:0;overflow:hidden;display:flex;flex-direction:column;border:1px solid rgba(126,34,206,.22);background:rgba(9,6,14,.72);border-radius:20px;padding:14px}
      #adminModal .lux-admin-content>.admin-tab-panel{min-height:0;flex:1;overflow:auto;padding-right:3px}
      #adminModal .lux-admin-mobile-select{display:none;width:100%;margin-bottom:10px;background:#180f29;border:1px solid rgba(126,34,206,.45);color:#ede9fe;border-radius:12px;padding:10px 12px;font-size:12px}
      @media(max-width:800px){#adminModal .lux-admin-shell{display:flex;flex-direction:column;gap:8px}#adminModal .lux-admin-sidebar{padding:8px;border-radius:16px}#adminModal .lux-admin-brand{display:none}#adminModal .lux-admin-tabs{display:none!important}#adminModal .lux-admin-mobile-select{display:block}#adminModal .lux-admin-content{border-radius:16px;padding:10px;overflow:auto}}
    `;
    document.head.appendChild(style);
  }

  function decorateTabs(tabBar) {
    [...tabBar.querySelectorAll('.admin-tab-btn')].forEach(button => {
      const key = tabKey(button);
      if (!key || key === 'providers') return;
      if (!button.dataset.luxAdminDecorated) {
        const label = LABELS[key] || String(button.textContent || '').trim();
        button.textContent = '';
        const icon = document.createElement('i');
        icon.dataset.lucide = ICONS[key] || 'circle';
        icon.className = 'lux-admin-tab-icon';
        const span = document.createElement('span');
        span.textContent = label;
        button.append(icon, span);
        button.dataset.luxAdminDecorated = '1';
      }
    });
    try { window.lucide?.createIcons?.(); } catch (_) {}
  }

  function syncActive(root, select) {
    const panels = [...root.querySelectorAll('.admin-tab-panel')];
    const visible = panels.find(panel => !panel.classList.contains('hidden'));
    const key = visible?.id?.replace(/^adminTab/, '').toLowerCase() || 'clientes';
    root.querySelectorAll('.admin-tab-btn').forEach(button => button.classList.toggle('lux-admin-active', tabKey(button) === key));
    if (select && [...select.options].some(o => o.value === key)) select.value = key;
  }

  function rebuild() {
    const modal = document.getElementById('adminModal');
    if (!modal) return false;
    injectStyles();
    removeProviders(modal);

    let tabBar = modal.querySelector('.admin-tab-btn')?.parentElement;
    const firstPanel = modal.querySelector('.admin-tab-panel');
    if (!tabBar || !firstPanel) return false;
    decorateTabs(tabBar);

    let shell = modal.querySelector('.lux-admin-shell');
    if (!shell) {
      const panels = [...modal.querySelectorAll('.admin-tab-panel')];
      const panelHost = firstPanel.parentElement;
      shell = document.createElement('div');
      shell.className = 'lux-admin-shell';
      const sidebar = document.createElement('aside');
      sidebar.className = 'lux-admin-sidebar';
      const brand = document.createElement('div');
      brand.className = 'lux-admin-brand';
      brand.innerHTML = '<small>Central de controle</small><strong>Administração Lux</strong>';
      const select = document.createElement('select');
      select.className = 'lux-admin-mobile-select';
      sidebar.append(brand, select);
      tabBar.classList.add('lux-admin-tabs');
      sidebar.appendChild(tabBar);
      const content = document.createElement('main');
      content.className = 'lux-admin-content';
      panels.forEach(panel => content.appendChild(panel));
      panelHost.appendChild(shell);
      shell.append(sidebar, content);
      select.addEventListener('change', () => window.switchAdminTab?.(select.value));
    }

    const select = shell.querySelector('.lux-admin-mobile-select');
    if (select) {
      select.replaceChildren();
      [...shell.querySelectorAll('.admin-tab-btn')].forEach(button => {
        const key = tabKey(button); if (!key || key === 'providers') return;
        const option = document.createElement('option'); option.value = key; option.textContent = LABELS[key] || button.textContent.trim(); select.appendChild(option);
      });
    }
    syncActive(modal, select);
    return true;
  }

  const originalSwitch = window.switchAdminTab;
  if (typeof originalSwitch === 'function' && !originalSwitch.__luxAdminPolishWrapped) {
    const wrapped = function(tab) {
      if (String(tab).toLowerCase() === 'providers') tab = 'clientes';
      const result = originalSwitch.apply(this, arguments.length ? [tab] : arguments);
      queueMicrotask(() => rebuild());
      return result;
    };
    wrapped.__luxAdminPolishWrapped = true;
    window.switchAdminTab = wrapped;
  }

  let attempts = 0;
  const timer = setInterval(() => { attempts += 1; if (rebuild() || attempts > 160) clearInterval(timer); }, 50);
  const observer = new MutationObserver(() => { if (document.getElementById('adminModal')) rebuild(); });
  observer.observe(document.documentElement, { childList: true, subtree: true });
})();