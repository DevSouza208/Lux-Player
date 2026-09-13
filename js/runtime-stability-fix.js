/*
 * LUX PLAY — ESTABILIDADE DE RUNTIME
 * ==================================
 * Mapa funcional relacionado:
 * - [LUX-IPTV-018] Reparo de URLs de TV e filmes
 * - [LUX-PROFILE-015] Entrada rápida no perfil
 * - [LUX-ARCH-007] runtime-stability-fix.js
 *
 * OBJETIVO
 * Este módulo aplica duas correções de compatibilidade sobre o núcleo atual:
 * 1) recupera URLs reais de reprodução que podem ficar ausentes depois que
 *    o catálogo sincronizado Xtream é montado;
 * 2) evita bloquear a abertura do perfil enquanto sincronizações secundárias
 *    ainda estão acontecendo.
 *
 * PROTEGIDO
 * Este arquivo participa diretamente do checkpoint funcional atual.
 * Não remova nem altere a ordem das rotinas abaixo sem testar, no mínimo:
 * TV ao vivo, Filmes, Séries, troca de perfil e Continuar Assistindo.
 *
 * REGRA DE ARQUITETURA
 * A M3U é a fonte de verdade para URL de playback. O catálogo Xtream serve
 * como enriquecimento de metadados/categorias. Este patch existe porque a
 * implementação atual ainda não garante isso em todos os casos.
 */
