const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const src = fs.readFileSync(path.join(__dirname, '..', 'js', 'script.js'), 'utf8');

function sliceBetween(start, end) {
  const a = src.indexOf(start);
  const b = src.indexOf(end, a + start.length);
  assert.ok(a >= 0 && b > a, 'Expected source regions are present: ' + start);
  return src.slice(a, b);
}
function setupGroups(categoryMap = {}) {
  const code = sliceBetween('    function normalizeSharedCategoryTitle(value) {', '    async function adminSendCategoriesToUsers() {');
  const ctx = { currentUser: { categoryMap }, isAdultContent: (group, name) => /adult|xxx|\+18|18\+/i.test(group + ' ' + name) };
  return vm.runInNewContext(code + '\n({applySharedCategoryToItem, sharedCategoryKey})', ctx);
}
function setupPreserve(owner, source) {
  const block = sliceBetween('    let loadedXtreamOwner = null;', '    function setMediaSourceState(');
  const fn = vm.runInNewContext(
    '(function(owner, identity) {' + block +
    '\nloadedXtreamOwner=owner; loadedXtreamIdentity=identity; return preserveXtreamSectionsWhileRefreshing; })',
    {}
  );
  return fn(owner, source);
}
function runFilter(list, selected, query = '') {
  let rendered = 0;
  const ctx = {
    activeCategory: selected,
    activeSearchQuery: query,
    currentSection: 'movies',
    currentFilteredItems: [],
    ITEMS_PER_PAGE: 60,
    visibleCount: 60,
    window: { LuxSmartGenres: { isSmart: key => key.startsWith('__lux_genre_'), matches: () => false } },
    getSectionItems: () => list,
    renderCategories: () => { rendered++; },
    normalizeSearchText: value => value.toLowerCase(),
    getSearchScore: () => 100,
    getCachedSearchData: () => '',
    updateScreenHeaderTitle: () => {},
    renderCurrentPage: () => {},
    compareLiveChannels: () => 0,
    isFavorite: () => false,
    hasResumeEntry: () => false,
  };
  vm.runInNewContext(
    sliceBetween('    function filterMedia() {', '    function updateScreenHeaderTitle() {') + '\nfilterMedia();',
    ctx
  );
  return { category: ctx.activeCategory, items: ctx.currentFilteredItems, rendered };
}

test('new provider titles stay present even when saved grouping has no key', () => {
  const groups = setupGroups({ 'movies|titulo velho': 'Filmes | Ação ⚡ PLUS' });
  const old = { type:'movies', name:'Título Velho', group:'FILMES', source:'xtream', isAdult:false };
  const newer = { type:'movies', name:'Título Novo', group:'FILMES', source:'xtream', isAdult:false };
  const result = [old, newer].map(groups.applySharedCategoryToItem);
  assert.equal(result.length, 2);
  assert.equal(result[0].group, 'Filmes | Ação ⚡ PLUS');
  assert.equal(result[1].group, 'FILMES');
  assert.equal(result[1].providerGroup, 'FILMES');
  assert.equal(result[1].sharedGroup, '');
});

test('stale safe-looking grouping never downgrades the adult restriction', () => {
  const groups = setupGroups({ 'movies|restrito': 'Filmes | Família' });
  const film = { type:'movies', name:'Restrito', group:'Filmes +18', source:'xtream', isAdult:true };
  const enriched = groups.applySharedCategoryToItem(film);
  assert.equal(enriched.group, 'Filmes +18');
  assert.equal(enriched.providerGroup, 'Filmes +18');
  assert.equal(enriched.isAdult, true);
});

test('a stale group can add adult restrictions but not remove them', () => {
  const groups = setupGroups({ 'movies|restrito': 'Adulto +18' });
  const film = { type:'movies', name:'Restrito', group:'FILMES', source:'xtream', isAdult:false };
  assert.equal(groups.applySharedCategoryToItem(film).isAdult, true);
});

test('Xtream refresh keeps movies and series only from the identical owner/source', () => {
  const owner = {};
  const preserved = setupPreserve(owner, 'server\0user\0pass');
  const films = Array.from({length:31306}, (_,i) => ({type:'movies',source:'xtream',id:'m'+i}));
  const series = Array.from({length:6049}, (_,i) => ({type:'series',source:'xtream',id:'s'+i}));
  const previous = [{type:'live',source:'xtream'}, ...films, ...series,
    {type:'movies',source:'secondary',id:'secondary'}];
  const old = preserved(previous,owner,'server\0user\0pass');
  assert.equal(old.length,37355);
  assert.equal(old.filter(i=>i.type==='movies').length,31306);
  assert.equal(old.filter(i=>i.type==='series').length,6049);
  assert.equal(preserved(previous,owner,'server\0user\0other').length,0);
  assert.equal(preserved(previous,{},'server\0user\0pass').length,0);
});

test('successful replacement removes titles genuinely dropped by the new supplier list', () => {
  const owner = {};
  const retain = setupPreserve(owner,'same');
  const old = [{type:'movies',source:'xtream',id:'m1'},
    {type:'movies',source:'xtream',id:'m2'},
    {type:'series',source:'xtream',id:'s1'}];
  let catalog = [...retain(old,owner,'same'),{type:'live',source:'xtream'}];
  assert.equal(catalog.length,4);
  const freshMovies = [{type:'movies',source:'xtream',id:'m2'}, {type:'movies',source:'xtream',id:'m3'}];
  catalog = [...catalog.filter(item=>item.type!=='movies'),...freshMovies];
  assert.deepEqual(catalog.filter(i=>i.type==='movies').map(i=>i.id),['m2','m3']);
  assert.equal(catalog.filter(i=>i.type==='series').length,1);
});

test('Todos always shows every provider item regardless of stale or unknown categories', () => {
  const list = [
    {id:'one',name:'Primeiro',type:'movies',group:'FILMES',isAdult:false},
    {id:'two',name:'Segundo',type:'movies',group:'Filmes | Drama',isAdult:false},
    {id:'three',name:'Terceiro',type:'movies',group:'Sem gênero identificado',isAdult:false},
  ];
  const output = runFilter(list,'Todos');
  assert.equal(output.category,'Todos');
  assert.equal(output.items.length,3);
  assert.deepEqual(output.items.map(i=>i.id),list.map(i=>i.id));
});

test('a category removed in the new catalogue falls back to Todos', () => {
  const list = [{id:'new',name:'Novo',type:'movies',group:'FILMES'}];
  const result = runFilter(list,'Filmes | Categoria Antiga');
  assert.equal(result.category,'Todos');
  assert.equal(result.items.length,1);
  assert.equal(result.rendered,1);
});

test('search applies across all provider titles without restricting to a stale category', () => {
  const list = [{id:'a',group:'FILMES',isAdult:false},{id:'b',group:'Drama',isAdult:false}];
  const result = runFilter(list,'Categoria Antiga','novo');
  assert.equal(result.items.length,2);
  assert.equal(result.category,'Categoria Antiga');
});

test('legacy publish button cannot overwrite recovered historical category maps', () => {
  const body = sliceBetween('    async function adminSendCategoriesToUsers() {','    function parseM3U(data) {');
  assert.doesNotMatch(body,/\.update\s*\(|\.from\s*\(\s*['"]usuarios['"]\s*\)/);
  assert.match(body,/preservada/);
});
