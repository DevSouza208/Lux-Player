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
  assert.equal(result.sections[1].keys.length, 19);
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

test('single-group catalog still displays all genres and honest partial counts', () => {
  const items = Array.from({ length: 31306 }, (_, i) => movie('Novo ' + i, 'FILMES'));
  const result = genres.navigation(items, ['FILMES']);
  assert.equal(result.sections[1].keys.length, 19);
  assert.equal(result.unclassified, 31306);
  assert.equal(result.counts.get('__lux_genre_unclassified__'), 31306);
  assert.ok(result.sections[2].keys.includes('__lux_genre_unclassified__'));
  assert.ok(!result.sections[2].keys.includes('FILMES'));
  assert.equal(result.counts.get(genres.genreKey(28)) || 0, 0);
});
