const test = require('node:test');
const assert = require('node:assert/strict');

const store = new Map();
global.localStorage = {
  getItem: key => store.get(key) || null,
  setItem: (key, value) => store.set(key, value)
};
const genres = require('../js/lux-smart-genres.js');
const movie = (name, group, extra = {}) => ({ name, group, type: 'movies', ...extra });

test('groups supplier genres while preserving exact catalogue counts', () => {
  const items = [
    movie('Um', 'Filmes | Ação ⚡ PLUS'),
    movie('Dois', 'Filmes | Ação ⚡ PLL'),
    movie('Três', 'Filmes | Comédia ⚡ PLUS'),
    movie('Quatro', 'Filmes | Lançamentos 2026 ⚡ PLL'),
    movie('Cinco', 'FILMES')
  ];
  const groups = [...new Set(items.map(item => item.group))];
  const result = genres.navigation(items, groups);
  assert.equal(items.length, 5);
  assert.equal(result.counts.get(genres.genreKey(28)), 2);
  assert.equal(result.counts.get(genres.genreKey(35)), 1);
  assert.equal(result.counts.get(genres.collectionKey('2026')), 1);
  assert.equal(result.counts.get('FILMES'), 1);
  assert.equal(genres.label(genres.genreKey(28)), 'Ação');
  assert.equal(genres.label(genres.collectionKey('2026')), 'Lançamentos 2026');
  assert.equal(genres.matches(items[0], genres.genreKey(28)), true);
  assert.equal(genres.matches(items[1], genres.genreKey(35)), false);
  assert.ok(!result.sections[2].keys.includes('Filmes | Ação ⚡ PLUS'));
  assert.equal(result.sections[1].keys.length, 2);
  assert.ok(!result.sections[2].keys.includes('FILMES'));
  assert.ok(result.sections[2].keys.includes('__lux_genre_unclassified__'));
  assert.equal(result.unclassified, 2);
  assert.equal(genres.matches(items[4], '__lux_genre_unclassified__'), true);
});

test('adult items remain outside the smart-genre routes', () => {
  const adult = movie('Restrito', 'Filmes | Ação +18', { isAdult: true });
  const output = genres.navigation([adult], [adult.group]);
  assert.equal(genres.matches(adult, genres.genreKey(28)), false);
  assert.equal(output.counts.get(genres.genreKey(28)), undefined);
  assert.ok(output.sections[2].keys.includes(adult.group));
});

test('TMDB genres are learned from an exact match without network requests', () => {
  const item = movie('Um filme (2026)', 'FILMES');
  assert.equal(genres.learn(item, { title: 'Um filme', releaseDate: '2026-02-01', genreIds: [28, 12] }), true);
  assert.equal(genres.matches(item, genres.genreKey(28)), true);
  assert.equal(genres.matches(item, '__lux_genre_unclassified__'), false);
  assert.equal(genres.matches(item, genres.genreKey(12)), true);
  assert.equal(genres.learn(item, { title: 'Um filme', releaseDate: '2026-02-01', genreIds: [28, 12] }), false);
  assert.equal(genres.learn(item, { title: 'Outro filme', releaseDate: '2026-02-01', genreIds: [27] }), false);
  assert.equal(genres.learn(item, { title: 'Um filme', releaseDate: '2025-02-01', genreIds: [27] }), false);
  assert.equal(genres.matches(item, genres.genreKey(27)), false);
});

test('catalogue index scales to 31,306 supplier entries with no added requests', () => {
  const items = Array.from({ length: 31306 }, (_, i) =>
    movie('Título ' + i, i % 2 ? 'Filmes | Ação ⚡ PLUS' : 'FILMES')
  );
  const results = genres.navigation(items, ['FILMES', 'Filmes | Ação ⚡ PLUS']);
  assert.equal(results.counts.get(genres.genreKey(28)), 15653);
  assert.equal(results.counts.get('FILMES'), 15653);
  assert.equal(items.length, 31306);
});

test('single-group catalog hides phantom genres and retains honest unclassified count', () => {
  const items = Array.from({ length: 31306 }, (_, i) => movie('Novo ' + i, 'FILMES'));
  const result = genres.navigation(items, ['FILMES']);
  assert.equal(result.sections[1].keys.length, 0);
  assert.equal(result.unclassified, 31306);
  assert.equal(result.counts.get('__lux_genre_unclassified__'), 31306);
  assert.ok(result.sections[2].keys.includes('__lux_genre_unclassified__'));
  assert.ok(!result.sections[2].keys.includes('FILMES'));
  assert.equal(result.counts.get(genres.genreKey(28)) || 0, 0);
});

test('adult titles are not exposed by general release-year collections', () => {
  const restricted = movie('Restrito', 'Filmes | Lançamentos 2026', { isAdult: true });
  const normal = movie('Aberto', 'Filmes | Lançamentos 2026');
  const items = [restricted, normal];
  const output = genres.navigation(items, ['Filmes | Lançamentos 2026']);
  assert.equal(output.counts.get(genres.collectionKey('2026')), 1);
  assert.equal(genres.matches(restricted, genres.collectionKey('2026')), false);
  assert.equal(genres.matches(normal, genres.collectionKey('2026')), true);
});

