(() => {
  'use strict';
  if (window.__luxSourceHubAdminInstalled) return;
  window.__luxSourceHubAdminInstalled = '20260915-drive-hq1';

  const DEFAULT_URL = 'https://drive.google.com/drive/folders/1zjVQ0K6mWgXcZSTV8gNi-jxY0x2KWjGN';

  function findPanel() {
    return document.querySelector('#adminTabSources, #adminTabFontes, [data-admin-panel="sources"], [data-admin-panel="fontes"]');
  }

  function ensurePanel() {
    let panel = findPanel();
    if (panel) return panel;
    const host = document.querySelector('#adminModal .lux-admin-content, #adminModal .admin-content, #adminModal');
    if (!host) return null;
    panel = document.createElement('section');
    panel.id = 'adminTabSources';
    panel.className = 'admin-tab-panel hidden';
    host.appendChild(panel);
    return panel;
  }

  function render() {
    const panel = ensurePanel();
    if (!panel || panel.querySelector('[data-lux-drive-source-card]')) return !!panel;

    const card = document.createElement('div');
    card.dataset.luxDriveSourceCard = '1';
    card.innerHTML = `
      <div style="margin-top:18px;padding:18px;border:1px solid rgba(168,85,247,.25);border-radius:18px;background:rgba(24,15,41,.72)">
        <div style="display:flex;gap:12px;align-items:center;justify-content:space-between;flex-wrap:wrap">
          <div><div style="font-size:12px;color:#c4b5fd;font-weight:800;text-transform:uppercase;letter-spacing:.08em">Google Drive • HQs</div>
          <div style="font-size:18px;color:white;font-weight:900;margin-top:3px">Primeira fonte real do Lux</div>
          <div style="font-size:12px;color:#a1a1aa;margin-top:4px">Varredura recursiva preservando coleção, arco, pasta e arquivo.</div></div>
          <span style="font-size:11px;padding:6px 10px;border-radius:999px;background:rgba(34,197,94,.12);color:#86efac;border:1px solid rgba(34,197,94,.2)">Preparada</span>
        </div>
        <label style="display:block;margin-top:15px;font-size:11px;font-weight:800;color:#ddd6fe">Pasta pública do Google Drive</label>
        <input id="luxDriveSourceUrl" value="${DEFAULT_URL}" style="width:100%;box-sizing:border-box;margin-top:6px;padding:11px 12px;border-radius:12px;border:1px solid rgba(168,85,247,.25);background:#10091c;color:white;outline:none" />
        <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:12px">
          <button id="luxDriveValidate" type="button" style="padding:9px 12px;border:0;border-radius:11px;background:#7c3aed;color:white;font-weight:800;cursor:pointer">Validar pasta</button>
          <button id="luxDriveScan" type="button" style="padding:9px 12px;border:1px solid rgba(168,85,247,.3);border-radius:11px;background:#211337;color:#ddd6fe;font-weight:800;cursor:pointer">Sincronizar índice</button>
        </div>
        <div id="luxDriveSourceStatus" style="margin-top:10px;font-size:12px;color:#a1a1aa">CBR, CBZ, PDF, EPUB, imagens e formatos web reconhecidos. Os arquivos não são baixados durante a indexação.</div>
      </div>`;
    panel.appendChild(card);

    const input = card.querySelector('#luxDriveSourceUrl');
    const status = card.querySelector('#luxDriveSourceStatus');
    card.querySelector('#luxDriveValidate').onclick = () => {
      const id = window.LuxSourceHub?.extractDriveFolderId(input.value);
      status.textContent = id ? `✓ Pasta reconhecida. ID: ${id}` : '✕ URL/ID de pasta inválido.';
      status.style.color = id ? '#86efac' : '#fca5a5';
    };
    card.querySelector('#luxDriveScan').onclick = () => {
      const id = window.LuxSourceHub?.extractDriveFolderId(input.value);
      if (!id) { status.textContent = '✕ Informe uma pasta válida antes de sincronizar.'; status.style.color = '#fca5a5'; return; }
      status.textContent = 'Terreno pronto: falta conectar o scanner ao endpoint seguro do Google Drive/Supabase para persistir o índice.';
      status.style.color = '#fde68a';
    };
    return true;
  }

  let tries = 0;
  const timer = setInterval(() => {
    tries += 1;
    if (render() || tries > 120) clearInterval(timer);
  }, 250);
  render();
})();
