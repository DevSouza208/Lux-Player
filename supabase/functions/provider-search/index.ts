import { createClient } from 'npm:@supabase/supabase-js@2';
import { load } from 'npm:cheerio@1.0.0';

const headers = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Cache-Control': 'no-store'
};
const json = (data: unknown, status = 200) => Response.json(data, { status, headers });
const BASE = 'https://animefire.io';
const SUPPORTED = ['animefire'];

function cleanText(value: unknown, max = 300) {
  return String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, max);
}

function normalizeTitle(value: unknown) {
  return String(value ?? '')
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function slugify(value: unknown) {
  return normalizeTitle(value).replace(/\s+/g, '-');
}

function absoluteUrl(base: string, value: string) {
  try { return value ? new URL(value, base).toString() : ''; } catch { return ''; }
}

function isAnimeFireHost(value: string) {
  try { return /(^|\.)animefire\.io$/i.test(new URL(value).hostname); } catch { return false; }
}

function assertAnimeFireUrl(value: string) {
  const url = absoluteUrl(BASE, value);
  if (!url || !isAnimeFireHost(url)) throw new Error('URL não pertence ao Anime Fire.');
  return url;
}

function detectVariant(title: string, url = '') {
  const text = `${title} ${url}`.toLowerCase();
  if (/dublad[oa]|\bdub\b/.test(text)) return 'dub';
  if (/legendad[oa]|\bsub\b/.test(text)) return 'sub';
  return 'default';
}

function detectMediaType(title: string, url = '') {
  const text = `${title} ${url}`.toLowerCase();
  if (/\b(movie|filme|gekijouban|longa[- ]metragem)\b/.test(text)) return 'movies';
  return 'series';
}

function cleanListingTitle(value: unknown) {
  return cleanText(value, 400)
    .replace(/\s+(?:n\/?a|\d+(?:[.,]\d+)?)\s+(?:a(?:10|12|14|16|18)|l)\s*$/i, '')
    .replace(/\s+(?:a(?:10|12|14|16|18)|l)\s*$/i, '')
    .replace(/\s+(?:n\/?a|\d+(?:[.,]\d+)?)\s*$/i, '')
    .trim();
}

async function resolveAccount(db: any, body: any) {
  const username = cleanText(body?.username, 160);
  const credential = String(body?.password ?? '');
  if (!username || !credential) return { error: json({ error: 'Login necessário.' }, 401) };
  const { data: account, error } = await db.rpc('lux_auth_resolve', {
    p_username: username,
    p_credential: credential
  });
  if (error) throw error;
  if (!account) return { error: json({ error: 'Credencial inválida ou sessão expirada.' }, 401) };
  return { account, username };
}

async function fetchHtml(url: string, referer = BASE) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15000);
  try {
    const response = await fetch(url, {
      redirect: 'follow',
      signal: controller.signal,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'pt-BR,pt;q=0.9,en-US;q=0.8,en;q=0.7',
        'Referer': referer
      }
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const text = await response.text();
    if (!text || text.length < 100) throw new Error('Resposta vazia ou inesperada.');
    return text;
  } finally {
    clearTimeout(timer);
  }
}

function isAnimeLandingUrl(value: string) {
  try {
    const url = new URL(value);
    if (!/(^|\.)animefire\.io$/i.test(url.hostname)) return false;
    const path = url.pathname.replace(/\/+$/, '');
    return /^\/animes\/[^/]+-todos-os-episodios$/i.test(path)
      || /^\/anime\/[^/]+$/i.test(path);
  } catch {
    return false;
  }
}

function posterFrom(anchor: any, baseUrl: string) {
  let img = anchor.find('img').first();
  if (!img.length) img = anchor.closest('article, .card, [class*="Card"], [class*="card"]').find('img').first();
  return absoluteUrl(baseUrl, img.attr('data-src') || img.attr('data-original') || img.attr('data-lazy-src') || img.attr('src') || '');
}

function titleFromAnchor(anchor: any) {
  const img = anchor.find('img').first();
  const candidates = [
    anchor.find('h3.animeTitle').first().text(),
    anchor.find('[class*="animeTitle"]').first().text(),
    anchor.find('h2,h3,h4').first().text(),
    img.attr('alt'),
    anchor.attr('title'),
    anchor.text()
  ];
  for (const candidate of candidates) {
    const title = cleanListingTitle(candidate || '');
    if (title && title.length > 1 && !/^assistir$/i.test(title)) return title;
  }
  return '';
}

function makeItem(title: string, url: string, poster = '') {
  return {
    provider: 'animefire',
    providerName: 'Anime Fire',
    lang: 'pt-BR',
    type: detectMediaType(title, url),
    title,
    url,
    poster,
    variant: detectVariant(title, url)
  };
}

