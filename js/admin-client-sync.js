(() => {
  'use strict';

  // IPTV 1.7+: o catálogo do fornecedor é um snapshot HTTPS global.
  // A atualização manual pertence ao botão único "Atualizar IPTV HTTPS"
  // instalado por provider-grouping-sync.js. Não decoramos mais cada cliente
  // com sincronização própria e não instalamos wrappers de catálogo no pós-boot.
  window.__luxAdminClientSyncInstalled = '20260918-https-snapshot-only1';
})();
