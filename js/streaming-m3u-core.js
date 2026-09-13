(() => {
  'use strict';

  const VERSION = '20260913-m3u-core-1';
  if (window.__luxM3uStreamingCore === VERSION) return;
  window.__luxM3uStreamingCore = VERSION;

  // Enquanto reconstruímos o streaming, a M3U volta a ser a única fonte de catálogo.
  // Isso impede o bridge Xtream sincronizado de assumir o carregamento antes dela.
  if (!window.__luxSyncedCatalogBridgeInstalled) {
    window.__luxSyncedCatalogBridgeInstalled = `disabled-by-${VERSION}`;
  }
  window.__luxDisableSyncedCatalog = true;

  const isM3uSource = source => source?.kind === 'm3u-url' || source?.kind === 'm3u-storage';

  const getM3uCandidates = () => {
    if (typeof window.getMediaSourceCandidates !== 'function') return [];

    let candidates = [];
    try {
      candidates = window.getMediaSourceCandidates(typeof currentUser !== 'undefined' ? currentUser : null) || [];
    } catch (error) {
      console.warn('[Lux Play] Não foi possível preparar as fontes M3U.', error);
      return [];
    }

    const seen = new Set();
    return candidates.filter(source => {
      if (!isM3uSource(source)) return false;
      const key = `${source.kind}|${String(source.value || '')}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  };

  const loadM3uOnly = async () => {
    const candidates = getM3uCandidates();
    const failures = [];

    if (!candidates.length) {
      if (typeof window.clearMediaSourceState === 'function') window.clearMediaSourceState();
      console.warn('[Lux Play] Nenhuma fonte M3U configurada para este usuário.');
      return false;
    }

    for (const source of candidates) {
      try {
        if (typeof window.loadPlaylist !== 'function') throw new Error('Leitor M3U ainda não está disponível.');
        const result = await window.loadPlaylist(source.value);
        const fallbackCount = typeof allMediaItems !== 'undefined' && Array.isArray(allMediaItems) ? allMediaItems.length : 0;
        const count = Number(result?.count ?? fallbackCount);
        if (!count) throw new Error('A lista não retornou itens utilizáveis.');

        if (typeof window.setMediaSourceState === 'function') {
          window.setMediaSourceState(source.kind, source.label || 'Lista M3U', count);
        }

        window.__luxSyncedXtreamActive = false;
        console.info('[Lux Play] Streaming carregado diretamente da M3U.', {
          source: source.label || source.kind,
          count
        });
        return true;
      } catch (error) {
        failures.push(`${source.label || source.kind}: ${error?.message || 'falha desconhecida'}`);
        console.warn('[Lux Play] Fonte M3U indisponível:', source.label || source.kind, error);
      }
    }

    if (typeof window.clearMediaSourceState === 'function') window.clearMediaSourceState();
    console.warn('[Lux Play] Nenhuma M3U pôde ser carregada.', failures);
    return false;
  };

  const install = () => {
    if (typeof window.loadMediaSourcesInPriority !== 'function') return false;
    if (window.loadMediaSourcesInPriority.__luxM3uStreamingCore === VERSION) return true;

    const patched = async function () {
      return loadM3uOnly();
    };
    patched.__luxM3uStreamingCore = VERSION;

    // Sobrescreve também um bridge Xtream que eventualmente tenha carregado antes deste módulo.
    window.loadMediaSourcesInPriority = patched;
    window.__luxSyncedXtreamActive = false;
    return true;
  };

  let attempts = 0;
  const timer = setInterval(() => {
    attempts += 1;
    install();

    // Mantém a proteção tempo suficiente para vencer a corrida dos módulos async.
    if (attempts >= 240) clearInterval(timer);
  }, 50);

  install();
})();
