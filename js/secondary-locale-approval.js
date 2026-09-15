(() => {
  'use strict';
  const VERSION = '20260915-locale-approval-retired1';
  if (window.__luxSecondaryLocaleApprovalInstalled === VERSION) return;
  window.__luxSecondaryLocaleApprovalInstalled = VERSION;

  // Recurso aposentado: o Lux não classifica idioma, não segura conteúdo,
  // não envia itens para aprovação e não consulta content-locale-reviews.
  document.getElementById('secondaryLocaleReviewsSection')?.remove();

  window.LuxSecondaryLocaleApproval = Object.freeze({
    version: VERSION,
    retired: true,
    processCatalog: async () => ({ skipped: true, retired: true }),
    refreshAdminReviews: async () => ({ skipped: true, retired: true })
  });
})();