import { createClient } from 'npm:@supabase/supabase-js@2';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Cache-Control': 'no-store'
};
const json = (data: unknown, status = 200) => Response.json(data, { status, headers: cors });
const GROUPING_VERSION = 'tmdb-v2';
const TMDB_FALLBACK_KEY = '3fd2be6f0c70a2a598f084ddfb75487c';

function cleanText(value: unknown, max = 500) {
  return String(value ?? '').trim().slice(0, max);
}

function normalize(value: unknown) {
  return String(value ?? '')
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\+/g, ' plus ')
    .replace(/&/g, ' e ')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function tmdbSearchTitle(value: unknown) {
  return cleanText(value, 300)
    .replace(/^\s*\d{1,3}\s*[xX]\s*\d{1,4}(?:\s*[\/-]\s*\d{1,4})?[A-Za-z]{0,3}\s+/i, '')
    .replace(/^\s*S\s*\d{1,3}\s*E\s*\d{1,4}(?:\s*[\/-]\s*E?\s*\d{1,4})?[A-Za-z]{0,3}\s+/i, '')
    .replace(/^\s*T\s*\d{1,3}\s*E\s*\d{1,4}(?:\s*[\/-]\s*E?\s*\d{1,4})?[A-Za-z]{0,3}\s+/i, '')
    .replace(/\s*[:|]\s*.+$/, '')
    .trim();
}

function tokenScore(a: string, b: string) {
  const aa = new Set(normalize(a).split(' ').filter(Boolean));
  const bb = new Set(normalize(b).split(' ').filter(Boolean));
  if (!aa.size || !bb.size) return 0;
  let hit = 0;
  aa.forEach(token => { if (bb.has(token)) hit += 1; });
  return hit / Math.max(aa.size, bb.size);
}

async function resolveAccount(db: any, body: any) {
  const username = cleanText(body?.username, 160);
  const credential = String(body?.password ?? '');
  if (!username || !credential) return { error: json({ error: 'Login necessário.' }, 401) };
  const { data: account, error } = await db.rpc('lux_auth_resolve', { p_username: username, p_credential: credential });
  if (error) throw error;
  if (!account) return { error: json({ error: 'Credencial inválida ou sessão expirada.' }, 401) };
  if (String(account.cargo || '').trim().toLowerCase() !== 'admin') return { error: json({ error: 'Acesso exclusivo de administrador.' }, 403) };
  return { account, username };
}

function normalizeCategories(input: unknown) {
  const rows = Array.isArray(input) ? input : [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const row of rows) {
    const value = cleanText(row, 180);
    if (!value || !/^s[eé]ries\s*\|/i.test(value)) continue;
    const key = normalize(value);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(value);
    if (out.length >= 120) break;
  }
  if (!out.some(row => /variad|outros/i.test(row))) out.push('Séries | Variadas ⚡ PLUS');
  return out;
}

function findCategory(categories: string[], needles: string[]) {
  for (const needle of needles) {
    const n = normalize(needle);
    const direct = categories.find(category => normalize(category).includes(n));
    if (direct) return direct;
  }
  return '';
}

