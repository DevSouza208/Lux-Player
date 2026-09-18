// Local saves and a persistent upload queue, isolated by account.
let gameSaveDatabase;
let pendingGameSaveSync;

function openGameSaveDatabase() {
  if (!gameSaveDatabase) gameSaveDatabase = new Promise((resolve, reject) => {
    const request = indexedDB.open('lux-user-game-saves', 1);
    request.onupgradeneeded = () => {
      request.result.createObjectStore('saves', { keyPath: 'key' }).createIndex('user', 'user');
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => { gameSaveDatabase = null; reject(request.error); };
  });
  return gameSaveDatabase;
}

async function gameSaveStoreTransaction(mode, operation) {
  const db = await openGameSaveDatabase();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction('saves', mode);
    const request = operation(transaction.objectStore('saves'));
    transaction.oncomplete = () => resolve(request.result);
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () => reject(transaction.error || new Error('Save local interrompido.'));
  });
}

function localGameSaveRecordKey(game, slot, user) {
  return JSON.stringify([typeof profileSaveOwner === 'function' ? profileSaveOwner(user) : user.user, getCloudGameSaveKey(game), Number(slot)]);
}

function readLocalGameSave(game, slot, user = currentUser) {
  if (!user) return Promise.resolve(null);
  return gameSaveStoreTransaction('readonly', store => store.get(localGameSaveRecordKey(game, slot, user)));
}

function writeLocalGameSave(game, slot, state, updatedAt, pending, user = currentUser, cloudBaseAt = pending ? null : updatedAt) {
  if (!user) return Promise.reject(new Error('Entre na sua conta para salvar.'));
  return gameSaveStoreTransaction('readwrite', store => store.put({
    key: localGameSaveRecordKey(game, slot, user), user: typeof profileSaveOwner === 'function' ? profileSaveOwner(user) : user.user,
    game: { id: game.id, url: game.url, name: game.name }, slot: Number(slot), state, updatedAt, pending, cloudBaseAt
  }));
}

async function markGameSaveUploaded(record) {
  const db = await openGameSaveDatabase();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction('saves', 'readwrite');
    const store = transaction.objectStore('saves');
    const request = store.get(record.key);
    request.onsuccess = () => {
      if (request.result?.updatedAt === record.updatedAt) store.put({ ...request.result, pending: false, cloudBaseAt: record.cloudBaseAt ?? record.updatedAt });
    };
    transaction.oncomplete = resolve;
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () => reject(transaction.error);
  });
}

async function uploadLocalGameSave(record, user) {
  const remote = await loadCloudGameSave(record.game, record.slot, user);
  if (remote && await gameSaveStatesEqual(record.state, remote.state)) {
    await markGameSaveUploaded({ ...record, cloudBaseAt: remote.updatedAt });
    return { saved: true };
  }
  if (remote && remote.updatedAt !== record.cloudBaseAt) return { conflict: true, newerCloud: true };
  const result = await syncGameSaveToCloud(record.game, record.slot, record.state, record.updatedAt, user, remote?.updatedAt || 0);
  if (result.conflict || result.newerCloud) return { ...result, conflict: true };
  if (!result.saved && !result.newerCloud) throw new Error('O servidor não confirmou o save.');
  await markGameSaveUploaded({ ...record, cloudBaseAt: record.updatedAt });
  return result;
}

function retryPendingGameSaves() {
  if (pendingGameSaveSync) return pendingGameSaveSync;
  const user = currentUser;
  if (!user) return Promise.resolve();
  pendingGameSaveSync = (async () => {
    const records = await gameSaveStoreTransaction('readonly', store => store.index('user').getAll(typeof profileSaveOwner === 'function' ? profileSaveOwner(user) : user.user));
    for (const record of records) {
      if (currentUser !== user) break;
      if (record.pending) await uploadLocalGameSave(record, user);
    }
  })().catch(() => {})
    .finally(() => { pendingGameSaveSync = null; });
  return pendingGameSaveSync;
}

window.addEventListener('online', () => retryPendingGameSaves());

