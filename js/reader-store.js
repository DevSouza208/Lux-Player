(function (root) {
  'use strict';
  let database;
  function owner(user) {
    if (!user?.user) throw new Error('Entre em um perfil para usar a biblioteca.');
    return JSON.stringify([user.user, user.profile?.data_key || Number(user.profile?.slot || 1)]);
  }
  function key(ownerId, id) { return JSON.stringify([ownerId, id]); }
  function open() {
    if (!database) database = new Promise((resolve, reject) => {
      const request = indexedDB.open('lux-reading', 1);
      request.onupgradeneeded = () => {
        request.result.createObjectStore('books', { keyPath: 'key' }).createIndex('owner', 'owner');
        request.result.createObjectStore('files', { keyPath: 'key' }).createIndex('book', 'book');
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => { database = null; reject(request.error); };
    });
    return database;
  }
  async function transact(names, mode, action) {
    const db = await open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(names, mode);
      let result;
      try { result = action(tx); } catch (error) { tx.abort(); reject(error); return; }
      tx.oncomplete = () => resolve(result?.result);
      tx.onerror = tx.onabort = () => reject(tx.error || new Error('Não foi possível salvar a biblioteca.'));
    });
  }
  const list = ownerId => transact(['books'], 'readonly', tx => tx.objectStore('books').index('owner').getAll(ownerId));
  const getFile = (ownerId, id, name) => transact(['files'], 'readonly', tx => tx.objectStore('files').get(key(ownerId, id) + ':' + name));
  async function put(ownerId, book, files) {
    const bookKey = key(ownerId, book.id);
    return transact(['books', 'files'], 'readwrite', tx => {
      tx.objectStore('books').put({ ...book, key: bookKey, owner: ownerId });
      for (const file of files) tx.objectStore('files').put({ key: bookKey + ':' + file.name, book: bookKey, blob: file.blob });
    });
  }
  async function remove(ownerId, id, {keepState=false}={}) {
    const bookKey = key(ownerId, id);
    await transact(['books', 'files'], 'readwrite', tx => {
      tx.objectStore('books').delete(bookKey);
      const cursor = tx.objectStore('files').index('book').openCursor(IDBKeyRange.only(bookKey));
      cursor.onsuccess = () => { if (cursor.result) { cursor.result.delete(); cursor.result.continue(); } };
    });
    if(!keepState)localStorage.removeItem('lux_reading:' + bookKey);
  }
  function readState(ownerId, id) {
    try { return JSON.parse(localStorage.getItem('lux_reading:' + key(ownerId, id)) || '{}') || {}; } catch { return {}; }
  }
  function writeState(ownerId, id, patch) {
    const next = { ...readState(ownerId, id), ...patch, updatedAt: Date.now() };
    const records = next._records ||= {};
    const changed = (key, payload) => {
      const old = records[key];
      if (JSON.stringify(old?.payload) !== JSON.stringify(payload)) records[key] = { payload, revision: old?.revision || 0, dirty: true };
    };
    if ('notes' in patch) changed('notebook', { text: next.notes || '' });
    for (const [key, fields] of [['progress',['page','total','progress','cfi']],['preferences',['theme','zoom','fontSize','effect']]]) {
      if (fields.some(field => field in patch)) changed(key, Object.fromEntries(fields.filter(field => next[field] !== undefined).map(field => [field,next[field]])));
    }
    if (patch.annotations) for (const [markId, mark] of Object.entries(patch.annotations)) changed('mark:' + markId, mark);
    localStorage.setItem('lux_reading:' + key(ownerId, id), JSON.stringify(next));
    if(Object.values(records).some(record=>record.dirty))root.LuxReaderCloud?.schedule(ownerId,id);
    return next;
  }
  function replaceState(ownerId,id,state) { localStorage.setItem('lux_reading:'+key(ownerId,id),JSON.stringify(state)); }
  function stateBooks(ownerId) {
    const result=[];
    for(let i=0;i<localStorage.length;i++){
      const name=localStorage.key(i);if(!name?.startsWith('lux_reading:'))continue;
      try{const [owner,book]=JSON.parse(name.slice(12));if(owner===ownerId&&/^[a-f0-9]{64}$/.test(book))result.push(book);}catch{}
    }
    return result;
  }
  async function digest(blob) {
    const bytes = blob instanceof Blob ? await blob.arrayBuffer() : new TextEncoder().encode(blob);
    return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), x => x.toString(16).padStart(2, '0')).join('');
  }
  function sortImages(files) {
    return Array.from(files).filter(file => /\.(png|jpe?g)$/i.test(file.name))
      .sort((a, b) => (a.webkitRelativePath || a.name).localeCompare(b.webkitRelativePath || b.name, 'pt-BR', { numeric: true, sensitivity: 'base' }));
  }
  root.LuxReaderStore = { owner, key, list, getFile, put, remove, readState, writeState, replaceState, stateBooks, digest, sortImages };
  if (typeof module !== 'undefined') module.exports = root.LuxReaderStore;
})(typeof window === 'undefined' ? globalThis : window);
