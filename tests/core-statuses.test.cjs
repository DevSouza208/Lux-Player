const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { stripTypeScriptTypes } = require('node:module');

test('cores ignore legacy local overrides and only display server-confirmed values', () => {
  const context = { window: {}, localStorage: { getItem() { throw Error('Local status must not be read'); }, setItem() { throw Error('Local status must not be written'); } } };
  vm.runInNewContext(fs.readFileSync('js/external-roms.js', 'utf8'), context);
  const cores = context.window.LuxExternalRoms;
  assert.ok(cores.coreStatuses().every(core => core.status === 'unknown'));
  cores.setCoreStatuses({ gba: 'untested', psp: 'tested' });
  assert.equal(cores.coreStatuses().find(core => core.id === 'gba').tested, false);
  assert.equal(cores.coreStatuses().find(core => core.id === 'psp').tested, true);
});

test('public endpoint reads without login and restricts publishing to valid administrators', async () => {
  let handler, writes = 0;
  const records = { gba: 'tested' };
  const db = { from(table) { let password; return {
    select() { return this; }, eq(key, value) { if (key === 'senha') password = value; return this; },
    async maybeSingle() { return { data: password === 'bad' ? null : { cargo: password === 'admin' ? 'admin' : 'user' } }; },
    async upsert(rows) { writes++; for (const row of rows) records[row.core_id] = row.status; return {}; },
    then(resolve) { resolve({ data: Object.entries(records).map(([core_id, status]) => ({ core_id, status })) }); }
  }; } };
  const source = fs.readFileSync('supabase/functions/core-statuses/index.ts', 'utf8').replace(/^import .*;\r?$/gm, '');
  vm.runInNewContext(stripTypeScriptTypes(source), { Response, Request, console, Deno: { env: { get: () => '' }, serve: fn => { handler = fn; } }, createClient: () => db });
  const call = body => handler(new Request('https://example.test', { method: 'POST', body: JSON.stringify(body) }));
  assert.deepEqual((await (await call({ action: 'get' })).json()).statuses, { gba: 'tested' });
  for (const password of [undefined, 'bad', 'user']) assert.equal((await call({ action: 'save', username: 'test', password, statuses: { gba: 'untested' } })).status, password === undefined ? 401 : 403);
  assert.equal(writes, 0);
  for (const statuses of [[], {}, { gba: 'invalid' }, { unknown: 'tested' }]) assert.equal((await call({ action: 'save', username: 'test', password: 'admin', statuses })).status, 400);
  assert.equal((await call({ action: 'save', username: 'test', password: 'admin', statuses: { gba: 'untested' } })).status, 200);
  assert.deepEqual((await (await call({ action: 'get' })).json()).statuses, { gba: 'untested' });
  assert.equal(writes, 1);
});

test('failed publishing preserves shared values; successful publishing uses server response', async () => {
  let shared = 'tested', fail = true;
  const select = { dataset: { coreStatusId: 'gba' }, value: 'untested' };
  const nodes = { adminCoreStatusSave: {}, adminCoreStatusMessage: {} };
  const context = {
    window: { LuxExternalRoms: { coreStatuses: () => [{ id: 'gba', status: shared }], setCoreStatuses: data => { shared = data.gba; } } },
    document: { getElementById: id => nodes[id] || null, querySelectorAll: () => [select] },
    currentUser: { role: 'admin', user: 'test', pass: 'test' },
    supabaseClient: { functions: { invoke: async () => fail ? { error: Error('offline') } : { data: { statuses: { gba: 'untested' } } } } }
  };
  const source = fs.readFileSync('js/script.js', 'utf8');
  vm.createContext(context);
  vm.runInContext(source.slice(source.indexOf('    let coreStatusRequest'), source.indexOf('    let adminR2UnlockedUser')), context);
  await context.saveAdminCoreStatuses();
  assert.equal(shared, 'tested');
  assert.match(nodes.adminCoreStatusMessage.textContent, /não foram salvas/);
  assert.equal(nodes.adminCoreStatusSave.disabled, false);
  fail = false;
  await context.saveAdminCoreStatuses();
  assert.equal(shared, 'untested');
  assert.match(nodes.adminCoreStatusMessage.textContent, /publicados/);
});
