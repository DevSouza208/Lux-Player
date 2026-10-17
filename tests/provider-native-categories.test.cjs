const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '..', 'js', 'script.js'), 'utf8');
const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');

function part(from, until) {
  const begin = source.indexOf(from);
  const end = source.indexOf(until, begin + from.length);
  assert.ok(begin >= 0 && end > begin, 'Expected source fragment: ' + from);
  return source.slice(begin, end);
}
const groupCode = part('    function normalizeSharedCategoryTitle(value) {', '    async function adminSendCategoriesToUsers() {');
const renderCode = part('    function renderCategories() {', '    // Dispara a busca');
const filterCode = part('    function filterMedia() {', '    function updateScreenHeaderTitle() {');

function categories(saved = {}) {
  const context = {
    currentUser: { categoryMap: saved },
    isAdultContent: (group, name) => /adult|xxx|\+18|18\+/i.test(group + ' ' + name)
  };
  return vm.runInNewContext(groupCode + '\napplySharedCategoryToItem', context);
}

test('current provider group outranks historical shared categories, including for new films and series', () => {
  const apply = categories({
    'movies|velho': 'Filmes | Categoria antiga',
    'series|serie': 'Séries | Categoria antiga'
  });
  const entries = [
    { type:'movies', name:'Velho', group:'Filmes | Ação', url:'http://provider/movie/1.mp4', isAdult:false },
    { type:'movies', name:'Novo', group:'Filmes | Lançamentos', url:'http://provider/movie/2.mp4', isAdult:false },
    { type:'series', name:'Serie', group:'Séries | Netflix', series_id:32, isAdult:false }
  ].map(apply);
  assert.deepEqual(entries.map(x => x.group), ['Filmes | Ação', 'Filmes | Lançamentos', 'Séries | Netflix']);
  assert.equal(entries[0].sharedGroup, 'Filmes | Categoria antiga');
  assert.equal(entries[0].url, 'http://provider/movie/1.mp4');
  assert.equal(entries[2].series_id, 32);
});

test('unclassified entries stay in their original provider group; missing groups get a safe fallback', () => {
  const apply = categories();
  assert.equal(apply({type:'movies',name:'Sem mapeamento',group:'FILMES'}).group,'FILMES');
  assert.equal(apply({type:'series',name:'Nova série',group:''}).group,'Séries');
  assert.equal(apply({type:'live',name:'Novo canal',group:null}).group,'Canais');
});

test('historical categories never relax adult restrictions from the provider', () => {
  const apply = categories({'movies|restrito':'Filmes | Família'});
  const film = apply({type:'movies',name:'Restrito',group:'Filmes +18',isAdult:true});
  assert.equal(film.group,'Filmes +18');
  assert.equal(film.isAdult,true);
});

function fakeDom() {
  const result = {};
  for (const id of ['mediaCountBadge','mobileMediaCountBadge','mobileCatSubtitle','categoriesList','mobileCategoryGrid']) {
    result[id] = {innerText:'',innerHTML:'',scrollTop:22,children:[],appendChild(node){this.children.push(node)}};
  }
  return { nodes: result, document: {
    getElementById: id => result[id] || null,
    createElement: () => ({className:'',innerHTML:'',textContent:''})
  }};
}
function render(items, kind) {
  const dom = fakeDom();
  const context = {
    getSectionItems: () => items, getStoredCategoryOrder: () => [],
    sortCategoriesSmart: (a,b) => a.localeCompare(b),
    isAdultContent: g => /adult|xxx|\+18|18\+/i.test(g),
    isSortModeActive: false, getFavorites: () => [], getItemKey: x => x.id,
    hasResumeEntry: () => false, document: dom.document, window: {},
    currentSection: kind, activeCategory: 'Todos',
    lucide: {createIcons(){}}, escapeGameHtml: x => x, ITEMS_PER_PAGE:60,
    filterMedia: () => {}, requireAdultPin: () => {},
    selectMobileCategory: () => {}, moveCategory: () => {}
  };
  vm.runInNewContext(renderCode + '\nrenderCategories()', context);
  return {
    desktop: dom.nodes.categoriesList.children.map(n => n.textContent + ' ' + n.innerHTML).join(' '),
    mobile: dom.nodes.mobileCategoryGrid.children.map(n => n.textContent + ' ' + n.innerHTML).join(' '),
    badge: dom.nodes.mediaCountBadge.innerText,
    desktopNodes: dom.nodes.categoriesList.children.length,
    mobileNodes: dom.nodes.mobileCategoryGrid.children.length,
    scroll: dom.nodes.categoriesList.scrollTop
  };
}

test('31,306 provider movies produce precise groups and full catalogue count on both interfaces', () => {
  const items = Array.from({length:31306}, (_,i) => ({
    id:'m'+i,type:'movies',name:'Filme '+i,group:'Filmes | Grupo '+(i % 53),isAdult:false
  }));
  const result = render(items,'movies');
  assert.equal(result.badge,'31306 itens');
  assert.equal(result.desktopNodes,56);
  assert.equal(result.mobileNodes,56);
  assert.ok(result.desktop.includes('Filmes | Grupo 0'));
  assert.ok(result.mobile.includes('Filmes | Grupo 0'));
  assert.ok(!result.desktop.includes('Sem gênero identificado'));
  assert.equal(result.scroll,22);
});

test('6,049 provider series produce precise groups on both interfaces', () => {
  const items = Array.from({length:6049}, (_,i) => ({
    id:'s'+i,type:'series',name:'Série '+i,group:'Séries | Grupo '+(i % 21),isAdult:false
  }));
  const result = render(items,'series');
  assert.equal(result.badge,'6049 itens');
  assert.equal(result.desktopNodes,24);
  assert.equal(result.mobileNodes,24);
  assert.ok(result.desktop.includes('Séries | Grupo 0'));
  assert.ok(result.mobile.includes('Séries | Grupo 0'));
});

test('TMDB can still provide art but no longer drives provider grouping or network-wide classification', () => {
  assert.doesNotMatch(html, /src="js\/lux-smart-genres\.js/);
  assert.doesNotMatch(html, /src="js\/lux-genre-candidate-loader\.js/);
  assert.doesNotMatch(source, /function queueSmartMovieClassification\s*\(/);
  assert.doesNotMatch(source, /smartGenreRefreshTimer|scheduleSmartGenreRefresh|learnSmartMovieGenres/);
  assert.match(source, /async function fetchTmdbMetadata\s*\(/);
  assert.match(source, /const rawCategoryCounts = new Map\(\);/);
  assert.doesNotMatch(source, /const smartGenres = null;/);
  const filter = part('    function filterMedia() {', '    function updateScreenHeaderTitle() {');
  assert.match(filter, /matchesCat = c\.group === activeCategory/);
  assert.doesNotMatch(filter, /LuxSmartGenres\.matches/);
});
