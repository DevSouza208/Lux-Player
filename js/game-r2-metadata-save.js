(() => {
  'use strict';

  const VERSION = '20260917-r2-metadata-save1';
  if (window.__luxR2MetadataSaveVersion === VERSION) return;
  window.__luxR2MetadataSaveVersion = VERSION;

  function message(text, error = false) {
    try {
      if (typeof setGameAdminStatus === 'function') setGameAdminStatus(text, error);
    } catch (_) {}
  }

  function blockRomUpload(editing = false) {
    const text = editing
      ? 'A ROM deste jogo já está no R2. Remova qualquer arquivo selecionado e salve apenas os dados do catálogo.'
      : 'ROMs usam somente Cloudflare R2. Envie o arquivo ao bucket luxroms e depois clique em “Ler ROMs do R2”.';
    message(text, true);
    window.alert?.(text);
  }

  async function saveR2GameMetadataOnly(targetStatus = 'approved') {
    if (!currentUser || currentUser.role !== 'admin') {
      window.alert?.('Somente administradores podem editar jogos.');
      return;
    }

    // Novo jogo continua sendo cadastrado exclusivamente pela leitura do R2.
    if (!editingGameId) {
      blockRomUpload(false);
      return;
    }

    const romInput = document.getElementById('gameAdminRom');
    const files = Array.from(romInput?.files || []);
    if (files.length) {
      blockRomUpload(true);
      return;
    }

    const title = document.getElementById('gameAdminTitle')?.value.trim() || '';
    const consoleName = document.getElementById('gameAdminConsole')?.value || '';
    const yearRaw = document.getElementById('gameAdminYear')?.value || '';
    const genresRaw = document.getElementById('gameAdminGenres')?.value || '';
    const coverUrl = document.getElementById('gameAdminCoverUrl')?.value.trim() || null;
    const synopsis = document.getElementById('gameAdminSynopsis')?.value.trim() || null;
    const players = Math.max(1, Number(document.getElementById('gameAdminPlayers')?.value) || 1);
    const coopRaw = document.getElementById('gameAdminCoop')?.value || '';
    const coop = coopRaw === 'yes' ? true : coopRaw === 'no' ? false : null;
    const published = targetStatus === 'approved';

    if (!title || !consoleName) {
      message('Informe o título e o console.', true);
      return;
    }

    const submit = document.getElementById('gameAdminSubmit');
    const draft = document.getElementById('gameAdminDraft');
    if (submit) submit.disabled = true;
    if (draft) draft.disabled = true;

    const gameId = editingGameId;
    const continueReview = Array.isArray(pendingReviewQueue)
      && String(pendingReviewQueue[0]) === String(gameId);

    try {
      const { data: existingGames, error: duplicateQueryError } = await supabaseClient
        .from('games')
        .select('id,title,normalized_title')
        .neq('id', gameId);
      if (duplicateQueryError) throw duplicateQueryError;

      const normalizer = typeof normalizeGameDuplicateKey === 'function'
        ? normalizeGameDuplicateKey
        : value => String(value || '').trim().toLowerCase();
      const titleKey = normalizer(title);
      if ((existingGames || []).some(game => normalizer(game.normalized_title || game.title) === titleKey)) {
        message('Já existe um jogo com este título no catálogo.', true);
        return;
      }

      const payload = {
        title,
        normalized_title: titleKey,
        console: consoleName,
        release_year: yearRaw ? Number(yearRaw) : null,
        genres: genresRaw.split(',').map(item => item.trim()).filter(Boolean),
        players,
        coop,
        synopsis,
        cover_url: coverUrl,
        status: published ? 'approved' : 'pending'
      };

      if (selectedGameMetadata) {
        payload.metadata_source = selectedGameMetadata.metadata_source || 'igdb';
        payload.metadata_external_id = selectedGameMetadata.external_id || null;
      }

      // Deliberadamente NÃO atualiza rom_path, rom_url, r2_path ou r2_url.
      // A ROM continua exatamente onde a leitura do R2 cadastrou.
      const { error } = await supabaseClient
        .from('games')
        .update(payload)
        .eq('id', gameId);
      if (error) throw error;

      if (continueReview) pendingReviewQueue.shift();
      if (typeof clearGameAdminForm === 'function') clearGameAdminForm();
      message('Dados atualizados. A ROM permaneceu no Cloudflare R2.');

      if (typeof loadGamesCatalog === 'function') await loadGamesCatalog();
      if (typeof renderGamesCatalog === 'function') await renderGamesCatalog();

      if (continueReview && typeof openNextPendingReview === 'function') openNextPendingReview();
      else if (published && typeof cancelGameAdminForm === 'function') cancelGameAdminForm();
    } catch (error) {
      console.error('[Lux Games] Falha ao salvar somente metadados do jogo:', error);
      message(`Não foi possível salvar os dados: ${error?.message || 'erro desconhecido'}`, true);
    } finally {
      if (submit) submit.disabled = false;
      if (draft) draft.disabled = false;
    }
  }

  saveR2GameMetadataOnly.__luxR2MetadataOnly = VERSION;

  function install() {
    try {
      adminImportGame = saveR2GameMetadataOnly;
      window.adminImportGame = saveR2GameMetadataOnly;
    } catch (_) {}
  }

  install();
  const timer = setInterval(() => {
    if (window.adminImportGame !== saveR2GameMetadataOnly) install();
  }, 250);
  setTimeout(() => clearInterval(timer), 15000);

  document.addEventListener('DOMContentLoaded', install, { once: true });
  console.info('[Lux Games] Edição de metadados R2-only ativa: salvar dados não envia ROM ao Supabase.');
})();
