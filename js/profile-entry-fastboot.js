(() => {
  'use strict';

  const VERSION = '20260917-profile-fastboot2';
  if (window.__luxProfileEntryFastbootInstalled === VERSION) return;
  window.__luxProfileEntryFastbootInstalled = VERSION;

  const DEFERRED_BOOT_JOBS = [
    'loadMediaSourcesInPriority',
    'syncCurrentSubscriptionFromProvider',
    'loadNotifications',
    'loadLiveSchedule',
    'loadGamesCatalog',
    'loadReadingCatalog'
  ];
  const MEDIA_SECTIONS = new Set(['live', 'movies', 'series']);

  let mediaBootPromise = Promise.resolve();
  let mediaBootLoading = false;
  let queuedMediaSection = null;

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

  const sourceFingerprint = () => {
    try {
      const user = typeof currentUser !== 'undefined' ? currentUser : null;
      if (!user) return '';
      return JSON.stringify([
        user.m3uUrl || '',
        user.m3uHttpsUrl || '',
        user.urlXc || '',
        user.userXc || '',
        user.senhaXc || ''
      ]);
    } catch (_) {
      return '';
    }
  };

  const refreshCurrentSection = profile => {
    if (!activeProfileIs(profile)) return;
    let section = 'home';
    try { section = typeof currentSection !== 'undefined' ? (currentSection || 'home') : 'home'; } catch (_) {}

    requestAnimationFrame(() => {
      if (!activeProfileIs(profile) || mediaBootLoading) return;
      try {
        if (typeof window.setSection === 'function') window.setSection(section);
        else if (section === 'home' && typeof window.renderHome === 'function') window.renderHome();
      } catch (error) {
        console.warn('[Lux Play] Atualização visual pós-perfil indisponível.', error);
      }
    });
  };

  const flushQueuedMediaSection = profile => {
    if (!queuedMediaSection || !activeProfileIs(profile) || mediaBootLoading) return false;
    const queued = queuedMediaSection;
    queuedMediaSection = null;
    try {
      if (typeof window.setSection === 'function') {
        window.setSection.apply(queued.thisArg || window, [queued.section, ...queued.args]);
        return true;
      }
    } catch (error) {
      console.warn('[Lux Play] Não foi possível abrir a seção solicitada.', error);
    }
    return false;
  };

  const queueMediaLoad = (job, profile) => {
    if (!job) return Promise.resolve(false);

    mediaBootPromise = mediaBootPromise.catch(() => false).then(async () => {
      if (!activeProfileIs(profile)) return false;
      mediaBootLoading = true;
      window.__luxProfileMediaLoading = true;
      try {
        return await job.fn.apply(job.thisArg, job.args);
      } catch (error) {
        console.warn('[Lux Play] Fonte de mídia em segundo plano indisponível.', error);
        return false;
      } finally {
        mediaBootLoading = false;
        window.__luxProfileMediaLoading = false;
        if (!flushQueuedMediaSection(profile)) refreshCurrentSection(profile);
      }
    });

    window.__luxProfileMediaReady = mediaBootPromise;
    return mediaBootPromise;
  };

  const installSectionGuard = () => {
    const original = window.setSection;
    if (typeof original !== 'function') return false;
    if (original.__luxProfileMediaGuard) return true;

    const wrapped = function(section, ...args) {
      const key = String(section || '').toLowerCase();
      if (mediaBootLoading && MEDIA_SECTIONS.has(key)) {
        queuedMediaSection = { section, args, thisArg: this };
        return;
      }
      return original.apply(this, [section, ...args]);
    };

    wrapped.__luxProfileMediaGuard = VERSION;
    wrapped.__luxProfileMediaGuardOriginal = original;
    window.setSection = wrapped;
    return true;
  };

  const runDeferredJobs = (jobs, profile) => {
    if (!jobs.size || !activeProfileIs(profile)) return;

    setTimeout(async () => {
      if (!activeProfileIs(profile)) return;

      const mediaJob = jobs.get('loadMediaSourcesInPriority');
      const providerJob = jobs.get('syncCurrentSubscriptionFromProvider');

      if (mediaJob) await queueMediaLoad(mediaJob, profile);
      if (!activeProfileIs(profile)) return;

      if (providerJob) {
        const before = sourceFingerprint();
        try {
          await providerJob.fn.apply(providerJob.thisArg, providerJob.args);
        } catch (error) {
          console.warn('[Lux Play] Atualização da assinatura em segundo plano indisponível.', error);
        }
        const after = sourceFingerprint();
        if (mediaJob && before !== after && activeProfileIs(profile)) {
          await queueMediaLoad(mediaJob, profile);
        }
      }

      const secondaryNames = ['loadNotifications', 'loadLiveSchedule', 'loadGamesCatalog', 'loadReadingCatalog'];
      const secondary = secondaryNames
        .map(name => jobs.get(name))
        .filter(Boolean)
        .map(job => Promise.resolve().then(() => job.fn.apply(job.thisArg, job.args)));

      if (secondary.length) {
        await Promise.allSettled(secondary);
        refreshCurrentSection(profile);
      }
    }, 0);
  };

  const install = () => {
    installSectionGuard();

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
    const ready = install();
    const sectionReady = installSectionGuard();
    if ((ready && sectionReady) || attempts >= 240) clearInterval(timer);
  }, 50);
  install();
})();