async function gameSaveStatesEqual(a, b) {
  const left = new Uint8Array((await serializeGameSaveState(a)).buffer);
  const right = new Uint8Array((await serializeGameSaveState(b)).buffer);
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function removeLocalProfileSaves(user) {
  return gameSaveStoreTransaction('readwrite', store=>{
    const request=store.index('user').openCursor(profileSaveOwner(user));
    request.onsuccess=()=>{const cursor=request.result;if(cursor){cursor.delete();cursor.continue();}};
    return request;
  });
}

if (typeof document !== 'undefined' && !document.querySelector('script[data-lux-rom-hybrid-storage]')) {
  const romStorageScript = document.createElement('script');
  romStorageScript.src = 'js/game-rom-hybrid-storage.js?v=20260916-hybrid-rom-storage1';
  romStorageScript.async = true;
  romStorageScript.dataset.luxRomHybridStorage = '1';
  document.head.appendChild(romStorageScript);
}

if (typeof document !== 'undefined' && !document.querySelector('script[data-lux-rom-storage-mode]')) {
  const romStorageModeScript = document.createElement('script');
  romStorageModeScript.src = 'js/game-rom-storage-mode.js?v=20260917-rom-storage-mode3-local-first';
  romStorageModeScript.async = true;
  romStorageModeScript.dataset.luxRomStorageMode = '1';
  document.head.appendChild(romStorageModeScript);
}

if (typeof document !== 'undefined' && !document.querySelector('script[data-lux-rom-playback-file]')) {
  const romPlaybackFileScript = document.createElement('script');
  romPlaybackFileScript.src = 'js/game-rom-playback-file.js?v=20260917-rom-playback-file2';
  romPlaybackFileScript.async = true;
  romPlaybackFileScript.dataset.luxRomPlaybackFile = '1';
  document.head.appendChild(romPlaybackFileScript);
}

if (typeof document !== 'undefined' && !document.querySelector('script[data-lux-rom-cleanup]')) {
  const romCleanupScript = document.createElement('script');
  romCleanupScript.src = 'js/game-rom-cleanup.js?v=20260917-rom-cleanup1';
  romCleanupScript.async = true;
  romCleanupScript.dataset.luxRomCleanup = '1';
  document.head.appendChild(romCleanupScript);
}

if (typeof document !== 'undefined' && !document.querySelector('script[data-lux-rom-manual-clear]')) {
  const romManualClearScript = document.createElement('script');
  romManualClearScript.src = 'js/game-rom-manual-clear.js?v=20260917-rom-manual-clear1';
  romManualClearScript.async = true;
  romManualClearScript.dataset.luxRomManualClear = '1';
  document.head.appendChild(romManualClearScript);
}

if (typeof document !== 'undefined' && !document.querySelector('script[data-lux-emulator-performance]')) {
  const emulatorPerformanceScript = document.createElement('script');
  emulatorPerformanceScript.src = 'js/emulator-speed-fix.js?v=20260916-emulator-performance5';
  emulatorPerformanceScript.async = true;
  emulatorPerformanceScript.dataset.luxEmulatorPerformance = '1';
  document.head.appendChild(emulatorPerformanceScript);
}

if (typeof document !== 'undefined' && !document.querySelector('script[data-lux-arcade-core-autodetect]')) {
  const arcadeCoreScript = document.createElement('script');
  arcadeCoreScript.src = 'js/arcade-core-autodetect.js?v=20260917-arcade-core-auto5';
  arcadeCoreScript.async = true;
  arcadeCoreScript.dataset.luxArcadeCoreAutodetect = '1';
  document.head.appendChild(arcadeCoreScript);
}

if (typeof document !== 'undefined' && !document.querySelector('script[data-lux-arcade-rom-blob]')) {
  const arcadeRomBlobScript = document.createElement('script');
  arcadeRomBlobScript.src = 'js/arcade-rom-blob-bridge.js?v=20260917-arcade-rom-blob1';
  arcadeRomBlobScript.async = true;
  arcadeRomBlobScript.dataset.luxArcadeRomBlob = '1';
  document.head.appendChild(arcadeRomBlobScript);
}

if (typeof document !== 'undefined' && !document.querySelector('script[data-lux-game-hltb]')) {
  const hltbScript = document.createElement('script');
  hltbScript.src = 'js/game-howlongtobeat.js?v=20260918-hltb8-cover-card';
  hltbScript.async = true;
  hltbScript.dataset.luxGameHltb = '1';
  document.head.appendChild(hltbScript);
}

if (typeof document !== 'undefined' && !document.querySelector('script[data-lux-game-mobile-cover-align]')) {
  const gameMobileCoverAlignScript = document.createElement('script');
  gameMobileCoverAlignScript.src = 'js/game-mobile-cover-align.js?v=20260918-cover-align1';
  gameMobileCoverAlignScript.async = true;
  gameMobileCoverAlignScript.dataset.luxGameMobileCoverAlign = '1';
  document.head.appendChild(gameMobileCoverAlignScript);
}

if (typeof document !== 'undefined' && !document.querySelector('script[data-lux-mobile-custom-controls-v2]')) {
  const customControlsScript = document.createElement('script');
  customControlsScript.src = 'js/mobile-custom-controls-v2.js?v=20260917-custom-layout-v2';
  customControlsScript.async = true;
  customControlsScript.dataset.luxMobileCustomControlsV2 = '1';
  document.head.appendChild(customControlsScript);
}

if (typeof document !== 'undefined' && !document.querySelector('script[data-lux-profile-entry-fastboot]')) {
  const profileEntryFastbootScript = document.createElement('script');
  profileEntryFastbootScript.src = 'js/profile-entry-fastboot.js?v=20260917-profile-fastboot3';
  profileEntryFastbootScript.async = false;
  profileEntryFastbootScript.dataset.luxProfileEntryFastboot = '1';
  document.head.appendChild(profileEntryFastbootScript);
}

if (typeof document !== 'undefined' && !document.querySelector('script[data-lux-https-snapshot]')) {
  const iptvHttpsSnapshotScript = document.createElement('script');
  iptvHttpsSnapshotScript.src = 'js/iptv-https-snapshot.js?v=20260918-https-snapshot-clean1';
  iptvHttpsSnapshotScript.async = false;
  iptvHttpsSnapshotScript.dataset.luxHttpsSnapshot = '1';
  document.head.appendChild(iptvHttpsSnapshotScript);
}

if (typeof document !== 'undefined' && !document.querySelector('script[data-lux-provider-grouping-sync]')) {
  const providerGroupingSyncScript = document.createElement('script');
  providerGroupingSyncScript.src = 'js/provider-grouping-sync.js?v=20260918-provider-sync-https-only1';
  providerGroupingSyncScript.async = false;
  providerGroupingSyncScript.dataset.luxProviderGroupingSync = '1';
  document.head.appendChild(providerGroupingSyncScript);
}
