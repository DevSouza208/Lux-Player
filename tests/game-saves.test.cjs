const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { stripTypeScriptTypes } = require('node:module');
function cloud() {
  let handler;
  const rows = new Map(), files = new Map();
  const key = (user, game, slot) => JSON.stringify([user, game, Number(slot)]);
  const db = {
    from(table) {
      const filters = {};
      return { select() { return this; }, eq(k,v) { filters[k] = v; return this; },
        async maybeSingle() {
          if (table === 'account_profiles') return { data: ['alice','bob'].includes(filters.user_name) && (filters.slot === 1 || (filters.user_name === 'alice' && filters.slot === 2)) ? {slot:filters.slot,data_key:''} : null };
          if (table === 'usuarios') return { data: ['alice','bob'].includes(filters.usuario) && filters.senha === 'secret' ? { usuario: filters.usuario } : null };
          return { data: rows.get(key(filters.user_name, filters.game_key, filters.slot)) };
        },
        then(resolve) { resolve({ data: [...rows.values()].filter(r => r.user_name === filters.user_name && r.game_key === filters.game_key) }); }
      };
    },
    storage: { from: () => ({
      async upload(path, bytes, options) { assert.equal(options.upsert, false); files.set(path, new Blob([bytes])); return {}; },
      async download(path) { return { data: files.get(path) }; },
      async remove(paths) { paths.forEach(path => files.delete(path)); return {}; }
    }) },
    async rpc(name, p) {
      assert.equal(name, 'commit_game_save_checked');
      const id = key(p.p_user_name, p.p_game_key, p.p_slot);
      if (p.p_expected_at != null && (rows.get(id)?.client_updated_at || 0) !== p.p_expected_at) return { data: false };
      if ((rows.get(id)?.client_updated_at || 0) >= p.p_updated_at) return { data: false };
      rows.set(id, { user_name: p.p_user_name, game_key: p.p_game_key, slot: p.p_slot, storage_path: p.p_storage_path, state_format: p.p_state_format, client_updated_at: p.p_updated_at });
      return { data: true };
    }
  };
  const source = fs.readFileSync('supabase/functions/game-save-sync/index.ts','utf8').replace(/^import .*;\r?$/gm,'');
  vm.runInNewContext(stripTypeScriptTypes(source), { Response, Request, URL, atob, btoa, crypto: require('node:crypto').webcrypto,
    Deno: { env: { get: () => 'test' }, serve: fn => handler = fn }, createClient: () => db });
  return { files, call: body => handler(new Request('https://test.com', { method: 'POST', body: JSON.stringify({ username: 'alice', password: 'secret', gameKey: 'game-1', slot: 1, ...body }) })) };
}
const payload = { action: 'save', updatedAt: Date.now() - 1000, dataBase64: btoa('save-data'), format: 'uint8array' };
test('cloud save roundtrip is isolated per account and slot', async () => {
  const app = cloud();
  assert.equal((await app.call(payload)).status, 200);
  const loaded = await (await app.call({ action: 'load' })).json();
  assert.equal(atob(loaded.save.dataBase64), 'save-data');
  assert.equal(loaded.save.format, 'uint8array');
  assert.equal((await (await app.call({ action: 'load', username: 'bob' })).json()).save, null);
  assert.equal((await (await app.call({ action: 'load', slot: 2 })).json()).save, null);
  assert.equal((await app.call({ action: 'load', password: 'wrong' })).status, 401);
});
test('old and concurrent uploads cannot replace newer cloud state', async () => {
  const app = cloud();
  await Promise.all([app.call(payload), app.call({ ...payload, updatedAt: payload.updatedAt + 1, dataBase64: btoa('newer') })]);
  const loaded = await (await app.call({ action: 'load' })).json();
  assert.equal(atob(loaded.save.dataBase64), 'newer');
  assert.equal((await (await app.call(payload)).json()).newerCloud, true);
});
test('native slot zero roundtrips in the cloud and remains isolated from states and profiles', async () => {
  const app = cloud();
  assert.equal((await app.call({ ...payload, slot: 0 })).status, 200);
  assert.equal(atob((await (await app.call({ action: 'load', slot: 0 })).json()).save.dataBase64), 'save-data');
  for (const extra of [{ slot: 1 }, { slot: 0, username: 'bob' }, { slot: 0, profileSlot: 2 }]) {
    assert.equal((await (await app.call({ action: 'load', ...extra })).json()).save, null);
  }
  for (const slot of [null, '', false, -1, 4]) assert.equal((await app.call({ ...payload, slot })).status, 400);
});
test('invalid save formats, slots and excessive payloads are rejected', async () => {
  const app = cloud();
  for (const override of [{slot:4}, {format:'bad'}, {dataBase64:'!!'}, {dataBase64:''}, {updatedAt:Date.now()+3600000}])
    assert.equal((await app.call({ ...payload, ...override })).status, 400);
  assert.equal((await app.call({ ...payload, dataBase64:'a'.repeat(8*1024*1024+4) })).status, 413);
  assert.equal(app.files.size, 0);
});
function emulator() {
  const storage = new Map();
  const field = { textContent:'', classList:{add(){},remove(){}} };
  const c = { currentUser:{user:'alice'}, console, Date, setTimeout: fn => { fn(); },
    localStorage:{getItem:k=>storage.get(k),setItem:(k,v)=>storage.set(k,v)},
    document:{getElementById:()=>field,querySelectorAll:()=>[]},
    getCloudGameSaveKey:game=>'game-'+game.id,
    window:{EJS_emulator:{gameManager:{loadState:state=>{c.loaded=state;},getState:()=>new Uint8Array([1,2])},pause(){}}},
    readLocalGameSave:async()=>null, writeLocalGameSave:async()=>{}, alert:message=>{c.alerted=message;}
  };
  vm.createContext(c);vm.runInContext(fs.readFileSync('js/emulator.js','utf8'),c);
  vm.runInContext('activeEmulatorGame = {id:1}; requestedSaveSlot = 1;',c);
  return {c,field,storage};
}
test('new device downloads a save even if slot metadata already has its timestamp', async () => {
  const {c,storage}=emulator();
  storage.set(c.getGameSaveKey({id:1}),JSON.stringify({1:{savedAt:new Date(1000).toISOString(),cloudUpdatedAt:1000}}));
  c.loadCloudGameSave=async()=>({updatedAt:1000,state:'remote-state'});
  await c.loadRequestedGameSlot();assert.equal(c.loaded,'remote-state');
  assert.notEqual(c.getGameSaveKey({id:1},{user:'alice'}),c.getGameSaveKey({id:1},{user:'bob'}));
});
test('local save survives cloud outage and game waits for upload confirmation', async () => {
  const {c,field}=emulator();let release;
  c.writeLocalGameSave=async()=>{c.persisted=true;};
  c.readLocalGameSave=async()=>({});
  c.uploadLocalGameSave=()=>new Promise(resolve=>release=resolve);
  c.closeGameEmulator=()=>{c.closed=true;};
  const running=c.saveGameAndClose(1);
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(c.persisted,true);assert.equal(c.closed,undefined);
  release({saved:true});await running;assert.equal(c.closed,true);
  c.closed=false;c.uploadLocalGameSave=async()=>{throw new Error('offline');};
  await c.saveGameAndClose(1);assert.equal(c.closed,false);assert.match(field.textContent,/pendente/);
});
test('pending queue retries only current user and preserves failures', async () => {
  const c={currentUser:{user:'alice'},window:{addEventListener(){}},getCloudGameSaveKey:g=>g.id};
  vm.createContext(c);vm.runInContext(fs.readFileSync('js/game-save-store.js','utf8'),c);
  const pending={user:'alice',pending:true};
  c.gameSaveStoreTransaction=async(_mode,operation)=>operation({index:()=>({getAll:user=>{assert.equal(user,'alice');return [pending];}})});
  c.uploadLocalGameSave=async()=>{throw new Error('offline');};
  await c.retryPendingGameSaves();assert.equal(pending.pending,true);
  c.uploadLocalGameSave=async(record,user)=>{assert.equal(user.user,'alice');record.pending=false;};
  await c.retryPendingGameSaves();assert.equal(pending.pending,false);
});

