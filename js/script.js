const SUPABASE_URL = 'https://fvcvshppvxihhttwyyvr.supabase.co';
    const SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_G22WZFcnYGNNkbUbygE5jA_FBBSXNrm';
    const supabaseClient = supabase.createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY);

    const NOTIFICATION_SHEET_ID = '1BCtYvuyNd7POr1VbKTFRbOCKIh1W6iGewVh-zuk-Et4';

    let currentUser = null;
    let allMediaItems = [];
    let currentSection = 'home'; 
    let activeCategory = 'Todos';
    let activeLiveChannel = null;
    let activeSearchQuery = ''; // Termo de busca ativo global

    let mobileStep = 'categories';

    let hlsLiveInstance = null;
    let hlsVodInstance = null;

    let isAdultUnlocked = false;
    let pendingUnlockAction = null;

    let currentFilteredItems = [];
    let visibleCount = 60;
    const ITEMS_PER_PAGE = 60;

    let currentSeriesDetails = null;
    let currentSeriesEpisodesData = null;
    let currentSelectedSeason = 1;

    let currentMovieItem = null;
    let currentSeriesItem = null;

    let activeConnectionTab = 'xc';
    let isSortModeActive = false;

    let activeNotifications = [];

    let activeAdminTab = 'clientes';

    function getJsonStorage(key, fallback) {
      try {
        const raw = localStorage.getItem(key);
        if (!raw) return fallback;
        const parsed = JSON.parse(raw);
        return parsed ?? fallback;
      } catch (_) {
        return fallback;
      }
    }

    function saveJsonStorage(key, value) {
      try {
        localStorage.setItem(key, JSON.stringify(value));
      } catch (_) {}
    }

    function capitalizeAdminTab(tab) {
      return tab.charAt(0).toUpperCase() + tab.slice(1);
    }

    function switchAdminTab(tab) {
      lockAdminR2Config();
      activeAdminTab = tab;

      const tabs = document.querySelectorAll('.admin-tab-btn');
      tabs.forEach(button => {
        const isActive = button.dataset.adminTab === tab;
        button.className = isActive
          ? 'admin-tab-btn bg-purple-600 text-white px-3 py-2 rounded-xl text-[11px] font-bold'
          : 'admin-tab-btn bg-[#180f29] text-purple-200 hover:bg-[#23153b] px-3 py-2 rounded-xl text-[11px] font-bold';
      });

      const panels = document.querySelectorAll('.admin-tab-panel');
      panels.forEach(panel => {
        const targetId = 'adminTab' + capitalizeAdminTab(tab);
        panel.classList.toggle('hidden', panel.id !== targetId);
      });

      if (tab === 'games') { renderAdminCoreStatusPanel(); syncCoreStatusesFromCloud(); }
      if (tab === 'books') { renderAdminBooksList(); window.LuxReadingAdmin?.refresh(); }
      if (tab === 'vods') renderAdminVodList();
      if (tab === 'avatars') loadAvatarGallery(true);
    }

    function renderPublicCoreStatusList() {
      const coreStatusList = document.getElementById('gameCoreStatusList');
      if (!coreStatusList) return;
      coreStatusList.innerHTML = (window.LuxExternalRoms?.coreStatuses?.() || []).map(core => `<span title="${escapeGameHtml(core.description || core.label)}" class="inline-flex items-center gap-1 rounded-full border border-purple-900/60 bg-[#120c1f] px-2 py-1"><span class="h-2 w-2 rounded-full ${core.tested ? 'bg-emerald-400' : 'bg-rose-400'}"></span>${escapeGameHtml(core.label)}</span>`).join('');
    }

    async function syncCoreStatusesFromCloud() {
      if (!window.LuxExternalRoms?.setCoreStatuses) return;
      try {
        const { data, error } = await supabaseClient.functions.invoke('core-statuses', { body: { action: 'get' } });
        if (error || data?.error || !data?.statuses) throw new Error(data?.error || 'Status indisponível.');
        window.LuxExternalRoms.setCoreStatuses(data.statuses);
        renderPublicCoreStatusList();
        if (document.getElementById('adminCoreStatusList')) renderAdminCoreStatusPanel();
      } catch (error) { console.warn('Status dos cores:', error); }
    }
    function renderAdminCoreStatusPanel() {
      const list = document.getElementById('adminCoreStatusList');
      if (!list || !window.LuxExternalRoms?.coreStatuses) return;
      const cores = window.LuxExternalRoms.coreStatuses();
      list.innerHTML = cores.map(core => `<label class="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-purple-900/50 bg-[#180f29] px-4 py-3"><span class="flex items-center gap-2 text-sm font-bold text-purple-100"><span class="h-3 w-3 rounded-full ${core.tested ? 'bg-emerald-400' : 'bg-rose-400'}"></span>${escapeGameHtml(core.label)}</span><select data-core-status-id="${escapeGameHtml(core.id)}" class="rounded-lg border border-purple-800/60 bg-[#120c1f] px-3 py-2 text-xs text-purple-200"><option value="tested" ${core.tested ? 'selected' : ''}>Verde · testado e aprovado</option><option value="untested" ${!core.tested ? 'selected' : ''}>Vermelho · não testado</option></select></label>`).join('');
    }

    function toggleAdminCoreStatusPanel() {
      const content = document.getElementById('adminCoreStatusContent');
      const label = document.getElementById('adminCoreStatusToggleLabel');
      if (!content) return;
      const isHidden = content.classList.toggle('hidden');
      if (label) label.textContent = isHidden ? 'Mostrar cores' : 'Ocultar cores';
      if (!isHidden) renderAdminCoreStatusPanel();
    }
    function saveAdminCoreStatuses() {
      const selects = [...document.querySelectorAll('#adminCoreStatusList [data-core-status-id]')];
      if (!selects.length || !window.LuxExternalRoms?.saveCoreStatuses) return;
      const statuses = Object.fromEntries(selects.map(select => [select.dataset.coreStatusId, select.value]));
      const user = currentUser;
      if (!user) return;
      window.LuxExternalRoms.saveCoreStatuses(statuses);
      const message = document.getElementById('adminCoreStatusMessage');
      if (message) message.textContent = 'Salvando status para todos os dispositivos...';
      supabaseClient.functions.invoke('core-statuses', { body: { action: 'save', statuses, username: user.user, password: user.pass } }).then(({ data, error }) => {
        if (error || data?.error) throw new Error(data?.error || 'Não foi possível salvar os status.');
        window.LuxExternalRoms.setCoreStatuses(data.statuses || statuses);
        if (message) message.textContent = 'Status dos cores salvo para todos os dispositivos.';
        renderAdminCoreStatusPanel();
        renderPublicCoreStatusList();
      }).catch(error => { if (message) message.textContent = error.message || 'Não foi possível salvar os status.'; });
    }
    let adminR2UnlockedUser = null;

    function lockAdminR2Config() {
      adminR2UnlockedUser = null;
      document.getElementById('adminR2Fields').disabled = true;
      document.getElementById('adminR2Fields').hidden = false;
      document.getElementById('adminR2ConfigContent').inert = true;
      document.getElementById('adminR2ConfigContent').style.cssText = 'filter: blur(6px); pointer-events: none; user-select: none;';
      document.getElementById('adminR2Save').disabled = true;
      document.getElementById('adminR2UnlockForm').classList.remove('hidden');
      document.getElementById('adminR2Lock').classList.add('hidden');
      document.getElementById('adminR2Password').value = '';
      document.getElementById('adminR2UnlockStatus').textContent = '';
      loadAdminR2Config();
    }

    function unlockAdminR2Config() {
      const input = document.getElementById('adminR2Password');
      const valid = currentUser?.role === 'admin' && !!input.value && input.value === currentUser.pass;
      input.value = '';
      if (!valid) {
        document.getElementById('adminR2UnlockStatus').textContent = 'Senha incorreta. Use a mesma senha do login de administrador.';
        input.focus();
        return;
      }
      adminR2UnlockedUser = currentUser;
      document.getElementById('adminR2ConfigContent').inert = false;
      document.getElementById('adminR2ConfigContent').style.cssText = '';
      document.getElementById('adminR2Fields').disabled = false;
      document.getElementById('adminR2Fields').hidden = false;
      document.getElementById('adminR2Save').disabled = false;
      document.getElementById('adminR2UnlockForm').classList.add('hidden');
      document.getElementById('adminR2Lock').classList.remove('hidden');
    }

    function renderAdminVodCategories() {
      const list = document.getElementById('adminVodCategories');
      if (!list) return;
      const categories = [...getAdminVodCatalog().map(vod => vod.category),
        ...allMediaItems.filter(item => item.type === 'movies').map(item => item.group)];
      const unique = new Map();
      categories.forEach(category => {
        const name = (category || '').trim();
        if (name && !unique.has(name.toLocaleLowerCase('pt-BR'))) unique.set(name.toLocaleLowerCase('pt-BR'), name);
      });
      list.replaceChildren(...[...unique.values()].sort((a, b) => a.localeCompare(b, 'pt-BR')).map(name => {
        const option = document.createElement('option');
        option.value = name;
        return option;
      }));
    }

    function loadAdminR2Config() {
      const config = getJsonStorage('lux_r2_config', { domain: 'https://pub-e7c51b64f286481c8772a8f345759fd9.r2.dev', bucket: 'luxvod', prefix: 'vods/' });
      document.getElementById('adminR2Domain').value = 'https://pub-e7c51b64f286481c8772a8f345759fd9.r2.dev';
      document.getElementById('adminR2Bucket').value = 'luxvod';
      document.getElementById('adminR2Prefix').value = config.prefix || 'vods/';
    }

    function adminSaveR2Config() {
      if (!currentUser || currentUser.role !== 'admin' || adminR2UnlockedUser !== currentUser) {
        alert('Desbloqueie as configurações com sua senha de login antes de salvar.');
        return;
      }
      const config = {
        domain: document.getElementById('adminR2Domain')?.value.trim() || '',
        bucket: 'luxvod',
        prefix: document.getElementById('adminR2Prefix')?.value.trim() || 'vods/'
      };
      saveJsonStorage('lux_r2_config', config);
      alert('Configuração do Cloudflare R2 salva localmente.');
    }

    function getAdminR2Config() {
      return getJsonStorage('lux_r2_config', { domain: 'https://pub-e7c51b64f286481c8772a8f345759fd9.r2.dev', bucket: 'luxvod', prefix: 'vods/' });
    }

    function getAdminBooksCatalog() {
      return getJsonStorage('lux_admin_books_catalog', []);
    }

    let sharedVodCatalog = [];
    let vodCatalogSyncBusy = false;

    function getPendingVodCatalog() {
      return getJsonStorage('lux_admin_vod_catalog', []);
    }

    function getAdminVodCatalog() {
      return [...new Map([...sharedVodCatalog, ...getPendingVodCatalog()].map(vod => [vod.url, vod])).values()];
    }

    async function requestVodCatalog(action, payload = {}) {
      const user = currentUser;
      if (!user) throw new Error('Entre na sua conta para acessar o catálogo.');
      const { data, error } = await supabaseClient.functions.invoke('vod-catalog', {
        body: { ...payload, action, username: user.user, password: user.pass }
      });
      if (currentUser !== user) throw new Error('A sessão mudou. Entre novamente.');
      if (error || data?.error) {
        let message = data?.error || 'Não foi possível sincronizar o catálogo compartilhado. Tente novamente.';
        try { message = (await error.context.json()).error || message; } catch (_) {}
        throw new Error(message);
      }
      return data;
    }

    function mergeSharedVodsIntoPlayer() {
      allMediaItems = [...allMediaItems.filter(item => item.source !== 'r2'), ...sharedVodCatalog.map(vod => ({
        id: 'r2_' + (vod.objectKey || vod.url), name: vod.title, group: vod.category || 'VOD R2',
        logo: vod.poster || '', url: vod.url, type: 'movies', source: 'r2',
        isAdult: isAdultContent(vod.category, vod.title)
      }))].filter(item => typeof profileAllowsMedia !== 'function' || profileAllowsMedia(item));
    }

    async function loadSharedVodCatalog() {
      const vods = [];
      let page;
      do {
        const data = await requestVodCatalog('list', { offset: vods.length });
        if (!Array.isArray(data?.vods)) throw new Error('Resposta inválida do catálogo.');
        page = data.vods;
        vods.push(...page);
      } while (page.length === 500);
      sharedVodCatalog = vods;
      mergeSharedVodsIntoPlayer();
      renderAdminVodList();
    }

    async function publishPendingVodCatalog() {
      if (currentUser?.role !== 'admin') throw new Error('Entre com uma conta de administrador.');
      if (vodCatalogSyncBusy) throw new Error('Aguarde a publicação em andamento e tente novamente.');
      vodCatalogSyncBusy = true;
      try {
        const pending = getPendingVodCatalog();
        for (let offset = 0; offset < pending.length; offset += 100) {
          const batch = pending.slice(offset, offset + 100);
          const data = await requestVodCatalog('publish', { vods: batch });
          if (!Array.isArray(data?.vods)) throw new Error('Resposta inválida ao publicar catálogo.');
          sharedVodCatalog = [...new Map([...sharedVodCatalog, ...data.vods].map(vod => [vod.url, vod])).values()];
          const published = new Set(batch.map(vod => JSON.stringify(vod)));
          localStorage.setItem('lux_admin_vod_catalog', JSON.stringify(getPendingVodCatalog().filter(vod => !published.has(JSON.stringify(vod)))));
        }
        await loadSharedVodCatalog();
      } finally {
        vodCatalogSyncBusy = false;
      }
    }

    function renderAdminBooksList() {
      const list = document.getElementById('adminBooksList');
      if (!list) return;
      const books = getAdminBooksCatalog();
      if (!books.length) {
        list.innerHTML = '<p class="text-xs text-purple-400/60 text-center py-6">Nenhum livro ou HQ cadastrado.</p>';
        return;
      }

      list.innerHTML = books.map((book, index) => `
        <div class="flex items-center gap-3 rounded-2xl border border-purple-900/40 bg-[#120c1f] p-2.5">
          <img src="${book.cover || 'https://placehold.co/80x120/1a122c/8b5cf6?text=Livro'}" alt="${book.title}" class="w-12 h-16 object-cover rounded-lg border border-purple-900/40" onerror="this.src='https://placehold.co/80x120/1a122c/8b5cf6?text=Livro'" />
          <div class="flex-1 min-w-0">
            <p class="text-xs font-bold text-white truncate">${book.title}</p>
            <p class="text-[10px] text-purple-400 mt-0.5">${book.category || 'Categoria'}</p>
            <a href="${book.url}" target="_blank" class="inline-block text-[10px] text-indigo-300 mt-1 hover:text-white">Abrir link</a>
          </div>
          <button onclick="removeAdminBook(${index})" class="text-rose-300 hover:text-white text-[10px] font-bold bg-rose-900/30 px-2 py-1.5 rounded-lg">Remover</button>
        </div>
      `).join('');
    }

    function adminAddBookEntry() {
      const title = document.getElementById('adminBookTitle')?.value.trim();
      const url = document.getElementById('adminBookUrl')?.value.trim();
      const category = document.getElementById('adminBookCategory')?.value.trim() || 'Leitura';
      const cover = document.getElementById('adminBookCover')?.value.trim() || '';

      if (!title || !url) {
        alert('Preencha o título e a URL do livro.');
        return;
      }

      const books = getAdminBooksCatalog();
      books.push({ title, url, category, cover });
      saveJsonStorage('lux_admin_books_catalog', books);
      document.getElementById('adminBookTitle').value = '';
      document.getElementById('adminBookUrl').value = '';
      document.getElementById('adminBookCategory').value = '';
      document.getElementById('adminBookCover').value = '';
      renderAdminBooksList();
      alert('Livro/HQ salvo no painel de administração.');
    }

    function removeAdminBook(index) {
      const books = getAdminBooksCatalog();
      books.splice(index, 1);
      saveJsonStorage('lux_admin_books_catalog', books);
      renderAdminBooksList();
    }

    function renderAdminVodList() {
      renderAdminVodCategories();
      const list = document.getElementById('adminR2VodList');
      if (!list) return;
      const vods = getAdminVodCatalog();
      if (!vods.length) {
        list.innerHTML = '<p class="text-xs text-purple-400/60 text-center py-6">Nenhuma VOD cadastrada no catálogo.</p>';
        return;
      }

      list.innerHTML = vods.map((entry, index) => {
        const vod = Object.fromEntries(Object.entries(entry).map(([key, value]) => [key, escapeGameHtml(value)]));
        return `
        <div class="flex items-center gap-3 rounded-2xl border border-purple-900/40 bg-[#120c1f] p-2.5">
          <img src="${vod.poster || 'https://placehold.co/80x120/1a122c/8b5cf6?text=VOD'}" alt="${vod.title}" class="w-12 h-16 object-cover rounded-lg border border-purple-900/40" onerror="this.src='https://placehold.co/80x120/1a122c/8b5cf6?text=VOD'" />
          <div class="flex-1 min-w-0">
            <p class="text-xs font-bold text-white truncate">${vod.title}</p>
            <p class="text-[10px] text-purple-400 mt-0.5">${vod.category || 'VOD R2'} · ${getPendingVodCatalog().some(item => item.url === entry.url) ? 'Pendente de publicação' : 'Publicado para todos'}</p>
            <a href="${vod.url}" target="_blank" class="inline-block text-[10px] text-indigo-300 mt-1 hover:text-white">Abrir vídeo</a>
          </div>
          <button onclick="removeAdminVod(${index})" class="text-rose-300 hover:text-white text-[10px] font-bold bg-rose-900/30 px-2 py-1.5 rounded-lg">Remover</button>
        </div>
      `; }).join('');
    }

    let adminVodUploadBusy = false;

    async function adminUploadVodToR2() {
      if (adminVodUploadBusy) return;
      const status = document.getElementById('adminVodUploadStatus');
      const title = document.getElementById('adminVodTitle').value.trim();
      const category = document.getElementById('adminVodCategory').value.trim() || 'VOD R2';
      const poster = document.getElementById('adminVodPoster').value.trim();
      const fileInput = document.getElementById('adminVodFile');
      const file = fileInput.files?.[0];
      if (!currentUser || currentUser.role !== 'admin') {
        status.textContent = 'Entre com uma conta de administrador.';
        return;
      }
      if (!title || !file || !file.size) {
        status.textContent = 'Informe o título e selecione um vídeo não vazio.';
        return;
      }
      const videoTypes = { mp4: 'video/mp4', m4v: 'video/mp4', mkv: 'video/x-matroska', webm: 'video/webm', mov: 'video/quicktime', avi: 'video/x-msvideo', ts: 'video/mp2t' };
      const contentType = file.type.startsWith('video/') ? file.type : videoTypes[file.name.split('.').pop().toLowerCase()];
      if (!contentType) {
        status.textContent = 'Selecione um arquivo de vídeo compatível.';
        return;
      }
      const prefix = document.getElementById('adminR2Prefix').value.trim() || 'vods/';
      adminVodUploadBusy = true;
      const controls = [...document.querySelectorAll('#adminTabVods input, #adminTabVods button')];
      const disabledStates = controls.map(control => control.disabled);
      controls.forEach(control => { control.disabled = true; });
      status.className = 'mt-3 text-[11px] text-purple-400 min-h-[18px]';
      status.textContent = 'Preparando upload para o Cloudflare R2...';
      let uploaded = false;
      try {
        const { data, error } = await supabaseClient.functions.invoke('r2-upload-url', {
          body: { fileName: file.name, contentType, bucket: 'luxvod', prefix,
            username: currentUser.user, password: currentUser.pass }
        });
        if (error) {
          let message = 'Não foi possível preparar o upload. Verifique a conexão e a publicação da função no Supabase.';
          try { message = (await error.context.json()).error || message; } catch (_) {}
          throw new Error(message);
        }
        if (!data?.uploadUrl || !data.publicUrl || !data.objectKey) throw new Error('Resposta incompleta da função de upload.');
        const upload = new URL(data.uploadUrl);
        const publicAddress = new URL(data.publicUrl);
        if (upload.protocol !== 'https:' || !upload.hostname.endsWith('.r2.cloudflarestorage.com') || publicAddress.protocol !== 'https:') {
          throw new Error('A função retornou um endereço de upload inválido.');
        }
        status.textContent = 'Enviando vídeo para o R2. Aguarde e mantenha o app aberto...';
        const response = await fetch(data.uploadUrl, {
          method: 'PUT', headers: { 'Content-Type': contentType }, body: file, credentials: 'omit'
        });
        if (!response.ok) throw new Error('Upload recusado pelo R2 (HTTP ' + response.status + '). Confira as permissões e tente novamente para renovar a assinatura.');
        uploaded = true;
        document.getElementById('adminVodUrl').value = data.publicUrl;
        const vods = getPendingVodCatalog();
        vods.push({ title, category, poster, url: data.publicUrl, objectKey: data.objectKey, bucket: 'luxvod' });
        // Não esconder falhas de persistência depois de enviar um arquivo grande.
        localStorage.setItem('lux_admin_vod_catalog', JSON.stringify(vods));
        ['adminVodTitle', 'adminVodCategory', 'adminVodPoster', 'adminVodUrl', 'adminVodFile'].forEach(id => { document.getElementById(id).value = ''; });
        renderAdminVodList();
        await publishPendingVodCatalog();
        status.textContent = 'Vídeo enviado ao R2 e publicado no catálogo de todos os usuários.';
        status.className = 'mt-3 text-[11px] text-emerald-300 min-h-[18px]';
      } catch (error) {
        status.textContent = uploaded
          ? 'O vídeo foi enviado ao R2, mas a publicação não foi concluída. Use Publicar pendentes e atualizar; se o cadastro não aparecer, copie a URL exibida.'
          : error instanceof TypeError ? 'Falha de conexão. Confira a rede e o CORS do bucket luxvod.' : error.message;
        status.className = 'mt-3 text-[11px] text-rose-300 min-h-[18px]';
      } finally {
        adminVodUploadBusy = false;
        controls.forEach((control, index) => { control.disabled = disabledStates[index]; });
      }
    }

    async function adminAddVodCatalogEntry() {
      if (currentUser?.role !== 'admin' || adminVodUploadBusy || vodCatalogSyncBusy) return;
      const title = document.getElementById('adminVodTitle').value.trim();
      const category = document.getElementById('adminVodCategory').value.trim() || 'VOD R2';
      const url = document.getElementById('adminVodUrl').value.trim();
      const poster = document.getElementById('adminVodPoster').value.trim();
      if (!title || !/^https?:\/\//i.test(url)) { alert('Preencha o título e um link HTTP ou HTTPS do vídeo.'); return; }
      const status = document.getElementById('adminVodUploadStatus');
      try {
        const vods = getPendingVodCatalog().filter(vod => vod.url !== url);
        vods.push({ title, category, url, poster });
        localStorage.setItem('lux_admin_vod_catalog', JSON.stringify(vods));
        renderAdminVodList();
        await publishPendingVodCatalog();
        ['adminVodTitle', 'adminVodCategory', 'adminVodUrl', 'adminVodPoster', 'adminVodFile'].forEach(id => { document.getElementById(id).value = ''; });
        status.textContent = 'Vídeo publicado no catálogo de todos os usuários, sem envio ao R2.';
      } catch (error) {
        status.textContent = error.message + ' O cadastro local, se salvo, pode ser reenviado em Publicar pendentes e atualizar.';
      }
    }

    async function removeAdminVod(index) {
      if (currentUser?.role !== 'admin' || vodCatalogSyncBusy || adminVodUploadBusy) return;
      const vod = getAdminVodCatalog()[index];
      if (!vod || !confirm('Remover este vídeo do catálogo? Se publicado, ele será removido para todos os usuários. O arquivo no R2 será mantido.')) return;
      vodCatalogSyncBusy = true;
      try {
        const shared = sharedVodCatalog.find(item => item.url === vod.url);
        if (shared) await requestVodCatalog('remove', { id: shared.id });
        localStorage.setItem('lux_admin_vod_catalog', JSON.stringify(getPendingVodCatalog().filter(item => item.url !== vod.url)));
        sharedVodCatalog = sharedVodCatalog.filter(item => item.url !== vod.url);
        mergeSharedVodsIntoPlayer();
        renderAdminVodList();
      } catch (error) { alert(error.message); }
      finally { vodCatalogSyncBusy = false; }
    }

    async function adminSyncR2CatalogToPlayer() {
      const status = document.getElementById('adminVodUploadStatus');
      try {
        await publishPendingVodCatalog();
        status.textContent = 'Catálogo compartilhado atualizado. Todos os usuários recebem os vídeos ao entrar ou atualizar o app.';
        if (currentSection === 'movies') filterMedia();
      } catch (error) { status.textContent = error.message + ' Os cadastros pendentes foram mantidos para tentar novamente.'; }
    }

    function setupAppUpdateNotifications() {
      if (!window.luxElectron?.onUpdateStatus) return;
      window.luxElectron.onUpdateStatus(update => {
        if (update?.state !== 'ready') return;
        const notification = document.getElementById('appUpdateNotification');
        const title = document.getElementById('appUpdateTitle');
        const message = document.getElementById('appUpdateMessage');
        if (!notification || !title || !message) return;
        title.textContent = `Versão ${update.version || 'nova'} disponível`;
        message.textContent = 'A atualização já foi baixada. Clique aqui para instalar e reiniciar o Lux Play.';
        notification.classList.remove('hidden');
        lucide.createIcons();
      });
    }

    async function installDownloadedUpdate() {
      const notification = document.getElementById('appUpdateNotification');
      const message = document.getElementById('appUpdateMessage');
      if (!window.luxElectron?.installUpdate) return;
      if (notification) notification.disabled = true;
      if (message) message.textContent = 'Instalando atualização e reiniciando...';
      await window.luxElectron.installUpdate();
    }

    // Variáveis para o controle de progresso e próximo episódio
    let nextEpisodeTimer = null;
    let pendingNextEpisodeItem = null;
    let currentPlayingVodItem = null;
    let lastSavedTime = 0;
    let vodControlsTimer = null;
    let vodLoadingTimer = null;
    let vodLoadingStartedAt = 0;
    let cloudSyncTimer = null;
    let cloudSyncInFlight = false;
    let applyingCloudSync = false;

    window.addEventListener('DOMContentLoaded', () => {
      setupAppUpdateNotifications();
      setupVodPlayerControls();
      loadAdminR2Config();
      switchAdminTab(activeAdminTab);
      const savedUser = localStorage.getItem('lux_auth_user');
      const savedPass = localStorage.getItem('lux_auth_pass');
      
      if (savedUser && savedPass) {
        document.getElementById('authEmail').value = savedUser;
        document.getElementById('authPass').value = savedPass;
        handleLogin();
      }
    });

    function getItemKey(item) {
      return item.url || item.series_id || item.id;
    }

    // Keep cloud keys stable while isolating every local copy by account.
    function userProgressPrefix() {
      return 'lux_user_progress:' + encodeURIComponent(currentUser?.user || '') + (typeof profileLocalSuffix === 'function' ? profileLocalSuffix() : '') + ':';
    }
    const userProgressStorage = {
      getItem(key) { return currentUser ? localStorage.getItem(userProgressPrefix() + key) : null; },
      setItem(key, value) { if (currentUser) localStorage.setItem(userProgressPrefix() + key, value); },
      removeItem(key) { if (currentUser) localStorage.removeItem(userProgressPrefix() + key); },
      keys() {
        if (!currentUser) return [];
        const prefix = userProgressPrefix(), keys = [];
        for (let i = 0; i < localStorage.length; i++) {
          const key = localStorage.key(i);
          if (key?.startsWith(prefix)) keys.push(key.slice(prefix.length));
        }
        return keys;
      },
      get length() { return this.keys().length; },
      key(index) { return this.keys()[index] ?? null; }
    };

    function restoreAccountProgress() {
      if (!currentUser || userProgressStorage.getItem('initialized')) return;
      // Existing sync records carry an owner; legacy shared keys do not.
      for (const [key, record] of Object.entries(getCloudSyncRecords())) applyCloudRecord(key, record.payload);
      userProgressStorage.setItem('initialized', '1');
    }

    // A cópia local continua sendo a fonte imediata/offline. Estes metadados
    // registram a versão de cada item para a nuvem escolher a mais recente.
    function getCloudSyncStorageKey() {
      return currentUser?.profile?.data_key || currentUser?.profile?.slot > 1 ? `lux_profile_sync_records_${JSON.stringify([currentUser.user,currentUser.profile.data_key || currentUser.profile.slot])}` : `lux_cloud_sync_records_${currentUser?.user || 'anonymous'}`;
    }

    function getCloudSyncRecords() {
      try {
        const stored = JSON.parse(localStorage.getItem(getCloudSyncStorageKey()) || '{}');
        return stored && typeof stored === 'object' ? stored : {};
      } catch (_) { return {}; }
    }

    function saveCloudSyncRecords(records) {
      try { localStorage.setItem(getCloudSyncStorageKey(), JSON.stringify(records)); } catch (_) {}
    }

    function scheduleCloudSync() {
      if (applyingCloudSync || !currentUser) return;
      if (cloudSyncTimer) clearTimeout(cloudSyncTimer);
      cloudSyncTimer = setTimeout(() => syncCloudProgress(), 3500);
    }

    function markCloudRecord(key, payload, deleted = false) {
      if (applyingCloudSync || !currentUser) return;
      const records = getCloudSyncRecords();
      records[key] = { payload: deleted ? { deleted: true } : payload, updatedAt: Date.now() };
      saveCloudSyncRecords(records);
      scheduleCloudSync();
    }

    function seedCloudSyncRecords() {
      const records = getCloudSyncRecords();
      const seed = (key, payload) => {
        if (!records[key]) records[key] = { payload, updatedAt: 0 };
      };
      for (const section of ['movies','series','live']) {
        try { const order=JSON.parse(userProgressStorage.getItem('lux_cat_order_v3_'+section)||'null');if(Array.isArray(order))seed('preference:category-order:'+section,{order}); } catch(_){}
      }
      getFavorites().forEach(key => seed(`favorite:media:${encodeURIComponent(key)}`, { favorite: true }));
      getGameFavorites().forEach(id => seed(`favorite:game:${encodeURIComponent(id)}`, { favorite: true }));

      for (let index = 0; index < userProgressStorage.length; index++) {
        const resumeKey = userProgressStorage.key(index);
        if (!resumeKey || !resumeKey.startsWith('lux_progress_') || resumeKey.endsWith('_meta') || resumeKey.startsWith('lux_progress_series_episode_')) continue;
        const progress = Number(userProgressStorage.getItem(resumeKey));
        if (!Number.isFinite(progress) || progress <= 0) continue;
        try {
          const meta = JSON.parse(userProgressStorage.getItem(getResumeMetaKey(resumeKey)) || '{}');
          seed(`resume:${resumeKey}`, { progress, meta });
        } catch (_) {}
      }
      for (let index = 0; index < userProgressStorage.length; index++) {
        const key = userProgressStorage.key(index);
        if (!key || !key.startsWith('lux_series_resume_')) continue;
        try { seed(`series:${key.slice('lux_series_resume_'.length)}`, { state: JSON.parse(userProgressStorage.getItem(key) || '{}') }); } catch (_) {}
      }
      saveCloudSyncRecords(records);
      return records;
    }

    function applyCloudRecord(key, payload) {
      const deleted = Boolean(payload?.deleted);
      if (key.startsWith('preference:category-order:')) {
        const section=key.slice('preference:category-order:'.length);
        if (['movies','series','live','books','games'].includes(section) && Array.isArray(payload?.order)) userProgressStorage.setItem('lux_cat_order_v3_' + section, JSON.stringify(payload.order));
      } else if (key.startsWith('favorite:media:')) {
        const itemKey = decodeURIComponent(key.slice('favorite:media:'.length));
        const favorites = getFavorites().filter(value => value !== itemKey);
        if (!deleted && payload?.favorite) favorites.push(itemKey);
        userProgressStorage.setItem('lux_favorites', JSON.stringify(favorites));
      } else if (key.startsWith('favorite:game:')) {
        const id = decodeURIComponent(key.slice('favorite:game:'.length));
        const favorites = getGameFavorites().filter(value => value !== id);
        if (!deleted && payload?.favorite) favorites.push(id);
        userProgressStorage.setItem('lux_game_favorites', JSON.stringify(favorites));
      } else if (key.startsWith('resume:')) {
        const resumeKey = key.slice('resume:'.length);
        if (deleted) {
          userProgressStorage.removeItem(resumeKey);
          userProgressStorage.removeItem(getResumeMetaKey(resumeKey));
        } else if (Number(payload?.progress) > 0) {
          userProgressStorage.setItem(resumeKey, String(payload.progress));
          userProgressStorage.setItem(getResumeMetaKey(resumeKey), JSON.stringify(payload.meta || {}));
        }
      } else if (key.startsWith('series:')) {
        const localKey = `lux_series_resume_${key.slice('series:'.length)}`;
        if (deleted) userProgressStorage.removeItem(localKey);
        else if (payload?.state?.seriesId) userProgressStorage.setItem(localKey, JSON.stringify(payload.state));
      }
    }

    async function syncCloudProgress() {
      if (!currentUser || cloudSyncInFlight) return;
      cloudSyncInFlight = true;
      const syncUser = currentUser;
      let syncSnapshot = null;
      try {
        seedCloudSyncRecords();
        const credentials = { username: currentUser.user, password: currentUser.pass, profileSlot: currentUser.profile?.slot || 1, profileKey: currentUser.profile?.data_key || '' };
        const response = await supabaseClient.functions.invoke('progress-sync', { body: { action: 'pull', ...credentials } });
        if (currentUser !== syncUser) return;
        if (response.error || response.data?.error) throw response.error || new Error(response.data.error);
        const localRecords = getCloudSyncRecords();
        const cloudRecords = response.data?.records || [];
        const cloudByKey = new Map(cloudRecords.map(record => [record.key, record]));
        const pending = [];

        applyingCloudSync = true;
        cloudRecords.forEach(record => {
          const local = localRecords[record.key];
          if (!local || Number(record.updatedAt) > Number(local.updatedAt || 0)) {
            applyCloudRecord(record.key, record.payload);
            localRecords[record.key] = { payload: record.payload, updatedAt: Number(record.updatedAt) };
          }
        });
        applyingCloudSync = false;

        Object.entries(localRecords).forEach(([key, record]) => {
          const cloud = cloudByKey.get(key);
          if (Number(record.updatedAt || 0) <= 0 && !cloud) record.updatedAt = Date.now();
          if (!cloud || Number(record.updatedAt) > Number(cloud.updatedAt || 0)) pending.push({ key, payload: record.payload, updatedAt: record.updatedAt });
        });
        saveCloudSyncRecords(localRecords);
        syncSnapshot = JSON.stringify(localRecords);
        for (let offset = 0; offset < pending.length; offset += 400) {
          if (currentUser !== syncUser) return;
          const push = await supabaseClient.functions.invoke('progress-sync', { body: { action: 'push', records: pending.slice(offset, offset + 400), ...credentials } });
          if (push.error || push.data?.error) throw push.error || new Error(push.data.error);
        }
        if (currentUser !== syncUser) return;
        refreshResumeUI?.();
      } catch (error) {
        console.warn('Sincronização em nuvem indisponível; os dados locais foram preservados.', error);
      } finally {
        applyingCloudSync = false;
        cloudSyncInFlight = false;
        if (currentUser && (currentUser !== syncUser || (syncSnapshot !== null && JSON.stringify(getCloudSyncRecords()) !== syncSnapshot))) scheduleCloudSync();
      }
    }

    window.addEventListener('online', () => syncCloudProgress());

    function getCloudGameSaveKey(game) {
      return `lux-play:game-save:${String(game?.id || game?.url || game?.name || '').replace(/[^a-z0-9_-]/gi, '_')}`;
    }

    async function requestGameSaveCloud(payload, user = currentUser) {
      if (!user) throw new Error('Entre na sua conta para acessar os saves.');
      const { data, error } = await supabaseClient.functions.invoke('game-save-sync', {
        body: { ...payload, username: user.user, password: user.pass, profileSlot: user.profile?.slot || 1, profileKey: user.profile?.data_key || '' }
      });
      if (currentUser !== user) throw new Error('A conta mudou durante a sincronização.');
      if (error || data?.error) throw new Error(data?.error || 'Não foi possível acessar o save na nuvem.');
      return data;
    }

    function arrayBufferToBase64(buffer) {
      const bytes = new Uint8Array(buffer);
      let binary = '';
      for (let index = 0; index < bytes.length; index++) binary += String.fromCharCode(bytes[index]);
      return btoa(binary);
    }

    function base64ToArrayBuffer(base64) {
      const binary = atob(base64);
      const bytes = new Uint8Array(binary.length);
      for (let index = 0; index < binary.length; index++) bytes[index] = binary.charCodeAt(index);
      return bytes.buffer;
    }

    async function serializeGameSaveState(state) {
      if (state instanceof Blob) return { format: 'arraybuffer', buffer: await state.arrayBuffer() };
      if (state instanceof ArrayBuffer) return { format: 'arraybuffer', buffer: state };
      if (ArrayBuffer.isView(state)) return { format: 'uint8array', buffer: state.buffer.slice(state.byteOffset, state.byteOffset + state.byteLength) };
      if (typeof state === 'string') return { format: 'text', buffer: new TextEncoder().encode(state).buffer };
      return { format: 'json', buffer: new TextEncoder().encode(JSON.stringify(state)).buffer };
    }

    function deserializeGameSaveState(dataBase64, format) {
      const buffer = base64ToArrayBuffer(dataBase64);
      if (format === 'uint8array') return new Uint8Array(buffer);
      if (format === 'text') return new TextDecoder().decode(buffer);
      if (format === 'json') return JSON.parse(new TextDecoder().decode(buffer));
      return buffer;
    }

    async function fetchCloudGameSaveSlots(game, user = currentUser) {
      const data = await requestGameSaveCloud({ action: 'list', gameKey: getCloudGameSaveKey(game), slot: 1 }, user);
      if (!Array.isArray(data?.slots)) throw new Error('Resposta inválida dos saves.');
      return data.slots;
    }

    async function syncGameSaveToCloud(game, slot, state, updatedAt = Date.now(), user = currentUser, expectedCloudAt = null) {
      if (!user || !game || !state) throw new Error('Save indisponível.');
      const serialized = await serializeGameSaveState(state);
      if (serialized.buffer.byteLength > 6 * 1024 * 1024) throw new Error('Save excede 6 MB e foi mantido neste dispositivo.');
      return requestGameSaveCloud({ action: 'save', gameKey: getCloudGameSaveKey(game), slot, updatedAt,
        format: serialized.format, dataBase64: arrayBufferToBase64(serialized.buffer), expectedCloudAt }, user);
    }

    async function loadCloudGameSave(game, slot, user = currentUser) {
      const data = await requestGameSaveCloud({ action: 'load', gameKey: getCloudGameSaveKey(game), slot }, user);
      if (!data?.save) return null;
      return { updatedAt: Number(data.save.updatedAt), state: deserializeGameSaveState(data.save.dataBase64, data.save.format) };
    }

    function getGameFavorites() {
      try {
        const favorites = JSON.parse(userProgressStorage.getItem('lux_game_favorites') || '[]');
        return Array.isArray(favorites) ? favorites : [];
      } catch (_) { return []; }
    }

    function isGameFavorite(game) { return getGameFavorites().includes(String(game?.id)); }

    function toggleGameFavorite(game, event) {
      event?.stopPropagation();
      if (!game?.id) return;
      const id = String(game.id);
      const favorites = getGameFavorites();
      const isFavoriteNow = !favorites.includes(id);
      userProgressStorage.setItem('lux_game_favorites', JSON.stringify(isFavoriteNow ? [...favorites, id] : favorites.filter(item => item !== id)));
      markCloudRecord(`favorite:game:${encodeURIComponent(id)}`, { favorite: isFavoriteNow }, !isFavoriteNow);
      renderGamesCatalog?.();
      updateGameDetailsActions?.(currentGameDetails);
    }

    function toggleCurrentGameFavorite(event) {
      if (currentGameDetails) toggleGameFavorite(currentGameDetails, event);
    }

    function toggleGameFavoriteById(id, event) {
      const game = gamesCatalog.find(item => String(item.id) === String(id));
      if (game) toggleGameFavorite(game, event);
    }

    function getFavorites() {
      try {
        const favs = userProgressStorage.getItem('lux_favorites');
        return favs ? JSON.parse(favs) : [];
      } catch (e) {
        return [];
      }
    }

    function isFavorite(item) {
      const key = getItemKey(item);
      return getFavorites().includes(key);
    }

    function toggleFavorite(item, event) {
      if (event) event.stopPropagation();
      const key = getItemKey(item);
      let favs = getFavorites();
      if (favs.includes(key)) {
        favs = favs.filter(k => k !== key);
      } else {
        favs.push(key);
      }
      userProgressStorage.setItem('lux_favorites', JSON.stringify(favs));
      markCloudRecord(`favorite:media:${encodeURIComponent(key)}`, { favorite: favs.includes(key) }, !favs.includes(key));
      renderCategories();
      filterMedia();
    }

    function toggleFavoriteCurrentMovie(event) {
      if (currentMovieItem) {
        toggleFavorite(currentMovieItem, event);
        updateMovieModalFavBtn();
      }
    }

    function updateMovieModalFavBtn() {
      if (!currentMovieItem) return;
      const fav = isFavorite(currentMovieItem);
      const textElem = document.getElementById('movieModalFavText');
      if (textElem) {
        textElem.innerText = fav ? 'Favoritado' : 'Favoritar';
      }
    }

    function toggleFavoriteCurrentSeries(event) {
      if (currentSeriesItem) {
        toggleFavorite(currentSeriesItem, event);
        updateSeriesModalFavBtn();
      }
    }

    function updateSeriesModalFavBtn() {
      if (!currentSeriesItem) return;
      const fav = isFavorite(currentSeriesItem);
      const textElem = document.getElementById('seriesModalFavText');
      if (textElem) {
        textElem.innerText = fav ? 'Favoritado' : 'Favoritar';
      }
    }

    function getResumeKey(item) {
      if (!item) return '';
      if (item.resumeKey) return item.resumeKey;
      if (item.type === 'series') {
        return 'lux_progress_series_' + (item.id || item.series_id || item.url || 'unknown');
      }
      return 'lux_progress_' + (item.id || item.url || 'unknown');
    }

    function getResumeMetaKey(itemOrResumeKey) {
      const resumeKey = typeof itemOrResumeKey === 'string' ? itemOrResumeKey : getResumeKey(itemOrResumeKey);
      return resumeKey ? resumeKey + '_meta' : '';
    }

    // Séries precisam de um estado próprio: o episódio é apenas a posição atual
    // dentro da série, e não uma entrada independente no catálogo.
    function getSeriesResumeKey(seriesOrId) {
      const seriesId = typeof seriesOrId === 'object'
        ? (seriesOrId.series_id || seriesOrId.id)
        : seriesOrId;
      return seriesId ? `lux_series_resume_${seriesId}` : '';
    }

    function getSeriesResumeState(seriesOrId) {
      try {
        const raw = userProgressStorage.getItem(getSeriesResumeKey(seriesOrId));
        const state = raw ? JSON.parse(raw) : null;
        return state && typeof state === 'object' ? state : null;
      } catch (e) {
        return null;
      }
    }

    function saveSeriesResumeState(item, progress) {
      if (!item || item.type !== 'series' || !item.series_id) return;
      try {
        const state = {
          seriesId: item.series_id,
          seriesName: item.seriesName || item.name || 'Série',
          seriesLogo: item.logo || '',
          seriesGroup: item.group || '',
          seasonNum: Number(item.seasonNum) || 1,
          episodeId: item.id || '',
          episodeNum: item.episodeNum || 1,
          episodeTitle: item.episodeTitle || '',
          episodeIndex: Number.isInteger(item.episodeIndex) ? item.episodeIndex : 0,
          progress: Math.max(0, Number(progress) || 0),
          updatedAt: Date.now()
        };
        userProgressStorage.setItem(getSeriesResumeKey(item), JSON.stringify(state));
        markCloudRecord(`series:${state.seriesId}`, { state });
      } catch (e) {}
    }

    function removeSeriesResumeState(seriesOrId) {
      try {
        const key = getSeriesResumeKey(seriesOrId);
        userProgressStorage.removeItem(key);
        const seriesId = key.replace('lux_series_resume_', '');
        if (seriesId) markCloudRecord(`series:${seriesId}`, {}, true);
      } catch (e) {}
    }

    function saveResumeMetadata(item) {
      if (!item || item.type === 'live') return;
      try {
        const resumeKey = getResumeKey(item);
        if (!resumeKey) return;
        const meta = {
          name: item.name || 'Sem título',
          url: item.url || '',
          type: item.type || 'movies',
          id: item.id || '',
          series_id: item.series_id || '',
          logo: item.logo || '',
          group: item.group || '',
          updatedAt: Date.now()
        };
        userProgressStorage.setItem(getResumeMetaKey(resumeKey), JSON.stringify(meta));
        const progress = Number(userProgressStorage.getItem(resumeKey));
        if (Number.isFinite(progress) && progress > 0) markCloudRecord(`resume:${resumeKey}`, { progress, meta });
      } catch (e) {}
    }

    function removeResumeData(itemOrResumeKey) {
      try {
        const resumeKey = typeof itemOrResumeKey === 'string' ? itemOrResumeKey : getResumeKey(itemOrResumeKey);
        if (!resumeKey) return;
        userProgressStorage.removeItem(resumeKey);
        userProgressStorage.removeItem(getResumeMetaKey(resumeKey));
        markCloudRecord(`resume:${resumeKey}`, {}, true);
      } catch (e) {}
    }

    function hasResumeEntry(item) {
      if (!item || item.type === 'live') return false;
      if (item.type === 'series') return Boolean(getSeriesResumeState(item));
      const progress = Number.parseFloat(userProgressStorage.getItem(getResumeKey(item)));
      return Number.isFinite(progress) && progress > 0;
    }

    function getResumeEntries() {
      const entries = new Map();

      allMediaItems.forEach(item => {
        if (!item || item.type === 'live') return;
        if (item.type === 'series') return;
        const resumeKey = getResumeKey(item);
        const rawProgress = userProgressStorage.getItem(resumeKey);
        const progress = Number.parseFloat(rawProgress);
        if (!Number.isFinite(progress) || progress <= 0) return;

        let itemForResume = item;
        let updatedAt = 0;

        const metaRaw = userProgressStorage.getItem(getResumeMetaKey(resumeKey));
        if (metaRaw) {
          try {
            const meta = JSON.parse(metaRaw);
            if (meta && typeof meta === 'object') {
              itemForResume = { ...item, ...meta, resumeKey };
              updatedAt = Number(meta.updatedAt) || 0;
            }
          } catch (e) {}
        }

        entries.set(resumeKey, { item: itemForResume, progress, updatedAt });
      });

      for (let i = 0; i < userProgressStorage.length; i++) {
        const key = userProgressStorage.key(i);
        if (!key || !key.startsWith('lux_progress_') || key.endsWith('_meta') || key.startsWith('lux_progress_series_episode_')) continue;

        const progress = Number.parseFloat(userProgressStorage.getItem(key));
        if (!Number.isFinite(progress) || progress <= 0) continue;

        const metaRaw = userProgressStorage.getItem(getResumeMetaKey(key));
        if (!metaRaw) continue;

        try {
          const meta = JSON.parse(metaRaw);
          if (!meta || meta.type === 'live' || !meta.url) continue;
          entries.set(key, {
            item: { ...meta, resumeKey: key },
            progress,
            updatedAt: Number(meta.updatedAt) || 0
          });
        } catch (e) {}
      }

      // Uma única entrada por série, sempre apontando para o episódio atual.
      for (let i = 0; i < userProgressStorage.length; i++) {
        const key = userProgressStorage.key(i);
        if (!key || !key.startsWith('lux_series_resume_')) continue;
        try {
          const state = JSON.parse(userProgressStorage.getItem(key));
          if (!state || !state.seriesId) continue;
          const series = allMediaItems.find(item => item.type === 'series' && String(item.series_id) === String(state.seriesId));
          const item = {
            ...(series || {}),
            id: state.seriesId,
            series_id: state.seriesId,
            name: state.seriesName || (series && series.name) || 'Série',
            logo: state.seriesLogo || (series && series.logo) || '',
            group: state.seriesGroup || (series && series.group) || '',
            type: 'series',
            seriesResumeState: state
          };
          entries.set(key, { item, progress: Number(state.progress), updatedAt: Number(state.updatedAt) || 0 });
        } catch (e) {}
      }

      return Array.from(entries.values())
        .filter(entry => typeof profileAllowsMedia !== 'function' || profileAllowsMedia(entry.item))
        .filter(entry => entry.item && (entry.item.url || entry.item.seriesResumeState))
        .sort((a, b) => b.updatedAt - a.updatedAt);
    }

    async function resumeSeriesFromState(series, state) {
      const savedState = state || getSeriesResumeState(series);
      if (!savedState) return;

      // O atalho da Home sempre devolve o usuário à aba Séries antes de retomar.
      setSection('series');
      await openSeriesModal(series, savedState, true);
    }

    function getLiveFallbackHtml(isAdult) {
      if (isAdult) {
        return `<div class="w-9 h-9 rounded-lg bg-rose-950/50 border border-rose-900/70 flex flex-col items-center justify-center text-rose-400 font-bold text-[9px] shrink-0"><i data-lucide="lock" class="w-3.5 h-3.5"></i><span>+18</span></div>`;
      }
      return `<div class="w-9 h-9 rounded-lg bg-[#180f29] border border-purple-900/50 flex items-center justify-center text-purple-400 shrink-0"><i data-lucide="tv" class="w-4 h-4"></i></div>`;
    }

    async function smartFetch(url) {
      const encoded = encodeURIComponent(url);
      const endpoints = [
        url,
        `https://api.allorigins.win/raw?url=${encoded}`,
        `https://corsproxy.io/?${encoded}`,
        `https://thingproxy.freeboard.io/fetch/${url}`
      ];

      for (const target of endpoints) {
        try {
          const controller = new AbortController();
          const timeoutId = setTimeout(() => controller.abort(), 8000);
          const res = await fetch(target, { signal: controller.signal });
          clearTimeout(timeoutId);
          if (res.ok) return res;
        } catch (e) {}
      }
      throw new Error(`Falha ao conectar: ${url}`);
    }

    async function fetchNotificationsFromSheet() {
      const sheetUrl = `https://docs.google.com/spreadsheets/d/${NOTIFICATION_SHEET_ID}/export?format=csv`;
      try {
        const res = await smartFetch(sheetUrl);
        const csvText = await res.text();
        return parseNotificationCSV(csvText);
      } catch (e) {
        return [];
      }
    }

    function parseNotificationCSV(text) {
      const lines = text.trim().split(/\r?\n/);
      const list = [];
      for (let i = 1; i < lines.length; i++) {
        const row = lines[i].split(/,(?=(?:(?:[^"]*"){2})*[^"]*$)/).map(v => v.replace(/^"|"$/g, '').trim());
        if (row.length >= 3) {
          list.push({
            startDate: row[0] || '',
            endDate: row[1] || '',
            message: row[2] || '',
            link: row[3] || ''
          });
        }
      }
      return list;
    }

    function isNotificationActive(startDateStr, endDateStr) {
      if (!startDateStr || !endDateStr) return false;
      try {
        const parseD = (s, isEnd) => {
          const parts = s.split('/');
          if (parts.length !== 3) return null;
          return new Date(parseInt(parts[2], 10), parseInt(parts[1], 10) - 1, parseInt(parts[0], 10), isEnd ? 23 : 0, isEnd ? 59 : 0, isEnd ? 59 : 0);
        };
        const start = parseD(startDateStr, false);
        const end = parseD(endDateStr, true);
        const now = new Date();
        if (!start || !end) return false;
        return now >= start && now <= end;
      } catch (e) {
        return false;
      }
    }

    function renderNotifications(autoDismiss = true) {
      const container = document.getElementById('notificationContainer');
      container.innerHTML = '';
      if (!activeNotifications || activeNotifications.length === 0) return;

      activeNotifications.forEach((item, index) => {
        const toast = document.createElement('div');
        toast.className = "bg-[#120c1f]/95 border border-purple-900/70 rounded-2xl p-3.5 lux-glow-sm shadow-2xl flex items-start gap-3 backdrop-blur-md pointer-events-auto transition-all duration-300 transform translate-y-4 opacity-0";
        
        const linkHtml = item.link ? `<a href="${item.link}" target="_blank" onclick="hideNotificationDot()" class="inline-flex items-center gap-1 text-[11px] text-purple-400 hover:text-purple-300 font-bold mt-1 transition-colors">Acessar link <i data-lucide="external-link" class="w-3 h-3"></i></a>` : '';

        toast.innerHTML = `
          <div class="w-8 h-8 rounded-xl bg-purple-950/80 border border-purple-800/50 text-purple-400 flex items-center justify-center shrink-0 mt-0.5">
            <i data-lucide="bell" class="w-4 h-4"></i>
          </div>
          <div class="flex-1 min-w-0">
            <p class="text-xs font-semibold text-slate-100 leading-snug break-words">${item.message}</p>
            ${linkHtml}
          </div>
          <button onclick="dismissNotification(this)" class="text-purple-400 hover:text-white p-1 rounded-lg shrink-0 transition-colors" title="Fechar">
            <i data-lucide="x" class="w-3.5 h-3.5"></i>
          </button>
        `;

        container.appendChild(toast);

        setTimeout(() => {
          toast.classList.remove('translate-y-4', 'opacity-0');
        }, 60 * index);

        if (autoDismiss) {
          setTimeout(() => {
            if (toast && toast.parentElement) {
              toast.classList.add('opacity-0', 'translate-y-4');
              setTimeout(() => {
                toast.remove();
                checkIfAllToastsClosed();
              }, 300);
            }
          }, 5000);
        }
      });

      lucide.createIcons();
    }

    function hideNotificationDot() {
      const badge = document.getElementById('notificationBadge');
      if (badge) badge.classList.add('hidden');
    }

    function dismissNotification(btn) {
      const toast = btn.closest('.pointer-events-auto');
      if (toast) {
        toast.classList.add('opacity-0', 'translate-y-4');
        setTimeout(() => {
          toast.remove();
          checkIfAllToastsClosed();
        }, 300);
      }
    }

    function checkIfAllToastsClosed() {
      const container = document.getElementById('notificationContainer');
      if (!container || container.children.length === 0) {
        hideNotificationDot();
      }
    }

    function reopenNotifications() {
      hideNotificationDot();
      renderNotifications(false);
    }

    async function loadAndShowNotifications() {
      const raw = await fetchNotificationsFromSheet();
      activeNotifications = raw.filter(n => isNotificationActive(n.startDate, n.endDate));
      
      if (activeNotifications.length > 0) {
        const badge = document.getElementById('notificationBadge');
        if (badge) badge.classList.remove('hidden');

        const todayStr = new Date().toDateString();
        const lastShownDate = localStorage.getItem('lux_notification_last_shown');

        if (lastShownDate !== todayStr) {
          renderNotifications(true);
          localStorage.setItem('lux_notification_last_shown', todayStr);
        }
      }
    }

    async function fetchUsersFromSupabase() {
      const { data, error } = await supabaseClient
        .from('usuarios')
        .select('*');
      
      if (error) {
        throw new Error(error.message);
      }
      return data || [];
    }

    function parseSupabaseUsers(rows) {
      return rows.map(row => {
        const nome = row.nome || '';
        const usuario = row.usuario || '';
        const senha = row.senha || '';
        const lista = row.lista_m3u || '';
        const vencimento = row.vencimento || '';
        const userXc = row.userxc || '';
        const senhaXc = row.senhaxc || '';
        const urlXc = row.urlxc || '';
        const senhaAdulto = row['senha18+'] || senha;
        const cargo = row.cargo || 'user';

        const isAdmin = cargo.trim().toLowerCase() === 'admin';

        return {
          name: nome,
          user: usuario,
          pass: senha,
          m3uUrl: lista,
          dueDate: vencimento,
          userXc: userXc,
          senhaXc: senhaXc,
          urlXc: urlXc,
          adultPin: senhaAdulto,
          role: isAdmin ? 'admin' : 'user'
        };
      });
    }

    function isExpired(dateStr) {
      if (!dateStr) return false;
      const parts = dateStr.split('/');
      if (parts.length === 3) {
        const due = new Date(parseInt(parts[2], 10), parseInt(parts[1], 10) - 1, parseInt(parts[0], 10), 23, 59, 59);
        return new Date() > due;
      }
      return false;
    }

    function isAdultContent(group = '', name = '') {
      const str = `${group} ${name}`.toLowerCase();
      return str.includes('adult') || 
             str.includes('xxx') || 
             str.includes('+18') || 
             str.includes('18+') || 
             str.includes('playboy') || 
             str.includes('sexy') || 
             str.includes('venus') || 
             str.includes('prive') || 
             str.includes('mycamtv') || 
             str.includes('erot');
    }

    function resolveUserCredentials(user) {
      if (user.urlXc && user.userXc && user.senhaXc) {
        return { isXc: true, server: user.urlXc, user: user.userXc, pass: user.senhaXc };
      }
      if (user.m3uUrl && (user.m3uUrl.includes('get.php') || user.m3uUrl.includes('player_api.php'))) {
        try {
          const u = new URL(user.m3uUrl);
          const username = u.searchParams.get('username') || u.searchParams.get('user');
          const password = u.searchParams.get('password') || u.searchParams.get('pass');
          if (username && password) {
            return { isXc: true, server: u.origin, user: username, pass: password };
          }
        } catch (e) {}
      }
      if (user.m3uUrl) {
        return { isXc: false, url: user.m3uUrl };
      }
      return { isXc: false, url: '' };
    }

    async function handleLogin() {
      const userInput = document.getElementById('authEmail').value.trim();
      const passInput = document.getElementById('authPass').value.trim();
      const statusText = document.getElementById('authStatusText');
      const loginBtn = document.getElementById('loginBtn');

      if (!userInput || !passInput) {
        statusText.innerText = 'Preencha usuário e senha.';
        statusText.className = 'text-xs text-center text-rose-400 font-medium';
        return;
      }

      statusText.innerText = 'Verificando dados no Supabase...';
      statusText.className = 'text-xs text-center text-purple-400 font-medium';
      loginBtn.disabled = true;

      let loginStage = 'database';
      try {
        const rows = await fetchUsersFromSupabase();
        loginStage = 'profiles';
        const users = parseSupabaseUsers(rows);
        const account = users.find(u => u.user.toLowerCase() === userInput.toLowerCase() && u.pass === passInput);

        if (account) {
          if (account.dueDate && isExpired(account.dueDate)) {
            statusText.innerText = `Acesso vencido em ${account.dueDate}.`;
            statusText.className = 'text-xs text-center text-rose-400 font-medium';
            loginBtn.disabled = false;
            return;
          }
          
          currentUser = account;
          isAdultUnlocked = false;
          statusText.innerText = '';
          
          localStorage.setItem('lux_auth_user', userInput);
          localStorage.setItem('lux_auth_pass', passInput);
          
          await openProfilePicker(true);
        } else {
          statusText.innerText = 'Usuário ou senha incorretos.';
          statusText.className = 'text-xs text-center text-rose-400 font-medium';
        }
      } catch (err) {
        statusText.innerText = loginStage === 'database' ? 'Não foi possível conectar ao Supabase. Tente novamente.' : 'Não foi possível abrir os perfis. Recarregue o aplicativo.';
        statusText.className = 'text-xs text-center text-rose-400 font-medium';
      } finally {
        loginBtn.disabled = false;
      }
    }

    function showSplashScreen() {
      document.getElementById('splashUserName').textContent = currentUser?.profile?.name || currentUser?.name || 'Usuário';
      document.getElementById('splashStatusMessage').textContent = 'Preparando seu espaço...';
      transitionScreen(document.getElementById('loadingSplash'), true);
      transitionScreen(document.getElementById('authScreen'), false);
    }

    function hideSplashScreen() {
      transitionScreen(document.getElementById('loadingSplash'), false).then(updateNavIndicator);
    }

    function logout() {
      window.LuxReadingAdmin?.stop();
      window.LuxReader?.close();
      transitionScreen(document.getElementById('profilePicker'), false);
      document.getElementById('profileEditPassword').value='';
      document.getElementById('profileAdultPassword').value='';
      if (currentPlayingVodItem) closeVodPlayer();
      if (cloudSyncTimer) clearTimeout(cloudSyncTimer);
      closeGameEmulator();
      closeGameDetails();
      document.getElementById('continueSlotModal')?.classList.add('hidden');
      lockAdminR2Config();
      currentUser = null;
      sharedVodCatalog = [];
      allMediaItems = [];
      isAdultUnlocked = false;
      
      localStorage.removeItem('lux_auth_user');
      localStorage.removeItem('lux_auth_pass');
      document.getElementById('authEmail').value = '';
      document.getElementById('authPass').value = '';
      
      const auth = document.getElementById('authScreen');
      auth.classList.remove('hidden');
      setTimeout(() => {
        auth.classList.remove('screen-hidden-down');
        auth.classList.add('screen-visible');
      }, 30);
    }

    async function startApp() {
      window.LuxReaderCloud?.flush();
      restoreAccountProgress();
      sharedVodCatalog = [];
      allMediaItems = [];
      document.getElementById('userNameBadge').innerText = currentUser.profile?.name || currentUser.name;
      renderProfileHeader();
      document.getElementById('userExpiryBadge').innerText = currentUser.dueDate ? `Val: ${currentUser.dueDate}` : 'Val: Ilimitada';

      if (currentUser.role === 'admin') {
        document.getElementById('adminPanelBtn').classList.remove('hidden');
        document.getElementById('gameUploadBtn').classList.add('hidden');
        document.getElementById('connectionConfigBtn').classList.remove('hidden');
      } else {
        document.getElementById('adminPanelBtn').classList.add('hidden');
        document.getElementById('gameUploadBtn').classList.add('hidden');
        document.getElementById('connectionConfigBtn').classList.add('hidden');
      }

      const liveContainer = document.getElementById('liveItemsContainer');
      liveContainer.onscroll = () => handleScroll(liveContainer);

      const vodContainer = document.getElementById('vodGridContainer');
      vodContainer.onscroll = () => handleScroll(vodContainer);

      const statusMsg = document.getElementById('splashStatusMessage');
      if (statusMsg) statusMsg.innerText = "Configurando sua experiência... O primeiro acesso pode demorar cerca de 1 min.";

      const xcCreds = resolveUserCredentials(currentUser);

      if (xcCreds.isXc) {
        await loadFromXtreamApi(xcCreds.server, xcCreds.user, xcCreds.pass);
      } else if (xcCreds.url) {
        await loadPlaylist(xcCreds.url);
      } else {
        // Contas sem playlist também carregam o catálogo compartilhado.
      }

      try { await loadSharedVodCatalog(); } catch (error) { alert(error.message); }
      await syncCloudProgress();
      retryPendingGameSaves();

      if (statusMsg) statusMsg.innerText = "Tudo pronto! Iniciando o Lux Play...";
      await new Promise(resolve => setTimeout(resolve, 640));

      setSection('home');
      hideSplashScreen();
      lucide.createIcons();
      loadAndShowNotifications();
    }

    function handleScroll(container) {
      if (container.scrollTop + container.clientHeight >= container.scrollHeight - 350) {
        if (visibleCount < currentFilteredItems.length) {
          visibleCount += ITEMS_PER_PAGE;
          appendMoreItems();
        }
      }
    }

    async function reloadUserData() {
      if (!currentUser) return;
      showSplashScreen();
      try {
        const rows = await fetchUsersFromSupabase();
        const users = parseSupabaseUsers(rows);
        const updated = users.find(u => u.user.toLowerCase() === currentUser.user.toLowerCase());
        if (updated) {
          currentUser = {...updated,accountRole:updated.role,profile:currentUser.profile,role:currentUser.profile?.is_child?'user':updated.role};
          const xcCreds = resolveUserCredentials(currentUser);
          if (xcCreds.isXc) {
            await loadFromXtreamApi(xcCreds.server, xcCreds.user, xcCreds.pass);
          } else if (xcCreds.url) {
            await loadPlaylist(xcCreds.url);
          }
        }
        await loadSharedVodCatalog();
        setSection(currentSection);
      } catch (e) { alert(e.message); }
      hideSplashScreen();
      loadAndShowNotifications();
    }

    function toggleSidebar() {
      const sidebar = document.getElementById('desktopSidebar');
      const openTab = document.getElementById('sidebarOpenTab');
      const vodGrid = document.getElementById('vodGridContainer');
      if (!sidebar) return;

      sidebar.classList.toggle('sidebar-collapsed');
      const isCollapsed = sidebar.classList.contains('sidebar-collapsed');

      if (openTab) {
        if (isCollapsed) {
          openTab.classList.remove('hidden');
          openTab.classList.add('flex');
        } else {
          openTab.classList.remove('flex');
          openTab.classList.add('hidden');
        }
      }

      if (vodGrid) {
        if (isCollapsed) {
          vodGrid.className = vodGrid.className.replace('xl:grid-cols-5', 'xl:grid-cols-6 2xl:grid-cols-7');
        } else {
          vodGrid.className = vodGrid.className.replace('xl:grid-cols-6 2xl:grid-cols-7', 'xl:grid-cols-5');
        }
      }

      lucide.createIcons();
    }

    async function toggleAdminModal() {
      lockAdminR2Config();
      const modal = document.getElementById('adminModal');
      modal.classList.toggle('hidden');
      if (!modal.classList.contains('hidden')) {
        await loadAdminUsersList();
      }
    }

    async function loadAdminUsersList() {
      const container = document.getElementById('adminUsersListContainer');
      container.innerHTML = '<p class="text-xs text-purple-400/60 text-center py-4">Carregando clientes...</p>';
      try {
        const { data, error } = await supabaseClient.from('usuarios').select('*').order('nome', { ascending: true });
        if (error || !data) {
          container.innerHTML = '<p class="text-xs text-rose-400 text-center py-4">Erro ao carregar do Supabase.</p>';
          return;
        }

        if (data.length === 0) {
          container.innerHTML = '<p class="text-xs text-purple-400/60 text-center py-4">Nenhum cliente cadastrado.</p>';
          return;
        }

        container.innerHTML = '';
        data.forEach(u => {
          const row = document.createElement('div');
          row.className = "flex items-center justify-between p-2.5 bg-[#180f29] border border-purple-900/40 rounded-xl";
          row.innerHTML = `
            <div class="min-w-0 pr-2">
              <p class="text-xs font-bold text-white truncate">${u.nome} <span class="text-[10px] text-purple-400 font-mono">(${u.usuario})</span></p>
              <p class="text-[10px] text-slate-400 truncate">Venc: ${u.vencimento || 'Ilimitado'} • Cargo: ${u.cargo || 'user'}</p>
            </div>
            <button onclick="adminDeleteUser('${u.usuario}')" class="bg-rose-950/60 hover:bg-rose-900 text-rose-400 p-1.5 rounded-lg text-xs transition-all shrink-0" title="Excluir">
              <i data-lucide="trash-2" class="w-3.5 h-3.5"></i>
            </button>
          `;
          container.appendChild(row);
        });
        lucide.createIcons();
      } catch (e) {
        container.innerHTML = '<p class="text-xs text-rose-400 text-center py-4">Erro de conexão com Supabase.</p>';
      }
    }

    async function adminCreateUser() {
      const nome = document.getElementById('adminNewName').value.trim();
      const usuario = document.getElementById('adminNewUser').value.trim();
      const senha = document.getElementById('adminNewPass').value.trim();
      const vencimento = document.getElementById('adminNewDue').value.trim();
      const lista_m3u = document.getElementById('adminNewM3u').value.trim();
      const userxc = document.getElementById('adminNewUserXc').value.trim();
      const senhaxc = document.getElementById('adminNewPassXc').value.trim();
      const urlxc = document.getElementById('adminNewUrlXc').value.trim();
      const senhaAdulto = document.getElementById('adminNewAdultPin').value.trim() || senha;
      const cargo = document.getElementById('adminNewRole').value;

      if (!nome || !usuario || !senha) {
        alert('Preencha pelo menos Nome, Usuário e Senha.');
        return;
      }

      const { error } = await supabaseClient.from('usuarios').insert([{
        usuario,
        nome,
        senha,
        vencimento,
        lista_m3u,
        cargo,
        userxc,
        senhaxc,
        urlxc,
        'senha18+': senhaAdulto
      }]);

      if (error) {
        alert('Erro ao cadastrar: ' + error.message);
      } else {
        alert('Cliente cadastrado com sucesso!');
        document.getElementById('adminNewName').value = '';
        document.getElementById('adminNewUser').value = '';
        document.getElementById('adminNewPass').value = '';
        document.getElementById('adminNewDue').value = '';
        document.getElementById('adminNewM3u').value = '';
        document.getElementById('adminNewUserXc').value = '';
        document.getElementById('adminNewPassXc').value = '';
        document.getElementById('adminNewUrlXc').value = '';
        document.getElementById('adminNewAdultPin').value = '';
        loadAdminUsersList();
      }
    }

    async function adminDeleteUser(usuarioId) {
      if (!confirm(`Deseja realmente excluir o usuário ${usuarioId}?`)) return;
      const { error } = await supabaseClient.from('usuarios').delete().eq('usuario', usuarioId);
      if (error) {
        alert('Erro ao excluir: ' + error.message);
      } else {
        loadAdminUsersList();
      }
    }

    // Catálogo de ROMs: os registros ficam em `games` e os arquivos no bucket `games`.
    let gamesCatalog = [];
    let editingGameId = null;

    function escapeGameHtml(value = '') {
      return String(value).replace(/[&<>'"]/g, char => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;'
      }[char]));
    }

    function gameStorageUrl(path) {
      if (!path) return '';
      return supabaseClient.storage.from('games').getPublicUrl(path).data.publicUrl || '';
    }

    function fillGameTitleFromRom() {
      const input = document.getElementById('gameAdminRom');
      const title = document.getElementById('gameAdminTitle');
      if (!input?.files?.[0] || !title || title.value.trim()) return;
      title.value = input.files[0].name.replace(/\.[^.]+$/, '').replace(/[._-]+/g, ' ').replace(/\s+/g, ' ').trim();
    }

    function setGameAdminStatus(message, isError = false) {
      const status = document.getElementById('gameAdminStatus');
      if (!status) return;
      status.textContent = message;
      status.className = `mt-3 text-xs ${isError ? 'text-rose-400' : 'text-emerald-300'}`;
    }

    function normalizeGameDuplicateKey(value) {
      return String(value || '')
        .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
        .toLowerCase().replace(/\.[^.]+$/, '')
        .replace(/[^a-z0-9]+/g, ' ').trim();
    }

    function gameTitleFromFile(file) {
      return file.name.replace(/\.[^.]+$/, '').replace(/[._-]+/g, ' ').replace(/\s+/g, ' ').trim();
    }

    async function getGameFileHash(file) {
      if (!window.crypto?.subtle) return null;
      const buffer = await file.arrayBuffer();
      const digest = await window.crypto.subtle.digest('SHA-256', buffer);
      return Array.from(new Uint8Array(digest)).map(byte => byte.toString(16).padStart(2, '0')).join('');
    }

    function gameImportErrorMessage(error) {
      if (!error) return 'erro desconhecido';
      if (typeof error === 'string') return error;
      return error.message || error.error_description || error.details || 'erro desconhecido';
    }

    function setGameBatchSummary(completed, skipped, failures) {
      const status = document.getElementById('gameAdminStatus');
      if (!status) return;
      const lines = [`Importação concluída: ${completed} enviado(s), ${skipped.length} ignorado(s), ${failures.length} com falha.`];
      if (skipped.length) lines.push(`Ignorados:\n${skipped.map(item => `• ${item.name}: ${item.reason}`).join('\n')}`);
      if (failures.length) lines.push(`Falhas:\n${failures.map(item => `• ${item.name}: ${item.reason}`).join('\n')}`);
      status.textContent = lines.join('\n\n');
      status.className = `mt-3 text-xs whitespace-pre-line ${failures.length ? 'text-rose-400' : 'text-emerald-300'}`;
    }

    function clearGameAdminForm() {
      document.getElementById('gameAdminPlayers').value = '1';
      document.getElementById('gameAdminCoop').value = '';
      ['gameAdminRom', 'gameAdminTitle', 'gameAdminYear', 'gameAdminGenres', 'gameAdminCoverUrl', 'gameAdminSynopsis'].forEach(id => {
        const input = document.getElementById(id);
        if (input) input.value = '';
      });
      const results = document.getElementById('gameMetadataResults');
      if (results) results.innerHTML = '';
      const sourceFile = document.getElementById('gameAdminSourceFile');
      if (sourceFile) { sourceFile.innerHTML = ''; sourceFile.classList.add('hidden'); }
      gameMetadataCandidates = [];
      gameMetadataSearchVersion++;
      selectedGameMetadata = null;
      editingGameId = null;
    }

    function cancelGameAdminForm() {
      pendingReviewQueue = [];
      clearGameAdminForm();
      const modal = document.getElementById('gameUploadModal');
      if (modal) modal.classList.add('hidden');
    }

    function toggleGameUploadModal() {
      if (!currentUser || currentUser.role !== 'admin') return;
      const modal = document.getElementById('gameUploadModal');
      if (!modal) return;
      if (!modal.classList.contains('hidden')) return cancelGameAdminForm();
      pendingReviewQueue = [];
      clearGameAdminForm();
      setGameAdminStatus('Selecione uma ou mais ROMs para enviar.');
      showGameAdminForm('Enviar jogos');
    }

    function showGameAdminForm(title) {
      const modal = document.getElementById('gameUploadModal');
      modal.querySelector('h3').textContent = title;
      modal.style.zIndex = '80';
      modal.classList.remove('hidden');
      document.getElementById('gameAdminTitle').focus();
      lucide.createIcons();
    }

    function adminEditGame(id, event) {
      event?.stopPropagation();
      if (!currentUser || currentUser.role !== 'admin') return;
      const game = gamesCatalog.find(item => String(item.id) === String(id));
      if (!game) return alert('Jogo não encontrado no catálogo. Atualize a lista e tente novamente.');
      // An explicit card edit must not retain an unrelated review queue or metadata.
      if (event) pendingReviewQueue = [];
      clearGameAdminForm();
      editingGameId = game.id;
      document.getElementById('gameAdminRom').value = '';
      document.getElementById('gameAdminTitle').value = game.title || '';
      document.getElementById('gameAdminConsole').value = game.console || 'snes';
      document.getElementById('gameAdminYear').value = game.release_year || '';
      document.getElementById('gameAdminPlayers').value = String(game.players || 1);
      document.getElementById('gameAdminCoop').value = game.coop === true ? 'yes' : game.coop === false ? 'no' : '';
      document.getElementById('gameAdminGenres').value = Array.isArray(game.genres) ? game.genres.join(', ') : (game.genres || game.genre || '');
      document.getElementById('gameAdminCoverUrl').value = game.cover_url || '';
      document.getElementById('gameAdminSynopsis').value = game.synopsis || game.sinopse || '';
      const sourceFile = document.getElementById('gameAdminSourceFile');
      const isReview = String(pendingReviewQueue[0]) === String(game.id);
      const fileName = game.source_file_name || game.rom_path?.split('/').pop() || '';
      const extension = fileName.includes('.') ? fileName.split('.').pop().toLowerCase() : 'não identificada';
      if (sourceFile && isReview && fileName) {
        sourceFile.innerHTML = `<span class="font-bold">ROM em revisão:</span> ${escapeGameHtml(fileName)} <span class="ml-1 rounded bg-amber-400/15 px-1.5 py-0.5 font-mono font-bold text-amber-200">.${escapeGameHtml(extension)}</span>`;
        sourceFile.classList.remove('hidden');
      } else if (sourceFile) {
        sourceFile.innerHTML = '';
        sourceFile.classList.add('hidden');
      }
      setGameAdminStatus(isReview ? `Revise os dados da ROM .${extension} antes de publicar.` : 'Editando dados do jogo. A ROM atual será mantida.');
      showGameAdminForm(isReview ? 'Revisar jogo' : 'Editar jogo');
    }

    let pendingReviewQueue = [];

    async function reviewUnapprovedGames() {
      if (!currentUser || currentUser.role !== 'admin') return;
      try {
        await loadGamesCatalog();
        pendingReviewQueue = gamesCatalog.filter(game => game.status !== 'approved').map(game => game.id);
        if (!pendingReviewQueue.length) return alert('Não há jogos não aprovados para revisar.');
        openNextPendingReview();
      } catch (error) {
        alert(`Não foi possível carregar os jogos para revisão: ${gameImportErrorMessage(error)}`);
      }
    }

    function openNextPendingReview() {
      const nextId = pendingReviewQueue[0];
      if (nextId === undefined) {
        cancelGameAdminForm();
        alert('Revisão concluída.');
        return;
      }
      adminEditGame(nextId);
      setGameAdminStatus(`Revisando ${pendingReviewQueue.length} jogo(s) não aprovado(s), um por vez.`);
    }

    async function adminDeleteGame(id, event) {
      event?.stopPropagation();
      if (!currentUser || currentUser.role !== 'admin') return;
      const game = gamesCatalog.find(item => String(item.id) === String(id));
      if (!game) return alert('Jogo não encontrado no catálogo. Atualize a página e tente novamente.');
      if (!confirm(`Remover “${game.title || 'este jogo'}” do catálogo e apagar a ROM armazenada? Esta ação não pode ser desfeita.`)) return;

      try {
        const { error: deleteError } = await supabaseClient.from('games').delete().eq('id', game.id);
        if (deleteError) throw deleteError;

        let storageError = null;
        if (game.rom_path) {
          const { error } = await supabaseClient.storage.from('games').remove([game.rom_path]);
          storageError = error;
        }
        closeGameDetails?.();
        await loadGamesCatalog();
        await renderGamesCatalog();
        if (storageError) alert(`O jogo foi removido do catálogo, mas não foi possível apagar a ROM do Storage: ${gameImportErrorMessage(storageError)}`);
        else alert('Jogo e ROM removidos com sucesso.');
      } catch (error) {
        console.error('Erro ao remover jogo:', error);
        alert(`Não foi possível remover o jogo: ${gameImportErrorMessage(error)}`);
      }
    }

    let gameMetadataCandidates = [];
    let selectedGameMetadata = null;
    let gameMetadataSearchVersion = 0;
    let gameMetadataSnapshot = {};

    async function searchGameMetadata() {
      const query = document.getElementById('gameAdminTitle')?.value.trim();
      const results = document.getElementById('gameMetadataResults');
      if (!query || !results) return setGameAdminStatus('Informe o título antes de buscar.', true);
      const version=++gameMetadataSearchVersion;
      gameMetadataSnapshot=Object.fromEntries(['Title','Console','Year','Genres','CoverUrl','Synopsis'].map(field=>[field,document.getElementById('gameAdmin'+field).value]));

      results.className = 'mt-3 text-xs text-purple-300';
      results.textContent = 'Buscando dados do jogo...';
      try {
        const { data, error } = await supabaseClient.functions.invoke('game-metadata', { body: { query } });
        if(version!==gameMetadataSearchVersion)return;
        if (error) throw error;
        gameMetadataCandidates = data?.results || [];
        if (!gameMetadataCandidates.length) {
          results.textContent = data?.warnings?.length ? 'Algumas fontes estão indisponíveis. Tente novamente ou preencha os dados manualmente.' : 'Nenhum resultado encontrado. Preencha os dados manualmente.';
          return;
        }
        results.className = 'mt-3 space-y-2';
        results.innerHTML = gameMetadataCandidates.map((game, index) => `<button type="button" onclick="applyGameMetadataCandidate(${index})" class="w-full flex items-center gap-3 text-left p-2 rounded-xl bg-[#120c1f] border border-purple-900/40 hover:border-indigo-500/70">
          ${game.cover_url ? `<img src="${escapeGameHtml(game.cover_url)}" class="w-9 h-12 object-cover rounded bg-purple-950" alt="">` : '<div class="w-9 h-12 rounded bg-purple-950"></div>'}
          <span class="min-w-0"><span class="block text-xs font-bold text-white truncate">${escapeGameHtml(game.title)}</span><span class="block text-[10px] text-purple-400 mt-0.5">${escapeGameHtml(String(game.release_year || 'Ano desconhecido'))} · ${escapeGameHtml(game.console || 'Console não identificado')} · ${escapeGameHtml(game.attribution || game.metadata_source || 'IGDB')}</span></span>
        </button>`).join('');
      } catch (error) {
        if(version!==gameMetadataSearchVersion)return;
        console.error('Erro na busca de metadados:', error);
        results.className = 'mt-3 text-xs text-amber-300';
        const detail = error?.message ? ` Detalhe: ${error.message}` : '';
        results.textContent = `Busca automática indisponível. Tente novamente ou preencha manualmente.${detail}`;
      }
    }

    function applyGameMetadataCandidate(index) {
      const game = gameMetadataCandidates[index];
      if (!game) return;
      selectedGameMetadata = game;
      const synopsis=game.synopsis&&game.metadata_source?.startsWith('wikipedia-')?`${game.synopsis}\n\nFonte: ${game.source_url} · ${game.attribution}`:game.synopsis;
      for(const [field,value] of Object.entries({Title:game.title,Console:game.console,Year:game.release_year,Genres:(game.genres||[]).join(', '),CoverUrl:game.cover_url,Synopsis:synopsis})){
        const input=document.getElementById('gameAdmin'+field);
        if(value&&(!input.value.trim()||(['Title','Console'].includes(field)&&input.value===gameMetadataSnapshot[field])))input.value=value;
      }
      const results = document.getElementById('gameMetadataResults');
      results.className = 'mt-3 text-xs text-emerald-300';
      results.textContent = `Sugestões aplicadas aos campos disponíveis · ${game.attribution||game.metadata_source||'IGDB'}. Campos preenchidos foram preservados; revise a edição e a plataforma.`;
    }

    async function adminImportGame(targetStatus = 'approved') {
      if (!currentUser || currentUser.role !== 'admin') {
        alert('Somente administradores podem importar jogos.');
        return;
      }

      const files = Array.from(document.getElementById('gameAdminRom')?.files || []);
      const file = files[0];
      const title = document.getElementById('gameAdminTitle')?.value.trim();
      const consoleName = document.getElementById('gameAdminConsole')?.value;
      const yearRaw = document.getElementById('gameAdminYear')?.value;
      const genresRaw = document.getElementById('gameAdminGenres')?.value || '';
      const coverUrl = document.getElementById('gameAdminCoverUrl')?.value.trim() || null;
      const synopsis = document.getElementById('gameAdminSynopsis')?.value.trim() || null;
      const published = targetStatus === 'approved';
      const players = Number(document.getElementById('gameAdminPlayers').value);
      const coopValue = document.getElementById('gameAdminCoop').value;
      const coop = coopValue === 'yes' ? true : coopValue === 'no' ? false : null;
      if (!Number.isInteger(players) || players < 1 || players > 8 || (coop === true && players < 2)) {
        setGameAdminStatus('Informe de 1 a 8 jogadores. Cooperação exige pelo menos 2 jogadores.', true);
        return;
      }
      const submit = document.getElementById('gameAdminSubmit');
      const draft = document.getElementById('gameAdminDraft');

      if ((!file && !editingGameId) || (!title && files.length <= 1) || !consoleName) {
        setGameAdminStatus(editingGameId ? 'Informe o título e o console.' : 'Selecione a ROM, informe o título e o console.', true);
        return;
      }

      if (editingGameId) {
        submit.disabled = true;
        draft.disabled = true;
        const continueReview = String(pendingReviewQueue[0]) === String(editingGameId);
        try {
          const { data: existingGames, error: duplicateQueryError } = await supabaseClient.from('games').select('id,title,normalized_title').neq('id', editingGameId);
          if (duplicateQueryError) throw duplicateQueryError;
          if ((existingGames || []).some(game => normalizeGameDuplicateKey(game.normalized_title || game.title) === normalizeGameDuplicateKey(title))) {
            setGameAdminStatus('Já existe um jogo com este título no catálogo.', true);
            return;
          }
          const { error } = await supabaseClient.from('games').update({
            title, normalized_title: normalizeGameDuplicateKey(title), console: consoleName,
            release_year: yearRaw ? Number(yearRaw) : null,
            genres: genresRaw.split(',').map(item => item.trim()).filter(Boolean),
            players, coop,
            synopsis, cover_url: coverUrl, status: published ? 'approved' : 'pending',
            ...(selectedGameMetadata?{metadata_source:selectedGameMetadata.metadata_source||'igdb',metadata_external_id:selectedGameMetadata.external_id||null}:{})
          }).eq('id', editingGameId);
          if (error) throw error;
          if (continueReview) pendingReviewQueue.shift();
          clearGameAdminForm();
          setGameAdminStatus('Dados do jogo atualizados.');
          await loadGamesCatalog();
          renderGamesCatalog();
          if (continueReview) openNextPendingReview();
          else if (published) cancelGameAdminForm();
        } catch (error) {
          setGameAdminStatus(`Não foi possível atualizar: ${error.message || 'erro desconhecido'}`, true);
        } finally { submit.disabled = false; draft.disabled = false; }
        return;
      }

      if (files.length > 1) {
        const allowedExtensions = ['gba', 'gb', 'gbc', 'sfc', 'smc', 'zip', 'md', 'gen', 'bin', 'nes', 'sms', 'n64', 'z64', 'iso', 'cso', 'pbp'];
        submit.disabled = true;
        draft.disabled = true;
        submit.classList.add('opacity-60', 'cursor-wait');
        let completed = 0;
        const skipped = [];
        const failures = [];
        try {
          const { data: existingGames, error: catalogError } = await supabaseClient
            .from('games').select('title, normalized_title, source_file_name, rom_sha256');
          if (catalogError) throw catalogError;
          const titleKeys = new Set((existingGames || []).map(game => normalizeGameDuplicateKey(game.normalized_title || game.title)).filter(Boolean));
          const fileNames = new Set((existingGames || []).map(game => normalizeGameDuplicateKey(game.source_file_name)).filter(Boolean));
          const fileHashes = new Set((existingGames || []).map(game => game.rom_sha256).filter(Boolean));

          for (const item of files) {
            const extension = item.name.split('.').pop()?.toLowerCase() || '';
            const gameTitle = gameTitleFromFile(item);
            const titleKey = normalizeGameDuplicateKey(gameTitle);
            const fileNameKey = normalizeGameDuplicateKey(item.name);
            if (!allowedExtensions.includes(extension)) { skipped.push({ name: item.name, reason: 'formato não suportado' }); continue; }
            if (titleKeys.has(titleKey)) { skipped.push({ name: item.name, reason: 'já existe um jogo com o mesmo nome' }); continue; }
            if (fileNames.has(fileNameKey)) { skipped.push({ name: item.name, reason: 'já existe um arquivo com o mesmo nome' }); continue; }

            let fileHash;
            try {
              fileHash = await getGameFileHash(item);
              if (fileHash && fileHashes.has(fileHash)) { skipped.push({ name: item.name, reason: 'o mesmo arquivo já foi enviado' }); continue; }
            } catch (error) {
              failures.push({ name: item.name, reason: `não foi possível verificar o arquivo: ${gameImportErrorMessage(error)}` });
              continue;
            }

            let objectPath = null;
            try {
              setGameAdminStatus(`Enviando ${completed + skipped.length + failures.length + 1} de ${files.length}: ${item.name}`);
              const cleanName = item.name.replace(/[^a-zA-Z0-9._-]/g, '_');
              objectPath = `roms/${consoleName}/${Date.now()}-${completed}-${cleanName}`;
              const { error: uploadError } = await supabaseClient.storage.from('games').upload(objectPath, item, { contentType: item.type || 'application/octet-stream', upsert: false });
              if (uploadError) throw uploadError;
              const { error: insertError } = await supabaseClient.from('games').insert([{
                title: gameTitle, normalized_title: normalizeGameDuplicateKey(gameTitle), console: consoleName, players: 1, genres: [],
                rom_path: objectPath, rom_url: gameStorageUrl(objectPath), rom_sha256: fileHash,
                source_file_name: item.name, status: published ? 'approved' : 'pending', metadata_source: null, metadata_external_id: null
              }]);
              if (insertError) throw insertError;
              completed++;
              titleKeys.add(titleKey); fileNames.add(fileNameKey); if (fileHash) fileHashes.add(fileHash);
            } catch (error) {
              let reason = gameImportErrorMessage(error);
              if (objectPath) {
                const { error: removeError } = await supabaseClient.storage.from('games').remove([objectPath]);
                if (removeError) reason += ` (também não foi possível remover o arquivo enviado: ${gameImportErrorMessage(removeError)})`;
              }
              failures.push({ name: item.name, reason });
            }
          }
          if (completed) clearGameAdminForm();
          setGameBatchSummary(completed, skipped, failures);
          await loadGamesCatalog(); renderGamesCatalog();
          if (published && completed > 0 && !failures.length && !skipped.length) cancelGameAdminForm();
        } catch (error) { setGameAdminStatus(`Não foi possível preparar o lote: ${gameImportErrorMessage(error)}`, true); }
        finally { submit.disabled = false; draft.disabled = false; submit.classList.remove('opacity-60', 'cursor-wait'); }
        return;
      }

      const extension = file.name.split('.').pop()?.toLowerCase();
      const allowedExtensions = ['gba', 'gb', 'gbc', 'sfc', 'smc', 'zip', 'md', 'gen', 'bin', 'nes', 'n64', 'z64'];
      if (!extension || !allowedExtensions.includes(extension)) {
        setGameAdminStatus('Formato não suportado para esta primeira versão.', true);
        return;
      }

      const cleanName = file.name.replace(/[^a-zA-Z0-9._-]/g, '_');
      const objectPath = `roms/${consoleName}/${Date.now()}-${cleanName}`;
      submit.disabled = true;
      draft.disabled = true;
      submit.classList.add('opacity-60', 'cursor-wait');
      setGameAdminStatus('Enviando ROM para o Storage...');

      try {
        let fileHash = null;
        try { fileHash = await getGameFileHash(file); } catch (error) { console.warn('Não foi possível calcular a assinatura da ROM:', error); }
        const { data: existingGames, error: catalogError } = await supabaseClient
          .from('games').select('title, normalized_title, source_file_name, rom_sha256');
        if (catalogError) throw catalogError;
        const sameTitle = (existingGames || []).some(game => normalizeGameDuplicateKey(game.normalized_title || game.title) === normalizeGameDuplicateKey(title));
        const sameFileName = (existingGames || []).some(game => normalizeGameDuplicateKey(game.source_file_name) === normalizeGameDuplicateKey(file.name));
        const sameFile = fileHash && (existingGames || []).some(game => game.rom_sha256 === fileHash);
        if (sameTitle || sameFileName || sameFile) {
          const reason = sameFile ? 'o mesmo arquivo já foi enviado' : (sameTitle ? 'já existe um jogo com o mesmo nome' : 'já existe um arquivo com o mesmo nome');
          setGameAdminStatus(`Jogo ignorado: ${reason}.`);
          return;
        }

        const { error: uploadError } = await supabaseClient.storage.from('games').upload(objectPath, file, {
          contentType: file.type || 'application/octet-stream', upsert: false
        });
        if (uploadError) throw uploadError;

        setGameAdminStatus('Salvando dados do jogo...');
        const { error: insertError } = await supabaseClient.from('games').insert([{
          title,
          normalized_title: normalizeGameDuplicateKey(title),
          players, coop,
          console: consoleName,
          release_year: yearRaw ? Number(yearRaw) : null,
          genres: genresRaw.split(',').map(item => item.trim()).filter(Boolean),
          synopsis,
          cover_url: coverUrl,
          rom_path: objectPath,
          rom_url: gameStorageUrl(objectPath),
          rom_sha256: fileHash,
          source_file_name: file.name,
          status: published ? 'approved' : 'pending',
          metadata_source: selectedGameMetadata ? (selectedGameMetadata.metadata_source || 'igdb') : null,
          metadata_external_id: selectedGameMetadata?.external_id || null
        }]);
        if (insertError) throw insertError;

        clearGameAdminForm();
        selectedGameMetadata = null;
        setGameAdminStatus(published ? 'Jogo publicado no catálogo.' : 'ROM enviada. O jogo ficou pendente para revisão.');
        await loadGamesCatalog();
        renderGamesCatalog();
        if (published) cancelGameAdminForm();
      } catch (error) {
        console.error('Erro ao importar jogo:', error);
        setGameAdminStatus(`Não foi possível importar: ${error.message || 'erro desconhecido'}`, true);
      } finally {
        submit.disabled = false;
        draft.disabled = false;
        submit.classList.remove('opacity-60', 'cursor-wait');
      }
    }

    async function loadGamesCatalog() {
      let query = supabaseClient.from('games').select('*').order('title', { ascending: true });
      if (!currentUser || currentUser.role !== 'admin') query = query.eq('status', 'approved');
      const { data, error } = await query;
      if (error) throw error;
      gamesCatalog = (data || []).filter(profileAllowsMedia);
      return gamesCatalog;
    }

    function openGameEmulatorById(id) {
      const game = gamesCatalog.find(item => String(item.id) === String(id));
      if (!game) return;
      const url = game.rom_url || gameStorageUrl(game.rom_path);
      if (!url) return alert('Este jogo ainda não possui uma URL de ROM válida.');
      const genres = Array.isArray(game.genres) ? game.genres.join(', ') : (game.genres || game.genre || '');
      openGameDetails({
        id: game.id,
        name: game.title,
        players: game.players,
        coop: game.coop,
        console: game.console,
        consoleLabel: String(game.console || 'Console').replace('mastersystem', 'Master System').replace('megadrive', 'Mega Drive').replace('psp', 'PSP').toUpperCase(),
        url,
        logo: game.cover_url || gameStorageUrl(game.cover_path),
        synopsis: game.synopsis || game.sinopse,
        releaseYear: game.release_year || game['release date'],
        genres
      });
    }

    async function loadFromXtreamApi(server, user, pass) {
      const cleanServer = server.replace(/\/+$/, '');
      const baseApi = `${cleanServer}/player_api.php?username=${encodeURIComponent(user)}&password=${encodeURIComponent(pass)}`;

      document.getElementById('splashStatusMessage').innerText = 'Baixando categorias e canais...';

      try {
        const [liveCatsRes, vodCatsRes, seriesCatsRes] = await Promise.all([
          smartFetch(`${baseApi}&action=get_live_categories`).then(r => r.json()).catch(() => []),
          smartFetch(`${baseApi}&action=get_vod_categories`).then(r => r.json()).catch(() => []),
          smartFetch(`${baseApi}&action=get_series_categories`).then(r => r.json()).catch(() => [])
        ]);

        const liveCatMap = Object.fromEntries(liveCatsRes.map(c => [c.category_id, c.category_name]));
        const vodCatMap = Object.fromEntries(vodCatsRes.map(c => [c.category_id, c.category_name]));
        const seriesCatMap = Object.fromEntries(seriesCatsRes.map(c => [c.category_id, c.category_name]));

        document.getElementById('splashStatusMessage').innerText = 'Sincronizando filmes e séries...';

        const [liveStreams, vodStreams, seriesStreams] = await Promise.all([
          smartFetch(`${baseApi}&action=get_live_streams`).then(r => r.json()).catch(() => []),
          smartFetch(`${baseApi}&action=get_vod_streams`).then(r => r.json()).catch(() => []),
          smartFetch(`${baseApi}&action=get_series`).then(r => r.json()).catch(() => [])
        ]);

        const parsedItems = [];

        liveStreams.forEach(item => {
          const groupName = liveCatMap[item.category_id] || 'Canais';
          parsedItems.push({
            id: parsedItems.length,
            stream_id: item.stream_id,
            name: item.name,
            group: groupName,
            logo: item.stream_icon || '',
            url: `${cleanServer}/live/${user}/${pass}/${item.stream_id}.m3u8`,
            type: 'live',
            isAdult: isAdultContent(groupName, item.name) || item.adult === true || String(item.is_adult || '') === '1'
          });
        });

        vodStreams.forEach(item => {
          const groupName = vodCatMap[item.category_id] || 'Filmes';
          const ext = item.container_extension || 'mp4';
          parsedItems.push({
            id: parsedItems.length,
            stream_id: item.stream_id,
            name: item.name,
            group: groupName,
            logo: item.stream_icon || '',
            url: `${cleanServer}/movie/${user}/${pass}/${item.stream_id}.${ext}`,
            type: 'movies',
            isAdult: isAdultContent(groupName, item.name) || item.adult === true || String(item.is_adult || '') === '1'
          });
        });

        seriesStreams.forEach(item => {
          const groupName = seriesCatMap[item.category_id] || 'Séries';
          parsedItems.push({
            id: parsedItems.length,
            series_id: item.series_id,
            name: item.name,
            group: groupName,
            logo: item.cover || '',
            type: 'series',
            isAdult: isAdultContent(groupName, item.name) || item.adult === true || String(item.is_adult || '') === '1'
          });
        });

        parsedItems.sort((a, b) => {
          if (Boolean(a.isAdult) === Boolean(b.isAdult)) return 0;
          return a.isAdult ? 1 : -1;
        });

        allMediaItems = parsedItems.filter(profileAllowsMedia);
        mergeSharedVodsIntoPlayer();
      } catch (err) {
        const fallbackM3u = `${cleanServer}/get.php?username=${encodeURIComponent(user)}&password=${encodeURIComponent(pass)}&type=m3u_plus&output=m3u8`;
        await loadPlaylist(fallbackM3u);
      }
    }

    async function loadPlaylist(url) {
      try {
        const res = await smartFetch(url);
        const text = await res.text();
        const parsed = parseM3U(text);

        parsed.sort((a, b) => {
          if (Boolean(a.isAdult) === Boolean(b.isAdult)) return 0;
          return a.isAdult ? 1 : -1;
        });

        allMediaItems = parsed.filter(profileAllowsMedia);
        mergeSharedVodsIntoPlayer();
      } catch (err) {
        alert('Erro ao carregar lista M3U.');
      }
    }

    function parseM3U(data) {
      if (!data) return [];
      const lines = data.split(/\r?\n/);
      const items = [];
      let temp = null;

      for (let i = 0; i < lines.length; i++) {
        const line = lines[i].trim();
        if (!line) continue;

        if (line.startsWith('#EXTINF:')) {
          temp = {};
          const groupMatch = line.match(/group-title="([^"]*)"/i);
          const logoMatch = line.match(/tvg-logo="([^"]*)"/i);
          const commaIdx = line.lastIndexOf(',');

          temp.group = groupMatch && groupMatch[1] ? groupMatch[1].trim() : 'Geral';
          temp.logo = logoMatch && logoMatch[1] ? logoMatch[1].trim() : '';
          temp.name = commaIdx !== -1 ? line.substring(commaIdx + 1).trim() : 'Sem título';
        } else if (!line.startsWith('#') && temp) {
          temp.url = line;
          temp.id = items.length;
          temp.type = detectMediaType(temp.group, temp.name, temp.url);
          temp.isAdult = isAdultContent(temp.group, temp.name);
          items.push(temp);
          temp = null;
        }
      }
      return items;
    }

    function detectMediaType(group, name, url) {
      const g = (group || '').toLowerCase();
      const n = (name || '').toLowerCase();
      const u = (url || '').toLowerCase();

      if (g.includes('24h') || g.includes('canais') || g.includes('abertos') || (g.includes('tv') && !g.includes('filmes') && !g.includes('series'))) {
        return 'live';
      }
      if (g.includes('serie') || g.includes('séries') || g.includes('temporada') || u.includes('/series/')) {
        return 'series';
      }
      if (g.includes('filme') || g.includes('movie') || g.includes('vod') || g.includes('cinema') || u.endsWith('.mp4') || u.endsWith('.mkv') || u.includes('/movie/')) {
        return 'movies';
      }
      return 'live';
    }

    function updateNavIndicator() {
      const activeBtn = document.getElementById('nav' + currentSection.charAt(0).toUpperCase() + currentSection.slice(1));
      const slider = document.getElementById('navSlider');
      if (activeBtn && slider) {
        slider.style.left = `${activeBtn.offsetLeft}px`;
        slider.style.width = `${activeBtn.offsetWidth}px`;
      }
    }

    window.addEventListener('resize', () => {
      updateNavIndicator();
      updateLayoutForScreen();
    });

    function setSection(section) {
      if (currentSection !== section) animateDashboardEntry();
      currentSection = section;
      
      // Zera a pesquisa APENAS se o usuário clicar em "Início" (home)
      if (section === 'home') {
        activeSearchQuery = '';
        const sidebar = document.getElementById('desktopSidebar');
        if (sidebar && window.innerWidth >= 1024) {
          sidebar.style.display = '';
        }
      }

      const sidebar = document.getElementById('desktopSidebar');
      const openTab = document.getElementById('sidebarOpenTab');
      const homeSec = document.getElementById('homeSection');
      const gamesSec = document.getElementById('gamesSection');
      const readingSec = document.getElementById('readingSection');
      const mobCatSec = document.getElementById('mobileCategoriesSection');
      const liveChanSec = document.getElementById('liveChannelsSection');
      const livePlySec = document.getElementById('livePlayerSection');
      const vodSec = document.getElementById('vodGridSection');

      if (homeSec) homeSec.classList.add('hidden');
      if (gamesSec) gamesSec.classList.add('hidden');
      if (readingSec) readingSec.classList.add('hidden');
      if (mobCatSec) mobCatSec.classList.add('hidden');
      if (liveChanSec) liveChanSec.classList.add('hidden');
      if (livePlySec) livePlySec.classList.add('hidden');
      if (vodSec) vodSec.classList.add('hidden');
      
      if (sidebar) {
        sidebar.style.display = 'none';
      }
      if (openTab) openTab.classList.add('hidden');

      const isMobile = window.innerWidth < 1024;

      if (section === 'home') {
        if (homeSec) homeSec.classList.remove('hidden');
        renderHomeDashboard();
      } else if (section === 'games') {
        if (gamesSec) gamesSec.classList.remove('hidden');
        if (typeof renderGamesCatalog === 'function') renderGamesCatalog();
      } else if (section === 'reading') {
        if (readingSec) readingSec.classList.remove('hidden');
        window.LuxReader?.refresh();
      } else {
        if (sidebar && !activeSearchQuery) {
          sidebar.style.display = '';
        }

        if (sidebar && !isMobile && !activeSearchQuery) {
          sidebar.classList.remove('hidden');
          sidebar.classList.add('lg:flex');
        } else if (sidebar) {
          sidebar.classList.add('hidden');
          sidebar.classList.remove('lg:flex');
        }

        if (section === 'live') {
          if (isMobile) {
            if (mobileStep === 'categories') {
              if (mobCatSec) mobCatSec.classList.remove('hidden');
            } else {
              if (liveChanSec) liveChanSec.classList.remove('hidden');
            }
          } else {
            if (liveChanSec) liveChanSec.classList.remove('hidden');
            if (livePlySec) livePlySec.classList.remove('hidden');
          }
          activeCategory = 'Todos'; 
        } else {
          if (isMobile && mobileStep === 'categories') {
            if (mobCatSec) mobCatSec.classList.remove('hidden');
          } else {
            if (vodSec) vodSec.classList.remove('hidden');
          }
          activeCategory = 'Todos';
        }

        visibleCount = ITEMS_PER_PAGE;
        isSortModeActive = false;
        updateSortButtonUI();

        const liveVideo = document.getElementById('videoPlayerLive');
        if (liveVideo) liveVideo.pause();

        renderCategories();
        filterMedia();
      }

      ['home', 'live', 'movies', 'series', 'games', 'reading'].forEach(sec => {
        const btn = document.getElementById('nav' + sec.charAt(0).toUpperCase() + sec.slice(1));
        if (btn) {
          btn.className = sec === section
            ? "relative z-10 flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-bold transition-colors text-white"
            : "relative z-10 flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-bold transition-colors text-purple-300 hover:text-white";
        }
      });
      
      ['home', 'live', 'movies', 'series', 'games', 'reading'].forEach(sec => {
        const bBtn = document.getElementById('bNav' + sec.charAt(0).toUpperCase() + sec.slice(1));
        if (bBtn) {
          const iconDiv = bBtn.querySelector('div');
          if (sec === section) {
            bBtn.className = "flex flex-col items-center justify-center gap-0.5 flex-1 py-1 text-purple-300 transition-all";
            iconDiv.className = "p-1 rounded-xl bg-purple-600 text-white shadow-md shadow-purple-900/60";
          } else {
            bBtn.className = "flex flex-col items-center justify-center gap-0.5 flex-1 py-1 text-purple-400/60 hover:text-purple-300 transition-all";
            iconDiv.className = "p-1 rounded-xl text-purple-400/60 bg-transparent shadow-none";
          }
        }
      });

      updateNavIndicator();
      lucide.createIcons();
    }

    function updateLayoutForScreen() {
      if (currentSection === 'home' || currentSection === 'games' || currentSection === 'reading') return; 
      
      const isMobile = window.innerWidth < 1024;
      const sidebar = document.getElementById('desktopSidebar');
      const mobCatSec = document.getElementById('mobileCategoriesSection');
      const liveChannelsSec = document.getElementById('liveChannelsSection');
      const livePlayerSec = document.getElementById('livePlayerSection');
      const vodGridSec = document.getElementById('vodGridSection');

      if (sidebar) sidebar.style.display = '';

      if (isMobile) {
        if (sidebar) { sidebar.classList.add('hidden'); sidebar.classList.remove('lg:flex'); }
        if (mobileStep === 'categories') {
          mobCatSec.classList.remove('hidden');
          liveChannelsSec.classList.add('hidden');
          livePlayerSec.classList.add('hidden');
          vodGridSec.classList.add('hidden');
        } else {
          mobCatSec.classList.add('hidden');
          if (currentSection === 'live') {
            liveChannelsSec.classList.remove('hidden');
            livePlayerSec.classList.add('hidden');
            vodGridSec.classList.add('hidden');
          } else {
            liveChannelsSec.classList.add('hidden');
            livePlayerSec.classList.add('hidden');
            vodGridSec.classList.remove('hidden');
          }
        }
      } else {
        mobCatSec.classList.add('hidden');
        if (sidebar && currentSection !== 'home' && currentSection !== 'games' && currentSection !== 'reading') {
            sidebar.classList.remove('hidden'); 
            sidebar.classList.add('lg:flex'); 
        }

        if (currentSection === 'live') {
          liveChannelsSec.classList.remove('hidden');
          livePlayerSec.classList.remove('hidden');
          vodGridSec.classList.add('hidden');
        } else {
          liveChannelsSec.classList.add('hidden');
          livePlayerSec.classList.add('hidden');
          vodGridSec.classList.remove('hidden');
        }
      }

      filterMedia();
      lucide.createIcons();
    }

    async function renderHomeDashboard() {
      loadTmdbHeroBanner();
      renderHomeResume();
      renderHomeJogos();
      renderHomeLancamentos2026();
    }

    let heroCarouselInterval = null;

    async function loadTmdbHeroBanner() {
      const bannerUser=currentUser;
      const titleEl = document.getElementById('heroTitle');
      const overviewEl = document.getElementById('heroOverview');
      const bgEl = document.getElementById('heroBgImage');
      const playBtn = document.getElementById('heroPlayBtn');
      const contentWrap = document.getElementById('heroContentWrap');
      const posterEl = document.getElementById('heroPosterImage');

      try {
        const res = await fetch('https://api.themoviedb.org/3/trending/all/week?api_key=3fd2be6f0c70a2a598f084ddfb75487c&language=pt-BR');
        const data = await res.json();
        if(currentUser!==bannerUser)return;
        const tmdbResults = (data.results || []).filter(profileAllowsMedia);

        const normalizeTitle = (str) => {
          if (!str) return '';
          return str.toLowerCase()
            .normalize("NFD").replace(/[\u0300-\u036f]/g, "") 
            .replace(/\(.*?\)/g, '') 
            .replace(/\[.*?\]/g, '') 
            .replace(/\b(dublado|legendado|dual|4k|fhd|uhd|hd|sd|h265|hevc|pt-br)\b/g, '') 
            .replace(/[^a-z0-9]/g, ' ') 
            .replace(/\s+/g, ' ') 
            .trim();
        };

        const matchedTrends = [];

        for (const tmdb of tmdbResults) {
          const tmdbTitle = normalizeTitle(tmdb.title || tmdb.name);
          if (!tmdbTitle) continue;

          const candidates = allMediaItems
            .filter(item => item.type !== 'live')
            .map(item => {
              const localTitle = normalizeTitle(item.name);
              let score = 0;

              if (localTitle === tmdbTitle) {
                score = 100;
              } else if (localTitle.startsWith(tmdbTitle + ' ')) {
                score = 80;
              }

              return { item, score };
            })
            .filter(result => result.score > 0)
            .sort((a, b) => b.score - a.score);

          const found = candidates.length > 0 ? candidates[0].item : null;

          if (found) {
            if (!matchedTrends.find(m => m.id === found.id)) {
              matchedTrends.push({ ...found, tmdb });
            }
          }
          if (matchedTrends.length >= 5) break; 
        }

        if (matchedTrends.length > 0) {
          let currentIndex = 0;

          const updateBanner = () => {
            const currentItem = matchedTrends[currentIndex];
            
            bgEl.style.opacity = '0';
            contentWrap.style.opacity = '0';
            
            setTimeout(() => {
              if(currentUser!==bannerUser || !profileAllowsMedia(currentItem))return;
              titleEl.innerText = currentItem.tmdb.title || currentItem.tmdb.name || currentItem.name;
              overviewEl.innerText = currentItem.tmdb.overview || 'Aproveite este destaque no seu catálogo.';
              
              if (currentItem.tmdb.backdrop_path) {
                bgEl.style.backgroundImage = `url('https://image.tmdb.org/t/p/original${currentItem.tmdb.backdrop_path}')`;
              } else if (currentItem.logo) {
                bgEl.style.backgroundImage = `url('${currentItem.logo}')`;
              }

              if (currentItem.tmdb.poster_path) {
                posterEl.src = `https://image.tmdb.org/t/p/w500${currentItem.tmdb.poster_path}`;
                posterEl.classList.remove('hidden');
              } else if (currentItem.logo) {
                posterEl.src = currentItem.logo;
                posterEl.classList.remove('hidden');
              } else {
                posterEl.classList.add('hidden');
              }
              
              bgEl.style.opacity = '0.25'; 
              contentWrap.style.opacity = '1';
              
              playBtn.classList.remove('hidden');
              playBtn.onclick = () => openVodPlayer(currentItem);

              currentIndex = (currentIndex + 1) % matchedTrends.length;
            }, 500); 
          };

          updateBanner(); 

          if (heroCarouselInterval) clearInterval(heroCarouselInterval);
          heroCarouselInterval = setInterval(updateBanner, 7000);

        } else {
          fallbackBanner();
        }
      } catch (e) {
        fallbackBanner();
      }

      function fallbackBanner() {
        const movies = allMediaItems.filter(i => i.type === 'movies');
        if (movies.length > 0) {
          const fallbackMovie = movies[Math.floor(Math.random() * Math.min(movies.length, 10))];
          titleEl.innerText = fallbackMovie.name;
          overviewEl.innerText = 'Destaque disponível em sua lista.';
          if(fallbackMovie.logo) {
             bgEl.style.backgroundImage = `url('${fallbackMovie.logo}')`;
             posterEl.src = fallbackMovie.logo;
             posterEl.classList.remove('hidden');
          }
          bgEl.style.opacity = '0.25';
          contentWrap.style.opacity = '1';
          playBtn.classList.remove('hidden');
          playBtn.onclick = () => openVodPlayer(fallbackMovie);
        }
      }
    }
    
    function renderHomeResume() {
      const container = document.getElementById('homeResumeContainer');
      if (!container) return;
      container.innerHTML = '';

      const resumeEntries = getResumeEntries();

      if (resumeEntries.length === 0) {
        container.innerHTML = '<p class="text-xs text-purple-400/60">Nenhuma mídia em andamento no momento.</p>';
        return;
      }

      resumeEntries.forEach(({ item, progress }) => {
        const card = document.createElement('div');
        card.className = "min-w-[140px] w-[140px] bg-[#120c1f] rounded-2xl border border-purple-950 overflow-hidden cursor-pointer group shrink-0 transition-all hover:-translate-y-1 shadow-lg";
        card.onclick = () => item.type === 'series' && item.seriesResumeState
          ? resumeSeriesFromState(item, item.seriesResumeState)
          : openVodPlayer(item);

        const iconName = item.type === 'series' ? 'clapperboard' : 'film';
        const safeName = item.type === 'series' && item.seriesResumeState
          ? `${item.name || 'Série'} • T${item.seriesResumeState.seasonNum}E${item.seriesResumeState.episodeNum}`
          : String(item.name || 'Sem título');
        const progressPercent = item.duration && Number(item.duration) > 0
          ? Math.min(100, Math.max(0, (Number(progress) / Number(item.duration)) * 100))
          : 0;

        const mediaHtml = item.logo
          ? `<img src="${item.logo}" class="w-full h-full object-cover group-hover:scale-105 transition-transform" onerror="this.outerHTML='<i data-lucide=\'${iconName}\' class=\'w-8 h-8 text-purple-700\'></i>'"/>`
          : `<i data-lucide="${iconName}" class="w-8 h-8 text-purple-700"></i>`;

        card.innerHTML = `
          <div class="w-full aspect-[2/3] bg-purple-950/40 relative overflow-hidden flex items-center justify-center">
            ${mediaHtml}
            ${progressPercent > 0 ? `<div class="absolute bottom-0 left-0 right-0 h-1 bg-black/60"><div class="h-full bg-purple-500" style="width:${progressPercent}%"></div></div>` : ''}
            <button type="button" class="resume-remove-btn absolute top-2 right-2 w-7 h-7 rounded-full bg-black/70 hover:bg-rose-600 text-white flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity z-10" title="Remover do Continuar Assistindo">
              <i data-lucide="trash-2" class="w-3.5 h-3.5"></i>
            </button>
          </div>
          <div class="p-2.5">
            <h5 class="text-xs font-bold text-white truncate group-hover:text-purple-300">${safeName}</h5>
          </div>
        `;

        const removeBtn = card.querySelector('.resume-remove-btn');
        if (removeBtn) {
          removeBtn.onclick = (event) => {
            event.preventDefault();
            event.stopPropagation();
            if (item.type === 'series' && item.seriesResumeState) {
              removeSeriesResumeState(item.series_id);
            } else {
              removeResumeData(item);
            }
            renderHomeResume();
            renderCategories();
            filterMedia();
          };
        }

        container.appendChild(card);
      });

      lucide.createIcons();
    }

    function renderHomeJogos() {
      const container = document.getElementById('homeJogosContainer');
      container.innerHTML = '';
      
      const jogosItems = allMediaItems.filter(i => 
        i.type === 'live' && 
        (i.group.toLowerCase().includes('guia de jogos') || i.group.toLowerCase().includes('jogos do dia'))
      );

      if (jogosItems.length === 0) {
        container.innerHTML = '<p class="text-xs text-purple-400/60">Nenhum evento esportivo no momento.</p>';
        return;
      }

      jogosItems.slice(0, 15).forEach(item => {
        const card = document.createElement('div');
        card.className = "min-w-[220px] w-[220px] bg-[#120c1f] border border-emerald-900/40 hover:border-emerald-500/60 rounded-2xl p-3 cursor-pointer group shrink-0 transition-all shadow-lg flex items-center gap-3";
        card.onclick = () => playLiveChannel(item);
        
        const iconHtml = item.logo 
            ? `<img src="${item.logo}" class="w-full h-full object-contain rounded-lg" onerror="this.outerHTML='<i data-lucide=\\'trophy\\' class=\\'w-5 h-5 text-emerald-400\\'></i>'"/>` 
            : `<i data-lucide="trophy" class="w-5 h-5 text-emerald-400"></i>`;

        card.innerHTML = `
          <div class="w-10 h-10 rounded-xl bg-emerald-950/60 border border-emerald-800/40 flex items-center justify-center shrink-0 p-1">
            ${iconHtml}
          </div>
          <div class="min-w-0">
            <h5 class="text-xs font-bold text-white truncate group-hover:text-emerald-300" title="${item.name}">${item.name}</h5>
            <span class="text-[10px] text-emerald-400/70 uppercase font-mono">Ao Vivo</span>
          </div>
        `;
        container.appendChild(card);
      });
      lucide.createIcons();
    }

    function renderHomeLancamentos2026() {
      const container = document.getElementById('homeLancamentosContainer');
      container.innerHTML = '';
      const lancamentos = allMediaItems.filter(i => i.type === 'movies' && (i.group.toLowerCase().includes('lançamentos 2026') || i.group.toLowerCase().includes('2026')));

      if (lancamentos.length === 0) {
        container.innerHTML = '<p class="text-xs text-purple-400/60">Nenhum lançamento de 2026 encontrado na lista.</p>';
        return;
      }

      lancamentos.slice(0, 15).forEach(item => {
        const card = document.createElement('div');
        card.className = "min-w-[130px] w-[130px] md:min-w-[150px] md:w-[150px] bg-[#120c1f] rounded-2xl border border-purple-950 overflow-hidden cursor-pointer group shrink-0 transition-all hover:-translate-y-1.5 shadow-lg";
        card.onclick = () => openMovieModal(item);
        card.innerHTML = `
          <div class="w-full aspect-[2/3] bg-purple-950/40 relative overflow-hidden flex items-center justify-center">
            ${item.logo ? `<img src="${item.logo}" class="w-full h-full object-cover group-hover:scale-105 transition-transform" onerror="this.outerHTML='<i data-lucide=\\'film\\' class=\\'w-8 h-8 text-purple-700\\'></i>'"/>` : `<i data-lucide="film" class="w-8 h-8 text-purple-700"></i>`}
          </div>
          <div class="p-2.5">
            <h5 class="text-xs font-bold text-white truncate group-hover:text-purple-300">${item.name}</h5>
          </div>
        `;
        container.appendChild(card);
      });
      lucide.createIcons();
    }

    function backToMobileCategories() {
      mobileStep = 'categories';
      updateLayoutForScreen();
    }

    function selectMobileCategory(cat) {
      const isAdultCat = isAdultContent(cat);
      const proceed = () => {
        activeCategory = cat;
        mobileStep = 'items';
        visibleCount = ITEMS_PER_PAGE;
        updateLayoutForScreen();
      };

      if (isAdultCat && !isAdultUnlocked) {
        requireAdultPin(proceed);
      } else {
        proceed();
      }
    }

    function getSectionItems() {
      return allMediaItems.filter(item => item.type === currentSection && profileAllowsMedia(item));
    }

    function getStoredCategoryOrder() {
      try {
        const saved = userProgressStorage.getItem('lux_cat_order_v3_' + currentSection);
        return saved ? JSON.parse(saved) : [];
      } catch (e) {
        return [];
      }
    }

    function saveCategoryOrder(orderArray) {
      userProgressStorage.setItem('lux_cat_order_v3_' + currentSection, JSON.stringify(orderArray));
      markCloudRecord('preference:category-order:' + currentSection, {order:orderArray});
    }

    function toggleSortMode() {
      isSortModeActive = !isSortModeActive;
      updateSortButtonUI();
      renderCategories();
    }

    function updateSortButtonUI() {
      const btn = document.getElementById('sortModeBtn');
      if (!btn) return;

      if (isSortModeActive) {
        btn.className = "text-[10px] bg-amber-600 hover:bg-amber-500 text-white p-1.5 rounded-md transition-all flex items-center justify-center shadow-md";
        btn.title = "Concluir Organização";
      } else {
        btn.className = "text-[10px] bg-purple-950 hover:bg-purple-900 text-purple-300 p-1.5 rounded-md transition-all flex items-center justify-center";
        btn.title = "Organizar Gêneros";
      }
    }

    function getCategoryTier(cat) {
      if (isAdultContent(cat)) return 5;
      const lower = cat.toLowerCase();

      if (currentSection === 'movies' || currentSection === 'series') {
        if (lower.includes('lançament') || lower.includes('lancament') || lower.includes('novidade')) {
          return 1;
        }
        const yearMatch = cat.match(/\b(20[2-9][0-9])\b/);
        if (yearMatch) {
          return 2;
        }
        if (lower.startsWith('filme') || lower.startsWith('série') || lower.startsWith('serie') || lower.includes('filme') || lower.includes('movie') || lower.includes('cinema')) return 3;
        if (lower.includes('colet') || lower.includes('saga') || lower.includes('franquia')) return 4;
        return 5;
      }

      const hasArrow = cat.includes('»') || cat.includes('⫸') || cat.includes('➤') || cat.includes('➜') || cat.includes('->');

      if (hasArrow) {
        if (lower.includes('24h') || lower.includes('24 horas')) {
          return 1.3;
        }
        if (lower.includes('ppv')) {
          return 1.2;
        }
        return 1;
      }

      if (cat.includes('|') && lower.includes('canais')) return 2;

      const isForeign = lower.includes('usa') || lower.includes('latino') || lower.includes('mexico') || 
        lower.includes('argentina') || lower.includes('colombia') || lower.includes('equador') || 
        lower.includes('paraguay') || lower.includes('uruguay') || lower.includes('chile') || 
        lower.includes('internacio') || lower.includes('portugal') || lower.includes('espanha') ||
        lower.includes('espana') || lower.includes('uk') || lower.includes('italia') || lower.includes('france');

      if (isForeign) return 3;
      if (lower.includes('ppv')) return 3;

      if (lower.includes('24h') || lower.includes('24 hrs') || lower.includes('24 horas')) return 4;
      if (lower.includes('rádios') || lower.includes('radios') || lower === 'canais') return 5;
      
      return 3;
    }

    function sortCategoriesSmart(a, b) {
      const tierA = getCategoryTier(a);
      const tierB = getCategoryTier(b);
      if (tierA !== tierB) return tierA - tierB;

      const yearA = a.match(/\b(20[2-9][0-9])\b/);
      const yearB = b.match(/\b(20[2-9][0-9])\b/);
      if (yearA && yearB) {
        return parseInt(yearB[1], 10) - parseInt(yearA[1], 10);
      }

      return a.localeCompare(b, 'pt-BR', { numeric: true, sensitivity: 'base' });
    }

    function moveCategory(catName, direction) {
      const items = getSectionItems();
      const rawCats = [...new Set(items.map(c => c.group))];
      const hasCliente = rawCats.find(c => c.toLowerCase().includes('área do cliente') || c.toLowerCase().includes('area do cliente'));
      const hasGuiaJogos = rawCats.find(c => c.toLowerCase().includes('guia de jogos'));

      const allBaseCats = rawCats.filter(c => c !== hasCliente && c !== hasGuiaJogos);
      let currentOrder = getStoredCategoryOrder();
      let orderedCats = [];

      if (currentOrder && currentOrder.length > 0) {
        currentOrder.forEach(c => {
          if (allBaseCats.includes(c)) orderedCats.push(c);
        });
        const remaining = allBaseCats.filter(c => !orderedCats.includes(c));
        remaining.sort(sortCategoriesSmart);
        orderedCats.push(...remaining);
      } else {
        orderedCats = [...allBaseCats];
        orderedCats.sort(sortCategoriesSmart);
      }

      const index = orderedCats.indexOf(catName);
      if (index === -1) return;

      const targetIndex = index + direction;
      if (targetIndex < 0 || targetIndex >= orderedCats.length) return;

      const temp = orderedCats[index];
      orderedCats[index] = orderedCats[targetIndex];
      orderedCats[targetIndex] = temp;

      saveCategoryOrder(orderedCats);
      renderCategories();
    }

    function renderCategories() {
      const items = getSectionItems();
      const rawCats = [...new Set(items.map(c => c.group))];

      const hasCliente = rawCats.find(c => c.toLowerCase().includes('área do cliente') || c.toLowerCase().includes('area do cliente'));
      const hasGuiaJogos = rawCats.find(c => c.toLowerCase().includes('guia de jogos'));

      const allBaseCats = rawCats.filter(c => c !== hasCliente && c !== hasGuiaJogos);

      let savedOrder = getStoredCategoryOrder();
      let sortedCats = [];

      if (savedOrder && savedOrder.length > 0) {
        savedOrder.forEach(cat => {
          if (allBaseCats.includes(cat)) sortedCats.push(cat);
        });
        const remaining = allBaseCats.filter(c => !sortedCats.includes(c));
        remaining.sort(sortCategoriesSmart);
        sortedCats.push(...remaining);
      } else {
        sortedCats = [...allBaseCats];
        sortedCats.sort(sortCategoriesSmart);
      }

      const cats = ['Todos', 'Continuar Assistindo', 'Minha Lista'];
      if (hasCliente) cats.push(hasCliente);
      if (hasGuiaJogos) cats.push(hasGuiaJogos);
      cats.push(...sortedCats);

      const resumeCount = items.filter(c => {
        return hasResumeEntry(c);
      }).length;

      const favCount = items.filter(c => isFavorite(c)).length;

      document.getElementById('mediaCountBadge').innerText = `${items.length} itens`;
      document.getElementById('mobileMediaCountBadge').innerText = `${items.length} itens`;

      const sectionTitle = currentSection === 'live' ? 'Canais de TV' : (currentSection === 'movies' ? 'Filmes' : 'Séries');
      document.getElementById('mobileCatSubtitle').innerText = `Escolha um gênero de ${sectionTitle}`;

      const desktopContainer = document.getElementById('categoriesList');
      desktopContainer.innerHTML = '';

      cats.forEach(cat => {
        const isAdultCat = isAdultContent(cat);
        const isResumeCat = cat === 'Continuar Assistindo';
        const isClienteCat = hasCliente && cat === hasCliente;
        const isGuiaCat = hasGuiaJogos && cat === hasGuiaJogos;
        const isFavCat = cat === 'Minha Lista';
        const isFixedTop = isResumeCat || cat === 'Todos' || isClienteCat || isGuiaCat || isFavCat;
        
        let count = 0;
        if (cat === 'Todos') count = items.length;
        else if (isResumeCat) count = resumeCount;
        else if (isFavCat) count = favCount;
        else count = items.filter(c => c.group === cat).length;

        const btn = document.createElement('div');
        
        const activeClasses = activeCategory === cat 
          ? (isResumeCat ? 'bg-amber-600/20 text-amber-300 border border-amber-500/50 shadow-sm' : (isClienteCat ? 'bg-blue-600/20 text-blue-300 border border-blue-500/50 shadow-sm' : (isGuiaCat ? 'bg-emerald-600/20 text-emerald-300 border border-emerald-500/50 shadow-sm' : (isFavCat ? 'bg-rose-600/20 text-rose-300 border border-rose-500/50 shadow-sm' : 'bg-purple-600/20 text-purple-300 border border-purple-500/40 shadow-sm'))))
          : (isResumeCat ? 'text-amber-400/80 hover:bg-amber-950/40 hover:text-amber-200' : (isClienteCat ? 'text-blue-400/90 hover:bg-blue-950/40 hover:text-blue-200' : (isGuiaCat ? 'text-emerald-400/90 hover:bg-emerald-950/40 hover:text-emerald-200' : (isFavCat ? 'text-rose-400/90 hover:bg-rose-950/40 hover:text-rose-200' : 'text-purple-400/70 hover:bg-purple-950/40 hover:text-purple-200'))));

        btn.className = `px-3 py-2 rounded-xl text-xs font-semibold transition-all flex items-center justify-between ${activeClasses} ${!isSortModeActive ? 'cursor-pointer' : ''}`;
        
        if (!isSortModeActive) {
          btn.onclick = () => {
            const proceed = () => {
              activeCategory = cat;
              visibleCount = ITEMS_PER_PAGE;
              renderCategories();
              filterMedia();
            };
            if (isAdultCat && !isAdultUnlocked) requireAdultPin(proceed);
            else proceed();
          };
        }

        let sortButtonsHtml = '';
        if (isSortModeActive && !isFixedTop) {
          sortButtonsHtml = `
            <div class="flex items-center gap-1 ml-2 shrink-0" onclick="event.stopPropagation()">
              <button onclick="moveCategory('${cat.replace(/'/g, "\\'")}', -1)" class="p-1 rounded bg-[#241738] hover:bg-purple-600 text-purple-300 hover:text-white transition-all" title="Subir">
                <i data-lucide="chevron-up" class="w-3.5 h-3.5"></i>
              </button>
              <button onclick="moveCategory('${cat.replace(/'/g, "\\'")}', 1)" class="p-1 rounded bg-[#241738] hover:bg-purple-600 text-purple-300 hover:text-white transition-all" title="Descer">
                <i data-lucide="chevron-down" class="w-3.5 h-3.5"></i>
              </button>
            </div>
          `;
        }

        let iconHtml = '';
        if (isResumeCat) iconHtml = `<i data-lucide="play-circle" class="w-3.5 h-3.5 text-amber-400 shrink-0"></i>`;
        else if (isFavCat) iconHtml = `<i data-lucide="heart" class="w-3.5 h-3.5 text-rose-400 shrink-0 fill-rose-400"></i>`;
        else if (isClienteCat) iconHtml = `<i data-lucide="shield" class="w-3.5 h-3.5 text-blue-400 shrink-0"></i>`;
        else if (isGuiaCat) iconHtml = `<i data-lucide="trophy" class="w-3.5 h-3.5 text-emerald-400 shrink-0"></i>`;
        else if (isAdultCat) iconHtml = `<i data-lucide="lock" class="w-3 h-3 text-rose-400 shrink-0"></i>`;

        let badgeBg = isResumeCat ? 'text-amber-400/70 bg-[#26180c]' : (isFavCat ? 'text-rose-400/70 bg-[#260c14]' : (isClienteCat ? 'text-blue-400/70 bg-[#0c1a26]' : (isGuiaCat ? 'text-emerald-400/70 bg-[#0c2618]' : 'text-purple-400/50 bg-[#170e26]')));

        btn.innerHTML = `
          <span class="truncate max-w-[180px] flex items-center gap-1.5" title="${cat}">
            ${iconHtml}
            ${cat}
          </span>
          <div class="flex items-center gap-1">
            <span class="text-[10px] ${badgeBg} px-1.5 py-0.5 rounded-md shrink-0">${count}</span>
            ${sortButtonsHtml}
          </div>
        `;
        desktopContainer.appendChild(btn);
      });

      const mobileGrid = document.getElementById('mobileCategoryGrid');
      mobileGrid.innerHTML = '';

      cats.forEach(cat => {
        const isAdultCat = isAdultContent(cat);
        const isResumeCat = cat === 'Continuar Assistindo';
        const isFavCat = cat === 'Minha Lista';
        const isClienteCat = hasCliente && cat === hasCliente;
        const isGuiaCat = hasGuiaJogos && cat === hasGuiaJogos;
        const isSpecialAll = cat === 'Todos';

        let count = 0;
        if (isSpecialAll) count = items.length;
        else if (isResumeCat) count = resumeCount;
        else if (isFavCat) count = favCount;
        else count = items.filter(c => c.group === cat).length;

        const card = document.createElement('div');
        card.onclick = () => selectMobileCategory(cat);

        const iconName = isResumeCat ? 'play-circle' : (isFavCat ? 'heart' : (isClienteCat ? 'shield' : (isGuiaCat ? 'trophy' : (isAdultCat ? 'lock' : (currentSection === 'live' ? 'tv' : (currentSection === 'movies' ? 'film' : 'clapperboard'))))));
        const iconColor = isResumeCat 
          ? 'text-amber-400 bg-amber-950/80 border-amber-800/60' 
          : (isFavCat 
            ? 'text-rose-400 bg-rose-950/80 border-rose-800/60' 
            : (isClienteCat ? 'text-blue-400 bg-blue-950/80 border-blue-800/60' : (isGuiaCat ? 'text-emerald-400 bg-emerald-950/80 border-emerald-800/60' : (isAdultCat ? 'text-rose-400 bg-rose-950/60 border-rose-800/40' : 'text-purple-400 bg-purple-950/60 border-purple-800/40'))));

        card.className = `relative rounded-2xl border p-4 flex flex-col justify-between cursor-pointer transition-all active:scale-[0.97] shadow-lg ${
          isSpecialAll 
            ? 'col-span-1 bg-gradient-to-r from-purple-900/60 to-indigo-900/40 border-purple-500/50 min-h-[95px]'
            : (isResumeCat 
              ? 'col-span-1 bg-gradient-to-r from-amber-950/60 to-purple-950/60 border-amber-500/50 min-h-[95px]'
              : (isFavCat
                ? 'col-span-1 bg-gradient-to-r from-rose-950/60 to-purple-950/60 border-rose-500/50 min-h-[95px]'
                : (isClienteCat
                  ? 'col-span-1 bg-gradient-to-r from-blue-950/60 to-purple-950/60 border-blue-500/50 min-h-[95px]'
                  : (isGuiaCat
                    ? 'col-span-1 bg-gradient-to-r from-emerald-950/60 to-purple-950/60 border-emerald-500/50 min-h-[95px]'
                    : (isAdultCat 
                      ? 'bg-[#180d1a] border-rose-900/40 hover:border-rose-600/50 min-h-[105px]' 
                      : 'bg-[#120c1f] border-purple-950/80 hover:border-purple-600/50 min-h-[105px]')))))
        }`;

        let badgeColor = isResumeCat ? 'bg-amber-950 text-amber-300' : (isFavCat ? 'bg-rose-950 text-rose-300' : (isClienteCat ? 'bg-blue-950 text-blue-300' : (isGuiaCat ? 'bg-emerald-950 text-emerald-300' : (isAdultCat ? 'bg-rose-950 text-rose-300' : 'bg-purple-950 text-purple-300'))));

        card.innerHTML = `
          <div class="flex items-center justify-between">
            <div class="w-9 h-9 rounded-xl border flex items-center justify-center ${iconColor}">
              <i data-lucide="${iconName}" class="w-4 h-4 ${isFavCat ? 'fill-rose-400' : ''}"></i>
            </div>
            <span class="text-[10px] font-mono font-bold px-2 py-0.5 rounded-md ${badgeColor}">
              ${count}
            </span>
          </div>
          <div class="mt-2">
            <h4 class="text-xs font-bold ${isResumeCat ? 'text-amber-200' : (isFavCat ? 'text-rose-200' : (isClienteCat ? 'text-blue-200' : (isGuiaCat ? 'text-emerald-200' : 'text-slate-100')))} line-clamp-2">${cat}</h4>
          </div>
        `;
        mobileGrid.appendChild(card);
      });

      lucide.createIcons();
    }

    // Dispara a busca ao apertar Enter ou clicar no botão Pesquisar
    function executeSearch() {
      const input = document.getElementById('searchInput');
      if (!input) return;
      const query = input.value.trim();

      if (!query) return;

      addRecentSearch(query);

      if (currentSection === 'home' || currentSection === 'reading') {
        setSection('movies');
      }

      activeSearchQuery = query;

      const sidebar = document.getElementById('desktopSidebar');
      if (sidebar) sidebar.style.display = 'none';

      if (currentSection === 'games') renderGamesCatalog();
      else filterMedia();
      closeSearchModal();
    }

    function handleSearchKey(event) {
      if (event.key === 'Enter') {
        executeSearch();
      }
    }

    function handleSearchInput() {
      // Vazio intencionalmente para evitar busca automática ao digitar
    }

    // Gerenciamento do Histórico de Pesquisas Recentes (Máximo 5)
    function getRecentSearches() {
      try {
        const list = userProgressStorage.getItem('lux_recent_searches');
        return list ? JSON.parse(list) : [];
      } catch(e) {
        return [];
      }
    }

    function addRecentSearch(query) {
      const q = query.trim();
      if (!q || q.length < 2) return;
      let searches = getRecentSearches();
      searches = searches.filter(item => item.toLowerCase() !== q.toLowerCase());
      searches.unshift(q);
      if (searches.length > 5) searches = searches.slice(0, 5);
      userProgressStorage.setItem('lux_recent_searches', JSON.stringify(searches));
      renderRecentSearches();
    }

    function removeRecentSearch(query, event) {
      if (event) event.stopPropagation();
      let searches = getRecentSearches();
      searches = searches.filter(item => item !== query);
      userProgressStorage.setItem('lux_recent_searches', JSON.stringify(searches));
      renderRecentSearches();
    }

    function clearRecentSearches() {
      userProgressStorage.removeItem('lux_recent_searches');
      renderRecentSearches();
    }

    function renderRecentSearches() {
      const container = document.getElementById('recentSearchesContainer');
      const listElem = document.getElementById('recentSearchesList');
      if (!container || !listElem) return;

      const searches = getRecentSearches();
      if (searches.length === 0) {
        container.classList.add('hidden');
        return;
      }

      container.classList.remove('hidden');
      listElem.innerHTML = '';

      searches.forEach(term => {
        const item = document.createElement('div');
        item.className = "flex items-center justify-between px-3 py-2 bg-[#180f29] hover:bg-purple-900/40 rounded-xl cursor-pointer text-xs text-slate-200 transition-colors group";
        item.onclick = () => {
          const input = document.getElementById('searchInput');
          if (input) {
            input.value = term;
            executeSearch();
          }
        };
        item.innerHTML = `
          <span class="truncate flex items-center gap-2"><i data-lucide="clock" class="w-3.5 h-3.5 text-purple-400/60"></i>${term}</span>
          <button onclick="removeRecentSearch('${term.replace(/'/g, "\\'")}', event)" class="text-purple-400/60 hover:text-rose-400 p-1 rounded transition-colors" title="Remover">
            <i data-lucide="x" class="w-3.5 h-3.5"></i>
          </button>
        `;
        listElem.appendChild(item);
      });
      lucide.createIcons();
    }

    // Funções para abrir e fechar o Modal de Busca Global
    function openSearchModal() {
      const modal = document.getElementById('searchModal');
      if (modal) {
        modal.classList.remove('hidden');
        const input = document.getElementById('searchInput');
        if (input) {
          input.focus();
          input.value = '';
        }
        renderRecentSearches();
      }
    }

    function closeSearchModal() {
      const modal = document.getElementById('searchModal');
      if (modal) {
        modal.classList.add('hidden');
      }
    }

    function getChannelSortInfo(name) {
      const raw = name || '';
      let quality = 5;
      if (/\b(4k|uhd)\b/i.test(raw)) quality = 1;
      else if (/\b(fhd|1080p)\b/i.test(raw)) quality = 2;
      else if (/\b(hd|720p)\b/i.test(raw)) quality = 3;
      else if (/\b(sd|480p|576p)\b/i.test(raw)) quality = 4;

      const isH265 = /\[?h\.?265\]?|\bhevc\b/i.test(raw) ? 1 : 0;

      let clean = raw
        .replace(/\[\s*(h\.?265|hevc|fhd|hd|sd|4k|uhd)\s*\]/gi, '')
        .replace(/\(\s*(h\.?265|hevc|fhd|hd|sd|4k|uhd)\s*\)/gi, '')
        .replace(/\b(4k|uhd|fhd|1080p|hd|720p|sd|h\.?265|hevc)\b/gi, '')
        .replace(/\s+/g, ' ')
        .trim();

      let numMatch = clean.match(/^(.*?)(?:[\s\-_]+)(\d+)$/);
      let base = clean;
      let num = 0;

      if (numMatch && numMatch[1].trim().length > 0) {
        base = numMatch[1].trim();
        num = parseInt(numMatch[2], 10);
      }

      return {
        base: base.toLowerCase(),
        num: num,
        quality: quality,
        isH265: isH265
      };
    }

    function compareLiveChannels(a, b) {
      if (Boolean(a.isAdult) !== Boolean(b.isAdult)) {
        return a.isAdult ? 1 : -1;
      }

      const nameA = (a.name || '').toLowerCase();
      const nameB = (b.name || '').toLowerCase();
      const groupA = (a.group || '').toLowerCase();
      const groupB = (b.group || '').toLowerCase();

      const isSudeste = groupA.includes('sudeste') || groupB.includes('sudeste') || activeCategory.toLowerCase().includes('sudeste');
      const isGloboA = nameA.includes('globo');
      const isGloboB = nameB.includes('globo');
      if (isSudeste && isGloboA && isGloboB) {
        const isSpA = /\b(sp|s[aã]o\s*paulo)\b/i.test(a.name);
        const isSpB = /\b(sp|s[aã]o\s*paulo)\b/i.test(b.name);
        if (isSpA !== isSpB) {
          return isSpA ? -1 : 1;
        }
      }

      const isPremiereGroup = groupA.includes('premiere') || groupB.includes('premiere') || activeCategory.toLowerCase().includes('premiere');
      const isPremA = nameA.includes('premiere') || nameA.includes('pfc');
      const isPremB = nameB.includes('premiere') || nameB.includes('pfc');
      if (isPremiereGroup || (isPremA && isPremB)) {
        const isClubesA = /\b(clube|clubes)\b/i.test(a.name);
        const isClubesB = /\b(clube|clubes)\b/i.test(b.name);
        if (isClubesA !== isClubesB) {
          return isClubesA ? -1 : 1;
        }
      }

      const infoA = getChannelSortInfo(a.name);
      const infoB = getChannelSortInfo(b.name);

      const cmpBase = infoA.base.localeCompare(infoB.base, 'pt-BR', { sensitivity: 'base' });
      if (cmpBase !== 0) return cmpBase;

      if (infoA.num !== infoB.num) {
        return infoA.num - infoB.num;
      }

      if (infoA.quality !== infoB.quality) {
        return infoA.quality - infoB.quality;
      }

      if (infoA.isH265 !== infoB.isH265) {
        return infoA.isH265 - infoB.isH265;
      }

      return a.name.localeCompare(b.name, 'pt-BR', { numeric: true, sensitivity: 'base' });
    }

    function normalizeSearchText(text = '') {
      return String(text)
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, ' ')
        .trim()
        .replace(/\s+/g, ' ');
    }

    function levenshteinDistance(a, b, maxDistance = 2) {
      if (a === b) return 0;
      if (!a || !b || Math.abs(a.length - b.length) > maxDistance) return maxDistance + 1;
      if (a.length > b.length) [a, b] = [b, a];

      let prev = new Array(a.length + 1);
      for (let i = 0; i <= a.length; i++) prev[i] = i;

      for (let j = 1; j <= b.length; j++) {
        const cur = [j];
        let min = j;
        for (let i = 1; i <= a.length; i++) {
          const value = Math.min(
            cur[i - 1] + 1,
            prev[i] + 1,
            prev[i - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)
          );
          cur[i] = value;
          if (value < min) min = value;
        }
        if (min > maxDistance) return maxDistance + 1;
        prev = cur;
      }
      return prev[a.length];
    }

    function getCachedSearchData(item) {
      if (!item._luxSearchData) {
        const normalized = normalizeSearchText(item.name || '');
        item._luxSearchData = {
          normalized,
          tokens: normalized ? normalized.split(' ') : []
        };
      }
      return item._luxSearchData;
    }

    function getSearchScore(searchData, queryTokens, normalizedQuery) {
      if (!normalizedQuery) return 0;
      if (!searchData.normalized) return -1;

      if (searchData.normalized.includes(normalizedQuery)) return 10000;

      let total = 0;

      for (const queryToken of queryTokens) {
        if (queryToken.length < 2) continue;
        let best = -1;

        for (const nameToken of searchData.tokens) {
          if (nameToken === queryToken) {
            best = 900;
            break;
          }

          if (nameToken.startsWith(queryToken) || queryToken.startsWith(nameToken)) {
            best = Math.max(best, 760 - Math.abs(nameToken.length - queryToken.length) * 15);
            continue;
          }

          if (
            queryToken.length >= 4 &&
            nameToken.length >= 3 &&
            queryToken[0] === nameToken[0] &&
            Math.abs(queryToken.length - nameToken.length) <= 1
          ) {
            const distance = levenshteinDistance(queryToken, nameToken, 1);
            if (distance <= 1) best = Math.max(best, 620);
          }
        }

        if (best < 0) return -1;
        total += best;
      }

      return total + Math.max(0, 120 - Math.abs(searchData.normalized.length - normalizedQuery.length));
    }

    function filterMedia() {
      const currentList = getSectionItems();
      const scoredResults = [];

      const normalizedQuery = normalizeSearchText(activeSearchQuery);
      const queryTokens = normalizedQuery ? normalizedQuery.split(' ') : [];

      currentList.forEach(c => {
        let matchesCat = false;

        if (activeSearchQuery) {
          matchesCat = true; 
        } else {
          if (activeCategory === 'Todos') matchesCat = true;
          else if (activeCategory === 'Continuar Assistindo') {
            matchesCat = hasResumeEntry(c);
          } else if (activeCategory === 'Minha Lista') {
            matchesCat = isFavorite(c);
          } else {
            matchesCat = c.group === activeCategory;
          }
        }

        if (!matchesCat) return;

        const score = normalizedQuery
          ? getSearchScore(getCachedSearchData(c), queryTokens, normalizedQuery)
          : 0;

        if (!normalizedQuery || score >= 0) scoredResults.push({ item: c, score });
      });

      if (normalizedQuery) {
        scoredResults.sort((a, b) => b.score - a.score);
      }

      currentFilteredItems = scoredResults.map(r => r.item);

      if (currentSection === 'live') {
        if (!normalizedQuery) currentFilteredItems.sort(compareLiveChannels);
      } else {
        if (!normalizedQuery) {
          currentFilteredItems.sort((a, b) => {
            if (Boolean(a.isAdult) === Boolean(b.isAdult)) return 0;
            return a.isAdult ? 1 : -1;
          });
        } else {
          const scoreMap = new Map(scoredResults.map(r => [r.item, r.score]));
          currentFilteredItems.sort((a, b) => {
            if (Boolean(a.isAdult) !== Boolean(b.isAdult)) return a.isAdult ? 1 : -1;
            return scoreMap.get(b) - scoreMap.get(a);
          });
        }
      }

      updateScreenHeaderTitle();

      visibleCount = ITEMS_PER_PAGE;
      renderCurrentPage();
    }

    function updateScreenHeaderTitle() {
      const headingEl = document.getElementById('activeCategoryHeading');
      if (headingEl) {
        if (activeSearchQuery) {
          headingEl.innerHTML = `
            <span class="flex items-center gap-2">
              Resultados para: <span class="text-purple-400">"${activeSearchQuery}"</span>
              <button onclick="clearSearchFilter()" class="ml-2 bg-purple-950 hover:bg-rose-600 text-purple-300 hover:text-white px-2.5 py-1 rounded-lg text-xs transition-all flex items-center gap-1 cursor-pointer">
                ✕ Limpar busca
              </button>
            </span>
          `;
        } else {
          headingEl.innerText = activeCategory;
        }
      }

      const liveCatTitleElem = document.getElementById('liveCategoryTitle');
      if (liveCatTitleElem) {
        if (activeSearchQuery) {
          liveCatTitleElem.innerHTML = `
            <span class="flex items-center justify-between w-full pr-1">
              <span class="truncate text-purple-300">Busca: "${activeSearchQuery}"</span>
              <button onclick="clearSearchFilter()" class="text-rose-400 hover:text-rose-300 ml-1 font-bold text-xs px-1.5 py-0.5 bg-purple-950 rounded cursor-pointer" title="Limpar busca">✕</button>
            </span>
          `;
        } else {
          liveCatTitleElem.innerText = activeCategory;
        }
      }
    }

    function clearSearchFilter() {
      activeSearchQuery = '';

      const isMobile = window.innerWidth < 1024;
      const isMediaCatalogSection = ['live', 'movies', 'series'].includes(currentSection);

      if (currentSection === 'live') {
        const liveChanSec = document.getElementById('liveChannelsSection');
        if (liveChanSec) liveChanSec.classList.remove('hidden');
      } else if (isMediaCatalogSection) {
        const sidebar = document.getElementById('desktopSidebar');
        if (sidebar && !isMobile) {
          sidebar.style.display = '';
          sidebar.classList.remove('hidden');
          sidebar.classList.add('lg:flex');
        }
      }

      if (currentSection === 'games') renderGamesCatalog();
      else if (isMediaCatalogSection) filterMedia();
    }

    function renderCurrentPage() {
      const container = currentSection === 'live' 
        ? document.getElementById('liveItemsContainer') 
        : document.getElementById('vodGridContainer');

      if (!container) return;

      container.innerHTML = '';
      container.scrollTop = 0;

      if (currentSection === 'live') {
        const liveCountElem = document.getElementById('liveChannelCount');
        if (liveCountElem) liveCountElem.innerText = currentFilteredItems.length;
      }

      appendMoreItems();
    }

    function appendMoreItems() {
      const isLive = currentSection === 'live';
      const container = isLive 
        ? document.getElementById('liveItemsContainer') 
        : document.getElementById('vodGridContainer');

      if (!container) return;

      if (currentFilteredItems.length === 0) {
        container.innerHTML = `
          <div class="col-span-full flex flex-col items-center justify-center py-20 text-center">
            <div class="w-16 h-16 rounded-2xl bg-purple-950/60 border border-purple-800/40 flex items-center justify-center text-purple-400 mb-3">
              <i data-lucide="search-x" class="w-8 h-8"></i>
            </div>
            <h3 class="text-white font-bold text-base">Nenhum resultado encontrado</h3>
            <p class="text-purple-400/60 text-xs mt-1">Tente pesquisar com outro termo ou limpe a busca.</p>
          </div>
        `;
        lucide.createIcons();
        return;
      }

      const currentBatch = currentFilteredItems.slice(container.children.length, visibleCount);
      const fragment = document.createDocumentFragment();

      currentBatch.forEach(c => {
        const card = document.createElement('div');

        if (isLive) {
          const isActive = activeLiveChannel && activeLiveChannel.id === c.id;
          const fav = isFavorite(c);
          card.onclick = () => {
            if (c.isAdult && !isAdultUnlocked) {
              requireAdultPin(() => playLiveChannel(c));
            } else {
              playLiveChannel(c);
            }
          };

          card.className = `flex items-center gap-3 p-2.5 rounded-xl cursor-pointer transition-all border ${
            isActive ? 'bg-purple-900/40 border-purple-500/50 lux-glow-sm' : 'hover:bg-purple-950/30 border-transparent'
          }`;
          
          card.innerHTML = `
            <div class="channel-logo-container w-9 h-9 object-contain rounded-lg bg-[#0c0814] border border-purple-950 p-1 shrink-0 flex items-center justify-center"></div>
            <div class="flex-1 min-w-0">
              <p class="text-xs font-semibold text-slate-200 truncate flex items-center gap-1">
                ${c.isAdult ? `<i data-lucide="lock" class="w-3 h-3 text-rose-400 shrink-0"></i>` : ''}
                ${c.name}
              </p>
              <p class="text-[10px] text-purple-400 truncate">${c.group}</p>
            </div>
          `;

          const logoDiv = card.querySelector('.channel-logo-container');
          if (c.logo) {
            const img = document.createElement('img');
            img.src = c.logo;
            img.className = "w-full h-full object-contain";
            img.onerror = () => {
              c.logo = '';
              logoDiv.innerHTML = getLiveFallbackHtml(c.isAdult);
              lucide.createIcons();
            };
            logoDiv.appendChild(img);
          } else {
            logoDiv.innerHTML = getLiveFallbackHtml(c.isAdult);
          }

          const favBtn = document.createElement('button');
          favBtn.className = "p-1.5 text-purple-400 hover:text-rose-400 transition-colors shrink-0";
          favBtn.title = "Favoritar";
          favBtn.innerHTML = `<i data-lucide="heart" class="w-4 h-4 ${fav ? 'fill-rose-500 text-rose-500' : ''}"></i>`;
          favBtn.onclick = (e) => toggleFavorite(c, e);
          card.appendChild(favBtn);

          if (isActive) {
            const activeIndicator = document.createElement('div');
            activeIndicator.className = "w-2 h-2 rounded-full bg-purple-400 animate-pulse shrink-0";
            card.appendChild(activeIndicator);
          }

        } else {
          card.onclick = () => {
            const resumeState = currentSection === 'series' && activeCategory === 'Continuar Assistindo'
              ? getSeriesResumeState(c)
              : null;
            if (c.isAdult && !isAdultUnlocked) {
              requireAdultPin(() => resumeState ? resumeSeriesFromState(c, resumeState) : handleVodClick(c));
            } else if (resumeState) {
              resumeSeriesFromState(c, resumeState);
            } else {
              handleVodClick(c);
            }
          };

          const isAdult = c.isAdult;
          const fav = isFavorite(c);
          
          card.className = "flex flex-col bg-[#120c1f] rounded-2xl border border-purple-950/80 hover:border-purple-500/70 overflow-hidden cursor-pointer group transition-all duration-300 hover:-translate-y-1.5 shadow-lg hover:shadow-purple-950/60 w-full min-h-[270px] md:min-h-[300px]";
          
          const posterContainer = document.createElement('div');
          posterContainer.className = "w-full relative overflow-hidden bg-[#0c0814] flex items-center justify-center shrink-0 aspect-[2/3]";

          if (c.logo) {
            const img = document.createElement('img');
            img.src = c.logo;
            img.className = "w-full h-full object-cover group-hover:scale-105 transition-transform duration-300";
            img.loading = "lazy";
            img.onerror = () => {
              c.logo = '';
              posterContainer.innerHTML = '';
              posterContainer.appendChild(createFallbackPoster(c, isAdult));
              addPosterOverlays(posterContainer, c, fav);
              lucide.createIcons();
            };
            posterContainer.appendChild(img);
          } else {
            posterContainer.appendChild(createFallbackPoster(c, isAdult));
          }

          addPosterOverlays(posterContainer, c, fav);
          card.appendChild(posterContainer);

          const infoDiv = document.createElement('div');
          infoDiv.className = "p-2.5 md:p-3 bg-[#120c1f] border-t border-purple-950/40 flex-1 flex flex-col justify-between min-h-[55px]";
          infoDiv.innerHTML = `
            <h4 class="text-xs font-bold text-slate-100 truncate group-hover:text-purple-300 transition-colors" title="${c.name}">${c.name}</h4>
            <p class="text-[10px] text-purple-400/80 truncate mt-0.5 md:mt-1">${c.group}</p>
          `;
          card.appendChild(infoDiv);
        }

        fragment.appendChild(card);
      });

      container.appendChild(fragment);
      lucide.createIcons();
    }

    function createFallbackPoster(c, isAdult) {
      const fallbackBgGradient = isAdult ? `from-[#1c0b16] via-[#120710] to-[#0a0409]` : `from-[#180f29] via-[#0f091a] to-[#08050e]`;
      const fallbackIcon = isAdult 
        ? `<div class="w-12 h-12 rounded-2xl bg-rose-950/60 border border-rose-800/50 flex flex-col items-center justify-center text-rose-400 mb-2 shadow-lg"><i data-lucide="lock" class="w-5 h-5 mb-0.5"></i><span class="text-[9px] font-bold">+18</span></div>`
        : (currentSection === 'movies'
          ? `<div class="w-12 h-12 rounded-2xl bg-purple-950/60 border border-purple-800/40 flex items-center justify-center text-purple-400 mb-2 shadow-lg"><i data-lucide="film" class="w-6 h-6"></i></div>`
          : `<div class="w-12 h-12 rounded-2xl bg-purple-950/60 border border-purple-800/40 flex items-center justify-center text-purple-400 mb-2 shadow-lg"><i data-lucide="clapperboard" class="w-6 h-6"></i></div>`
        );

      const div = document.createElement('div');
      div.className = `absolute inset-0 bg-gradient-to-br ${fallbackBgGradient} flex flex-col items-center justify-center p-4 text-center border-b border-purple-950/40`;
      div.innerHTML = `
        ${fallbackIcon}
        <p class="text-[11px] font-bold text-slate-300 line-clamp-3 leading-tight">${c.name}</p>
      `;
      return div;
    }

    function addPosterOverlays(container, c, fav) {
      const gradientOverlay = document.createElement('div');
      gradientOverlay.className = "absolute inset-0 bg-gradient-to-t from-[#120c1f] via-transparent to-transparent opacity-90 pointer-events-none";
      container.appendChild(gradientOverlay);

      const favBtn = document.createElement('button');
      favBtn.className = "absolute top-2 left-2 p-2 rounded-xl bg-black/60 hover:bg-black text-white transition-all z-20 shadow cursor-pointer";
      favBtn.innerHTML = `<i data-lucide="heart" class="w-4 h-4 ${fav ? 'fill-rose-500 text-rose-500' : 'text-white'}">`;
      favBtn.onclick = (e) => toggleFavorite(c, e);
      container.appendChild(favBtn);

      if (c.isAdult) {
        const adultBadge = document.createElement('div');
        adultBadge.className = "absolute top-2 right-2 bg-rose-950/90 border border-rose-600/50 text-rose-300 text-[10px] px-2 py-0.5 rounded-md font-bold flex items-center gap-1 z-10 shadow";
        adultBadge.innerHTML = `<i data-lucide="lock" class="w-3 h-3"></i> +18`;
        container.appendChild(adultBadge);
      }

      const hoverOverlay = document.createElement('div');
      hoverOverlay.className = "absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity bg-black/40 backdrop-blur-[2px] z-10 pointer-events-none";
      hoverOverlay.innerHTML = `
        <div class="w-11 h-11 md:w-12 md:h-12 rounded-full bg-purple-600 text-white flex items-center justify-center shadow-lg shadow-purple-900/60 transform group-hover:scale-110 transition-transform">
          <i data-lucide="play" class="w-5 h-5 fill-white ml-0.5"></i>
        </div>
      `;
      container.appendChild(hoverOverlay);
    }

    function handleVodClick(item) {
      if (currentSection === 'movies') {
        openMovieModal(item);
      } else if (currentSection === 'series') {
        openSeriesModal(item);
      }
    }

    async function openMovieModal(item) {
      if (!profileAllowsMedia(item)) return;
      currentMovieItem = item;
      document.getElementById('movieModalTitle').innerText = item.name;
      document.getElementById('movieModalCategory').innerText = item.group;
      document.getElementById('movieModalYear').innerText = 'Filme';
      document.getElementById('movieModalPlot').innerText = 'Carregando sinopse...';

      const coverContainer = document.getElementById('movieModalCover');
      coverContainer.innerHTML = '';
      
      if (item.logo) {
        const img = document.createElement('img');
        img.src = item.logo;
        img.className = "w-full h-full object-cover";
        img.onerror = () => {
          coverContainer.innerHTML = `<i data-lucide="film" class="w-8 h-8 text-purple-700"></i>`;
          lucide.createIcons();
        };
        coverContainer.appendChild(img);
      } else {
        coverContainer.innerHTML = `<i data-lucide="film" class="w-8 h-8 text-purple-700"></i>`;
      }

      updateMovieModalFavBtn();

      document.getElementById('movieModalPlayBtn').onclick = () => {
        closeMovieModal();
        openVodPlayer(item);
      };

      document.getElementById('movieModal').classList.remove('hidden');

      const xcCreds = resolveUserCredentials(currentUser);
      if (xcCreds.isXc && item.url) {
        const match = item.url.match(/\/movie\/[^/]+\/[^/]+\/([^\.]+)\./);
        if (match && match[1]) {
          const streamId = match[1];
          const cleanServer = xcCreds.server.replace(/\/+$/, '');
          const infoUrl = `${cleanServer}/player_api.php?username=${encodeURIComponent(xcCreds.user)}&password=${encodeURIComponent(xcCreds.pass)}&action=get_vod_info&vod_id=${streamId}`;
          try {
            const res = await smartFetch(infoUrl);
            const data = await res.json();
            if (data && data.info) {
              const info = data.info;
              document.getElementById('movieModalPlot').innerText = info.plot || info.description || 'Sinopse não disponível.';
              if (info.releasedate || info.year) {
                document.getElementById('movieModalYear').innerText = info.releasedate || info.year;
              }
            } else {
              document.getElementById('movieModalPlot').innerText = 'Sinopse não disponível.';
            }
          } catch(e) {
            document.getElementById('movieModalPlot').innerText = 'Sinopse não disponível.';
          }
        } else {
          document.getElementById('movieModalPlot').innerText = 'Sinopse não disponível.';
        }
      } else {
        document.getElementById('movieModalPlot').innerText = 'Sinopse disponível apenas via servidor Xtream Codes.';
      }
      lucide.createIcons();
    }

    function closeMovieModal() {
      document.getElementById('movieModal').classList.add('hidden');
      currentMovieItem = null;
    }

    async function openSeriesModal(series, resumeState = null, autoPlayResume = false) {
      if (!profileAllowsMedia(series)) return;
      currentSeriesItem = series;
      currentSeriesDetails = series;
      document.getElementById('seriesModalTitle').innerText = series.name;
      document.getElementById('seriesModalCategory').innerText = series.group;
      document.getElementById('seriesModalStats').innerText = 'Buscando temporadas...';
      document.getElementById('seriesModalPlot').innerText = 'Carregando sinopse...';

      updateSeriesModalFavBtn();

      const coverContainer = document.getElementById('seriesModalCover');
      coverContainer.innerHTML = '';

      if (series.logo) {
        const img = document.createElement('img');
        img.src = series.logo;
        img.className = "w-full h-full object-cover";
        img.onerror = () => {
          coverContainer.innerHTML = series.isAdult 
            ? `<div class="w-full h-full bg-rose-950/60 flex flex-col items-center justify-center text-rose-400 font-bold text-[10px]"><i data-lucide="lock" class="w-5 h-5 mb-0.5"></i>+18</div>`
            : `<i data-lucide="clapperboard" class="w-8 h-8 text-purple-700"></i>`;
          lucide.createIcons();
        };
        coverContainer.appendChild(img);
      } else {
        coverContainer.innerHTML = series.isAdult 
          ? `<div class="w-full h-full bg-rose-950/60 flex flex-col items-center justify-center text-rose-400 font-bold text-[10px]"><i data-lucide="lock" class="w-5 h-5 mb-0.5"></i>+18</div>`
          : `<i data-lucide="clapperboard" class="w-8 h-8 text-purple-700"></i>`;
      }

      document.getElementById('seriesSeasonsContainer').innerHTML = '';
      
      document.getElementById('seriesEpisodesContainer').innerHTML = `
        <div class="flex flex-col items-center justify-center py-12 gap-3">
          <div class="w-10 h-10 border-4 border-purple-500/20 border-t-purple-500 rounded-full animate-spin"></div>
          <p class="text-xs font-semibold text-purple-300 animate-pulse">Sincronizando temporadas e episódios...</p>
        </div>
      `;
      document.getElementById('seriesModal').classList.remove('hidden');

      const xcCreds = resolveUserCredentials(currentUser);

      if (xcCreds.isXc && series.series_id) {
        const cleanServer = xcCreds.server.replace(/\/+$/, '');
        const infoUrl = `${cleanServer}/player_api.php?username=${encodeURIComponent(xcCreds.user)}&password=${encodeURIComponent(xcCreds.pass)}&action=get_series_info&series_id=${series.series_id}`;
        
        try {
          const res = await smartFetch(infoUrl);
          const data = await res.json();
          currentSeriesEpisodesData = data.episodes || {};

          if (data && data.info) {
            const info = data.info;
            document.getElementById('seriesModalPlot').innerText = info.plot || info.description || 'Sinopse não disponível.';
          } else {
            document.getElementById('seriesModalPlot').innerText = 'Sinopse não disponível.';
          }

          const seasonNumbers = Object.keys(currentSeriesEpisodesData)
            .map(Number)
            .filter(n => !isNaN(n))
            .sort((a, b) => a - b);

          document.getElementById('seriesModalStats').innerText = `${seasonNumbers.length} Temporada(s)`;

          if (seasonNumbers.length > 0) {
            currentSelectedSeason = resumeState && seasonNumbers.includes(Number(resumeState.seasonNum))
              ? Number(resumeState.seasonNum)
              : seasonNumbers[0];
            renderSeasonTabs(seasonNumbers);
            renderSeasonEpisodes();

            if (autoPlayResume && resumeState) {
              const episodes = currentSeriesEpisodesData[currentSelectedSeason] || [];
              const episodeIndex = episodes.findIndex(ep => String(ep.id) === String(resumeState.episodeId));
              const episode = episodes[episodeIndex >= 0 ? episodeIndex : Number(resumeState.episodeIndex)];
              if (episode) {
                closeSeriesModal();
                openVodPlayer(buildSeriesEpisodeItem(series, currentSelectedSeason, episode, episodeIndex >= 0 ? episodeIndex : Number(resumeState.episodeIndex), episodes));
              }
            }
          } else {
            document.getElementById('seriesEpisodesContainer').innerHTML = '<p class="text-xs text-slate-400 p-6 text-center">Nenhum episódio cadastrado nesta série.</p>';
          }
        } catch (err) {
          document.getElementById('seriesModalPlot').innerText = 'Sinopse não disponível.';
          document.getElementById('seriesEpisodesContainer').innerHTML = '<p class="text-xs text-rose-400 p-6 text-center">Erro ao buscar episódios do servidor.</p>';
        }
      } else {
        document.getElementById('seriesModalPlot').innerText = 'Sinopse disponível apenas via servidor Xtream Codes.';
        document.getElementById('seriesEpisodesContainer').innerHTML = '<p class="text-xs text-purple-400 p-6 text-center">Série disponível via lista direta.</p>';
      }
      lucide.createIcons();
    }

    function refreshResumeUI() {
      renderHomeResume();
      if (currentSection === 'movies' || currentSection === 'series') {
        renderCategories();
        filterMedia();
      }
    }

    function buildSeriesEpisodeItem(series, seasonNum, ep, index, episodes) {
      const xcCreds = resolveUserCredentials(currentUser);
      const cleanServer = xcCreds.server.replace(/\/+$/, '');
      const ext = ep.container_extension || 'mp4';
      const epNum = ep.episode_num || ep.episode || (index + 1);
      const epTitle = ep.title ? ep.title.trim() : `Episódio ${epNum}`;

      return {
        name: `${series.name} - T${seasonNum}E${epNum} (${epTitle})`,
        url: `${cleanServer}/series/${xcCreds.user}/${xcCreds.pass}/${ep.id}.${ext}`,
        type: 'series',
        id: ep.id,
        series_id: series.series_id || '',
        logo: series.logo || '',
        group: series.group || '',
        resumeKey: 'lux_progress_series_episode_' + ep.id,
        seasonNum,
        episodeNum: epNum,
        episodeTitle: epTitle,
        episodeIndex: index,
        episodeList: episodes,
        seriesName: series.name
      };
    }

    function renderSeasonTabs(seasonsList) {
      const container = document.getElementById('seriesSeasonsContainer');
      container.innerHTML = '';

      seasonsList.forEach(sNum => {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = `px-4 py-2 rounded-xl text-xs font-bold transition-all whitespace-nowrap cursor-pointer ${
          Number(sNum) === Number(currentSelectedSeason)
            ? 'bg-purple-600 text-white shadow-lg shadow-purple-950/50'
            : 'bg-[#1a122c] text-purple-300 hover:bg-purple-900/50 border border-purple-900/50'
        }`;
        btn.innerText = `Temporada ${sNum}`;
        btn.onclick = () => {
          currentSelectedSeason = Number(sNum);
          renderSeasonTabs(seasonsList);
          renderSeasonEpisodes();
        };
        container.appendChild(btn);
      });
    }

    function renderSeasonEpisodes() {
      const container = document.getElementById('seriesEpisodesContainer');
      container.innerHTML = '';

      if (!currentSeriesEpisodesData) return;
      const episodes = currentSeriesEpisodesData[currentSelectedSeason] || 
                       currentSeriesEpisodesData[String(currentSelectedSeason)] || 
                       currentSeriesEpisodesData[Number(currentSelectedSeason)] || [];

      if (episodes.length === 0) {
        container.innerHTML = '<p class="text-xs text-slate-400 p-6 text-center">Nenhum episódio nesta temporada.</p>';
        return;
      }

      episodes.forEach((ep, index) => {
        const epNum = ep.episode_num || ep.episode || '1';
        const epTitle = ep.title ? ep.title.trim() : `Episódio ${epNum}`;

        const row = document.createElement('div');
        row.onclick = () => {
          closeSeriesModal();
          openVodPlayer(buildSeriesEpisodeItem(currentSeriesDetails, currentSelectedSeason, ep, index, episodes));
        };

        row.className = "flex items-center justify-between p-3 bg-[#180f29] hover:bg-purple-900/40 border border-purple-950 hover:border-purple-700/50 rounded-xl cursor-pointer transition-all group";
        row.innerHTML = `
          <div class="flex items-center gap-3 min-w-0">
            <span class="w-8 h-8 rounded-lg bg-purple-950 border border-purple-900/60 text-purple-300 flex items-center justify-center text-xs font-mono font-bold shrink-0">
              ${epNum}
            </span>
            <div class="truncate">
              <p class="text-xs font-semibold text-slate-200 truncate group-hover:text-purple-300 transition-colors">
                ${epTitle}
              </p>
              <p class="text-[10px] text-purple-400/60 font-mono">Temporada ${currentSelectedSeason} • Episódio ${epNum}</p>
            </div>
          </div>
          <div class="w-8 h-8 rounded-full bg-purple-600/20 group-hover:bg-purple-600 text-purple-400 group-hover:text-white flex items-center justify-center shrink-0 transition-all shadow">
            <i data-lucide="play" class="w-4 h-4 fill-current ml-0.5"></i>
          </div>
        `;
        container.appendChild(row);
      });
      lucide.createIcons();
    }

    function closeSeriesModal() {
      document.getElementById('seriesModal').classList.add('hidden');
      currentSeriesItem = null;
    }

    function decodeEpgText(str) {
      if (!str) return '';
      try {
        const binString = atob(str);
        const bytes = Uint8Array.from(binString, (m) => m.codePointAt(0));
        return new TextDecoder('utf-8', { fatal: false }).decode(bytes);
      } catch (e) {
        try {
          return atob(str);
        } catch (err) {
          return str;
        }
      }
    }

    async function openEpgModal() {
      const modal = document.getElementById('epgModal');
      const container = document.getElementById('epgContainer');
      container.innerHTML = '<p class="text-xs text-purple-300/70 text-center py-8">Carregando guia de programação...</p>';
      modal.classList.remove('hidden');

      if (!activeLiveChannel || !activeLiveChannel.stream_id) {
        container.innerHTML = '<p class="text-xs text-purple-300/70 text-center py-8">Nenhum canal ao vivo selecionado no momento.</p>';
        return;
      }

      const xcCreds = resolveUserCredentials(currentUser);
      if (xcCreds.isXc) {
        const cleanServer = xcCreds.server.replace(/\/+$/, '');
        const epgUrl = `${cleanServer}/player_api.php?username=${encodeURIComponent(xcCreds.user)}&password=${encodeURIComponent(xcCreds.pass)}&action=get_short_epg&stream_id=${activeLiveChannel.stream_id}`;
        try {
          const res = await smartFetch(epgUrl);
          const data = await res.json();
          if (data && data.epg_listings && data.epg_listings.length > 0) {
            container.innerHTML = '';
            data.epg_listings.forEach(epg => {
              const title = decodeEpgText(epg.title || '');
              const start = epg.start || '';
              const end = epg.end || '';
              const desc = decodeEpgText(epg.description || '');

              const card = document.createElement('div');
              card.className = "p-3 bg-[#180f29] border border-purple-900/40 rounded-xl space-y-1";
              card.innerHTML = `
                <div class="flex items-center justify-between">
                  <span class="text-xs font-bold text-white">${title || 'Programa ao vivo'}</span>
                  <span class="text-[10px] text-purple-400 font-mono">${start.substring(11, 16)} - ${end.substring(11, 16)}</span>
                </div>
                ${desc ? `<p class="text-[11px] text-slate-300 leading-tight">${desc}</p>` : ''}
              `;
              container.appendChild(card);
            });
          } else {
            container.innerHTML = '<p class="text-xs text-purple-300/70 text-center py-8">Sinopse não disponível.</p>';
          }
        } catch (e) {
          container.innerHTML = '<p class="text-xs text-rose-400 text-center py-8">Erro ao carregar a programação do EPG.</p>';
        }
      } else {
        container.innerHTML = '<p class="text-xs text-purple-300/70 text-center py-8">Guia EPG disponível apenas via Xtream Codes.</p>';
      }
      lucide.createIcons();
    }

    function closeEpgModal() {
      document.getElementById('epgModal').classList.add('hidden');
    }

    function playLiveChannel(channel) {
      if (!profileAllowsMedia(channel)) return;
      activeLiveChannel = channel;

      if (window.innerWidth < 1024) {
        openVodPlayer(channel);
        return;
      }

      document.getElementById('noStreamAlertLive').classList.add('hidden');
      document.getElementById('liveCurrentName').innerText = channel.name;
      document.getElementById('liveCurrentGroup').innerText = channel.group;

      const logoContainer = document.getElementById('liveCurrentLogo');
      const fallbackBarHtml = channel.isAdult
        ? `<div class="w-full h-full bg-rose-950/60 flex flex-col items-center justify-center text-rose-400 font-bold text-[9px]"><i data-lucide="lock" class="w-3.5 h-3.5"></i><span>+18</span></div>`
        : `<i data-lucide="tv" class="w-5 h-5"></i>`;

      logoContainer.innerHTML = channel.logo 
        ? `<img src="${channel.logo}" class="w-full h-full object-contain" onerror="this.outerHTML='${fallbackBarHtml}'; lucide.createIcons();"/>`
        : fallbackBarHtml;

      const video = document.getElementById('videoPlayerLive');

      if (hlsLiveInstance) hlsLiveInstance.destroy();

      if (Hls.isSupported() && channel.url.includes('.m3u8')) {
        hlsLiveInstance = new Hls({ enableWorker: true });
        hlsLiveInstance.loadSource(channel.url);
        hlsLiveInstance.attachMedia(video);
        hlsLiveInstance.on(Hls.Events.MANIFEST_PARSED, () => video.play().catch(() => {}));
      } else {
        video.src = channel.url;
        video.play().catch(() => {});
      }

      appendMoreItems();
    }

    function formatVodTime(seconds) {
      if (!Number.isFinite(seconds) || seconds < 0) return '0:00';
      const hours = Math.floor(seconds / 3600);
      const minutes = Math.floor((seconds % 3600) / 60);
      const secs = Math.floor(seconds % 60).toString().padStart(2, '0');
      return hours ? `${hours}:${String(minutes).padStart(2, '0')}:${secs}` : `${minutes}:${secs}`;
    }

    function updateVodControls() {
      const video = document.getElementById('videoPlayerVod');
      const progress = document.getElementById('vodProgress');
      const time = document.getElementById('vodTimeDisplay');
      const playIcon = document.getElementById('vodPlayIcon');
      const volumeIcon = document.getElementById('vodVolumeIcon');
      const volume = document.getElementById('vodVolume');
      if (!video) return;

      const hasDuration = Number.isFinite(video.duration) && video.duration > 0;
      if (progress) {
        progress.max = hasDuration ? video.duration : 0;
        progress.value = hasDuration ? Math.min(video.currentTime, video.duration) : 0;
        progress.style.setProperty('--vod-progress-percent', hasDuration ? `${(video.currentTime / video.duration) * 100}%` : '0%');
        progress.disabled = !hasDuration || currentPlayingVodItem?.type === 'live';
        progress.classList.toggle('opacity-40', progress.disabled);
      }
      if (time) time.textContent = currentPlayingVodItem?.type === 'live' ? 'AO VIVO' : `${formatVodTime(video.currentTime)} / ${formatVodTime(video.duration)}`;
      if (playIcon) playIcon.setAttribute('data-lucide', video.paused ? 'play' : 'pause');
      if (volumeIcon) volumeIcon.setAttribute('data-lucide', video.muted || video.volume === 0 ? 'volume-x' : (video.volume < 0.5 ? 'volume-1' : 'volume-2'));
      if (volume && document.activeElement !== volume) volume.value = video.muted ? 0 : video.volume;
      lucide.createIcons();
    }

    function showVodLoading() {
      const overlay = document.getElementById('vodLoadingOverlay');
      const text = document.getElementById('vodLoadingText');
      if (!overlay) return;
      if (vodLoadingTimer) clearTimeout(vodLoadingTimer);
      vodLoadingStartedAt = Date.now();
      if (text) text.textContent = 'Preparando sua sessão...';
      overlay.classList.remove('hidden', 'opacity-0', 'pointer-events-none');
    }

    function hideVodLoading() {
      const overlay = document.getElementById('vodLoadingOverlay');
      if (!overlay) return;
      if (vodLoadingTimer) clearTimeout(vodLoadingTimer);
      const remainingTime = Math.max(0, 2000 - (Date.now() - vodLoadingStartedAt));
      vodLoadingTimer = setTimeout(() => {
        overlay.classList.add('opacity-0', 'pointer-events-none');
        vodLoadingTimer = setTimeout(() => overlay.classList.add('hidden'), 500);
      }, remainingTime);
    }

    function resetVodLoading() {
      const overlay = document.getElementById('vodLoadingOverlay');
      if (vodLoadingTimer) clearTimeout(vodLoadingTimer);
      if (overlay) overlay.classList.add('hidden', 'opacity-0', 'pointer-events-none');
    }

    function showVodControls() {
      const controls = document.getElementById('vodCustomControls');
      if (!controls) return;
      controls.classList.remove('opacity-0', 'translate-y-3', 'pointer-events-none');
      if (vodControlsTimer) clearTimeout(vodControlsTimer);
      if (!currentPlayingVodItem || document.querySelector('#vodAudioMenu:not(.hidden), #vodSubtitleMenu:not(.hidden), #vodSpeedMenu:not(.hidden)')) return;
      vodControlsTimer = setTimeout(() => {
        const video = document.getElementById('videoPlayerVod');
        if (video && !video.paused) controls.classList.add('opacity-0', 'translate-y-3', 'pointer-events-none');
      }, 3500);
    }

    function setupVodPlayerControls() {
      const container = document.getElementById('playerVideoContainer');
      const video = document.getElementById('videoPlayerVod');
      if (!container || !video) return;
      ['mousemove', 'touchstart'].forEach(eventName => container.addEventListener(eventName, showVodControls, { passive: true }));
      video.addEventListener('click', toggleVodPlayback);
      ['play', 'pause', 'timeupdate', 'durationchange', 'volumechange', 'loadedmetadata'].forEach(eventName => video.addEventListener(eventName, updateVodControls));
      video.addEventListener('loadedmetadata', refreshVodTrackControls);
      document.addEventListener('keydown', handleVodKeyboardShortcut);
    }

    function handleVodKeyboardShortcut(event) {
      const modal = document.getElementById('vodPlayerModal');
      if (!modal || modal.classList.contains('hidden') || event.altKey || event.ctrlKey || event.metaKey) return;
      if (event.target?.matches?.('input, select, textarea, button')) return;

      const shortcuts = {
        ' ': toggleVodPlayback,
        ArrowLeft: () => seekVodBy(-10),
        ArrowRight: () => seekVodBy(10),
        m: toggleVodMute,
        M: toggleVodMute,
        f: togglePlayerFullscreen,
        F: togglePlayerFullscreen
      };
      const action = shortcuts[event.key];
      if (!action) return;
      event.preventDefault();
      action();
    }

    function toggleVodPlayback() {
      const video = document.getElementById('videoPlayerVod');
      if (!video) return;
      if (video.paused) video.play().catch(() => {});
      else video.pause();
      showVodControls();
    }

    function seekVodBy(seconds) {
      const video = document.getElementById('videoPlayerVod');
      if (!video || !Number.isFinite(video.duration) || currentPlayingVodItem?.type === 'live') return;
      video.currentTime = Math.max(0, Math.min(video.duration, video.currentTime + seconds));
      showVodControls();
    }

    function seekVodPlayer(value) {
      const video = document.getElementById('videoPlayerVod');
      if (video && Number.isFinite(video.duration)) video.currentTime = Number(value);
      showVodControls();
    }

    function setVodVolume(value) {
      const video = document.getElementById('videoPlayerVod');
      if (!video) return;
      video.volume = Number(value);
      video.muted = video.volume === 0;
      showVodControls();
    }

    function toggleVodMute() {
      const video = document.getElementById('videoPlayerVod');
      if (!video) return;
      video.muted = !video.muted;
      showVodControls();
    }

    function toggleVodSpeedMenu() {
      const menu = document.getElementById('vodSpeedMenu');
      if (!menu) return;
      document.getElementById('vodAudioMenu')?.classList.add('hidden');
      document.getElementById('vodSubtitleMenu')?.classList.add('hidden');
      menu.classList.toggle('hidden');
      if (!menu.classList.contains('hidden')) renderVodSpeedMenu();
      showVodControls();
      lucide.createIcons();
    }

    function renderVodSpeedMenu() {
      const video = document.getElementById('videoPlayerVod');
      const menu = document.getElementById('vodSpeedMenu');
      if (!video || !menu) return;
      const speeds = [0.5, 0.75, 1, 1.25, 1.5, 2];
      menu.innerHTML = `<p class="px-2 pb-1 pt-0.5 text-[10px] font-bold uppercase tracking-wider text-purple-400">Velocidade</p>${speeds.map(speed => `<button onclick="setVodPlaybackRate(${speed})" class="mt-1 flex w-full items-center justify-between rounded-xl px-3 py-2 text-left text-xs ${video.playbackRate === speed ? 'bg-purple-600 text-white' : 'text-purple-200 hover:bg-purple-900/60'}"><span>${String(speed).replace('.', ',')}x</span>${video.playbackRate === speed ? '<i data-lucide="check" class="h-3.5 w-3.5 shrink-0"></i>' : ''}</button>`).join('')}`;
      lucide.createIcons();
    }

    function setVodPlaybackRate(rate) {
      const video = document.getElementById('videoPlayerVod');
      if (!video) return;
      video.playbackRate = rate;
      const label = document.getElementById('vodSpeedLabel');
      if (label) label.textContent = `${String(rate).replace('.', ',')}x`;
      document.getElementById('vodSpeedMenu')?.classList.add('hidden');
      showVodControls();
    }

    async function toggleVodPictureInPicture() {
      const video = document.getElementById('videoPlayerVod');
      if (!video || !document.pictureInPictureEnabled) return;
      try {
        if (document.pictureInPictureElement) await document.exitPictureInPicture();
        else await video.requestPictureInPicture();
      } catch (error) {
        console.warn('Picture in Picture não está disponível para este vídeo:', error);
      }
      showVodControls();
    }

    async function downloadVod() {
      const item = currentPlayingVodItem;
      if (!item?.url) return;
      if (item.url.toLowerCase().includes('.m3u8')) {
        alert('Este VOD usa transmissão HLS. O download direto não é suportado pela lista, mas continua disponível para arquivos de vídeo diretos.');
        return;
      }
      const fileName = `${(item.name || 'lux-play-vod').replace(/[\\/:*?"<>|]/g, '_')}.mp4`;
      if (!window.luxElectron?.downloadVod) {
        alert('O download direto está disponível no aplicativo Lux Play.');
        return;
      }
      const result = await window.luxElectron.downloadVod({ url: item.url, fileName });
      if (!result?.ok) alert(result?.message || 'Não foi possível iniciar o download.');
    }

    function playRelativeEpisode(direction) {
      const item = currentPlayingVodItem;
      if (!item || item.type !== 'series' || !Array.isArray(item.episodeList)) return;
      const index = Number(item.episodeIndex) + direction;
      if (index < 0 || index >= item.episodeList.length) return;
      const episode = item.episodeList[index];
      openVodPlayer(buildSeriesEpisodeItem({ series_id: item.series_id, name: item.seriesName || 'Série', logo: item.logo || '', group: item.group || '' }, item.seasonNum, episode, index, item.episodeList));
    }

    function getVodTrackLabel(track, fallback) {
      return track?.name || track?.label || track?.lang || track?.language || fallback;
    }

    function getNativeAudioTracks(video) {
      try { return video?.audioTracks ? Array.from(video.audioTracks) : []; } catch (_) { return []; }
    }

    function refreshVodTrackControls() {
      const video = document.getElementById('videoPlayerVod');
      const audioButton = document.getElementById('vodAudioButton');
      const subtitleButton = document.getElementById('vodSubtitleButton');
      if (!video || !audioButton || !subtitleButton) return;
      const audioTracks = hlsVodInstance?.audioTracks || getNativeAudioTracks(video);
      const subtitleTracks = hlsVodInstance?.subtitleTracks || Array.from(video.textTracks || []);
      audioButton.classList.toggle('hidden', audioTracks.length < 2);
      subtitleButton.classList.toggle('hidden', subtitleTracks.length === 0);
      renderVodTrackMenu('audio');
      renderVodTrackMenu('subtitle');
      lucide.createIcons();
    }

    function renderVodTrackMenu(type) {
      const video = document.getElementById('videoPlayerVod');
      const menu = document.getElementById(type === 'audio' ? 'vodAudioMenu' : 'vodSubtitleMenu');
      if (!video || !menu) return;
      const tracks = type === 'audio' ? (hlsVodInstance?.audioTracks || getNativeAudioTracks(video)) : (hlsVodInstance?.subtitleTracks || Array.from(video.textTracks || []));
      const selected = type === 'audio' ? (hlsVodInstance ? hlsVodInstance.audioTrack : getNativeAudioTracks(video).findIndex(track => track.enabled)) : (hlsVodInstance ? hlsVodInstance.subtitleTrack : Array.from(video.textTracks || []).findIndex(track => track.mode === 'showing'));
      const options = type === 'subtitle' ? [{ label: 'Sem legendas', index: -1 }, ...tracks.map((track, index) => ({ label: getVodTrackLabel(track, `Legenda ${index + 1}`), index }))] : tracks.map((track, index) => ({ label: getVodTrackLabel(track, `Áudio ${index + 1}`), index }));
      menu.innerHTML = `<p class="px-2 pb-1 pt-0.5 text-[10px] font-bold uppercase tracking-wider text-purple-400">${type === 'audio' ? 'Idioma do áudio' : 'Legendas'}</p>${options.map(option => `<button onclick="selectVodTrack('${type}', ${option.index})" class="mt-1 flex w-full items-center justify-between rounded-xl px-3 py-2 text-left text-xs ${option.index === selected ? 'bg-purple-600 text-white' : 'text-purple-200 hover:bg-purple-900/60'}"><span class="truncate">${escapeGameHtml(option.label)}</span>${option.index === selected ? '<i data-lucide="check" class="h-3.5 w-3.5 shrink-0"></i>' : ''}</button>`).join('')}`;
    }

    function togglePlayerTrackMenu(type) {
      const menu = document.getElementById(type === 'audio' ? 'vodAudioMenu' : 'vodSubtitleMenu');
      const other = document.getElementById(type === 'audio' ? 'vodSubtitleMenu' : 'vodAudioMenu');
      if (!menu) return;
      other?.classList.add('hidden');
      document.getElementById('vodSpeedMenu')?.classList.add('hidden');
      menu.classList.toggle('hidden');
      if (!menu.classList.contains('hidden')) renderVodTrackMenu(type);
      showVodControls();
      lucide.createIcons();
    }

    function selectVodTrack(type, index) {
      const video = document.getElementById('videoPlayerVod');
      if (!video) return;
      if (type === 'audio') {
        if (hlsVodInstance) hlsVodInstance.audioTrack = index;
        else getNativeAudioTracks(video).forEach((track, trackIndex) => { track.enabled = trackIndex === index; });
      } else if (hlsVodInstance) {
        hlsVodInstance.subtitleTrack = index;
      } else {
        Array.from(video.textTracks || []).forEach((track, trackIndex) => { track.mode = trackIndex === index ? 'showing' : 'disabled'; });
      }
      document.getElementById(type === 'audio' ? 'vodAudioMenu' : 'vodSubtitleMenu')?.classList.add('hidden');
      refreshVodTrackControls();
      showVodControls();
    }

    function openVodPlayer(item) {
      if (!profileAllowsMedia(item)) return;
      cancelNextEpisode();

      currentPlayingVodItem = item;
      lastSavedTime = 0;
      showVodLoading();

      const liveVideo = document.getElementById('videoPlayerLive');
      if (liveVideo) liveVideo.pause();

      document.getElementById('vodPlayerTitle').innerText = item.name;
      document.getElementById('vodPlayerType').innerText = item.type === 'live' ? 'AO VIVO' : (item.type === 'movies' ? 'FILME' : 'EPISÓDIO');
      document.getElementById('vodPlayerModal').classList.remove('hidden');
      document.getElementById('vodPreviousEpisode')?.classList.toggle('hidden', item.type !== 'series' || !item.episodeIndex);
      document.getElementById('vodNextEpisode')?.classList.toggle('hidden', item.type !== 'series' || !item.episodeList || item.episodeIndex >= item.episodeList.length - 1);
      document.getElementById('vodAudioButton')?.classList.add('hidden');
      document.getElementById('vodSubtitleButton')?.classList.add('hidden');
      document.getElementById('vodAudioMenu')?.classList.add('hidden');
      document.getElementById('vodSubtitleMenu')?.classList.add('hidden');
      document.getElementById('vodSpeedMenu')?.classList.add('hidden');
      showVodControls();

      const video = document.getElementById('videoPlayerVod');
      if (hlsVodInstance) hlsVodInstance.destroy();
      hlsVodInstance = null;

      let finalStreamUrl = item.url;

      const resumeKey = getResumeKey(item);
      const savedTime = item.type !== 'live' ? userProgressStorage.getItem(resumeKey) : null;
      
      if (item.type !== 'live') {
        if (item.type === 'series') {
          saveSeriesResumeState(item, savedTime);
        } else {
          saveResumeMetadata(item);
        }
        if (!savedTime) {
          userProgressStorage.setItem(resumeKey, '1');
        }
      }

      const onVideoReady = () => {
        if (savedTime && parseFloat(savedTime) > 10) {
          video.currentTime = parseFloat(savedTime);
        }
        video.play().catch(() => {});
        hideVodLoading();
        refreshVodTrackControls();
        updateVodControls();
      };

      if (Hls.isSupported() && (finalStreamUrl.includes('.m3u8') || item.type === 'live')) {
        hlsVodInstance = new Hls({ enableWorker: true, renderTextTracksNatively: true });
        hlsVodInstance.loadSource(finalStreamUrl);
        hlsVodInstance.attachMedia(video);
        hlsVodInstance.on(Hls.Events.MANIFEST_PARSED, onVideoReady);
        hlsVodInstance.on(Hls.Events.AUDIO_TRACKS_UPDATED, refreshVodTrackControls);
        hlsVodInstance.on(Hls.Events.SUBTITLE_TRACKS_UPDATED, refreshVodTrackControls);
      } else {
        video.src = finalStreamUrl;
        video.onloadedmetadata = onVideoReady;
      }

      video.onerror = () => {
        const text = document.getElementById('vodLoadingText');
        if (text) text.textContent = 'Não foi possível carregar este vídeo.';
      };

      video.ontimeupdate = () => {
        if (item.type !== 'live' && video.currentTime > 1) {
          if (Math.abs(video.currentTime - lastSavedTime) >= 5) {
            lastSavedTime = video.currentTime;
            userProgressStorage.setItem(resumeKey, video.currentTime);
            if (item.type === 'series') {
              saveSeriesResumeState(item, video.currentTime);
            } else {
              try {
                const metaRaw = userProgressStorage.getItem(getResumeMetaKey(resumeKey));
                if (metaRaw) {
                  const meta = JSON.parse(metaRaw);
                  meta.updatedAt = Date.now();
                  userProgressStorage.setItem(getResumeMetaKey(resumeKey), JSON.stringify(meta));
                  markCloudRecord(`resume:${resumeKey}`, { progress: video.currentTime, meta });
                } else {
                  saveResumeMetadata(item);
                }
              } catch (e) {}
            }
          }
        }
      };

      video.onended = () => {
        if (item.type !== 'live') {
          removeResumeData(resumeKey);
        }

        if (item.type === 'series' && item.episodeList && typeof item.episodeIndex === 'number') {
          const nextIndex = item.episodeIndex + 1;
          if (nextIndex < item.episodeList.length) {
            const nextEp = item.episodeList[nextIndex];
            const nextItem = buildSeriesEpisodeItem({
              series_id: item.series_id,
              name: item.seriesName || 'Série',
              logo: item.logo || '',
              group: item.group || ''
            }, item.seasonNum, nextEp, nextIndex, item.episodeList);

            userProgressStorage.setItem(getResumeKey(nextItem), '0');
            saveSeriesResumeState(nextItem, 0);

            showNextEpisodeOverlay(nextItem);
          } else {
            removeSeriesResumeState(item);
          }
        } else if (item.type === 'series') {
          removeSeriesResumeState(item);
        }

        refreshResumeUI();
      };

      lucide.createIcons();
    }

    function showNextEpisodeOverlay(nextItem) {
      pendingNextEpisodeItem = nextItem;
      const overlay = document.getElementById('nextEpOverlay');
      const seriesNameEl = document.getElementById('nextEpSeriesName');
      const titleEl = document.getElementById('nextEpTitle');
      const progressBar = document.getElementById('nextEpProgressBar');

      if (!overlay) return;

      seriesNameEl.innerText = nextItem.seriesName || 'Série';
      titleEl.innerText = nextItem.name.replace(/^.*? - /, '');
      overlay.classList.remove('hidden');

      progressBar.style.transition = 'none';
      progressBar.style.width = '100%';
      setTimeout(() => {
        progressBar.style.transition = 'width 4s linear';
        progressBar.style.width = '0%';
      }, 50);

      if (nextEpisodeTimer) clearTimeout(nextEpisodeTimer);

      nextEpisodeTimer = setTimeout(() => {
        playNextEpisodeNow();
      }, 4000);
    }

    function cancelNextEpisode() {
      if (nextEpisodeTimer) clearTimeout(nextEpisodeTimer);
      const overlay = document.getElementById('nextEpOverlay');
      if (overlay) overlay.classList.add('hidden');
      pendingNextEpisodeItem = null;
    }

    function playNextEpisodeNow() {
      if (nextEpisodeTimer) clearTimeout(nextEpisodeTimer);
      const overlay = document.getElementById('nextEpOverlay');
      if (overlay) overlay.classList.add('hidden');

      if (pendingNextEpisodeItem) {
        const itemToPlay = pendingNextEpisodeItem;
        pendingNextEpisodeItem = null;
        openVodPlayer(itemToPlay);
      }
    }

    function closeVodPlayer() {
      cancelNextEpisode();
      const video = document.getElementById('videoPlayerVod');
      
      if (currentPlayingVodItem && video && video.currentTime > 1) {
        const resumeKey = getResumeKey(currentPlayingVodItem);
        userProgressStorage.setItem(resumeKey, video.currentTime);
        if (currentPlayingVodItem.type === 'series') {
          saveSeriesResumeState(currentPlayingVodItem, video.currentTime);
        } else {
          saveResumeMetadata(currentPlayingVodItem);
        }
      }

      video.ontimeupdate = null;
      video.onended = null;
      video.onloadedmetadata = null;
      video.pause();
      video.src = '';
      if (hlsVodInstance) hlsVodInstance.destroy();
      hlsVodInstance = null;
      if (vodControlsTimer) clearTimeout(vodControlsTimer);
      document.getElementById('vodAudioMenu')?.classList.add('hidden');
      document.getElementById('vodSubtitleMenu')?.classList.add('hidden');
      document.getElementById('vodSpeedMenu')?.classList.add('hidden');
      resetVodLoading();
      currentPlayingVodItem = null;
      document.getElementById('vodPlayerModal').classList.add('hidden');
      refreshResumeUI();
    }

    function togglePlayerFullscreen() {
      const playerElem = document.getElementById('vodPlayerModal');
      const video = document.getElementById('videoPlayerVod');

      if (!document.fullscreenElement) {
        if (playerElem.requestFullscreen) {
          playerElem.requestFullscreen().catch(() => video.requestFullscreen());
        } else if (video.webkitEnterFullscreen) {
          video.webkitEnterFullscreen();
        }
      } else {
        if (document.exitFullscreen) document.exitFullscreen();
      }
    }

    function requireAdultPin(onSuccess) {
      if (isChildProfile()) return;
      if (isAdultUnlocked) {
        onSuccess();
        return;
      }
      pendingUnlockAction = onSuccess;
      document.getElementById('adultPinInput').value = '';
      document.getElementById('adultPinError').classList.add('hidden');
      document.getElementById('adultPinModal').classList.remove('hidden');
      document.getElementById('adultPinInput').focus();
    }

    function verifyAdultPin() {
      if (isChildProfile()) return;
      const entered = document.getElementById('adultPinInput').value.trim();
      const correctPin = (currentUser && currentUser.adultPin) ? currentUser.adultPin : '0000';

      if (entered === correctPin) {
        isAdultUnlocked = true;
        closeAdultPinModal();
        if (pendingUnlockAction) pendingUnlockAction();
      } else {
        document.getElementById('adultPinError').classList.remove('hidden');
      }
    }

    function closeAdultPinModal() {
      document.getElementById('adultPinModal').classList.add('hidden');
      pendingUnlockAction = null;
    }

    function toggleConfigModal() {
      document.getElementById('configModal').classList.toggle('hidden');
    }

    function setConnectionTab(tab) {
      activeConnectionTab = tab;
      if (tab === 'xc') {
        document.getElementById('formXc').classList.remove('hidden');
        document.getElementById('formM3u').classList.add('hidden');
        document.getElementById('tabXc').className = 'flex-1 py-1.5 text-xs font-bold bg-purple-600 text-white rounded-lg transition-all';
        document.getElementById('tabM3u').className = 'flex-1 py-1.5 text-xs font-bold text-purple-300 rounded-lg transition-all';
      } else {
        document.getElementById('formM3u').classList.remove('hidden');
        document.getElementById('formXc').classList.add('hidden');
        document.getElementById('tabM3u').className = 'flex-1 py-1.5 text-xs font-bold bg-purple-600 text-white rounded-lg transition-all';
        document.getElementById('tabXc').className = 'flex-1 py-1.5 text-xs font-bold text-purple-300 rounded-lg transition-all';
      }
    }

    function saveManualConnection() {
      let finalUrl = '';

      if (activeConnectionTab === 'xc') {
        const server = document.getElementById('manualXcServer').value.trim();
        const user = document.getElementById('manualXcUser').value.trim();
        const pass = document.getElementById('manualXcPass').value.trim();

        if (!server || !user || !pass) {
          alert('Preencha Servidor, Usuário e Senha do Xtream Codes.');
          return;
        }

        const cleanServer = server.replace(/\/+$/, '');
        finalUrl = `${cleanServer}/get.php?username=${encodeURIComponent(user)}&password=${encodeURIComponent(pass)}&type=m3u_plus&output=m3u8`;
      } else {
        finalUrl = document.getElementById('manualM3uInput').value.trim();
        if (!finalUrl) {
          alert('Insira a URL da lista M3U.');
          return;
        }
      }

      toggleConfigModal();
      loadPlaylist(finalUrl);
    }

    let gamesConsoleFilter = 'all';
    let gamesStatusFilter = 'all';
    let gamesFavoritesOnly = false;
    let gamesOriginFilter = 'all';
    function setGamesFilter(type, value) {
      if (type === 'console') gamesConsoleFilter = value;
      else if (type === 'status') gamesStatusFilter = value;
      else if (type === 'origin') gamesOriginFilter = value;
      else gamesFavoritesOnly = !gamesFavoritesOnly;
      renderGamesCatalog();
    }

    function gameMatchesSearch(game) {
      const normalizedQuery = normalizeSearchText(activeSearchQuery);
      if (!normalizedQuery) return true;
      const searchItem = { name: [game.name, game.console, game.sourceFileName, game.source === 'external' ? 'rom externa local dispositivo' : 'lux'].filter(Boolean).join(' ') };
      return getSearchScore(getCachedSearchData(searchItem), normalizedQuery.split(' '), normalizedQuery) >= 0;
    }

    function togglePublicCoreStatusPanel() {
      const content = document.getElementById('gameCoreStatusContent');
      const label = document.getElementById('gameCoreStatusToggleLabel');
      if (!content) return;
      const isHidden = content.classList.toggle('hidden');
      if (label) label.textContent = isHidden ? 'Mostrar cores' : 'Ocultar cores';
    }
    function openGameCard(id) {
      const gameId = String(id);
      if (gameId.startsWith('external_')) { window.openExternalGame?.(gameId); return; }
      openGameEmulatorById(gameId);
    }
    async function renderGamesCatalog() {
      const container = document.getElementById('gamesSection');
      if (!container) return;

      container.innerHTML = `<div class="flex flex-1 flex-col items-center justify-center gap-3 text-center">
        <div class="flex h-12 w-12 items-center justify-center rounded-2xl border border-purple-500/30 bg-purple-600/10">
          <div class="h-5 w-5 animate-spin rounded-full border-2 border-purple-300/30 border-t-purple-300"></div>
        </div>
        <div>
          <p class="text-sm font-bold text-purple-200">Carregando catálogo de jogos</p>
          <p class="mt-1 text-xs text-purple-400/70">Preparando sua biblioteca retro...</p>
        </div>
      </div>`;
      let gamesList = [];
      try {
        const records = await loadGamesCatalog();
        const luxGames = records.map(game => ({
          id: game.id, name: game.title || 'Sem título', console: game.console || 'snes',
          players: Math.max(1, Number(game.players) || 1), coop: game.coop,
          url: game.rom_url || gameStorageUrl(game.rom_path), logo: game.cover_url || gameStorageUrl(game.cover_path),
          status: game.status || 'pending', sourceFileName: game.source_file_name || '', source: 'lux'
        }));
        const externalGames = (await window.LuxExternalRoms?.list?.() || []).map(game => ({ ...game, source: 'external', status: 'external', players: Math.max(1, Number(game.players) || 1) }));
        gamesList = [...luxGames, ...externalGames].filter(game =>
          (gamesOriginFilter === 'all' || game.source === gamesOriginFilter) &&
          (gamesConsoleFilter === 'all' || game.console === gamesConsoleFilter) &&
          (gamesStatusFilter === 'all' || game.status === gamesStatusFilter) &&
          (!gamesFavoritesOnly || (game.source === 'lux' && isGameFavorite(game))) && gameMatchesSearch(game)
        );
      } catch (error) {
        console.error('Erro ao carregar jogos:', error);
        container.innerHTML = `<p class="text-xs text-rose-400 p-6">Não foi possível carregar os jogos: ${escapeGameHtml(error.message || 'erro desconhecido')}</p>`;
        return;
      }

      let html = `
        <div class="p-6 md:p-8 overflow-y-auto h-full">
          <div class="flex items-center justify-between mb-6">
            <div>
              <h2 class="text-white font-bold text-lg md:text-xl">Central Retro & Emuladores</h2>
              <p class="text-xs text-purple-400/70 mt-0.5">Jogue clássicos direto no navegador</p>
            </div>
            <div class="flex flex-wrap justify-end gap-2">
              <select onchange="setGamesFilter('console', this.value)" class="bg-[#120c1f] border border-purple-900/60 rounded-lg px-2 py-1.5 text-[11px] text-purple-200"><option value="all">🎮 Todos</option><option value="gba">🟣 GBA</option><option value="gb">🟡 GB</option><option value="gbc">🎨 GBC</option><option value="snes">🕹️ SNES</option><option value="megadrive">🔵 Mega Drive</option><option value="nes">🔴 NES</option><option value="mastersystem">🟠 Master System</option><option value="n64">🟢 N64</option><option value="psp">🔴 PSP</option></select><select onchange="setGamesFilter('origin', this.value)" class="bg-[#120c1f] border border-purple-900/60 rounded-lg px-2 py-1.5 text-[11px] text-purple-200"><option value="all">📚 Todos os jogos</option><option value="lux">⭐ Catálogo Lux</option><option value="external">📁 ROMs do dispositivo</option></select><button onclick="document.getElementById('externalRomInput').click()" class="w-full sm:w-auto bg-purple-600 hover:bg-purple-500 rounded-lg px-3 py-2 text-[11px] font-bold text-white transition-colors">Abrir ROM</button><input id="externalRomInput" type="file" accept=".gb,.gbc,.gba,.nes,.sfc,.smc,.sms,.md,.gen,.n64,.z64,.v64,.iso,.cso,.pbp" class="hidden" onchange="importExternalRom(this.files[0]); this.value=''">
              <button onclick="setGamesFilter('favorites')" aria-pressed="${gamesFavoritesOnly}" class="${gamesFavoritesOnly ? 'bg-rose-500/20 border-rose-400/60 text-rose-200' : 'bg-[#120c1f] border-purple-900/60 text-purple-200 hover:border-rose-400/60'} border rounded-lg px-2.5 py-1.5 text-[11px] font-bold transition-colors flex items-center gap-1"><i data-lucide="heart" class="w-3.5 h-3.5 ${gamesFavoritesOnly ? 'fill-current' : ''}"></i> Favoritos</button>
              ${currentUser?.role === 'admin' ? `<button onclick="reviewUnapprovedGames()" class="bg-rose-950/60 hover:bg-rose-900/80 border border-rose-800/60 rounded-lg px-2 py-1.5 text-[11px] font-bold text-rose-200 transition-colors">Revisar não aprovados</button><select onchange="setGamesFilter('status', this.value)" class="bg-[#120c1f] border border-purple-900/60 rounded-lg px-2 py-1.5 text-[11px] text-purple-200"><option value="all">Status: todos</option><option value="approved">✓ Aprovados</option><option value="pending">◷ Pendentes</option></select>` : ''}
            </div>
          </div>
          <div class="mb-5 rounded-2xl border border-purple-900/50 bg-purple-950/20 p-4">
            <div class="flex flex-wrap items-center justify-between gap-3">
              <div><p class="text-[11px] font-bold uppercase tracking-wide text-purple-400">Cores do emulador</p><p class="mt-1 text-[10px] text-purple-300/70">As bolinhas indicam o teste do core, não o status do jogo.</p></div>
              <button type="button" onclick="togglePublicCoreStatusPanel()" class="rounded-lg border border-purple-800/60 bg-[#120c1f] px-3 py-1.5 text-[10px] font-bold text-purple-200 hover:bg-purple-900/70"><span id="gameCoreStatusToggleLabel">Mostrar cores</span></button>
            </div>
            <div id="gameCoreStatusContent" class="mt-3 hidden">
              <div id="gameCoreStatusList" class="flex flex-wrap gap-2 text-[10px] font-bold text-purple-200"></div>
              <p id="externalRomStatus" class="mt-2 text-[10px] text-purple-400/80"></p>
            </div>
          </div>
          ${activeSearchQuery ? `<div class="mb-6 border-t border-purple-900/50 pt-5 flex flex-wrap items-center gap-3"><h3 class="text-xl font-extrabold text-white">Resultados para: <span class="text-purple-400">&quot;${escapeGameHtml(activeSearchQuery)}&quot;</span></h3><button onclick="clearSearchFilter()" class="bg-purple-950 hover:bg-rose-600 text-purple-200 hover:text-white px-3 py-1.5 rounded-xl text-xs font-bold transition-all flex items-center gap-1.5"><i data-lucide="x" class="w-3.5 h-3.5"></i> Limpar busca</button></div>` : ''}
          <div class="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 xl:grid-cols-7 gap-4">
      `;

      if (gamesList.length === 0) {
        html += '<div class="col-span-full py-16 text-center text-purple-400/70"><i data-lucide="gamepad-2" class="w-10 h-10 mx-auto mb-3 text-purple-700"></i><p class="text-sm font-medium text-purple-300">Nenhum jogo publicado ainda.</p><p class="text-xs mt-1">Use o painel Admin para enviar uma ROM e publicá-la.</p></div>';
      }
      gamesList.forEach(game => {
        html += `
          <div onclick="openGameCard('${escapeGameHtml(game.id)}')" 
               class="flex flex-col bg-[#120c1f] rounded-2xl border ${currentUser?.role === 'admin' ? (game.status === 'approved' ? 'border-emerald-500/70' : 'border-rose-500/70') : 'border-purple-950/80'} hover:border-purple-500/70 overflow-hidden cursor-pointer group transition-all duration-300 hover:-translate-y-1.5 shadow-lg">
            <div class="w-full aspect-[2/3] bg-purple-950/40 flex items-center justify-center relative overflow-hidden">
              ${game.logo ? `<img src="${escapeGameHtml(game.logo)}" alt="Capa de ${escapeGameHtml(game.name)}" class="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300">` : '<div class="w-12 h-12 rounded-2xl bg-purple-600/20 text-purple-400 flex items-center justify-center group-hover:scale-110 transition-transform"><i data-lucide="gamepad-2" class="w-6 h-6"></i></div>'}
              <span class="absolute top-2 right-2 px-2 py-0.5 rounded text-[9px] font-mono font-bold uppercase bg-purple-900/80 text-purple-200">
                ${game.console}
              </span>
              ${game.source === 'lux' ? `<button onclick="toggleGameFavoriteById('${escapeGameHtml(game.id)}', event)" title="${isGameFavorite(game) ? 'Remover dos favoritos' : 'Adicionar aos favoritos'}" aria-label="${isGameFavorite(game) ? 'Remover dos favoritos' : 'Adicionar aos favoritos'}" aria-pressed="${isGameFavorite(game)}" class="absolute bottom-2 right-2 w-8 h-8 rounded-full bg-[#120c1f]/90 border ${isGameFavorite(game) ? 'border-rose-400/70 text-rose-400' : 'border-purple-700/70 text-purple-200'} hover:bg-rose-500 hover:border-rose-400 hover:text-white flex items-center justify-center transition-all"><i data-lucide="heart" class="w-4 h-4 ${isGameFavorite(game) ? 'fill-current' : ''}"></i></button>` : ''}
              ${currentUser?.role === 'admin' ? `<div class="absolute top-2 left-2 flex gap-1 opacity-0 group-hover:opacity-100 transition-all"><button onclick="adminEditGame('${escapeGameHtml(game.id)}', event)" title="Editar jogo" aria-label="Editar jogo" class="w-7 h-7 rounded-lg bg-[#120c1f]/90 border border-purple-700/70 text-purple-200 hover:bg-purple-600 hover:text-white flex items-center justify-center"><i data-lucide="pencil" class="w-3.5 h-3.5"></i></button><button onclick="adminDeleteGame('${escapeGameHtml(game.id)}', event)" title="Remover jogo e ROM" aria-label="Remover jogo e ROM" class="w-7 h-7 rounded-lg bg-[#120c1f]/90 border border-rose-800/70 text-rose-300 hover:bg-rose-600 hover:text-white flex items-center justify-center"><i data-lucide="trash-2" class="w-3.5 h-3.5"></i></button></div>` : ''}
            </div>
            <div class="p-3 bg-[#120c1f] border-t border-purple-950/40">
              ${gameFeatureBadges(game)}
              <h4 class="text-xs font-bold text-slate-100 truncate group-hover:text-purple-300">${escapeGameHtml(game.name)}</h4>
              <p class="text-[10px] text-purple-400/70 uppercase mt-0.5">Jogar Agora</p>
              ${currentUser?.role === 'admin' ? `<p class="text-[9px] uppercase mt-1 font-bold ${game.status === 'approved' ? 'text-emerald-400' : 'text-rose-400'}">${game.status === 'approved' ? 'Aprovado' : 'Pendente'}</p>` : ''}
            </div>
          </div>
        `;
      });

      html += `</div></div>`;
      container.innerHTML = html;
      renderPublicCoreStatusList();
      syncCoreStatusesFromCloud();
      lucide.createIcons();
    }

    function renderGamesSection() {
      return renderGamesCatalog();
    }

    function gameFeatureBadges(game) {
      const count = Math.max(1, Math.min(8, Math.trunc(Number(game.players) || 1)));
      const playersLabel = count === 1 ? '1 jogador' : `Até ${count} jogadores`;
      const coop = game.coop === true && count > 1;
      return `<div class="game-feature-badges"><span class="game-feature-badge" title="${playersLabel}"><i data-lucide="${count === 1 ? 'user-round' : 'users-round'}" aria-hidden="true"></i>${count === 1 ? '1 jogador' : `1–${count} jogadores`}</span>${coop ? '<span class="game-feature-badge game-feature-coop" title="Modo cooperativo disponível no jogo"><i data-lucide="handshake" aria-hidden="true"></i>Co-op</span>' : ''}</div>`;
    }

    lucide.createIcons();