test('TMDB Discover candidates classify only existing titles, using localized or original names', () => {
  const items = [
    movie('Oppenheimer (2023)', 'FILMES'),
    movie('Duna: Parte Dois (2024)', 'FILMES'),
    movie('Barbie (2023)', 'FILMES'),
    movie('Um filme inexistente', 'FILMES'),
    movie('Restrito (2023)', 'FILMES', { isAdult: true })
  ];
  const index = genres.createCatalogIndex(items);
  const matched = genres.ingestCandidates(index, [
    { title: 'Oppenheimer', original_title: 'Oppenheimer', release_date: '2023-07-19', genre_ids: [18, 36] },
    { title: 'Dune: Part Two', original_title: 'Duna: Parte Dois', release_date: '2024-03-01', genre_ids: [878, 12] },
    { title: 'Barbie', original_title: 'Barbie', release_date: '2023-07-01', genre_ids: [35, 12] },
    { title: 'Restrito', release_date: '2023-01-01', genre_ids: [27] },
    { title: 'Filme do TMDB mas não do Lux', genre_ids: [28] }
  ]);
  assert.equal(matched, 3);
  assert.equal(genres.matches(items[0], genres.genreKey(18)), true);
  assert.equal(genres.matches(items[1], genres.genreKey(878)), true);
  assert.equal(genres.matches(items[2], genres.genreKey(35)), true);
  assert.equal(genres.matches(items[3], genres.genreKey(28)), false);
  assert.equal(genres.matches(items[4], genres.genreKey(27)), false);
  const result = genres.navigation(items, ['FILMES']);
  assert.equal(result.unclassified, 1);
  assert.equal(result.counts.get(genres.genreKey(12)), 2);
  assert.equal(items.length, 5);
});

test('genres from original Xtream stream data are recognized without TMDB calls', () => {
  const item = movie('Filme X', 'FILMES', { providerGenreText: 'Ação, Ficção científica', providerGenreIds: [12] });
  assert.deepEqual(new Set(genres.genreIds(item)), new Set([28, 878, 12]));
  assert.equal(genres.navigation([item], ['FILMES']).unclassified, 0);
});

test('TMDB remakes are distinguished by year and very short names with year remain matchable', () => {
  const old = movie('It (1990)', 'FILMES');
  const remake = movie('It (2017)', 'FILMES');
  const index = genres.createCatalogIndex([old, remake]);
  assert.equal(genres.ingestCandidates(index, [
    { title: 'It', original_title: 'It', release_date: '2017-09-08', genre_ids: [27] }
  ]), 1);
  assert.equal(genres.matches(old, genres.genreKey(27)), false);
  assert.equal(genres.matches(remake, genres.genreKey(27)), true);
});

test('bulk TMDB candidate matching against 31,306 provider items respects real counts', () => {
  const items = Array.from({ length: 31306 }, (_, i) =>
    movie('Filme número ' + i + ' (2024)', 'FILMES')
  );
  const candidates = Array.from({ length: 2000 }, (_, i) => ({
    title: 'Filme número ' + i,
    release_date: '2024-09-01',
    genre_ids: i % 2 === 0 ? [28, 12] : [35]
  }));
  const index = genres.createCatalogIndex(items);
  const matched = genres.ingestCandidates(index, candidates);
  const result = genres.navigation(items, ['FILMES']);
  assert.equal(matched, 2000);
  assert.equal(result.counts.get(genres.genreKey(28)), 1000);
  assert.equal(result.counts.get(genres.genreKey(35)), 1000);
  assert.equal(result.unclassified, 29306);
  assert.equal(items.length, 31306);
});

test('TV series use the correct TMDB TV genre taxonomy, independently of films', () => {
  const show = movie('Série Exemplo (2024)', 'SERIES', {type:'series'});
  const film = movie('Série Exemplo (2024)', 'FILMES', {type:'movies'});
  const index = genres.createCatalogIndex([show]);
  assert.equal(genres.ingestCandidates(index, [
    {name:'Série Exemplo',original_name:'Example Series',first_air_date:'2024-07-01',genre_ids:[10759,10765,18]}
  ]),1);
  assert.deepEqual(new Set(genres.genreIds(show)),new Set([28,12,878,14,18]));
  assert.equal(genres.matches(show,genres.genreKey(878)),true);
  assert.equal(genres.matches(film,genres.genreKey(878)),false);
  const nav = genres.navigation([show], ['SERIES']);
  assert.equal(nav.unclassified,0);
  assert.ok(!nav.sections[2].keys.includes('SERIES'));
});

test('provider series genres and adult isolation work with no TMDB lookups', () => {
  const a = movie('Amigos', 'SERIES', {type:'series',providerGenreText:'Comédia'});
  const b = movie('Reality Popular', 'SERIES', {type:'series',providerGenreIds:[10764]});
  const c = movie('Adulto', 'SERIES', {type:'series',providerGenreIds:[10764],isAdult:true});
  const nav=genres.navigation([a,b,c],['SERIES']);
  assert.equal(nav.counts.get(genres.genreKey(35)),1);
  assert.equal(nav.counts.get(genres.genreKey(10764)),1);
  assert.equal(genres.matches(c,genres.genreKey(10764)),false);
  assert.equal(nav.unclassified,0);
});

test('TV series catalog scales to 13,000 titles with exact verified counts', () => {
  const shows=Array.from({length:13000},(_,i)=>
    movie('Seriado '+i+' (2022)','SERIES',{type:'series'}));
  const index=genres.createCatalogIndex(shows);
  const rows=Array.from({length:1000},(_,i)=>({
    name:'Seriado '+i,first_air_date:'2022-01-01',genre_ids:i%2?[35]:[10759]
  }));
  assert.equal(genres.ingestCandidates(index,rows),1000);
  const result=genres.navigation(shows,['SERIES']);
  assert.equal(result.counts.get(genres.genreKey(35)),500);
  assert.equal(result.counts.get(genres.genreKey(28)),500);
  assert.equal(result.counts.get(genres.genreKey(12)),500);
  assert.equal(result.unclassified,12000);
});
