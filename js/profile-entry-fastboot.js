(() => {
  'use strict';

  // IPTV EMPTY BASELINE — 18/09/2026
  // Durante a reconstrução do catálogo, nenhuma fonte IPTV pode carregar.
  // Este módulo bloqueia todas as rotas antigas (Xtream, M3U, snapshot, retry,
  // importação local e conexão manual) antes de startApp() abrir o perfil.
  const VERSION = '20260918-iptv-empty1';
  if (window.__luxProfileEntryFastbootInstalled === VERSION) return;
  window.__luxProfileEntryFastbootInstalled = VERSION;
  window.__luxIptvRebuildDisabled = true;

  const disabledMessage = 'IPTV temporariamente vazia: aguardando o novo carregador HTTPS.';

  const resetIptvState = () => {
    try { ++xtreamLoadSequence; } catch (_) {}
    try { xtreamMovieContext = null; } catch (_) {}
    try { xtreamSeriesContext = null; } catch (_) {}
    try { xtreamMovieSectionRetryDone = true; } catch (_) {}
    try { xtreamSeriesSectionRetryDone = true; } catch (_) {}
    try {
      xtreamMoviesState = { status: 'idle', count: 0, error: '', timeoutMs: 0, reason: 'disabled' };
      xtreamSeriesState = { status: 'idle', count: 0, error: '', timeoutMs: 0, reason: 'disabled' };
    } catch (_) {}
    try {
      if (typeof clearMediaSourceState === 'function') clearMediaSourceState();
      else if (typeof allMediaItems !== 'undefined') allMediaItems = [];
    } catch (_) {}
  };

  const disabledLoader = async () => {
    resetIptvState();
    window.LuxDevkit?.info?.('IPTV', 'disabled', 'Carregamento de IPTV desativado para reconstrução HTTPS', {
      candidates: [],
      live: 0,
      movies: 0,
      series: 0
    });
    return false;
  };

  const disabledAction = async () => {
    resetIptvState();
    throw new Error(disabledMessage);
  };

  const installIptvEmptyBaseline = () => {
    resetIptvState();

    // Não existe seleção de fonte nesta fase.
    window.getMediaSourceCandidates = () => [];
    window.loadMediaSourcesInPriority = disabledLoader;
    window.resolveUserCredentials = () => ({ isXc: false, url: '' });

    // Bloqueia todas as rotas antigas, inclusive ações manuais.
    window.loadFromXtreamApi = disabledAction;
    window.loadPlaylist = disabledAction;
    window.importLocalM3u = disabledAction;
    window.retryXtreamMovies = async () => false;
    window.retryXtreamSeries = async () => false;
    window.manualReloadXtreamMovies = async () => false;
    window.manualReloadXtreamSeries = async () => false;
    window.saveManualConnection = () => {
      resetIptvState();
      alert(disabledMessage);
    };
    window.adminSendCategoriesToUsers = () => {
      const status = document.getElementById('adminCategorySyncStatus');
      if (status) status.textContent = 'IPTV em reconstrução. Nenhum catálogo está sendo carregado.';
    };

    // Módulos antigos não podem reativar o catálogo depois do boot.
    window.LuxHttpsIptv = undefined;
    window.LuxSyncedCatalog = undefined;
    window.__luxHttpsSnapshotActive = false;
    window.__luxSyncedXtreamActive = false;

    const connectionButton = document.getElementById('connectionConfigBtn');
    if (connectionButton) connectionButton.classList.add('hidden');
    const localInput = document.getElementById('localM3uFile');
    if (localInput) localInput.disabled = true;
    const adminButton = document.getElementById('adminCategorySyncButton');
    if (adminButton) {
      adminButton.disabled = true;
      adminButton.textContent = 'IPTV em reconstrução';
      adminButton.removeAttribute('onclick');
    }

    window.__luxIptvEmptyBaselineInstalled = VERSION;
    return true;
  };

  const installProfileWrapper = () => {
    const original = window.activateAccountProfile;
    if (typeof original !== 'function') return false;
    if (original.__luxIptvEmptyWrapped === VERSION) return true;

    const wrapped = async function(profile) {
      installIptvEmptyBaseline();
      return original.apply(this, arguments);
    };
    wrapped.__luxIptvEmptyWrapped = VERSION;
    wrapped.__luxIptvEmptyOriginal = original;
    window.activateAccountProfile = wrapped;
    return true;
  };

  // script.js e profiles.js já foram carregados quando este arquivo é injetado
  // por game-save-store.js. Ainda assim repetimos por alguns ciclos para cobrir
  // qualquer ordem de execução do navegador sem criar uma segunda rota IPTV.
  installIptvEmptyBaseline();
  installProfileWrapper();

  let attempts = 0;
  const timer = setInterval(() => {
    attempts += 1;
    installIptvEmptyBaseline();
    if (installProfileWrapper() || attempts >= 120) clearInterval(timer);
  }, 25);
})();
