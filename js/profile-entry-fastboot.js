(() => {
  'use strict';

  // Profile entry must never start the media bootstrap before the canonical
  // Cloudflare HTTPS snapshot has installed its loader. There is no fallback
  // IPTV path: web, Electron and local builds all wait for the same source.
  const VERSION = '20260918-profile-fastboot4-https-only';
  const SNAPSHOT_SRC = 'js/iptv-https-snapshot.js?v=20260918-https-snapshot-clean1';
  if (window.__luxProfileEntryFastbootInstalled === VERSION) return;
  window.__luxProfileEntryFastbootInstalled = VERSION;

  const DEFERRED_BOOT_JOBS = [
    'syncCurrentSubscriptionFromProvider',
    'loadNotifications',
    'loadLiveSchedule',
    'loadGamesCatalog',
    'loadReadingCatalog'
  ];

  let snapshotReadyPromise = null;

  const ensureHttpsSnapshotReady = () => {
    if (window.LuxHttpsIptv?.install?.() && window.loadMediaSourcesInPriority?.__luxHttpsSnapshot) {
      return Promise.resolve(window.LuxHttpsIptv);
    }
    if (snapshotReadyPromise) return snapshotReadyPromise;

    snapshotReadyPromise = (async () => {
      let script = document.querySelector('script[data-lux-https-snapshot]');
      if (!script) {
        script = document.createElement('script');
        script.src = SNAPSHOT_SRC;
        script.async = false;
        script.dataset.luxHttpsSnapshot = '1';
        document.head.appendChild(script);
      }

      window.LuxDevkit?.running?.('IPTV-HTTPS', 'boot-gate', 'Aguardando o leitor HTTPS obrigatório...');

      for (let attempt = 0; attempt < 240; attempt += 1) {
        const api = window.LuxHttpsIptv;
        if (api?.install?.() && window.loadMediaSourcesInPriority?.__luxHttpsSnapshot) {
          window.LuxDevkit?.success?.('IPTV-HTTPS', 'boot-gate', 'Leitor HTTPS confirmado antes do boot', 0, {
            version: api.version || null,
            source: 'cloudflare-snapshot-only'
          });
          return api;
        }
        await new Promise(resolve => setTimeout(resolve, 50));
      }

      throw new Error('O snapshot IPTV HTTPS obrigatório não ficou disponível. O Lux não usará uma fonte alternativa.');
    })().catch(error => {
      snapshotReadyPromise = null;
      window.LuxDevkit?.emit?.({
        category: 'IPTV-HTTPS',
        status: 'error',
        label: 'boot-gate',
        message: error?.message || 'Falha ao preparar o snapshot HTTPS.'
      });
      throw error;
    });

    return snapshotReadyPromise;
  };

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

      // Provider refresh may change account metadata, but IPTV itself remains
      // locked to the global HTTPS snapshot. A metadata change only reloads
      // that same canonical source.
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
            await ensureHttpsSnapshotReady();
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
    if (original.__luxProfileEntryFastbootWrapped === VERSION) return true;

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
        // Hard gate: there is no Xtream/M3U/HTTP fallback anymore. The profile
        // cannot enter startApp until the HTTPS snapshot owns the media loader.
        await ensureHttpsSnapshotReady();
        if (!window.loadMediaSourcesInPriority?.__luxHttpsSnapshot) {
          throw new Error('A fonte IPTV HTTPS obrigatória não assumiu o carregamento do Lux.');
        }
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
