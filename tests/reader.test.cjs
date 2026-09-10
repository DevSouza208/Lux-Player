const { test } = require('node:test');
const assert = require('node:assert/strict');
const { indexedDB, IDBKeyRange } = require('fake-indexeddb');
global.indexedDB = indexedDB; global.IDBKeyRange = IDBKeyRange;
const values = new Map();
global.localStorage = { getItem: key => values.get(key) || null, setItem: (key, value) => values.set(key, value), removeItem: key => values.delete(key) };
const store = require('../js/reader-store.js');

test('reading library, files, notes and positions are isolated by account and profile', async () => {
  const adult = store.owner({ user: 'ana', profile: { data_key: 'adult' } });
  const child = store.owner({ user: 'ana', profile: { data_key: 'child' } });
  const other = store.owner({ user: 'bia', profile: { data_key: 'adult' } });
  await store.put(adult, { id: 'book', title: 'Livro', format: 'pdf' }, [{ name: 'source', blob: new Blob(['PDF']) }]);
  store.writeState(adult, 'book', { page: 8, total: 20, notes: 'Minha nota' });
  store.writeState(adult, 'book', { page: 9 });
  assert.equal((await store.list(adult)).length, 1);
  assert.equal(await (await store.getFile(adult, 'book', 'source')).blob.text(), 'PDF');
  for (const owner of [child, other]) {
    assert.deepEqual(await store.list(owner), []);
    assert.equal(await store.getFile(owner, 'book', 'source'), undefined);
    assert.deepEqual(store.readState(owner, 'book'), {});
  }
  assert.equal(store.readState(adult, 'book').page, 9);
  assert.equal(store.readState(adult, 'book').notes, 'Minha nota');
  await store.put(child, { id: 'book', title: 'Outro exemplar' }, [{ name: 'source', blob: new Blob(['child']) }]);
  await store.remove(adult, 'book');
  assert.equal(await store.getFile(adult, 'book', 'source'), undefined);
  assert.deepEqual(store.readState(adult, 'book'), {});
  assert.equal((await store.list(child)).length, 1);
});

test('EPUB CFI survives notes and appearance changes; recreated profiles start fresh', () => {
  const owner = store.owner({ user: 'ana', profile: { slot: 1, data_key: 'original' } });
  store.writeState(owner, 'epub', { cfi: 'epubcfi(/6/2!/4/2:30)', progress: .3 });
  store.writeState(owner, 'epub', { notes: 'Reflexão', theme: 'sepia' });
  assert.equal(store.readState(owner, 'epub').cfi, 'epubcfi(/6/2!/4/2:30)');
  const recreated = store.owner({ user: 'ana', profile: { slot: 1, data_key: 'replacement' } });
  assert.deepEqual(store.readState(recreated, 'epub'), {});
  assert.throws(() => store.owner(null), /perfil/);
});

test('image folders sort numerically and exclude non-image files', () => {
  const images = store.sortImages(['10.png', '2.jpg', '1.jpeg', 'readme.txt'].map(name => ({ name })));
  assert.deepEqual(images.map(file => file.name), ['1.jpeg', '2.jpg', '10.png']);
});

test('content identity detects changed files and keeps identical imports stable', async () => {
  assert.equal(await store.digest(new Blob(['same'])), await store.digest(new Blob(['same'])));
  assert.notEqual(await store.digest(new Blob(['same'])), await store.digest(new Blob(['changed'])));
});

test('storage errors propagate instead of claiming notes were saved', () => {
  const write = localStorage.setItem;
  localStorage.setItem = () => { throw new Error('quota'); };
  try { assert.throws(() => store.writeState('owner', 'book', { notes: 'pending' }), /quota/); }
  finally { localStorage.setItem = write; }
});
