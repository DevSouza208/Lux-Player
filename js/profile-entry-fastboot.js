(() => {
  'use strict';

  // IPTV HTTPS ativo — 18/09/2026
  // Este módulo não bloqueia mais o catálogo. Ele apenas garante que o
  // snapshot HTTPS já carregado em window.LuxHttpsIptv assuma o boot do perfil.
  const VERSION = '20260918-https-snapshot-enabled1';
  if (window.__luxProfileEntryFastbootInstalled === VERSION) return;
  window.__luxProfileEntryFastbootInstalled = VERSION;
  window.__luxIptvRebuildDisabled = false;
  window.__luxIptvEmptyBaselineInstalled = false;

  const installSnapshot = () => {
    try {
      if (window.LuxHttpsIptv?.install) return window.LuxHttpsIptv.install();
    } catch (error) {
      console.warn('[Lux IPTV HTTPS] Falha ao instalar snapshot no boot:', error);
    }
    return false;
  };

  installSnapshot();

  let attempts = 0;
  const timer = setInterval(() => {
    attempts += 1;
    if (installSnapshot() || attempts >= 200) clearInterval(timer);
  }, 50);
})();
