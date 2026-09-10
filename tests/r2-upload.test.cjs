const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { stripTypeScriptTypes } = require('node:module');

function server({ role = 'admin', found = true, configured = true } = {}) {
  let handler, command, signing;
  const env = { SUPABASE_URL: 'https://example.supabase.co', SUPABASE_SERVICE_ROLE_KEY: 'test',
    R2_ACCOUNT_ID: 'a'.repeat(32), R2_ACCESS_KEY_ID: 'test', R2_SECRET_ACCESS_KEY: 'test',
    R2_BUCKET: 'luxvod', R2_PUBLIC_DOMAIN: 'https://media.example.com' };
  if (!configured) delete env.R2_SECRET_ACCESS_KEY;
  const query = { select() { return this; }, eq() { return this; },
    async maybeSingle() { return { data: found ? { cargo: role } : null }; } };
  const source = fs.readFileSync('supabase/functions/r2-upload-url/index.ts', 'utf8').replace(/^import .*;\r?$/gm, '');
  vm.runInNewContext(stripTypeScriptTypes(source), {
    Request, Response, URL, crypto: require('node:crypto').webcrypto,
    Deno: { env: { get: key => env[key] }, serve: fn => { handler = fn; } },
    createClient: () => ({ from: () => query }),
    S3Client: class {}, PutObjectCommand: class { constructor(input) { command = input; } },
    getSignedUrl: async (_client, _command, options) => { signing = options; return 'https://account.r2.cloudflarestorage.com/luxvod/key?signed'; }
  });
  return { call: body => handler(new Request('https://example.com', {
    method: 'POST', body: typeof body === 'string' ? body : JSON.stringify(body)
  })), handler, details: () => ({ command, signing }) };
}
const payload = { username: 'admin', password: 'test', fileName: 'Vídeo #1.mp4',
  contentType: 'video/mp4', bucket: 'luxvod', prefix: '/vods/filmes/' };

test('nega requisições sem login, credenciais inválidas e usuários comuns', async () => {
  assert.equal((await server().call({})).status, 401);
  assert.equal((await server({ found: false }).call(payload)).status, 401);
  assert.equal((await server({ role: 'user' }).call(payload)).status, 403);
});
test('valida JSON, bucket, prefixo e tipo antes de assinar', async () => {
  for (const body of ['{', null, { ...payload, bucket: 'other' }, { ...payload, prefix: '../vods' },
    { ...payload, contentType: 'text/html' }, { ...payload, fileName: '' }]) {
    const app = server();
    assert.equal((await app.call(body)).status, 400);
    assert.equal(app.details().command, undefined);
  }
});
test('secrets ausentes não produzem URL de upload', async () => {
  assert.equal((await server({ configured: false }).call(payload)).status, 503);
});
test('assina PUT no luxvod e retorna URL pública codificada e chave única', async () => {
  const app = server();
  const response = await app.call(payload);
  assert.equal(response.status, 200);
  const data = await response.json();
  assert.match(data.objectKey, /^vods\/filmes\/[a-f0-9-]+-Vídeo #1.mp4$/);
  assert.ok(data.publicUrl.endsWith('V%C3%ADdeo%20%231.mp4'));
  assert.equal(app.details().command.Bucket, 'luxvod');
  assert.equal(app.details().command.ACL, undefined);
  assert.equal(app.details().command.ContentType, 'video/mp4');
  assert.equal(app.details().signing.expiresIn, 900);
  assert.ok(app.details().signing.signableHeaders.has('content-type'));
  assert.notEqual((await (await app.call(payload)).json()).objectKey, data.objectKey);
});
test('preflight funciona para Electron e métodos inesperados são recusados', async () => {
  const app = server();
  const preflight = await app.handler(new Request('https://example.com', { method: 'OPTIONS', headers: { Origin: 'null' } }));
  assert.equal(preflight.status, 204);
  assert.equal(preflight.headers.get('access-control-allow-origin'), '*');
  assert.equal((await app.handler(new Request('https://example.com'))).status, 405);
});

test('front-end faz PUT e só salva o catálogo após sucesso', async () => {
  const source = fs.readFileSync('js/script.js', 'utf8');
  const block = source.slice(source.indexOf('    let adminVodUploadBusy'), source.indexOf('    async function adminAddVodCatalogEntry'));
  for (const ok of [true, false]) {
    const fields = Object.fromEntries(['adminVodUploadStatus', 'adminVodTitle', 'adminVodCategory', 'adminVodPoster',
      'adminVodFile', 'adminVodUrl', 'adminR2Prefix'].map(id => [id, { value: '', disabled: false }]));
    fields.adminVodTitle.value = 'Teste';
    fields.adminVodFile.files = [{ name: 'test.mp4', type: 'video/mp4', size: 10 }];
    let saved, invoked = 0, put = 0;
    const context = {
      URL, TypeError, currentUser: { role: 'admin', user: 'u', pass: 'p' },
      document: { getElementById: id => fields[id], querySelectorAll: () => Object.values(fields) },
      supabaseClient: { functions: { invoke: async (name, options) => {
        invoked++; assert.equal(name, 'r2-upload-url'); assert.equal(options.body.bucket, 'luxvod');
        return { data: { uploadUrl: 'https://account.r2.cloudflarestorage.com/key', publicUrl: 'https://media.example.com/key', objectKey: 'key' } };
      } } },
      fetch: async (_url, options) => { put++; assert.equal(options.method, 'PUT'); assert.equal(options.headers['Content-Type'], 'video/mp4'); return { ok, status: ok ? 200 : 403 }; },
      localStorage: { setItem: (_key, value) => { saved = JSON.parse(value); } },
      getPendingVodCatalog: () => [], renderAdminVodList: () => {}, publishPendingVodCatalog: async () => { assert.ok(saved); }
    };
    vm.createContext(context); vm.runInContext(block, context);
    await Promise.all([context.adminUploadVodToR2(), context.adminUploadVodToR2()]);
    assert.equal(invoked, 1); assert.equal(put, 1);
    if (ok) assert.equal(saved[0].objectKey, 'key');
    else assert.equal(saved, undefined);
    assert.ok(Object.values(fields).every(field => !field.disabled));
  }
});
