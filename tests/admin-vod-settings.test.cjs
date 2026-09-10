const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync('js/script.js', 'utf8');
function setup() {
  const fields = {};
  const context = { currentUser: { role: 'admin', pass: 'login-password' }, allMediaItems: [],
    document: { getElementById: id => fields[id] ||= { value: '', style: {}, classList: { add() {}, remove() {} }, focus() {}, replaceChildren(...options) { this.options = options; } }, createElement: () => ({}) },
    loadAdminR2Config() {}, getAdminVodCatalog: () => [], alert() {}, saveJsonStorage() { context.saved = true; } };
  vm.createContext(context);
  vm.runInContext(source.slice(source.indexOf('    let adminR2UnlockedUser'), source.indexOf('    function loadAdminR2Config')), context);
  vm.runInContext(source.slice(source.indexOf('    function adminSaveR2Config'), source.indexOf('    function getAdminR2Config')), context);
  context.lockAdminR2Config();
  return { context, fields };
}
test('configuração exige senha do administrador e volta a bloquear', () => {
  const { context: c, fields: f } = setup();
  c.adminSaveR2Config(); assert.equal(c.saved, undefined);
  f.adminR2Password.value = 'wrong'; c.unlockAdminR2Config(); assert.equal(f.adminR2Fields.disabled, true);
  f.adminR2Password.value = 'login-password'; c.unlockAdminR2Config();
  assert.equal(f.adminR2Password.value, ''); assert.equal(f.adminR2Fields.hidden, false);
  c.adminSaveR2Config(); assert.equal(c.saved, true);
  c.saved = false; c.lockAdminR2Config(); c.adminSaveR2Config(); assert.equal(c.saved, false);
  c.currentUser.role = 'user'; f.adminR2Password.value = 'login-password'; c.unlockAdminR2Config(); assert.equal(f.adminR2Fields.disabled, true);
});
test('categorias combinam catálogo e filmes sem duplicação', () => {
  const { context: c, fields: f } = setup();
  c.getAdminVodCatalog = () => [{ category: 'Ação' }, { category: 'ação' }, { category: 'Drama' }];
  c.allMediaItems = [{ type: 'movies', group: 'Comédia' }, { type: 'live', group: 'TV' }];
  c.renderAdminVodCategories();
  assert.deepEqual(Array.from(f.adminVodCategories.options, o => o.value), ['Ação', 'Comédia', 'Drama']);
});

test('R2 lock controls and category suggestions belong to the VOD panel', () => {
  const html = fs.readFileSync('index.html', 'utf8');
  const panel = html.slice(html.indexOf('<div id="adminTabVods"'), html.indexOf('<div id="gameUploadModal"', html.indexOf('<div id="adminTabVods"')));
  for (const id of ['adminR2UnlockForm', 'adminR2Password', 'adminR2Fields', 'adminR2Lock']) {
    assert.ok(panel.includes('id="' + id + '"'));
    assert.equal(html.split('id="' + id + '"').length, 2);
  }
  assert.match(panel, /id="adminVodCategory"[^>]*list="adminVodCategories"/);
  assert.equal((html.match(/<fieldset\b/g) || []).length, (html.match(/<\/fieldset>/g) || []).length);
});
