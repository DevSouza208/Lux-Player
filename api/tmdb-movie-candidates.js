// Shared public TMDB candidate cache for the Lux Original movie-genre index.
// This endpoint never receives playlist URLs, credentials, user identifiers or film lists.
const GENRES = [28, 12, 16, 35, 80, 99, 18, 10751, 14, 36, 27, 10402, 9648, 10749, 878, 10770, 53, 10752, 37];
const BATCH_SIZE = 4;
const PAGE_COUNT = 3;
const MAX_ROUNDS = 3;
const CONCURRENCY = 4;

async function getPage(apiKey, genre, page, round) {
  const params = new URLSearchParams({
    api_key: apiKey,
    language: 'pt-BR',
    include_adult: 'false',
    sort_by: round < 2 ? 'popularity.desc' : 'vote_count.desc',
    with_genres: String(genre),
    page: String(page)
  });
  const response = await fetch('https://api.themoviedb.org/3/discover/movie?' + params, {
    headers: { Accept: 'application/json' },
    signal: AbortSignal.timeout(5500)
  });
  if (!response.ok) throw new Error('TMDB HTTP ' + response.status);
  const payload = await response.json();
  return Array.isArray(payload.results) ? payload.results : [];
}

async function limitedMap(jobs, limit, fn) {
  let cursor = 0;
  const results = new Array(jobs.length);
  await Promise.all(Array.from({ length: Math.min(limit, jobs.length) }, async () => {
    while (cursor < jobs.length) {
      const idx = cursor++;
      try { results[idx] = await fn(jobs[idx]); }
      catch { results[idx] = null; }
    }
  }));
  return results;
}

module.exports = async function tmdbDiscover(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const batch = Number(req.query?.batch);
  const round = Number(req.query?.round);
  const batches = Math.ceil(GENRES.length / BATCH_SIZE);
  if (!Number.isInteger(batch) || batch < 0 || batch >= batches
      || !Number.isInteger(round) || round < 0 || round >= MAX_ROUNDS) {
    return res.status(400).json({ error: 'Invalid batch/round' });
  }

  const apiKey = process.env.TMDB_API_KEY;
  if (!apiKey) return res.status(503).json({ error: 'TMDB candidate service unavailable' });

  const genres = GENRES.slice(batch * BATCH_SIZE, (batch + 1) * BATCH_SIZE);
  const jobs = genres.flatMap(genre => Array.from({ length: PAGE_COUNT }, (_, i) => ({
    genre, page: i + 1 + (round < 2 ? round * PAGE_COUNT : 0)
  })));
  const results = await limitedMap(jobs, CONCURRENCY, job =>
    getPage(apiKey, job.genre, job.page, round)
  );

  const rows = new Map();
  let success = 0;
  results.forEach(items => {
    if (!items) return;
    success++;
    for (const item of items) {
      if (item?.adult || !Number.isInteger(Number(item?.id))) continue;
      const ids = (Array.isArray(item.genre_ids) ? item.genre_ids : []).map(Number)
        .filter(id => GENRES.includes(id));
      if (!ids.length) continue;
      const id = String(item.id);
      const previous = rows.get(id);
      rows.set(id, {
        id: Number(item.id),
        title: String(item.title || '').slice(0, 240),
        original_title: String(item.original_title || '').slice(0, 240),
        release_date: String(item.release_date || '').slice(0, 16),
        genre_ids: previous ? Array.from(new Set([...previous.genre_ids, ...ids])) : ids
      });
    }
  });
  const complete = success === jobs.length;
  res.setHeader('Cache-Control', complete
    ? 'public, max-age=60, s-maxage=86400, stale-while-revalidate=86400'
    : 'public, max-age=0, s-maxage=300');
  return res.status(200).json({
    version: 1, batch, round, complete,
    rows: Array.from(rows.values()), pagesFetched: success
  });
};
