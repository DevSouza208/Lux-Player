const test = require('node:test');
const assert = require('node:assert/strict');
const handler = require('../api/tmdb-movie-candidates.js');

function response() {
  return {
    statusCode: 200,
    headers: {},
    status(code) { this.statusCode = code; return this; },
    setHeader(key, value) { this.headers[key] = value; return this; },
    json(payload) { this.payload = payload; return this; }
  };
}

test('public TMDB candidate endpoint rejects non-GET and invalid batches', async () => {
  const denied = response();
  await handler({ method: 'POST', query: {} }, denied);
  assert.equal(denied.statusCode, 405);
  const invalid = response();
  await handler({ method: 'GET', query: { batch: 999, round: 0 } }, invalid);
  assert.equal(invalid.statusCode, 400);
});

test('response is privacy-safe and combines genre IDs without catalog credentials', async () => {
  const oldFetch = global.fetch;
  const oldKey = process.env.TMDB_API_KEY;
  process.env.TMDB_API_KEY = 'test-only-key';
  const urls = [];
  global.fetch = async url => {
    urls.push(String(url));
    return {
      ok: true,
      json: async () => ({
        results: [
          { id: 1, title: 'Filme', original_title: 'Movie', release_date: '2024-01-01', genre_ids: [28, 18], adult: false },
          { id: 2, title: 'Restrito', adult: true, genre_ids: [27] }
        ]
      })
    };
  };
  try {
    const res = response();
    await handler({ method: 'GET', query: { batch: '0', round: '0' } }, res);
    assert.equal(res.statusCode, 200);
    assert.equal(res.payload.complete, true);
    assert.equal(res.payload.pagesFetched, 12);
    assert.equal(urls.length, 12);
    assert.equal(res.payload.rows.length, 1);
    assert.deepEqual(res.payload.rows[0].genre_ids, [28, 18]);
    assert.equal(JSON.stringify(res.payload).includes('test-only-key'), false);
    assert.equal(JSON.stringify(res.payload).includes('playlist'), false);
    assert.match(res.headers['Cache-Control'], /s-maxage=86400/);
    assert.ok(urls.every(url => url.includes('include_adult=false')));
  } finally {
    global.fetch = oldFetch;
    if (oldKey === undefined) delete process.env.TMDB_API_KEY;
    else process.env.TMDB_API_KEY = oldKey;
  }
});

test('missing server-side TMDB key fails safely with no external request', async () => {
  const oldKey = process.env.TMDB_API_KEY;
  delete process.env.TMDB_API_KEY;
  try {
    const res = response();
    await handler({ method: 'GET', query: { batch: 0, round: 0 } }, res);
    assert.equal(res.statusCode, 503);
  } finally {
    if (oldKey !== undefined) process.env.TMDB_API_KEY = oldKey;
  }
});
