import { createClient } from 'npm:@supabase/supabase-js@2';
import { load } from 'npm:cheerio@1.0.0';

const headers = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Cache-Control': 'no-store'
};
const json = (data: unknown, status = 200) => Response.json(data, { status, headers });

function cleanText(value: unknown, max = 200) {
  return String(value ?? '').trim().slice(0, max);
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

function absoluteUrl(base: string, value: string) {
  if (!value) return '';
  try { return new URL(value, base).toString(); } catch { return ''; }
}

function normalizeTitle(value: string) {
  return String(value || '')
    .toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function slugify(value: string) {
  return normalizeTitle(value).replace(/\s+/g, '-');
}

function detectVariant(title: string, url = '') {
  const text = `${title} ${url}`.toLowerCase();
  if (/\bdublad[oa]\b|\/anime-dublado\//i.test(text)) return 'dub';
  if (/\blegendad[oa]\b|\bsub\b/i.test(text)) return 'sub';
  return 'default';
}

function detectMediaType(title: string, url = '') {
  const text = `${title} ${url}`;
  if (/\/(?:filmes?|movies?)\//i.test(url)) return 'movies';
  if (/\b(?:filme|movie|gekijouban|the movie|longa[- ]metragem)\b/i.test(text)) return 'movies';
  return 'series';
}

async function fetchHtml(url: string, referer: string) {
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

function assertProviderUrl(provider: string, value: string) {
  let parsed: URL;
  try { parsed = new URL(value); } catch { throw new Error('URL do provider inválida.'); }
  const host = parsed.hostname.toLowerCase();
  if (provider === 'dattebayobr' && !/(^|\.)dattebayo-br\.com$/.test(host)) throw new Error('URL não pertence ao Dattebayo BR.');
  if (provider === 'animefire' && !/(^|\.)animefire\.io$/.test(host)) throw new Error('URL não pertence ao Anime Fire.');
  return parsed.toString();
}

function parseDattebayoCards(html: string) {
  const base = 'https://www.dattebayo-br.com';
  const $ = load(html);
  const results: any[] = [];
  $('div.ultimosAnimesHomeItem').each((_, element) => {
    const root = $(element);
    const anchor = root.find('a[href]').first();
    const title = cleanText(root.find('.ultimosAnimesHomeItemInfosNome').first().text(), 300);
    const href = absoluteUrl(base, anchor.attr('href') || '');
    const img = root.find('.ultimosAnimesHomeItemImg img').first();
    const poster = absoluteUrl(base, img.attr('data-src') || img.attr('src') || '');
    if (!title || !href) return;
    results.push({ provider: 'dattebayobr', providerName: 'Dattebayo BR', lang: 'pt-BR', type: detectMediaType(title, href), title, url: href, poster, variant: detectVariant(title, href) });
  });
  return results;
}

function animeFireSeriesUrl(rawUrl: string) {
  try {
    const url = new URL(rawUrl);
    const parts = url.pathname.split('/').filter(Boolean);
    const last = parts[parts.length - 1] || '';
    if (/^\d+(?:\.\d+)?$/.test(last)) {
      parts.pop();
      url.pathname = `/${parts.join('/')}-todos-os-episodios`;
      url.search = '';
      url.hash = '';
    }
    return url.toString();
  } catch {
    return rawUrl;
  }
}

function parseAnimeFireCards(html: string) {
  const base = 'https://animefire.io';
  const $ = load(html);
  const results: any[] = [];
  const seen = new Set<string>();
  $('div.divCardUltimosEps, article.cardUltimosEps').each((_, element) => {
    const root = $(element);
    const anchor = root.is('a') ? root : root.find('a[href]').first();
    if (!anchor.length) return;
    const title = cleanText(root.find('h3.animeTitle').first().text() || anchor.find('h3.animeTitle').first().text() || anchor.attr('title') || '', 300);
    const rawHref = absoluteUrl(base, anchor.attr('href') || '');
    if (!title || !rawHref) return;
    const mediaType = detectMediaType(title, rawHref);
    const href = mediaType === 'series' ? animeFireSeriesUrl(rawHref) : rawHref;
    const img = root.find('img').first();
    const poster = absoluteUrl(base, img.attr('data-src') || img.attr('data-original') || img.attr('src') || '');
    const key = `${normalizeTitle(title)}|${href}`;
    if (seen.has(key)) return;
    seen.add(key);
    results.push({ provider: 'animefire', providerName: 'Anime Fire', lang: 'pt-BR', type: mediaType, title, url: href, poster, variant: detectVariant(title, href) });
  });
  return results;
}

async function searchDattebayo(query: string, page: number) {
  const base = 'https://www.dattebayo-br.com';
  return parseDattebayoCards(await fetchHtml(`${base}/busca?busca=${encodeURIComponent(query)}&page=${page}`, base)).slice(0, 40);
}

async function searchAnimeFire(query: string, _page: number) {
  const base = 'https://animefire.io';
  const slug = slugify(query);
  if (!slug) return [];
  return parseAnimeFireCards(await fetchHtml(`${base}/pesquisar/${encodeURIComponent(slug)}`, base)).slice(0, 60);
}

async function catalogDattebayo() {
  const base = 'https://www.dattebayo-br.com';
  const pages = [base, `${base}/animes`, `${base}/anime-dublado`];
  const settled = await Promise.allSettled(pages.map(url => fetchHtml(url, base)));
  const items: any[] = [];
  settled.forEach(row => { if (row.status === 'fulfilled') items.push(...parseDattebayoCards(row.value)); });
  return dedupe(items).slice(0, 300);
}

function findAnimeFireLastPage(html: string, kind: string) {
  const $ = load(html);
  let max = 1;
  const re = new RegExp(`/lista-de-animes-${kind}/(\\d+)`, 'i');
  $('a[href]').each((_, element) => {
    const href = String($(element).attr('href') || '');
    const match = href.match(re);
    if (match) max = Math.max(max, Number(match[1]) || 1);
  });
  return Math.min(max, 24);
}

async function collectAnimeFireList(kind: 'legendados' | 'dublados') {
  const base = 'https://animefire.io';
  const rootUrl = `${base}/lista-de-animes-${kind}`;
  const first = await fetchHtml(rootUrl, base);
  const lastPage = findAnimeFireLastPage(first, kind);
  const items = [...parseAnimeFireCards(first)];
  const remaining = Array.from({ length: Math.max(0, lastPage - 1) }, (_, index) => index + 2);
  for (let offset = 0; offset < remaining.length; offset += 6) {
    const batch = remaining.slice(offset, offset + 6);
    const settled = await Promise.allSettled(batch.map(page => fetchHtml(`${rootUrl}/${page}`, base)));
    settled.forEach(row => { if (row.status === 'fulfilled') items.push(...parseAnimeFireCards(row.value)); });
  }
  return items;
}

async function catalogAnimeFire() {
  const settled = await Promise.allSettled([collectAnimeFireList('legendados'), collectAnimeFireList('dublados')]);
  const items: any[] = [];
  settled.forEach(row => { if (row.status === 'fulfilled') items.push(...row.value); });
  if (!items.length) {
    const base = 'https://animefire.io';
    const fallbackUrls = [`${base}/top-animes`, `${base}/em-lancamento`, `${base}/atualizados`];
    const fallback = await Promise.allSettled(fallbackUrls.map(url => fetchHtml(url, base)));
    fallback.forEach(row => { if (row.status === 'fulfilled') items.push(...parseAnimeFireCards(row.value)); });
  }
  return dedupe(items).slice(0, 1800);
}

function episodeNumberFromText(value: string, fallback: number) {
  const normalized = String(value || '').replace(',', '.');
  const match = normalized.match(/(?:epis[oó]dio\s*)?(\d+(?:\.\d+)?)/i);
  return match ? Number(match[1]) : fallback;
}

async function episodesDattebayo(rawUrl: string) {
  const base = 'https://www.dattebayo-br.com';
  const seriesUrl = assertProviderUrl('dattebayobr', rawUrl).replace(/\/$/, '');
  const items: any[] = [];
  const seen = new Set<string>();
  for (let page = 1; page <= 12 && items.length < 500; page++) {
    const pageUrl = page === 1 ? seriesUrl : `${seriesUrl}/page/${page}`;
    const html = await fetchHtml(pageUrl, base);
    const $ = load(html);
    const rows = $('div.ultimosEpisodiosHomeItem');
    if (!rows.length) break;
    let added = 0;
    rows.each((index, element) => {
      const root = $(element);
      const anchor = root.find('a[href]').first();
      const href = absoluteUrl(base, anchor.attr('href') || '');
      if (!href || seen.has(href)) return;
      const rawNumber = cleanText(root.find('.ultimosEpisodiosHomeItemInfosNum').first().text(), 80).replace(/epis[oó]dio/i, '').trim();
      const title = cleanText(root.find('.ultimosEpisodiosHomeItemInfosNome').first().text(), 300) || `Episódio ${rawNumber || items.length + 1}`;
      const episode = episodeNumberFromText(rawNumber || title, items.length + index + 1);
      seen.add(href);
      items.push({ id: `dattebayobr:${encodeURIComponent(href)}`, episode, episodeNum: episode, episode_num: episode, title, pageUrl: href, provider: 'dattebayobr', providerName: 'Dattebayo BR' });
      added++;
    });
    if (!added) break;
  }
  return items.sort((a, b) => Number(a.episode || 0) - Number(b.episode || 0));
}

async function episodesAnimeFire(rawUrl: string) {
  const base = 'https://animefire.io';
  const seriesUrl = assertProviderUrl('animefire', rawUrl);
  const html = await fetchHtml(seriesUrl, base);
  const $ = load(html);
  const items: any[] = [];
  const seen = new Set<string>();
  $('a.lEp.epT.divNumEp, div.div_video_list > a').each((index, element) => {
    const anchor = $(element);
    const href = absoluteUrl(base, anchor.attr('href') || '');
    if (!href || seen.has(href)) return;
    const text = cleanText(anchor.text(), 300);
    const lastPath = (() => {
      try { return new URL(href).pathname.split('/').filter(Boolean).pop() || ''; } catch { return ''; }
    })();
    const episode = Number(lastPath) || episodeNumberFromText(text, index + 1);
    seen.add(href);
    items.push({ id: `animefire:${encodeURIComponent(href)}`, episode, episodeNum: episode, episode_num: episode, title: text || `Episódio ${episode}`, pageUrl: href, provider: 'animefire', providerName: 'Anime Fire' });
  });
  return items.sort((a, b) => Number(a.episode || 0) - Number(b.episode || 0));
}

const SEARCHERS: Record<string, (query: string, page: number) => Promise<any[]>> = { dattebayobr: searchDattebayo, animefire: searchAnimeFire };
const CATALOGS: Record<string, () => Promise<any[]>> = { dattebayobr: catalogDattebayo, animefire: catalogAnimeFire };
const EPISODES: Record<string, (url: string) => Promise<any[]>> = { dattebayobr: episodesDattebayo, animefire: episodesAnimeFire };

function dedupe(items: any[]) {
  const seen = new Set<string>();
  return items.filter(item => {
    const key = `${item.provider}|${normalizeTitle(item.title)}|${item.variant || 'default'}|${item.url || item.pageUrl || ''}`;
    if (!normalizeTitle(item.title) || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

Deno.serve(async (request: Request) => {
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers });
  if (request.method !== 'POST') return json({ error: 'Método não permitido.' }, 405);
  try {
    let body: any;
    try { body = await request.json(); } catch { return json({ error: 'JSON inválido.' }, 400); }
    const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } });
    const auth = await resolveAccount(db, body);
    if (auth.error) return auth.error;
    const action = cleanText(body?.action, 30).toLowerCase();
    const provider = cleanText(body?.provider || 'all', 40).toLowerCase();
    if (action === 'search') {
      const query = cleanText(body?.query, 120);
      if (query.length < 2) return json({ error: 'Digite pelo menos 2 caracteres.' }, 400);
      const page = Math.min(10, Math.max(1, Number(body?.page) || 1));
      const targets = provider === 'all' ? Object.keys(SEARCHERS) : [provider];
      if (targets.some(id => !SEARCHERS[id])) return json({ error: 'Provider ainda não suportado pelo mecanismo de busca.' }, 400);
      const settled = await Promise.allSettled(targets.map(async id => ({ id, items: await SEARCHERS[id](query, page) })));
      const results: any[] = [];
      const failures: { provider: string; error: string }[] = [];
      settled.forEach((row, index) => {
        if (row.status === 'fulfilled') results.push(...row.value.items);
        else failures.push({ provider: targets[index] || 'desconhecido', error: row.reason?.message || 'Falha na consulta.' });
      });
      return json({ query, page, provider, results: dedupe(results), failures, supported: Object.keys(SEARCHERS) });
    }
    if (action === 'catalog') {
      const targets = provider === 'all' ? Object.keys(CATALOGS) : [provider];
      if (targets.some(id => !CATALOGS[id])) return json({ error: 'Provider ainda não suportado pelo catálogo.' }, 400);
      const settled = await Promise.allSettled(targets.map(async id => ({ id, items: await CATALOGS[id]() })));
      const results: any[] = [];
      const failures: { provider: string; error: string }[] = [];
      settled.forEach((row, index) => {
        if (row.status === 'fulfilled') results.push(...row.value.items);
        else failures.push({ provider: targets[index] || 'desconhecido', error: row.reason?.message || 'Falha no catálogo.' });
      });
      return json({ provider, results: dedupe(results), failures, supported: Object.keys(CATALOGS) });
    }
    if (action === 'episodes') {
      if (!EPISODES[provider]) return json({ error: 'Provider ainda não suportado para episódios.' }, 400);
      const url = cleanText(body?.url, 4000);
      if (!url) return json({ error: 'Anime não informado.' }, 400);
      const episodes = await EPISODES[provider](url);
      return json({ provider, url, episodes, count: episodes.length });
    }
    return json({ error: 'Ação inválida.' }, 400);
  } catch (error: any) {
    console.error('provider-search:', error);
    const message = error?.name === 'AbortError' ? 'O provider demorou demais para responder.' : (error?.message || 'Falha ao consultar providers.');
    return json({ error: message }, 500);
  }
});