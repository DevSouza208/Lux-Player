(() => {
  'use strict';

  // Profile entry must not bypass the primary media bootstrap. The IPTV catalog
  // is part of startApp's state initialization; deferring it leaves sections
  // alive with an empty allMediaItems array and makes tab changes look broken.
  // Keep only non-critical enrichment jobs out of the profile critical path.
  const VERSION = '20260917-profile-fastboot3';
  if (window.__luxProfileEntryFastbootInstalled === VERSION) return;
  window.__luxProfileEntryFastbootInstalled = VERSION;

  const DEFERRED_BOOT_JOBS = [
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

  const activeProfileIs = profile => {
    try {
      return sameProfile(typeof currentUser !== 'undefined' ? currentUser?.profile : null, profile);
    } catch (_) {
      return false;
    }
  };

  const safeRefresh = profile => {
    if (!activeProfileIs(profile)) return;
    requestAnimationFrame(() => {
      if (!activeProfileIs(profile)) return;
      try {
        const section = typeof currentSection !== 'undefined' ? (currentSection || 'home') : 'home';
        if (typeof window.setSection === 'function') window.setSection(section);
        else if (section === 'home' && typeof window.renderHome === 'function') window.renderHome();
      } catch (error) {
        console.warn('[Lux Play] Atualização visual pós-perfil indisponível.', error);
      }
    });
  };

  const runDeferredJobs = (jobs, profile) => {
    if (!jobs.size || !activeProfileIs(profile)) return;

    setTimeout(async () => {
      if (!activeProfileIs(profile)) return;

      // Provider refresh may change URLs after the catalog already loaded. If it
      // does, reload the primary media source once, without making profile entry
      // depend on the provider request.
      const providerJob = jobs.get('syncCurrentSubscriptionFromProvider');
      if (providerJob) {
        let before = '';
        try {
          before = JSON.stringify([
            currentUser?.m3uUrl || '', currentUser?.m3uHttpsUrl || '',
            currentUser?.urlXc || '', currentUser?.userXc || '', currentUser?.senhaXc || ''
          ]);
          await providerJob.fn.apply(providerJob.thisArg, providerJob.args);
          const after = JSON.stringify([
            currentUser?.m3uUrl || '', currentUser?.m3uHttpsUrl || '',
            currentUser?.urlXc || '', currentUser?.userXc || '', currentUser?.senhaXc || ''
          ]);
          if (before !== after && activeProfileIs(profile) && typeof window.loadMediaSourcesInPriority === 'function') {
            await window.loadMediaSourcesInPriority();
          }
        } catch (error) {
          console.warn('[Lux Play] Atualização da assinatura em segundo plano indisponível.', error);
        }
      }

      const secondaryNames = ['loadNotifications', 'loadLiveSchedule', 'loadGamesCatalog', 'loadReadingCatalog'];
      const secondary = secondaryNames
        .map(name => jobs.get(name))
        .filter(Boolean)
        .map(job => Promise.resolve().then(() => job.fn.apply(job.thisArg, job.args)));

      if (secondary.length) await Promise.allSettled(secondary);
      safeRefresh(profile);
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
          return Promise.resolve(null);
        };
        window[name] = stub;
        restorers.push(() => {
          if (window[name] === stub) window[name] = fn;
        });
      });

      try {
        // Crucially, loadMediaSourcesInPriority is NOT stubbed. startApp must
        // finish loading IPTV before the profile activation is considered done.
        return await original.apply(this, arguments);
      } finally {
        restorers.reverse().forEach(restore => restore());
        if (activeProfileIs(profile)) runDeferredJobs(deferred, profile);
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