function chooseGroup(categories: string[], genres: string[], networks: string[]) {
  const networkText = networks.map(normalize).join(' | ');
  const serviceRules: Array<[RegExp, string[]]> = [
    [/netflix/, ['netflix']],
    [/apple tv/, ['apple tv']],
    [/disney/, ['disney']],
    [/hbo|max original|hbo max/, ['hbo max', 'hbo']],
    [/prime video|amazon/, ['prime video', 'amazon prime', 'prime']],
    [/hulu/, ['hulu']],
    [/star plus|star\+/, ['star plus', 'star+']]
  ];
  for (const [pattern, needles] of serviceRules) {
    if (pattern.test(networkText)) {
      const hit = findCategory(categories, needles);
      if (hit) return hit;
    }
  }

  const normalizedGenres = genres.map(normalize);
  const genreRules: Array<[string[], string[]]> = [
    [['reality'], ['reality']],
    [['documentary'], ['documentario', 'documentarios']],
    [['kids', 'family'], ['infantil', 'kids', 'familia']],
    [['animation'], ['animacao', 'animation']],
    [['crime'], ['crime', 'policial']],
    [['sci fi fantasy', 'science fiction', 'fantasy'], ['ficcao cientifica', 'sci fi', 'fantasia']],
    [['mystery', 'thriller'], ['suspense', 'misterio', 'thriller']],
    [['action adventure', 'action', 'adventure'], ['acao', 'aventura']],
    [['comedy'], ['comedia', 'comedy']],
    [['soap'], ['novela', 'novelas']],
    [['war politics'], ['guerra', 'politica']],
    [['western'], ['faroeste', 'western']],
    [['drama'], ['drama']]
  ];
  for (const [genreNeedles, categoryNeedles] of genreRules) {
    if (genreNeedles.some(needle => normalizedGenres.some(genre => genre.includes(normalize(needle))))) {
      const hit = findCategory(categories, categoryNeedles);
      if (hit) return hit;
    }
  }
  return findCategory(categories, ['variadas', 'variada', 'outros']) || 'Séries | Variadas ⚡ PLUS';
}

async function tmdbFetch(path: string) {
  const apiKey = Deno.env.get('TMDB_API_KEY') || TMDB_FALLBACK_KEY;
  const separator = path.includes('?') ? '&' : '?';
  const response = await fetch(`https://api.themoviedb.org/3${path}${separator}api_key=${encodeURIComponent(apiKey)}&language=pt-BR`, {
    headers: { 'Accept': 'application/json', 'User-Agent': 'Lux-Canonical-Grouping/1.0' }
  });
  if (!response.ok) throw new Error(`TMDB HTTP ${response.status}`);
  return await response.json();
}

function chooseSearchResult(title: string, year: number | null, results: any[]) {
  const normalizedTitle = normalize(title);
  let best: any = null;
  let bestScore = 0;
  for (const result of results || []) {
    const names = [result?.name, result?.original_name].filter(Boolean);
    let score = Math.max(...names.map((name: string) => {
      const n = normalize(name);
      if (!n) return 0;
      if (n === normalizedTitle) return 1;
      return tokenScore(title, name);
    }), 0);
    const resultYear = Number(String(result?.first_air_date || '').slice(0, 4)) || 0;
    if (year && resultYear) {
      const delta = Math.abs(Number(year) - resultYear);
      if (delta === 0) score += 0.12;
      else if (delta <= 1) score += 0.06;
      else if (delta >= 4) score -= 0.12;
    }
    if (score > bestScore) { best = result; bestScore = score; }
  }
  return bestScore >= 0.48 ? { result: best, score: Math.min(1, bestScore) } : { result: null, score: bestScore };
}

