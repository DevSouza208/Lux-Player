import { createClient } from 'npm:@supabase/supabase-js@2';
import { load } from 'npm:cheerio@1.0.0';

const headers = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Cache-Control': 'no-store'
};

const json = (data: unknown, status = 200) => Response.json(data, { status, headers });

function cleanText(value: unknown, max = 4000) {
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
  return { account };
}

function browserHeaders(referer: string, extra: Record<string, string> = {}) {
  return {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
    'Accept': '*/*',
    'Accept-Language': 'pt-BR,pt;q=0.9,en-US;q=0.8,en;q=0.7',
    'Referer': referer,
    ...extra
  };
}

function normalizeEmbeddedUrl(value: string) {
  return String(value || '')
    .replace(/\\\//g, '/')
    .replace(/\\u0026/gi, '&')
    .replace(/&amp;/gi, '&')
    .replace(/&#0*38;/gi, '&')
    .replace(/[\\"'<>]+$/g, '')
    .replace(/[),;]+$/g, '')
    .trim();
}

function absoluteUrl(base: string, value: string) {
  const normalized = normalizeEmbeddedUrl(value);
  if (!normalized) return '';
  try { return new URL(normalized, base).toString(); } catch { return ''; }
}

function assertProviderPage(provider: string, value: string) {
  let parsed: URL;
  try { parsed = new URL(value); } catch { throw new Error('URL do episódio inválida.'); }
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') throw new Error('Protocolo do episódio não suportado.');
  const host = parsed.hostname.toLowerCase();
  if (provider === 'dattebayobr' && !/(^|\.)dattebayo-br\.com$/.test(host)) {
    throw new Error('URL do episódio não pertence ao Dattebayo BR.');
  }
  if (provider !== 'dattebayobr') throw new Error('Resolver direto ainda não disponível para este provider.');
  return parsed.toString();
}

function allowedMediaHost(hostname: string) {
  const host = hostname.toLowerCase();
  return /(^|\.)animeyabu\.net$/.test(host)
    || /(^|\.)r2\.cloudflarestorage\.com$/.test(host)
    || /(^|\.)cloudflarestorage\.com$/.test(host)
    || /(^|\.)dattebayo-br\.com$/.test(host);
}

function isLikelyMedia(url: string) {
  try {
    const parsed = new URL(url);
    if (!allowedMediaHost(parsed.hostname)) return false;
    if (/\.(?:mp4|m3u8)(?:$|[?#])/i.test(parsed.pathname + parsed.search)) return true;
    if (/(^|\.)animeyabu\.net$/i.test(parsed.hostname) && parsed.searchParams.has('url')) return true;
    return false;
  } catch {
    return false;
  }
}

function mediaScore(url: string) {
  const value = url.toLowerCase();
  let score = 0;
  if (/zful|fullhd|full-hd|1080/.test(value)) score += 400;
  else if (/z333|(?:^|[^a-z])hd(?:[^a-z]|$)|720/.test(value)) score += 300;
  else if (/ziphonec|(?:^|[^a-z])sd(?:[^a-z]|$)|480/.test(value)) score += 200;
  if (/x-amz-signature=/.test(value)) score += 80;
  if (/r2\.cloudflarestorage\.com/.test(value)) score += 40;
  if (/animeyabu\.net/.test(value)) score += 20;
  return score;
}

function qualityLabel(url: string) {
  const value = url.toLowerCase();
  if (/zful|fullhd|full-hd|1080/.test(value)) return 'FULLHD';
  if (/z333|(?:^|[^a-z])hd(?:[^a-z]|$)|720/.test(value)) return 'HD';
  if (/ziphonec|(?:^|[^a-z])sd(?:[^a-z]|$)|480/.test(value)) return 'SD';
  return 'AUTO';
}

async function fetchHtml(url: string, referer: string) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15000);
  try {
    const response = await fetch(url, {
      redirect: 'follow',
      signal: controller.signal,
      headers: browserHeaders(referer, { 'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8' })
    });
    if (!response.ok) throw new Error(`Página do episódio respondeu HTTP ${response.status}.`);
    const text = await response.text();
    if (!text || text.length < 100) throw new Error('Página do episódio vazia ou inesperada.');
    return text;
  } finally {
    clearTimeout(timer);
  }
}

function collectUrls(html: string, baseUrl: string) {
  const normalizedHtml = normalizeEmbeddedUrl(html);
  const $ = load(normalizedHtml);
  const found = new Set<string>();
  const add = (value: string) => {
    const url = absoluteUrl(baseUrl, value);
    if (url) found.add(url);
  };

  const attributes = ['src', 'href', 'data-src', 'data-url', 'data-video', 'data-file'];
  $('video, video source, source, iframe, a, [data-src], [data-url], [data-video], [data-file]').each((_, element) => {
    const node = $(element);
    attributes.forEach(attribute => {
      const value = node.attr(attribute);
      if (value) add(value);
    });
  });

  const absoluteMatches = normalizedHtml.match(/https?:\/\/[^\s"'<>]+/gi) || [];
  absoluteMatches.forEach(add);

  return [...found];
}

function isNestedPlayerPage(url: string) {
  try {
    const parsed = new URL(url);
    const host = parsed.hostname.toLowerCase();
    if (isLikelyMedia(url)) return false;
    return /(^|\.)dattebayo-br\.com$/.test(host) || /(^|\.)animeyabu\.net$/.test(host);
  } catch {
    return false;
  }
}

async function resolveCandidate(candidate: string, referer: string) {
  let parsed: URL;
  try { parsed = new URL(candidate); } catch { return ''; }
  if (!allowedMediaHost(parsed.hostname)) return '';

  if (/r2\.cloudflarestorage\.com$/i.test(parsed.hostname) && parsed.searchParams.has('X-Amz-Signature')) {
    return candidate;
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 12000);
  try {
    const response = await fetch(candidate, {
      method: 'GET',
      redirect: 'follow',
      signal: controller.signal,
      headers: browserHeaders(referer, { 'Range': 'bytes=0-0' })
    });
    const finalUrl = String(response.url || candidate);
    try { await response.body?.cancel(); } catch (_) {}
    if (!response.ok && response.status !== 206) return '';
    if (!isLikelyMedia(finalUrl)) return '';
    return finalUrl;
  } catch {
    return '';
  } finally {
    clearTimeout(timer);
  }
}

async function resolveDattebayo(pageUrl: string) {
  const firstHtml = await fetchHtml(pageUrl, 'https://www.dattebayo-br.com');
  const collected = new Set<string>(collectUrls(firstHtml, pageUrl));

  const nestedPages = [...collected].filter(isNestedPlayerPage).slice(0, 6);
  const nested = await Promise.allSettled(nestedPages.map(async url => ({ url, html: await fetchHtml(url, pageUrl) })));
  nested.forEach(result => {
    if (result.status !== 'fulfilled') return;
    collectUrls(result.value.html, result.value.url).forEach(url => collected.add(url));
  });

  const candidates = [...collected]
    .filter(isLikelyMedia)
    .sort((a, b) => mediaScore(b) - mediaScore(a));

  if (!candidates.length) throw new Error('Nenhuma fonte de vídeo foi encontrada na página do episódio.');

  const resolved: { url: string; quality: string; score: number }[] = [];
  for (const candidate of candidates.slice(0, 12)) {
    const direct = await resolveCandidate(candidate, pageUrl);
    if (!direct) continue;
    if (resolved.some(item => item.url === direct)) continue;
    resolved.push({ url: direct, quality: qualityLabel(candidate), score: mediaScore(candidate) });
  }

  resolved.sort((a, b) => b.score - a.score);
  if (!resolved.length) throw new Error('O player foi encontrado, mas não foi possível obter um link direto válido.');

  return {
    streamUrl: resolved[0].url,
    quality: resolved[0].quality,
    alternatives: resolved.map(item => ({ url: item.url, quality: item.quality }))
  };
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

    const provider = cleanText(body?.provider, 40).toLowerCase();
    const pageUrl = assertProviderPage(provider, cleanText(body?.url, 4000));
    const resolved = await resolveDattebayo(pageUrl);
    return json({ provider, pageUrl, ...resolved });
  } catch (error: any) {
    console.error('provider-stream:', error);
    const message = error?.name === 'AbortError'
      ? 'O provider demorou demais para responder.'
      : (error?.message || 'Não foi possível resolver o vídeo do provider.');
    return json({ error: message }, 500);
  }
});
