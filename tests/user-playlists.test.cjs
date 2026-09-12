const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), vm = require('node:vm');
const { stripTypeScriptTypes } = require('node:module');

test('playlist server enforces admin uploads, 200 MB limit, complete parts and account-bound reads', async () => {
  let handler, listed;
  const id = '00000000-0000-4000-8000-000000000000';
  let files = [{ name: '000.part', metadata: { size: 5 } }];
  const bucket = {
    createSignedUploadUrl: async path => ({ data: { token: path } }),
    list: async folder => { listed = folder; return { data: files }; },
    createSignedUrls: async paths => ({ data: paths.map(signedUrl => ({ signedUrl })) })
  };
  const db = { storage: { from: () => bucket }, from: () => {
    let password;
    return { select() { return this; }, eq(key, value) { if (key === 'senha') password = value; return this; },
      maybeSingle: async () => ({ data: password === 'wrong' ? null : { cargo: password, lista_m3u: 'm3u-storage:' + id } }) };
  } };
  const source = fs.readFileSync('supabase/functions/user-playlists/index.ts', 'utf8').replace(/^import .*;\r?$/gm, '');
  vm.runInNewContext(stripTypeScriptTypes(source), { Request, Response, crypto, createClient: () => db,
    Deno: { env: { get() {} }, serve: fn => handler = fn } });
  const call = body => handler(new Request('https://test.invalid', { method: 'POST', body: JSON.stringify({ username: 'test', password: 'admin', ...body }) }));
  assert.equal((await call({ action: 'prepare', password: 'user', size: 5 })).status, 403);
  assert.equal((await call({ action: 'read', password: 'wrong' })).status, 401);
  for (const size of [0, -1, '5', 200 * 1024 * 1024 + 1]) assert.equal((await call({ action: 'prepare', size })).status, 400);
  const plan = await (await call({ action: 'prepare', size: 200 * 1024 * 1024 })).json();
  assert.equal(plan.parts.length, 25);
  assert.equal(plan.chunkSize, 8 * 1024 * 1024);
  const read = await call({ action: 'read', password: 'user', reference: 'm3u-storage:someone-else' });
  assert.equal(read.status, 200);
  assert.equal(listed, id);
  assert.equal((await call({ action: 'verify', reference: 'm3u-storage:' + id, size: 6 })).status, 400);
  files = [{ name: '001.part', metadata: { size: 5 } }];
  assert.equal((await call({ action: 'read' })).status, 400);
});

test('playlist upload sends ordered binary parts and only returns a reference after verification', async () => {
  const source = fs.readFileSync('js/script.js', 'utf8');
  const calls = [], chunks = [];
  let fail = false;
  const context = { currentUser: { user: 'admin', pass: 'pass' },
    document: { getElementById: () => ({ textContent: '' }) },
    supabaseClient: {
      functions: { invoke: async (_, { body }) => { calls.push(body.action); return { data: body.action === 'prepare'
        ? { reference: 'm3u-storage:test', chunkSize: 8, parts: [{ path: '0' }, { path: '1' }, { path: '2' }] } : {} }; } },
      storage: { from: () => ({ uploadToSignedUrl: async (_, token, blob) => { chunks.push(await blob.text()); return fail ? { error: Error('offline') } : {}; } }) }
    } };
  vm.createContext(context);
  vm.runInContext(source.slice(source.indexOf('    async function userPlaylistRequest'), source.indexOf('    let editingAdminUsername')), context);
  const file = new File(['#EXTM3U\n#EXTINF:0,A\nx'], 'list.m3u');
  assert.equal(await context.uploadUserPlaylist(file), 'm3u-storage:test');
  assert.equal(chunks.join(''), await file.text());
  assert.deepEqual(calls, ['prepare', 'verify']);
  calls.length = 0; fail = true;
  await assert.rejects(context.uploadUserPlaylist(file));
  assert.deepEqual(calls, ['prepare']);
  await assert.rejects(context.uploadUserPlaylist({ name: 'big.m3u', size: 200 * 1024 * 1024 + 1 }), /200 MB/);
});
