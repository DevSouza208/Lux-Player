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

async function searchDattebayo(query: string, page: number) {
  const base = 'https://www.dattebayo-br.com';
  const url = `${base}/busca?busca=${encodeURIComponent(query)}&page=${page}`;
  const html = await fetchHtml(url, base);
  const $ = load(html);
  const results: any[] = [];
  $('div.ultimosAnimesHomeItem').each((_, element) => {
    const root = $(element);
    const anchor = root.find('a').first();
    const title = cleanText(root.find('.ultimosAnimesHomeItemInfosNome').first().text(), 300);
    const href = absoluteUrl(base, anchor.attr('href') || '');
    const img = root.find('.ultimosAnimesHomeItemImg img').first();
    const poster = absoluteUrl(base, img.attr('data-src') || img.attr('src') || '');
    if (!title || !href) return;
    results.push({ provider: 'dattebayobr', providerName: 'Dattebayo BR', lang: 'pt-BR', type: 'series', title, url: href, poster });
  });
  return results.slice(0, 40);
}

function animeFireSeriesUrl(rawUrl: string) {
  try {
    const url = new URL(rawUrl);
    const parts = url.pathname.split('/').filter(Boolean);
    const last = parts[parts.length - 1] || '';
    if (/^\d+$/.test(last)) {
      parts.pop();
      url.pathname = `/${parts.join('/')}-todos-os-episodios`;
    }
    return url.toString();
  } catch {
    return rawUrl;
  }
}

async function searchAnimeFire(query: string, page: number) {
  const base = 'https://animefire.io';
  const slug = query.trim().toLowerCase().replace(/\s+/g, '-');
  const url = `${base}/pesquisar/${encodeURIComponent(slug)}/${page}`;
  const html = await fetchHtml(url, base);
  const $ = load(html);
  const results: any[] = [];
  $('article.cardUltimosEps > a').each((_, element) => {
    const anchor = $(element);
    const title = cleanText(anchor.find('h3.animeTitle').first().text(), 300);
    const href = animeFireSeriesUrl(absoluteUrl(base, anchor.attr('href') || ''));
    const img = anchor.find('img').first();
    const poster = absoluteUrl(base, img.attr('data-src') || img.attr('src') || '');
    if (!title || !href) return;
    results.push({ provider: 'animefire', providerName: 'Anime Fire', lang: 'pt-BR', type: 'series', title, url: href, poster });
  });
  return results.slice(0, 40);
}

const SEARCHERS: Record<string, (query: string, page: number) => Promise<any[]>> = {
  dattebayobr: searchDattebayo,
  animefire: searchAnimeFire
};

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
    if (action !== 'search') return json({ error: 'Ação inválida.' }, 400);

    const query = cleanText(body?.query, 120);
    if (query.length < 2) return json({ error: 'Digite pelo menos 2 caracteres.' }, 400);
    const page = Math.min(10, Math.max(1, Number(body?.page) || 1));
    const provider = cleanText(body?.provider || 'all', 40).toLowerCase();
    const targets = provider === 'all' ? Object.keys(SEARCHERS) : [provider];
    if (targets.some(id => !SEARCHERS[id])) return json({ error: 'Provider ainda não suportado pelo mecanismo de busca.' }, 400);

    const settled = await Promise.allSettled(targets.map(async id => ({ id, items: await SEARCHERS[id](query, page) })));
    const results: any[] = [];
    const failures: { provider: string; error: string }[] = [];
    settled.forEach((row, index) => {
      if (row.status === 'fulfilled') results.push(...row.value.items);
      else failures.push({ provider: targets[index] || 'desconhecido', error: row.reason?.message || 'Falha na consulta.' });
    });

    const seen = new Set<string>();
    const deduped = results.filter(item => {
      const normalized = String(item.title || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();
      const key = `${item.provider}|${normalized}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });

    return json({ query, page, provider, results: deduped, failures, supported: Object.keys(SEARCHERS) });
  } catch (error: any) {
    console.error('provider-search:', error);
    const message = error?.name === 'AbortError' ? 'O provider demorou demais para responder.' : (error?.message || 'Falha ao pesquisar providers.');
    return json({ error: message }, 500);
  }
});
