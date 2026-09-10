const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { stripTypeScriptTypes } = require('node:module');
function server(role = 'user', found = true, due = '') {
  let handler, writes = 0;
  const query = { select() { return this; }, eq() { return this; }, order() { return this; },
    range: async () => ({ data: [{ id: 'v1', title: 'Movie' }] }),
    maybeSingle: async () => ({ data: found ? { cargo: role, vencimento: due } : null }),
    upsert(records) { writes++; return { select: async () => ({ data: records }) }; },
    delete() { writes++; return { eq: async () => ({}) }; } };
  vm.runInNewContext(stripTypeScriptTypes(fs.readFileSync('supabase/functions/vod-catalog/index.ts','utf8').replace(/^import .*;\r?$/gm,'')), {
    Request, Response, URL, Deno: { env: { get: () => 'test' }, serve: fn => handler = fn }, createClient: () => ({ from: () => query })
  });
  return { writes: () => writes, call: body => handler(new Request('https://test.com', { method: 'POST', body: JSON.stringify({ username: 'u', password: 'p', ...body }) })) };
}
test('authenticated viewers can read but cannot publish or remove', async () => {
  const app = server();
  assert.equal((await app.call({ action: 'list' })).status, 200);
  for (const action of ['publish', 'remove']) assert.equal((await app.call({ action })).status, 403);
  assert.equal(app.writes(), 0);
  assert.equal((await server('user', false).call({ action: 'list' })).status, 401);
  assert.equal((await server('user', true, '01/01/2000').call({ action: 'list' })).status, 403);
});
test('admin publishing validates URLs and deduplicates records', async () => {
  const app = server('admin');
  assert.equal((await app.call({ action: 'publish', vods: [{ title: 'Test', url: 'javascript:alert(1)' }] })).status, 400);
  assert.equal(app.writes(), 0);
  const vod = { title: 'Test', url: 'https://media.example/test.mp4' };
  const response = await app.call({ action: 'publish', vods: [vod, vod] });
  assert.equal(response.status, 200); assert.equal((await response.json()).vods.length, 1);
  assert.equal((await app.call({ action: 'remove', id: '00000000-0000-0000-0000-000000000001' })).status, 200);
});
function client(fail = false) {
  const source = fs.readFileSync('js/script.js','utf8');
  let pending = [{ title: 'Old', url: 'https://media.example/old.mp4', category: 'Movies' }];
  const remote = [];
  const c = { currentUser: { role: 'admin', user: 'u', pass: 'p' }, allMediaItems: [{ source: 'iptv' }],
    isAdultContent: () => false, renderAdminVodList() {}, getJsonStorage: () => pending,
    localStorage: { setItem: (_key, value) => pending = JSON.parse(value) },
    supabaseClient: { functions: { invoke: async (_name, {body}) => {
      if (fail) return { error: {} };
      if (body.action === 'publish') { remote.push(...body.vods); return { data: { vods: body.vods } }; }
      return { data: { vods: remote } };
    } } }
  };
  vm.createContext(c);
  vm.runInContext(source.slice(source.indexOf('    let sharedVodCatalog'), source.indexOf('    function renderAdminBooksList')), c);
  return { c, pending: () => pending, remote };
}
test('legacy pending videos publish without upload and merge without duplicates', async () => {
  const {c, pending, remote} = client();
  await c.publishPendingVodCatalog();
  assert.equal(pending().length, 0); assert.equal(remote.length, 1);
  await c.loadSharedVodCatalog(); assert.equal(c.allMediaItems.length, 2);
  assert.equal(c.allMediaItems[1].name, 'Old');
});
test('failed publication keeps pending videos for retry', async () => {
  const {c, pending} = client(true);
  await assert.rejects(c.publishPendingVodCatalog());
  assert.equal(pending().length, 1); assert.equal(c.allMediaItems.length, 1);
});