(() => {
  'use strict';

  // Evita instalar os wrappers duas vezes se o script for carregado novamente.
  if (window.__luxRuntimeStabilityFixInstalled) return;
  window.__luxRuntimeStabilityFixInstalled = '20260912-stability2';

  /**
   * Normaliza nomes para comparação tolerante entre M3U e catálogo Xtream.
   * Remove acentos, extensões, marcadores técnicos e pontuação.
   */
  const normalizeText = value => String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\.(mkv|mp4|avi|mov|ts|m3u8?|flv|webm)$/i, '')
    .replace(/\([^)]*\)|\[[^\]]*\]/g, ' ')
    .replace(/\b(dublado|legendado|dual|4k|fhd|uhd|hd|sd|h265|hevc|pt-br)\b/g, ' ')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  /**
   * Normaliza URLs de imagem para comparação de logos/capas.
   * Query string e hash são ignorados porque CDNs costumam variar esses dados.
   */
  const normalizeAssetUrl = value => {
    const raw = String(value || '').trim();
    if (!raw) return '';
    try {
      const url = new URL(raw);
      url.hash = '';
      return `${url.origin}${url.pathname}`.replace(/\/+$/, '').toLowerCase();
    } catch (_) {
      return raw.split('#')[0].split('?')[0].replace(/\/+$/, '').toLowerCase();
    }
  };

  /** Padroniza aliases de tipo usados pelas diferentes fontes. */
  const normalizeType = value => {
    const type = String(value || '').toLowerCase();
    if (type === 'movie' || type === 'movies' || type === 'vod') return 'movies';
    if (type === 'live' || type === 'tv') return 'live';
    return type;
  };

  /**
   * [LUX-IPTV-018]
   * Extrai um stream ID numérico de formatos variados de URL.
   *
   * Importante: não assume apenas o path Xtream clássico. Alguns provedores
   * entregam o ID como query param ou alteram a estrutura do caminho.
   */
  const extractFlexibleStreamId = value => {
    const raw = String(value || '').trim();
    if (!raw) return '';

    try {
      const parsed = new URL(raw);
      for (const key of ['stream_id', 'stream', 'id']) {
        const candidate = parsed.searchParams.get(key);
        if (/^\d+$/.test(String(candidate || ''))) return String(candidate);
      }

      const parts = parsed.pathname.split('/').filter(Boolean);
      const last = decodeURIComponent(parts.at(-1) || '');
      const match = last.match(/^(\d+)(?:\.[a-z0-9]{1,10})?$/i);
      if (match) return match[1];
    } catch (_) {}

    const clean = raw.split(/[?#]/)[0].replace(/\/+$/, '');
    const last = clean.split('/').filter(Boolean).at(-1) || '';
    const match = last.match(/^(\d+)(?:\.[a-z0-9]{1,10})?$/i);
    return match ? match[1] : '';
  };

  /** Adiciona múltiplos candidatos ao mesmo índice sem perder colisões. */
  const addToMap = (map, key, item) => {
    if (!key) return;
    const list = map.get(key) || [];
    list.push(item);
    map.set(key, list);
  };

  /**
   * Busca novamente a playlist HTTPS registrada no manifest sincronizado.
   * cache:no-store é intencional: este reparo precisa trabalhar com a lista
   * atual, não com uma cópia antiga do navegador.
   */
  const loadRawPlaylistItems = async () => {
    const manifest = window.__luxSyncedXtreamManifest;
    const playlistUrl = String(manifest?.playlist || '').trim();
    if (!playlistUrl || typeof window.parseM3U !== 'function') return [];

    const response = await fetch(playlistUrl, { cache: 'no-store' });
    if (!response.ok) throw new Error(`playlist HTTP ${response.status}`);
    const text = await response.text();
    return window.parseM3U(text).filter(item => item?.url);
  };

  /**
   * [LUX-IPTV-018] REPARO DE PLAYBACK — PROTEGIDO
   *
   * Percorre SOMENTE TV e Filmes oriundos do catálogo sincronizado que ainda
   * estão sem URL. A rotina não reorganiza catálogo, não troca categoria,
   * não renomeia item e não toca em Séries.
   *
   * Ordem de tentativa:
   * 1. tipo + stream_id;
   * 2. stream_id global quando é único;
   * 3. nome normalizado, usando logo para desempate;
   * 4. logo única;
   * 5. direct_source como último fallback.
   */
  const repairSyncedPlaybackUrls = async () => {
    if (!window.__luxSyncedXtreamActive || typeof allMediaItems === 'undefined' || !Array.isArray(allMediaItems)) return;

    let rawItems;
    try {
      rawItems = await loadRawPlaylistItems();
    } catch (error) {
      console.warn('[Lux Play] Não foi possível validar os endereços de reprodução.', error);
      return;
    }
    if (!rawItems.length) return;

    // Índices separados permitem recuperar o link sem reconstruir os cards.
    const byTypeAndId = new Map();
    const byAnyId = new Map();
    const byTypeAndName = new Map();
    const byTypeAndLogo = new Map();

    rawItems.forEach(raw => {
      const type = normalizeType(raw.type);
      const id = extractFlexibleStreamId(raw.url);
      if (id) addToMap(byAnyId, id, raw);
      if (type !== 'live' && type !== 'movies') return;
      if (id && !byTypeAndId.has(`${type}|${id}`)) byTypeAndId.set(`${type}|${id}`, raw);
      addToMap(byTypeAndName, `${type}|${normalizeText(raw.name)}`, raw);
      addToMap(byTypeAndLogo, `${type}|${normalizeAssetUrl(raw.logo)}`, raw);
    });

    let repaired = 0;
    let directFallbacks = 0;
    let stillMissing = 0;

    for (const item of allMediaItems) {
      // Não mexer em outras fontes nem sobrescrever URL que já é válida.
      if (item?.source !== 'synced-xtream') continue;
      const type = normalizeType(item.type);
      if (type !== 'live' && type !== 'movies') continue;
      if (String(item.url || '').trim()) continue;

      const streamId = String(item.stream_id ?? '').trim();
      let match = streamId ? byTypeAndId.get(`${type}|${streamId}`) : null;

      // Se o ID existe uma única vez na playlist inteira, ele é seguro mesmo
      // quando o tipo inferido pela origem não coincidiu.
      if (!match && streamId) {
        const sameId = byAnyId.get(streamId) || [];
        if (sameId.length === 1) match = sameId[0];
      }

      // Nome é fallback, nunca a primeira escolha. Logo ajuda a desempatar.
      if (!match) {
        const nameMatches = byTypeAndName.get(`${type}|${normalizeText(item.name)}`) || [];
        if (nameMatches.length === 1) match = nameMatches[0];
        else if (nameMatches.length > 1) {
          const logo = normalizeAssetUrl(item.logo || item.stream_icon);
          match = nameMatches.find(candidate => logo && normalizeAssetUrl(candidate.logo) === logo) || nameMatches[0];
        }
      }

      if (!match) {
        const logoMatches = byTypeAndLogo.get(`${type}|${normalizeAssetUrl(item.logo || item.stream_icon)}`) || [];
        if (logoMatches.length === 1) match = logoMatches[0];
      }

      if (match?.url) {
        item.url = match.url;
        repaired += 1;
        continue;
      }

      // direct_source é usado apenas quando nenhuma associação com a M3U foi
      // possível e a origem forneceu uma URL HTTP(S) direta.
      const direct = String(item.direct_source || item.directSource || '').trim();
      if (/^https?:\/\//i.test(direct)) {
        item.url = direct;
        directFallbacks += 1;
        continue;
      }

      stillMissing += 1;
    }

    // Estatísticas ficam disponíveis para diagnóstico sem alterar a UI.
    if (window.__luxSyncedXtreamStats) {
      window.__luxSyncedXtreamStats.playbackRepaired = repaired;
      window.__luxSyncedXtreamStats.playbackDirectFallbacks = directFallbacks;
      window.__luxSyncedXtreamStats.playbackMissing = stillMissing;
    }

    console.info('[Lux Play] Endereços de reprodução validados.', { repaired, directFallbacks, stillMissing });
  };

  /**
   * Instala o reparo imediatamente depois do carregamento normal das fontes.
   * Mantemos o loader original e apenas executamos a validação no resultado.
   */
  const installCatalogRepair = () => {
    if (window.__luxCatalogPlaybackRepairInstalled) return true;
    if (!window.__luxSyncedCatalogBridgeInstalled || typeof window.loadMediaSourcesInPriority !== 'function') return false;

    const originalLoad = window.loadMediaSourcesInPriority;
    window.loadMediaSourcesInPriority = async function () {
      const result = await originalLoad.apply(this, arguments);
      if (result && window.__luxSyncedXtreamActive) await repairSyncedPlaybackUrls();
      return result;
    };

    window.__luxCatalogPlaybackRepairInstalled = true;
    window.LuxPlaybackRepair = { run: repairSyncedPlaybackUrls, extractStreamId: extractFlexibleStreamId };
    return true;
  };

  /** Compara perfis pelo data_key e usa slot apenas como fallback legado. */
  const sameProfile = (a, b) => {
    if (!a || !b) return false;
    if (a.data_key && b.data_key) return String(a.data_key) === String(b.data_key);
    return Number(a.slot || 1) === Number(b.slot || 1);
  };

  /**
   * [LUX-PROFILE-015] ENTRADA RÁPIDA NO PERFIL
   *
   * Durante activateAccountProfile(), substitui temporariamente duas rotinas
   * secundárias por marcadores leves. Depois que a ativação principal termina,
   * restaura as funções originais e agenda sync/VOD compartilhado no próximo
   * ciclo do event loop.
   *
   * Isso reduz a percepção de travamento sem eliminar nenhuma sincronização.
   */
  const installFastProfileEntry = () => {
    if (window.__luxFastProfileEntryInstalled) return true;
    if (typeof window.activateAccountProfile !== 'function' || typeof window.syncCloudProgress !== 'function') return false;

    const originalActivate = window.activateAccountProfile;

    window.activateAccountProfile = async function (profile) {
      const syncFunction = window.syncCloudProgress;
      const sharedVodFunction = typeof window.loadSharedVodCatalog === 'function' ? window.loadSharedVodCatalog : null;
      let deferredSync = false;
      let deferredSharedVods = false;
      const deferSyncOnly = async () => { deferredSync = true; };
      const deferSharedVodsOnly = async () => { deferredSharedVods = true; };

      // A troca é temporária e sempre é revertida no finally.
      window.syncCloudProgress = deferSyncOnly;
      if (sharedVodFunction) window.loadSharedVodCatalog = deferSharedVodsOnly;

      try {
        return await originalActivate.apply(this, arguments);
      } finally {
        if (window.syncCloudProgress === deferSyncOnly) window.syncCloudProgress = syncFunction;
        if (sharedVodFunction && window.loadSharedVodCatalog === deferSharedVodsOnly) window.loadSharedVodCatalog = sharedVodFunction;

        // Se o usuário já mudou para outro perfil, não terminamos tarefas do
        // perfil anterior em segundo plano.
        if (!sameProfile(currentUser?.profile, profile)) return;

        if (deferredSync && typeof syncFunction === 'function') {
          setTimeout(() => {
            Promise.resolve(syncFunction()).catch(error => {
              console.warn('[Lux Play] Sincronização em segundo plano indisponível.', error);
            });
          }, 0);
        }

        if (deferredSharedVods && typeof sharedVodFunction === 'function') {
          setTimeout(() => {
            Promise.resolve(sharedVodFunction())
              .then(() => {
                try { if (typeof window.setSection === 'function') window.setSection(currentSection || 'home'); } catch (_) {}
              })
              .catch(error => {
                console.warn('[Lux Play] Conteúdos extras indisponíveis no momento.', error);
              });
          }, 0);
        }
      }
    };

    window.__luxFastProfileEntryInstalled = true;
    return true;
  };

  /**
   * Os scripts principais são carregados dinamicamente. Por isso este módulo
   * tenta instalar seus wrappers a cada 50 ms até as dependências existirem.
   * O limite de 240 tentativas evita um timer eterno se algo falhar no boot.
   */
  let attempts = 0;
  const install = () => {
    attempts += 1;
    const catalogReady = installCatalogRepair();
    const profileReady = installFastProfileEntry();
    if ((catalogReady && profileReady) || attempts >= 240) clearInterval(timer);
  };

  const timer = setInterval(install, 50);
  install();
})();
