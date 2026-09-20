(() => {
  'use strict';

  const VERSION = '20260920-legacy-m3u-native1';
  const WORKER_BASE = 'https://lux-playlist-sync.professorsouza-tech.workers.dev';
  const GLOBAL_ACCOUNT = 'admin';
  const MANIFEST_URL = `${WORKER_BASE}/catalogos/${GLOBAL_ACCOUNT}/manifest.json`;

  if (window.__luxHttpsSnapshotModule === VERSION) return;
  window.__luxHttpsSnapshotModule = VERSION;

  let installed = false;
  let loadingPromise = null;
  let activeManifest = null;

  const fetchJson = async url => {
    const response = await fetch(url, { cache: 'no-store', credentials: 'omit' });
    if (!response.ok) throw new Error(`HTTP ${response.status} ao carregar dados HTTPS.`);
    return response.json();
  };

  /**
   * Restaura o fluxo que estava funcional no Lux original:
   *
   * 1. usa a cópia HTTPS da M3U apenas para baixar o catálogo;
   * 2. entrega o texto da M3U ao parser original do Lux;
   * 3. o parser preserva exatamente a URL publicada em cada entrada;
   * 4. playLiveChannel decide o player pela própria URL:
   *    .m3u8 => Hls.js; qualquer outro formato => <video> nativo.
   *
   * Não reconstruímos URL de canal e não casamos playback por stream_id.
   */
  const loadSnapshot = async () => {
    if (loadingPromise) return loadingPromise;

    loadingPromise = (async () => {
      const started = performance.now();
      window.LuxDevkit?.running?.('IPTV-HTTPS', 'snapshot', 'Carregando M3U HTTPS no parser original do Lux...');

      try {
        const manifest = await fetchJson(MANIFEST_URL);
        const playlistUrl = String(manifest?.playlist || '').trim();
        if (!/^https:\/\//i.test(playlistUrl)) {
          throw new Error('Manifesto HTTPS sem playlist pública válida.');
        }
        if (typeof window.loadPlaylist !== 'function') {
          throw new Error('Parser M3U original do Lux ainda não está disponível.');
        }

        // Este é o ponto essencial: reaproveita exatamente o loader/parsing
        // original em vez de transformar a M3U em um catálogo reconstruído.
        const result = await window.loadPlaylist(playlistUrl);
        const count = Number(result?.count ?? (Array.isArray(allMediaItems) ? allMediaItems.length : 0));
        if (!count) throw new Error('A M3U HTTPS não retornou conteúdo utilizável.');

        if (typeof setMediaSourceState === 'function') {
          setMediaSourceState('m3u-url', 'Lista M3U HTTPS sincronizada', count);
        }

        activeManifest = manifest;
        window.__luxHttpsSnapshotActive = true;
        window.__luxSyncedXtreamActive = false;
        window.__luxHttpsSnapshotStats = {
          playlistItems: count,
          groupedItems: Number(result?.groupedCount ?? (Array.isArray(allMediaItems) ? allMediaItems.length : count)),
          playback: 'legacy-direct-m3u'
        };

        window.LuxDevkit?.success?.(
          'IPTV-HTTPS',
          'snapshot',
          'M3U HTTPS carregada pelo fluxo original; URLs de playback preservadas',
          Math.round(performance.now() - started),
          window.__luxHttpsSnapshotStats
        );

        return { count, ...window.__luxHttpsSnapshotStats };
      } catch (error) {
        window.__luxHttpsSnapshotActive = false;
        if (typeof clearMediaSourceState === 'function') clearMediaSourceState();
        window.LuxDevkit?.emit?.({
          category: 'IPTV-HTTPS',
          status: 'error',
          label: 'snapshot',
          message: error?.message || 'Falha ao carregar M3U HTTPS.'
        });
        throw error;
      }
    })().finally(() => {
      loadingPromise = null;
    });

    return loadingPromise;
  };

  const install = () => {
    if (installed) return true;
    if (typeof window.loadMediaSourcesInPriority !== 'function') return false;
    if (typeof window.loadPlaylist !== 'function') return false;

    const originalResolve = typeof window.resolveUserCredentials === 'function'
      ? window.resolveUserCredentials
      : null;

    window.getMediaSourceCandidates = () => [
      {
        kind: 'm3u-url',
        label: 'Lista M3U HTTPS sincronizada',
        value: String(activeManifest?.playlist || '')
      }
    ];

    window.loadMediaSourcesInPriority = async () => {
      window.LuxDevkit?.info?.(
        'IPTV',
        'ordem-fontes',
        'Fluxo restaurado: M3U HTTPS -> URL original da entrada -> player do navegador',
        { candidates: [{ kind: 'm3u-url', label: 'Lista M3U HTTPS sincronizada' }] }
      );
      try {
        await loadSnapshot();
        return true;
      } catch (error) {
        console.warn('[Lux IPTV HTTPS] M3U sincronizada indisponível:', error);
        return false;
      }
    };
    // Mantém o contrato esperado pelo profile-entry-fastboot atual.
    window.loadMediaSourcesInPriority.__luxHttpsSnapshot = VERSION;

    window.resolveUserCredentials = user => {
      if (window.__luxHttpsSnapshotActive) {
        return { isXc: false, url: String(activeManifest?.playlist || '') };
      }
      return originalResolve ? originalResolve(user) : { isXc: false, url: '' };
    };

    installed = true;
    window.__luxHttpsSnapshotInstalled = VERSION;
    return true;
  };

  window.LuxHttpsIptv = {
    version: VERSION,
    manifestUrl: MANIFEST_URL,
    reload: loadSnapshot,
    install
  };

  let attempts = 0;
  const timer = setInterval(() => {
    attempts += 1;
    if (install() || attempts >= 200) clearInterval(timer);
  }, 50);
})();
