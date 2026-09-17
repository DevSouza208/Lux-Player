(() => {
  'use strict';

  const VERSION = '20260917-profile-fastboot1';
  if (window.__luxProfileEntryFastbootInstalled === VERSION) return;
  window.__luxProfileEntryFastbootInstalled = VERSION;

  // These jobs enrich the dashboard, but none of them is required to decide
  // which local/account profile is active. Keeping them in the critical path
  // makes a slow provider or catalogue endpoint look like a broken login.
  const DEFERRED_BOOT_JOBS = [
    'loadMediaSourcesInPriority',
    'syncCurrentSubscriptionFromProvider',
    'loadNotifications',
    'loadLiveSchedule',
    'loadGamesCatalog',
    'loadReadingCatalog'
  ];

  const sameProfile = (left, right) => {
    if (!left || !right) return false;
    if (left.data_key && right.data_key) return String(left.data_key) === String(right.data_key);
    return Number(left.slot || 1) === Number(right.slot || 1);
  };

  const safeRefresh = () => {
    try {
      if (typeof window.setSection === 'function') window.setSection(typeof currentSection !== 'undefined' ? currentSection || 'home' : 'home');
      else if (typeof window.renderHome === 'function') window.renderHome();
    } catch (error) {
      console.warn('[Lux Play] Atualização visual pós-perfil indisponível.', error);
    }
  };

  const runDeferredJobs = (jobs, profile) => {
    if (!jobs.size) return;
    setTimeout(async () => {
      try {
        if (!sameProfile(typeof currentUser !== 'undefined' ? currentUser?.profile : null, profile)) return;
      } catch (_) { return; }

      // Load the user's current source immediately. Provider refresh may finish
      // later and trigger a second source refresh without blocking the dashboard.
      const mediaJob = jobs.get('loadMediaSourcesInPriority');
      if (mediaJob) {
        Promise.resolve(mediaJob.fn.apply(mediaJob.thisArg, mediaJob.args))
          .then(safeRefresh)
          .catch(error => console.warn('[Lux Play] Fonte de mídia em segundo plano indisponível.', error));
      }

      const providerJob = jobs.get('syncCurrentSubscriptionFromProvider');
      if (providerJob) {
        Promise.resolve(providerJob.fn.apply(providerJob.thisArg, providerJob.args))
          .then(() => {
            const currentMedia = window.loadMediaSourcesInPriority;
            if (typeof currentMedia === 'function') return currentMedia();
          })
          .then(safeRefresh)
          .catch(error => console.warn('[Lux Play] Atualização da assinatura em segundo plano indisponível.', error));
      }

      const secondaryNames = ['loadNotifications', 'loadLiveSchedule', 'loadGamesCatalog', 'loadReadingCatalog'];
      const secondary = secondaryNames
        .map(name => jobs.get(name))
        .filter(Boolean)
        .map(job => Promise.resolve().then(() => job.fn.apply(job.thisArg, job.args)));

      if (secondary.length) {
        Promise.allSettled(secondary).then(safeRefresh);
      }
    }, 0);
  };

  const install = () => {
    const original = window.activateAccountProfile;
    if (typeof original !== 'function') return false;
    if (original.__luxProfileEntryFastbootWrapped) return true;

    const wrapped = async function(profile) {
      const deferred = new Map();
      const restorers = [];

      DEFERRED_BOOT_JOBS.forEach(name => {
        const fn = window[name];
        if (typeof fn !== 'function') return;
        const stub = function(...args) {
          deferred.set(name, { fn, args, thisArg: this });
          return Promise.resolve(name === 'loadMediaSourcesInPriority' ? false : null);
        };
        window[name] = stub;
        restorers.push(() => {
          if (window[name] === stub) window[name] = fn;
        });
      });

      try {
        return await original.apply(this, arguments);
      } finally {
        restorers.reverse().forEach(restore => restore());
        try {
          if (sameProfile(typeof currentUser !== 'undefined' ? currentUser?.profile : null, profile)) {
            runDeferredJobs(deferred, profile);
          }
        } catch (_) {}
      }
    };

    wrapped.__luxProfileEntryFastbootWrapped = VERSION;
    wrapped.__luxProfileEntryFastbootOriginal = original;
    window.activateAccountProfile = wrapped;
    return true;
  };

  let attempts = 0;
  const timer = setInterval(() => {
    attempts += 1;
    if (install() || attempts >= 240) clearInterval(timer);
  }, 50);
  install();
})();