test('different saves ask before choosing local or cloud; cancellation preserves both', async () => {
  for (const choice of ['local','cloud',null]) {
    const {c}=emulator();let chosen = 0, writes = 0;
    c.readLocalGameSave=async()=>({state:'local',updatedAt:100});
    c.loadCloudGameSave=async()=>({state:'cloud',updatedAt:200});
    c.gameSaveStatesEqual=async(a,b)=>a===b;
    c.chooseGameSaveSource=async(local,cloud)=>{assert.equal(local,100);assert.equal(cloud,200);chosen++;return choice;};
    c.writeLocalGameSave=async()=>{writes++;};
    c.uploadLocalGameSave=async()=>({saved:true});
    await c.loadRequestedGameSlot();
    assert.equal(chosen,1);
    assert.equal(c.loaded,choice || undefined);
    assert.equal(writes,choice ? 1 : 0);
  }
});
test('native save is persisted before upload and stays pending on network failure', async () => {
  const { c } = emulator();
  let local, flushed = false;
  c.window.EJS_emulator.gameManager.saveSaveFiles = async () => { flushed = true; };
  c.window.EJS_emulator.gameManager.getSaveFile = async () => { assert.equal(flushed, true); return new Uint8Array([7, 8]); };
  c.readLocalGameSave = async () => local;
  c.writeLocalGameSave = async (game, slot, state, updatedAt, pending, user, cloudBaseAt) => { local = { game, slot, state, updatedAt, pending, cloudBaseAt }; };
  c.uploadLocalGameSave = async record => { assert.equal(record, local); assert.equal(record.slot, 0); throw Error('offline'); };
  const result = await c.saveNativeGame();
  assert.equal(result.savedLocally, true);
  assert.equal(result.syncError.message, 'offline');
  assert.equal(local.pending, true);
  assert.deepEqual([...local.state], [7, 8]);
});