async function classifyOne(db: any, row: any, categories: string[]) {
  const now = new Date().toISOString();
  const searchTitle = tmdbSearchTitle(row?.canonical_title) || cleanText(row?.canonical_title, 300);
  let details: any = null;
  let tmdbId = Number(row?.tmdb_id) || 0;
  let confidence = 0;

  try {
    if (!tmdbId) {
      const query = encodeURIComponent(searchTitle);
      const yearPart = row?.year ? `&first_air_date_year=${encodeURIComponent(String(row.year))}` : '';
      const search = await tmdbFetch(`/search/tv?include_adult=false&query=${query}${yearPart}`);
      let picked = chooseSearchResult(searchTitle, row?.year || null, search?.results || []);
      if (!picked.result && yearPart) {
        const retry = await tmdbFetch(`/search/tv?include_adult=false&query=${query}`);
        picked = chooseSearchResult(searchTitle, row?.year || null, retry?.results || []);
      }
      tmdbId = Number(picked?.result?.id) || 0;
      confidence = Number(picked?.score || 0);
    } else {
      confidence = 1;
    }

    if (tmdbId) details = await tmdbFetch(`/tv/${tmdbId}?append_to_response=external_ids`);
  } catch (error) {
    console.warn('TMDB grouping failed for', row?.canonical_title, error);
  }

  const genres = Array.isArray(details?.genres) ? details.genres.map((g: any) => cleanText(g?.name, 80)).filter(Boolean) : [];
  const networks = Array.isArray(details?.networks) ? details.networks.map((n: any) => cleanText(n?.name, 100)).filter(Boolean) : [];
  const group = chooseGroup(categories, genres, networks);
  const imdbId = cleanText(details?.external_ids?.imdb_id, 40);
  const metadata = {
    ...(row?.metadata && typeof row.metadata === 'object' ? row.metadata : {}),
    lux_group: group,
    grouping_version: GROUPING_VERSION,
    grouping_source: details ? 'tmdb' : 'fallback',
    grouping_updated_at: now,
    grouping_confidence: Math.round(confidence * 100),
    tmdb_search_title: searchTitle,
    tmdb_genres: genres,
    tmdb_networks: networks,
    imdb_id: imdbId
  };
  const poster = !row?.poster && details?.poster_path ? `https://image.tmdb.org/t/p/w500${details.poster_path}` : row?.poster || '';
  const update: any = { metadata, updated_at: now };
  if (tmdbId) update.tmdb_id = tmdbId;
  if (poster) update.poster = poster;
  const { error } = await db.from('lux_catalog_titles').update(update).eq('id', row.id);
  if (error) throw error;
  return { id: row.id, title: row.canonical_title, search_title: searchTitle, group, tmdb_id: tmdbId || null, imdb_id: imdbId || null, matched: Boolean(details) };
}

async function runPool<T, R>(items: T[], concurrency: number, worker: (item: T) => Promise<R>) {
  const results: R[] = [];
  let index = 0;
  const runners = Array.from({ length: Math.max(1, Math.min(concurrency, items.length || 1)) }, async () => {
    while (true) {
      const current = index++;
      if (current >= items.length) break;
      results[current] = await worker(items[current]);
    }
  });
  await Promise.all(runners);
  return results;
}

Deno.serve(async (request: Request) => {
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
  if (request.method !== 'POST') return json({ error: 'Método não permitido.' }, 405);
  try {
    let body: any;
    try { body = await request.json(); } catch { return json({ error: 'JSON inválido.' }, 400); }
    const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } });
    const auth = await resolveAccount(db, body);
    if (auth.error) return auth.error;
    const action = cleanText(body?.action, 30).toLowerCase();
    if (action !== 'batch' && action !== 'status') return json({ error: 'Ação inválida.' }, 400);

    const categories = normalizeCategories(body?.categories);
    const limit = action === 'status' ? 1 : Math.min(12, Math.max(1, Number(body?.limit) || 8));
    const { data: candidates, error } = await db.rpc('lux_catalog_grouping_candidates', { p_version: GROUPING_VERSION, p_limit: limit });
    if (error) throw error;
    const rows = Array.isArray(candidates) ? candidates : [];
    const remainingBefore = Number(rows?.[0]?.remaining || 0);
    if (action === 'status') return json({ version: GROUPING_VERSION, remaining: remainingBefore, categories: categories.length });
    if (!rows.length) return json({ version: GROUPING_VERSION, processed: 0, matched: 0, fallback: 0, remaining: 0, items: [] });

    const results = await runPool(rows, 4, row => classifyOne(db, row, categories));
    const matched = results.filter((row: any) => row?.matched).length;
    const fallback = results.length - matched;
    const remaining = Math.max(0, remainingBefore - results.length);
    return json({ version: GROUPING_VERSION, processed: results.length, matched, fallback, remaining, items: results });
  } catch (error: any) {
    console.error('content-catalog-grouping:', error);
    return json({ error: error?.message || 'Falha ao atualizar o agrupamento.' }, 500);
  }
});
