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
      // A newer local save may have been created while the request was in flight.
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
  })().catch(() => { /* Keep pending data on disk; retry on login, online or next game. */ })
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

// Game services bootstrap: hybrid ROM storage, storage mode, local-file playback, cleanup, manual clearing and emulator performance stay outside index.html.
if (typeof document !== 'undefined' && !document.querySelector('script[data-lux-rom-hybrid-storage]')) {
  const romStorageScript = document.createElement('script');
  romStorageScript.src = 'js/game-rom-hybrid-storage.js?v=20260916-hybrid-rom-storage1';
  romStorageScript.async = true;
  romStorageScript.dataset.luxRomHybridStorage = '1';
  document.head.appendChild(romStorageScript);
}

if (typeof document !== 'undefined' && !document.querySelector('script[data-lux-rom-storage-mode]')) {
  const romStorageModeScript = document.createElement('script');
  romStorageModeScript.src = 'js/game-rom-storage-mode.js?v=20260917-rom-storage-mode2';
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

if (typeof document !== 'undefined' && !document.querySelector('script[data-lux-r2-only-roms]')) {
  const r2OnlyScript = document.createElement('script');
  r2OnlyScript.src = 'js/game-r2-only.js?v=20260917-r2-only-roms1';
  r2OnlyScript.async = false;
  r2OnlyScript.dataset.luxR2OnlyRoms = '1';
  document.head.appendChild(r2OnlyScript);
}