test('native cloud download is cached locally with cloud revision for offline reuse', async () => {
  const { c } = emulator();
  const state = new Uint8Array([3, 4]);
  let local, loaded;
  c.window.EJS_emulator.gameManager.FS = { writeFile: (_path, bytes) => { loaded = bytes; } };
  c.window.EJS_emulator.gameManager.getSaveFilePath = () => '/save.srm';
  c.readLocalGameSave = async () => local;
  c.loadCloudGameSave = async () => ({ state, updatedAt: 1200 });
  c.writeLocalGameSave = async (game, slot, bytes, updatedAt, pending, user, cloudBaseAt) => { local = { state: bytes, updatedAt, pending, cloudBaseAt }; assert.equal(slot, 0); };
  await c.loadNativeGameSave();
  assert.equal(loaded, state);
  assert.equal(local.pending, false);
  assert.equal(local.cloudBaseAt, 1200);
  c.loadCloudGameSave = async () => { throw Error('offline'); };
  c.uploadLocalGameSave = async () => { throw Error('offline'); };
  loaded = null;
  await c.loadNativeGameSave();
  assert.equal(loaded, state);
});
test('identical save data skips the choice even with different timestamps', async () => {
  const {c}=emulator();
  c.readLocalGameSave=async()=>({state:'same',updatedAt:100});
  c.loadCloudGameSave=async()=>({state:'same',updatedAt:200});
  c.gameSaveStatesEqual=async(a,b)=>a===b;
  c.chooseGameSaveSource=()=>{assert.fail('No conflict expected');};
  await c.loadRequestedGameSlot();assert.equal(c.loaded,'same');
});
test('background upload stops on divergent cloud version without clearing pending data', async () => {
  const c={currentUser:{user:'alice'},window:{addEventListener(){}},getCloudGameSaveKey:g=>g.id};
  vm.createContext(c);vm.runInContext(fs.readFileSync('js/game-save-store.js','utf8'),c);
  c.loadCloudGameSave=async()=>({updatedAt:200,state:'remote'});
  c.gameSaveStatesEqual=async()=>false;
  c.syncGameSaveToCloud=async()=>assert.fail('Must not overwrite');
  c.markGameSaveUploaded=async()=>assert.fail('Must keep pending');
  const result=await c.uploadLocalGameSave({state:'local',updatedAt:300,cloudBaseAt:100},c.currentUser);
  assert.equal(result.conflict,true);
});
test('server rejects upload if another device changed the expected cloud version', async () => {
  const app=cloud();await app.call(payload);
  const response=await app.call({...payload,updatedAt:payload.updatedAt+1,expectedCloudAt:0,dataBase64:btoa('wrong')});
  assert.equal((await response.json()).conflict,true);
  assert.equal(atob((await (await app.call({action:'load'})).json()).save.dataBase64),'save-data');
});

test('cloud game saves separate profiles on the same account', async()=>{
 const app=cloud();
 assert.equal((await app.call({...payload,profileSlot:2})).status,200);
 assert.equal((await (await app.call({action:'load',profileSlot:1})).json()).save,null);
 assert.equal(atob((await (await app.call({action:'load',profileSlot:2})).json()).save.dataBase64),'save-data');
 assert.equal((await app.call({action:'load',profileSlot:3})).status,403);
});
