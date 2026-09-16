(() => {
  'use strict';

  const VERSION = '20260916-admin-hub3';
  if (window.__luxAdminPanelPolish === VERSION) return;
  window.__luxAdminPanelPolish = VERSION;

  const ICONS = { overview:'layout-dashboard', clientes:'users', games:'gamepad-2', books:'book-open', highlights:'sparkles', destaques:'sparkles', vods:'film', avatars:'image', functionalities:'map', sources:'database', fontes:'database' };
  const LABELS = { overview:'Visão geral', clientes:'Clientes', games:'Jogos', books:'Livros', highlights:'Destaques', destaques:'Destaques', vods:'VODs & R2', avatars:'Avatares', functionalities:'Funcionalidades', sources:'Fontes', fontes:'Fontes' };
  const DESCRIPTIONS = {
    clientes:'Contas, acessos, listas e vencimentos', games:'Catálogo, ROMs e compatibilidade dos cores', books:'Biblioteca, HQs e arquivos de leitura', highlights:'Banners e destaques da página inicial', destaques:'Banners e destaques da página inicial',
    vods:'Catálogo secundário e armazenamento R2', avatars:'Galeria compartilhada de fotos de perfil', functionalities:'Mapa técnico do Lux em produção e homologação', sources:'Google Drive e outras origens do catálogo', fontes:'Google Drive e outras origens do catálogo'
  };

  const create = (tag, cls='', text='') => { const el=document.createElement(tag); if(cls) el.className=cls; if(text) el.textContent=text; return el; };
  const tabKey = button => String(button?.dataset?.adminTab || '').trim().toLowerCase();
  function removeProviders(root) { root?.querySelectorAll('[data-admin-tab="providers"],#adminTabProviders,[data-provider-admin],[data-content-providers]').forEach(n=>n.remove()); }

  function injectStyles() {
    if (document.getElementById('luxAdminPolishStyles')) return;
    const s=create('style'); s.id='luxAdminPolishStyles'; s.textContent=`
      #adminModal>div{max-width:1440px!important;width:min(96vw,1440px)!important;height:min(92vh,900px)!important;max-height:92vh!important;padding:14px!important;background:linear-gradient(145deg,#120c1f 0%,#0b0712 100%)!important}
      #adminModal .lux-admin-header{position:relative!important;margin:-2px -2px 12px;padding:10px 12px 14px 52px!important;border-bottom:1px solid rgba(126,34,206,.22)}
      #adminModal .lux-admin-header-title{font-size:16px;font-weight:900;color:white;display:flex;align-items:center;gap:9px}.lux-admin-header-title svg{color:#a78bfa}
      #adminModal .lux-admin-header-sub{font-size:10px;color:#8b7ba8;margin:3px 0 0 25px}
      #adminModal .lux-admin-close{position:absolute!important;left:10px!important;right:auto!important;top:50%!important;transform:translateY(-50%)!important;margin:0!important;z-index:4!important;width:30px!important;height:30px!important;display:grid!important;place-items:center!important}
      #adminModal .lux-admin-shell{display:grid;grid-template-columns:218px minmax(0,1fr);gap:12px;min-height:0;height:100%;overflow:hidden}
      #adminModal .lux-admin-sidebar{min-height:0;display:flex;flex-direction:column;border:1px solid rgba(126,34,206,.25);background:rgba(18,12,31,.72);border-radius:18px;padding:10px;overflow:hidden}
      #adminModal .lux-admin-brand{padding:8px 8px 12px;border-bottom:1px solid rgba(126,34,206,.18);margin-bottom:9px}.lux-admin-brand small{display:block;color:#8b5cf6;font-size:8px;letter-spacing:.17em;text-transform:uppercase;font-weight:900}.lux-admin-brand strong{display:block;color:#fff;font-size:14px;margin-top:3px}.lux-admin-brand p{font-size:9px;color:#746789;margin-top:3px;line-height:1.35}
      #adminModal .lux-admin-tabs{display:flex!important;flex-direction:column!important;flex-wrap:nowrap!important;gap:4px!important;overflow:auto!important;padding:0!important;margin:0!important;background:transparent!important;border:0!important}
      #adminModal .lux-admin-tabs .admin-tab-btn{width:100%;display:grid;grid-template-columns:18px 1fr;align-items:center;gap:8px;text-align:left;border-radius:11px!important;padding:8px 9px!important;font-size:10.5px!important;background:transparent!important;border:1px solid transparent!important;color:#b9a8d6!important;box-shadow:none!important;transition:.16s ease!important}
      #adminModal .lux-admin-tabs .admin-tab-btn:hover{background:rgba(88,28,135,.22)!important;color:#fff!important;transform:translateX(2px)}#adminModal .lux-admin-tabs .admin-tab-btn.lux-admin-active{background:linear-gradient(135deg,rgba(124,58,237,.92),rgba(91,33,182,.88))!important;border-color:rgba(196,181,253,.15)!important;color:#fff!important;box-shadow:0 7px 20px rgba(46,16,101,.22)!important}
      #adminModal .lux-admin-tab-icon{width:14px;height:14px}#adminModal .lux-admin-content{min-width:0;min-height:0;overflow:hidden;display:flex;flex-direction:column;border:1px solid rgba(126,34,206,.18);background:rgba(9,6,14,.62);border-radius:18px;padding:14px}
      #adminModal .lux-admin-content>.admin-tab-panel{min-height:0;flex:1;overflow:auto;padding:1px 4px 4px 1px}#adminModal .lux-admin-content>.admin-tab-panel::-webkit-scrollbar{width:6px}#adminModal .lux-admin-content>.admin-tab-panel::-webkit-scrollbar-thumb{background:#3b2460;border-radius:9px}
      #adminModal .lux-admin-section-head{display:flex;align-items:flex-start;justify-content:space-between;gap:10px;margin:1px 2px 13px;padding-bottom:11px;border-bottom:1px solid rgba(126,34,206,.15)}#adminModal .lux-admin-section-head h4{font-size:15px;color:#fff;font-weight:900}#adminModal .lux-admin-section-head p{font-size:10px;color:#8f80a8;margin-top:2px}
      #adminModal .lux-admin-content input,#adminModal .lux-admin-content select,#adminModal .lux-admin-content textarea{font-size:11px!important}#adminModal .lux-admin-content button{font-size:10.5px}
      #adminModal .lux-admin-overview{height:100%;overflow:auto}.lux-admin-hero{border:1px solid rgba(139,92,246,.28);background:radial-gradient(circle at 90% 10%,rgba(124,58,237,.18),transparent 38%),linear-gradient(135deg,rgba(24,15,41,.92),rgba(13,8,23,.9));border-radius:18px;padding:20px}.lux-admin-eyebrow{font-size:9px;color:#a78bfa;letter-spacing:.17em;font-weight:900;text-transform:uppercase}.lux-admin-hero h2{font-size:24px;color:white;font-weight:950;margin-top:4px}.lux-admin-hero p{font-size:11px;color:#9f91b6;max-width:620px;margin-top:5px;line-height:1.55}
      #adminModal .lux-admin-quick{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:9px;margin-top:12px}.lux-admin-quick button{min-height:92px;text-align:left;border:1px solid rgba(126,34,206,.22);background:rgba(18,12,31,.72);border-radius:15px;padding:13px;transition:.18s}.lux-admin-quick button:hover{border-color:rgba(167,139,250,.55);background:rgba(37,22,61,.9);transform:translateY(-2px)}.lux-admin-quick svg{width:17px;height:17px;color:#a78bfa}.lux-admin-quick strong{display:block;color:#fff;font-size:11px;margin-top:8px}.lux-admin-quick span{display:block;color:#7f7197;font-size:9px;margin-top:2px;line-height:1.35}
      #adminModal .lux-admin-mobile-select{display:none;width:100%;background:#180f29;border:1px solid rgba(126,34,206,.45);color:#ede9fe;border-radius:11px;padding:9px 11px;font-size:11px}
      @media(max-width:900px){#adminModal>div{width:98vw!important;height:94vh!important;padding:10px!important}#adminModal .lux-admin-shell{display:flex;flex-direction:column;gap:8px}#adminModal .lux-admin-sidebar{padding:7px;flex:none}.lux-admin-brand{display:none}#adminModal .lux-admin-tabs{display:none!important}#adminModal .lux-admin-mobile-select{display:block}#adminModal .lux-admin-content{border-radius:14px;padding:9px;overflow:hidden}#adminModal .lux-admin-quick{grid-template-columns:repeat(2,minmax(0,1fr))}.lux-admin-hero{padding:15px}.lux-admin-hero h2{font-size:20px}}
    `; document.head.appendChild(s);
  }

  function makeOverview() {
    const panel=create('div','admin-tab-panel hidden lux-admin-overview'); panel.id='adminTabOverview';
    const hero=create('section','lux-admin-hero'); hero.innerHTML='<div class="lux-admin-eyebrow">Central de controle</div><h2>Administração Lux</h2><p>Clientes, conteúdo, jogos e infraestrutura em um único lugar. Escolha uma área para administrar sem misturar ferramentas diferentes.</p>'; panel.appendChild(hero);
    const quick=create('div','lux-admin-quick');
    ['clientes','games','books','destaques','avatars','vods','functionalities','sources'].forEach(key=>{ const b=create('button'); b.type='button'; b.dataset.adminShortcut=key; b.innerHTML=`<i data-lucide="${ICONS[key]}"></i><strong>${LABELS[key]}</strong><span>${DESCRIPTIONS[key]}</span>`; b.addEventListener('click',()=>window.switchAdminTab?.(key)); quick.appendChild(b); }); panel.appendChild(quick); return panel;
  }

  function decorateTabs(tabBar) { [...tabBar.querySelectorAll('.admin-tab-btn')].forEach(button=>{ const key=tabKey(button); if(!key||key==='providers')return; if(button.dataset.luxAdminDecorated)return; const label=LABELS[key]||button.textContent.trim(); button.textContent=''; const icon=create('i','lux-admin-tab-icon'); icon.dataset.lucide=ICONS[key]||'circle'; button.append(icon,create('span','',label)); button.dataset.luxAdminDecorated='1'; }); }
  function addSectionHeads(root) { root.querySelectorAll('.admin-tab-panel').forEach(panel=>{ if(panel.id==='adminTabOverview'||panel.dataset.luxAdminHead)return; const key=panel.id.replace(/^adminTab/,'').toLowerCase(); const title=LABELS[key]; if(!title)return; const head=create('div','lux-admin-section-head'); const wrap=create('div'); wrap.append(create('h4','',title),create('p','',DESCRIPTIONS[key]||'Ferramentas administrativas')); head.appendChild(wrap); panel.prepend(head); panel.dataset.luxAdminHead='1'; }); }
  function syncActive(root,select) { const visible=[...root.querySelectorAll('.admin-tab-panel')].find(p=>!p.classList.contains('hidden')); const key=visible?.id?.replace(/^adminTab/,'').toLowerCase()||'overview'; root.querySelectorAll('.admin-tab-btn').forEach(b=>b.classList.toggle('lux-admin-active',tabKey(b)===key)); if(select&&[...select.options].some(o=>o.value===key))select.value=key; }

  function rebuild() {
    const modal=document.getElementById('adminModal'); if(!modal)return false; injectStyles(); removeProviders(modal);
    const firstButton=modal.querySelector('.admin-tab-btn'), firstPanel=modal.querySelector('.admin-tab-panel'); if(!firstButton||!firstPanel)return false;
    let tabBar=firstButton.parentElement, shell=modal.querySelector('.lux-admin-shell');
    if(!tabBar.querySelector('[data-admin-tab="overview"]')){ const b=create('button','admin-tab-btn'); b.type='button'; b.dataset.adminTab='overview'; b.textContent='Visão geral'; b.addEventListener('click',()=>window.switchAdminTab?.('overview')); tabBar.prepend(b); }
    decorateTabs(tabBar); if(!document.getElementById('adminTabOverview')) firstPanel.parentElement.insertBefore(makeOverview(),firstPanel);
    if(!shell){ const panels=[...modal.querySelectorAll('.admin-tab-panel')], host=panels[0].parentElement; shell=create('div','lux-admin-shell'); const side=create('aside','lux-admin-sidebar'); const brand=create('div','lux-admin-brand'); brand.innerHTML='<small>Lux Play</small><strong>Admin Hub</strong><p>Controle operacional e catálogo</p>'; const select=create('select','lux-admin-mobile-select'); side.append(brand,select); tabBar.classList.add('lux-admin-tabs'); side.appendChild(tabBar); const content=create('main','lux-admin-content'); panels.forEach(p=>content.appendChild(p)); host.appendChild(shell); shell.append(side,content); select.addEventListener('change',()=>window.switchAdminTab?.(select.value)); }
    const header=modal.querySelector(':scope > div > div:first-child');
    if(header){ if(!header.classList.contains('lux-admin-header')){header.classList.add('lux-admin-header'); const h=header.querySelector('h3'); if(h){h.classList.add('lux-admin-header-title'); h.childNodes.forEach(n=>{if(n.nodeType===3&&n.textContent.includes('Painel de Administração'))n.textContent=' Admin Hub';}); const sub=create('p','lux-admin-header-sub','Gerencie o ecossistema Lux Play'); h.parentElement.appendChild(sub);}} const candidates=[...header.querySelectorAll('button')]; const close=candidates.find(b=>/fechar|close/i.test(b.getAttribute('aria-label')||b.title||''))||candidates.find(b=>b.textContent.trim()==='×'||b.textContent.trim()==='✕')||candidates[candidates.length-1]; if(close)close.classList.add('lux-admin-close'); }
    const select=shell.querySelector('.lux-admin-mobile-select'); if(select){select.replaceChildren(); [...shell.querySelectorAll('.admin-tab-btn')].forEach(b=>{const key=tabKey(b);if(!key||key==='providers')return;const o=create('option');o.value=key;o.textContent=LABELS[key]||b.textContent.trim();select.appendChild(o);});}
    addSectionHeads(modal); syncActive(modal,select); try{window.lucide?.createIcons?.();}catch(_){} return true;
  }

  const nativeSwitch=window.switchAdminTab;
  if(typeof nativeSwitch==='function'&&!nativeSwitch.__luxAdminHubWrapped){ const wrapped=function(tab){let key=String(tab||'overview').toLowerCase();if(key==='providers')key='overview';if(key==='fontes')key='sources';if(key==='overview'){document.querySelectorAll('#adminModal .admin-tab-panel').forEach(p=>p.classList.toggle('hidden',p.id!=='adminTabOverview'));}else nativeSwitch.call(this,key);queueMicrotask(()=>rebuild());}; wrapped.__luxAdminHubWrapped=true; window.switchAdminTab=wrapped; }
  let tries=0; const timer=setInterval(()=>{tries++;if(rebuild()||tries>160)clearInterval(timer);},50);
})();