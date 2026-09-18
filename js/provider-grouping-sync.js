(() => {
  'use strict';

  // IPTV EMPTY BASELINE — 18/09/2026
  // Sincronização/publicação antiga desativada até o novo pipeline HTTPS.
  const VERSION = '20260918-iptv-empty1';
  window.__luxProviderHttpsSync = false;
  window.__luxProviderSyncDisabled = VERSION;
  window.adminSyncProviderCatalogForAll = async () => {
    const status = document.getElementById('adminCategorySyncStatus');
    if (status) status.textContent = 'IPTV em reconstrução. O sincronizador antigo está desativado.';
    return false;
  };

  const disableButton = () => {
    const button = document.getElementById('adminCategorySyncButton');
    if (!button) return false;
    button.disabled = true;
    button.textContent = 'IPTV em reconstrução';
    button.removeAttribute('onclick');
    return true;
  };

  disableButton();
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', disableButton, { once: true });
})();
