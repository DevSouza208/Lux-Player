(() => {
  'use strict';
  if (window.__luxDriveSecondarySourceUi) return;
  window.__luxDriveSecondarySourceUi = '20260916-2';

  function loadHub() {
    if (window.LuxSourceHub || document.querySelector('script[data-lux-drive-hub-direct]')) return;
    const script = document.createElement('script');
    script.src = 'js/lux-source-hub.js?v=20260916-drive-hq5';
    script.async = false;
    script.dataset.luxDriveHubDirect = '1';
    document.head.appendChild(script);
  }

  async function libraryApi(payload, timeoutMs=30000) {
    if (!window.LuxReaderCloud?.request) throw new Error('Entre novamente no Lux.');
    return window.LuxReaderCloud.request('reading-source-library', payload, undefined, { timeoutMs });
  }

  function inject() {
    const form = document.getElementById('secondarySourceForm');
    if (!form || document.getElementById('secondarySourceOrigin')) return false;
    loadHub();

    const name = document.getElementById('secondarySourceName');
    const type = document.getElementById('secondarySourceType');
    const url = document.getElementById('secondarySourceUrl');
    const urlLabel = url?.closest('label');
    if (!name || !type || !url || !urlLabel) return false;

    const originWrap = document.createElement('label');
    originWrap.className = 'md:col-span-2 text-[11px] font-medium text-purple-300';
    originWrap.innerHTML = `Origem da fonte
      <select id="secondarySourceOrigin" class="mt-1 w-full rounded-xl border border-purple-900/50 bg-[#120c1f] px-3 py-2 text-xs text-white">
        <option value="m3u">M3U / M3U8</option>
        <option value="google-drive">Google Drive</option>
      </select>`;
    form.insertBefore(originWrap, form.firstElementChild?.nextSibling || form.firstChild);

    const driveActions = document.createElement('div');
    driveActions.id = 'secondaryDriveActions';
    driveActions.className = 'hidden md:col-span-2 rounded-xl border border-purple-900/50 bg-[#120c1f]/60 p-3';
    driveActions.innerHTML = `
      <div class="flex flex-wrap items-center gap-2">
        <button id="secondaryDriveValidate" type="button" class="rounded-xl border border-purple-700 px-3 py-2 text-xs font-bold text-purple-200">Validar pasta</button>
        <button id="secondaryDriveScan" type="button" class="rounded-xl bg-purple-600 px-3 py-2 text-xs font-bold text-white">Sincronizar índice</button>
        <button id="secondaryDrivePublish" type="button" disabled class="rounded-xl bg-emerald-600 px-3 py-2 text-xs font-bold text-white disabled:cursor-not-allowed disabled:opacity-40">Salvar e publicar fonte</button>
        <span id="secondaryDriveBadge" class="text-[10px] text-purple-300">CBR, CBZ, PDF, EPUB e subpastas.</span>
      </div>
      <div id="secondaryDriveStats" class="mt-2 text-[11px] text-purple-300"></div>
      <div id="secondaryDrivePublishInfo" class="mt-2 text-[10px] text-purple-300/80">Após sincronizar, publique a fonte para disponibilizá-la na Leitura de todos os usuários.</div>`;
    urlLabel.insertAdjacentElement('afterend', driveActions);

    const origin = document.getElementById('secondarySourceOrigin');
    const save = document.getElementById('secondarySourceSave');
    const priority = document.getElementById('secondarySourcePriority')?.closest('label');
    const flags = document.getElementById('secondarySourceEnabled')?.closest('div');
    const status = document.getElementById('secondarySourceStatus');
    const publish = document.getElementById('secondaryDrivePublish');
    const publishInfo = document.getElementById('secondaryDrivePublishInfo');
    let scannedSourceKey = '';

    function mode() {
      const drive = origin.value === 'google-drive';
      type.closest('label').classList.toggle('hidden', drive);
      priority?.classList.toggle('hidden', drive);
      flags?.classList.toggle('hidden', drive);
      driveActions.classList.toggle('hidden', !drive);
      if (save) save.classList.toggle('hidden', drive);
      urlLabel.childNodes[0].textContent = drive ? 'Pasta pública do Google Drive\n            ' : 'URL M3U / M3U8\n            ';
      url.placeholder = drive ? 'Cole aqui o link da pasta pública do Google Drive' : 'http:// ou https://';
      url.nextElementSibling.textContent = drive
        ? 'O Lux lê somente o índice da pasta. Os arquivos não são baixados durante a sincronização.'
        : 'A URL é buscada pelo backend e transformada em registros normalizados no Supabase.';
      if (drive && !name.value) name.value = 'Biblioteca Google Drive';
    }
    origin.addEventListener('change', mode); mode();

    document.getElementById('secondaryDriveValidate').onclick = () => {
      const id = window.LuxSourceHub?.extractDriveFolderId(url.value);
      status.textContent = id ? `✓ Pasta do Google Drive reconhecida. ID: ${id}` : '✕ Cole um link válido de pasta do Google Drive.';
      status.style.color = id ? '#86efac' : '#fca5a5';
    };

    document.getElementById('secondaryDriveScan').onclick = async (event) => {
      const button = event.currentTarget;
      const id = window.LuxSourceHub?.extractDriveFolderId(url.value);
      if (!id) { status.textContent = '✕ Cole um link válido de pasta do Google Drive.'; status.style.color = '#fca5a5'; return; }
      scannedSourceKey = '';
      publish.disabled = true;
      button.disabled = true; status.style.color = '#c4b5fd'; status.textContent = 'Lendo a estrutura do Drive sem baixar as HQs…';
      try {
        const result = await window.LuxSourceHub.scanDriveSource({ folderUrl:url.value, sourceName:name.value.trim() || 'Biblioteca Google Drive', onProgress:p => {
          document.getElementById('secondaryDriveStats').textContent = `${p.items.toLocaleString('pt-BR')} itens • ${p.folders.toLocaleString('pt-BR')} pastas • ${p.comics.toLocaleString('pt-BR')} HQs`;
          status.textContent = `Indexando… ${p.pendingFolders.toLocaleString('pt-BR')} pastas na fila`;
        }});
        scannedSourceKey = `drive:${result.rootId}`;
        document.getElementById('secondaryDriveStats').textContent = `${result.stats.items.toLocaleString('pt-BR')} itens • ${result.stats.folders.toLocaleString('pt-BR')} pastas • ${result.stats.comics.toLocaleString('pt-BR')} HQs • ${result.stats.books.toLocaleString('pt-BR')} livros`;
        status.style.color = '#86efac';
        status.textContent = result.published ? '✓ Índice sincronizado. Esta fonte já está publicada.' : '✓ Índice sincronizado. Agora salve e publique a fonte.';
        publish.disabled = false;
        publish.textContent = result.published ? 'Salvar e atualizar publicação' : 'Salvar e publicar fonte';
        publishInfo.textContent = result.published ? 'Fonte global ativa. Publicar novamente atualiza o nome e confirma o catálogo atual.' : 'Pronta para publicação global em Leitura.';
      } catch (error) {
        status.style.color = '#fca5a5'; status.textContent = '✕ ' + (error?.message || 'Falha ao sincronizar o Google Drive.');
      } finally { button.disabled = false; }
    };

    publish.onclick = async () => {
      if (!scannedSourceKey) { status.style.color='#fca5a5'; status.textContent='✕ Sincronize o índice antes de publicar.'; return; }
      publish.disabled = true;
      const previous = publish.textContent;
      publish.textContent = 'Publicando…';
      status.style.color = '#c4b5fd'; status.textContent = 'Salvando e publicando a fonte para todos os usuários…';
      try {
        const data = await libraryApi({action:'publish-source',sourceKey:scannedSourceKey,name:name.value.trim() || 'Biblioteca Google Drive'});
        if (!data?.published) throw new Error('A fonte não foi marcada como publicada.');
        status.style.color = '#86efac'; status.textContent = '✓ Fonte salva e publicada para todos os usuários.';
        publish.textContent = 'Publicada ✓';
        publishInfo.textContent = 'Esta biblioteca está globalmente disponível em Leitura. Permissões por usuário poderão ser aplicadas futuramente.';
        window.dispatchEvent(new CustomEvent('lux-reading-source-published',{detail:data.source||{source_key:scannedSourceKey}}));
        setTimeout(() => { publish.disabled=false; publish.textContent='Salvar e atualizar publicação'; }, 1400);
      } catch (error) {
        status.style.color='#fca5a5'; status.textContent='✕ '+(error?.message || 'Não foi possível publicar a fonte.');
        publish.disabled=false; publish.textContent=previous;
      }
    };
    return true;
  }

  let tries = 0;
  const timer = setInterval(() => { tries += 1; if (inject() || tries > 160) clearInterval(timer); }, 100);
  inject();
})();