function parseAnimeFireListings(html: string, pageUrl: string) {
  const $ = load(html);
  const results: any[] = [];
  const seen = new Set<string>();
  $('a[href]').each((_, element) => {
    const anchor = $(element);
    const href = absoluteUrl(pageUrl, anchor.attr('href') || '');
    if (!isAnimeLandingUrl(href)) return;
    const title = titleFromAnchor(anchor);
    if (!title) return;
    const key = `${normalizeTitle(title)}|${href}`;
    if (seen.has(key)) return;
    seen.add(key);
    results.push(makeItem(title, href, posterFrom(anchor, pageUrl)));
  });
  return results;
}

function parseAnimeFireDetail(html: string, pageUrl: string) {
  const $ = load(html);
  const title = cleanListingTitle(
    $('h1').first().text()
      || $('meta[property="og:title"]').attr('content')
      || $('title').first().text().replace(/\s*[-|].*AnimeFire.*$/i, '')
  );
  if (!title) return null;
  const poster = absoluteUrl(pageUrl,
    $('meta[property="og:image"]').attr('content')
      || $('img').filter((_, el) => /poster|capa|anime/i.test(String($(el).attr('class') || ''))).first().attr('src')
      || ''
  );
  return makeItem(title, pageUrl, poster);
}

function dedupe(items: any[]) {
  const seen = new Set<string>();
  return items.filter(item => {
    const key = `${item.provider}|${normalizeTitle(item.title)}|${item.variant || 'default'}|${item.url || item.pageUrl || ''}`;
    if (!normalizeTitle(item.title) || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function titleMatchesQuery(title: string, query: string) {
  const normalizedTitle = normalizeTitle(title);
  const normalizedQuery = normalizeTitle(query);
  if (!normalizedQuery) return false;
  if (normalizedTitle.includes(normalizedQuery)) return true;
  const titleTokens = normalizedTitle.split(' ').filter(Boolean);
  const queryTokens = normalizedQuery.split(' ').filter(Boolean);
  return queryTokens.every(token => titleTokens.some(candidate => candidate.includes(token) || token.includes(candidate)));
}

function findLetterLastPage(html: string, letter: string) {
  const $ = load(html);
  let max = 1;
  $('a[href]').each((_, element) => {
    const href = absoluteUrl(BASE, String($(element).attr('href') || ''));
    try {
      const url = new URL(href);
      const match = url.pathname.match(/^\/top-animes\/(\d+)\/?$/i);
      if (match && String(url.searchParams.get('letra') || '').toLowerCase() === letter.toLowerCase()) {
        max = Math.max(max, Number(match[1]) || 1);
      }
    } catch {}
  });
  return Math.min(max, 16);
}

async function searchAnimeFire(query: string) {
  const normalized = normalizeTitle(query);
  if (!normalized) return [];
  const firstChar = normalized.match(/[a-z0-9]/)?.[0] || '';
  const items: any[] = [];

  if (firstChar) {
    const firstUrl = `${BASE}/top-animes/${encodeURIComponent(firstChar)}`;
    try {
      const firstHtml = await fetchHtml(firstUrl, BASE);
      items.push(...parseAnimeFireListings(firstHtml, firstUrl));
      const lastPage = findLetterLastPage(firstHtml, firstChar);
      const pages = Array.from({ length: Math.max(0, lastPage - 1) }, (_, index) => index + 2);
      for (let offset = 0; offset < pages.length; offset += 5) {
        const batch = pages.slice(offset, offset + 5);
        const settled = await Promise.allSettled(batch.map(page => {
          const url = `${BASE}/top-animes/${page}?letra=${encodeURIComponent(firstChar)}`;
          return fetchHtml(url, BASE).then(html => parseAnimeFireListings(html, url));
        }));
        settled.forEach(result => { if (result.status === 'fulfilled') items.push(...result.value); });
      }
    } catch (error) {
      console.warn('AnimeFire letter index failed:', error);
    }
  }

  let results = dedupe(items).filter(item => titleMatchesQuery(item.title, query));

  if (!results.length) {
    const slug = slugify(query);
    const directUrls = [
      `${BASE}/animes/${slug}-todos-os-episodios`,
      `${BASE}/animes/${slug}-dublado-todos-os-episodios`
    ];
    const settled = await Promise.allSettled(directUrls.map(url => fetchHtml(url, BASE).then(html => parseAnimeFireDetail(html, url))));
    settled.forEach(result => {
      if (result.status === 'fulfilled' && result.value) results.push(result.value);
    });
  }

  return dedupe(results).slice(0, 80);
}

async function catalogAnimeFire() {
  const urls = [
    `${BASE}/top-animes`,
    `${BASE}/em-lancamento`,
    `${BASE}/atualizados`,
    `${BASE}/top-animes/a`,
    `${BASE}/top-animes/n`,
    `${BASE}/top-animes/s`,
    `${BASE}/top-animes/b`
  ];
  const settled = await Promise.allSettled(urls.map(url => fetchHtml(url, BASE).then(html => parseAnimeFireListings(html, url))));
  const items: any[] = [];
  settled.forEach(result => { if (result.status === 'fulfilled') items.push(...result.value); });
  return dedupe(items).slice(0, 900);
}

function episodeNumberFromText(value: string, fallback: number) {
  const normalized = String(value || '').replace(',', '.');
  const match = normalized.match(/(?:epis[oó]dio|episode|ep)?\s*#?\s*(\d+(?:\.\d+)?)/i);
  return match ? Number(match[1]) : fallback;
}

function episodeNumberFromUrl(value: string) {
  try {
    const url = new URL(value);
    const legacy = url.pathname.match(/^\/animes\/[^/]+\/(\d+(?:\.\d+)?)\/?$/i);
    if (legacy) return Number(legacy[1]);
    const modern = url.pathname.match(/^\/anime\/[^/]+\/(?:episodio|episode|ep)\/?(\d+(?:\.\d+)?)\/?$/i);
    if (modern) return Number(modern[1]);
    for (const key of ['episodio', 'episode', 'ep']) {
      const raw = url.searchParams.get(key);
      if (raw && /^\d+(?:\.\d+)?$/.test(raw)) return Number(raw);
    }
  } catch {}
  return null;
}

async function episodesAnimeFire(rawUrl: string) {
  const seriesUrl = assertAnimeFireUrl(rawUrl);
  const html = await fetchHtml(seriesUrl, BASE);
  const $ = load(html);
  const items: any[] = [];
  const seen = new Set<string>();

  $('a[href]').each((index, element) => {
    const anchor = $(element);
    const href = absoluteUrl(seriesUrl, anchor.attr('href') || '');
    if (!href || !isAnimeFireHost(href) || seen.has(href)) return;
    const fromUrl = episodeNumberFromUrl(href);
    if (fromUrl === null) return;
    const text = cleanText(anchor.text(), 300);
    const episode = Number.isFinite(fromUrl) ? fromUrl : episodeNumberFromText(text, index + 1);
    seen.add(href);
    items.push({
      id: `animefire:${encodeURIComponent(href)}`,
      episode,
      episodeNum: episode,
      episode_num: episode,
      title: text || `Episódio ${episode}`,
      pageUrl: href,
      provider: 'animefire',
      providerName: 'Anime Fire'
    });
  });

  return items.sort((a, b) => Number(a.episode || 0) - Number(b.episode || 0));
}

Deno.serve(async (request: Request) => {
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers });
  if (request.method !== 'POST') return json({ error: 'Método não permitido.' }, 405);

  try {
    let body: any;
    try { body = await request.json(); } catch { return json({ error: 'JSON inválido.' }, 400); }

    const db = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
      { auth: { persistSession: false } }
    );
    const auth = await resolveAccount(db, body);
    if (auth.error) return auth.error;

    const action = cleanText(body?.action, 30).toLowerCase();
    const requestedProvider = cleanText(body?.provider || 'animefire', 40).toLowerCase();
    if (requestedProvider === 'dattebayobr') return json({ error: 'Dattebayo BR está desativado temporariamente.' }, 400);
    if (!['animefire', 'all', ''].includes(requestedProvider)) return json({ error: 'Provider não suportado.' }, 400);

    if (action === 'search') {
      const query = cleanText(body?.query, 120);
      if (query.length < 2) return json({ error: 'Digite pelo menos 2 caracteres.' }, 400);
      const results = await searchAnimeFire(query);
      return json({ query, page: 1, provider: 'animefire', results, failures: [], supported: SUPPORTED });
    }

    if (action === 'catalog') {
      const results = await catalogAnimeFire();
      return json({ provider: 'animefire', results, failures: [], supported: SUPPORTED });
    }

    if (action === 'episodes') {
      const url = cleanText(body?.url, 4000);
      if (!url) return json({ error: 'Anime não informado.' }, 400);
      const episodes = await episodesAnimeFire(url);
      return json({ provider: 'animefire', url, episodes, count: episodes.length, supported: SUPPORTED });
    }

    return json({ error: 'Ação inválida.' }, 400);
  } catch (error: any) {
    console.error('provider-search:', error);
    const message = error?.name === 'AbortError'
      ? 'O Anime Fire demorou demais para responder.'
      : (error?.message || 'Falha ao consultar Anime Fire.');
    return json({ error: message }, 500);
  }
});
