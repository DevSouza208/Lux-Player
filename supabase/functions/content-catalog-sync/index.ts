import { createClient } from 'npm:@supabase/supabase-js@2';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Cache-Control': 'no-store'
};
const json = (data: unknown, status = 200) => Response.json(data, { status, headers: cors });

function cleanText(value: unknown, max = 500) {
  return String(value ?? '').trim().slice(0, max);
}

function normalizeTitle(value: unknown) {
  return String(value ?? '')
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\.(mkv|mp4|avi|mov|webm|ts|m3u8?)\b/gi, ' ')
    .replace(/\([^)]*(?:dublado|legendado|dual|4k|fhd|uhd|hd|sd|1080p|720p|480p)[^)]*\)/gi, ' ')
    .replace(/\[[^\]]*(?:dublado|legendado|dual|4k|fhd|uhd|hd|sd|1080p|720p|480p)[^\]]*\]/gi, ' ')
    .replace(/\b(dublado|legendado|dual(?: audio)?|pt[- ]?br|4k|fhd|uhd|full\s*hd|hd|sd|h265|hevc|1080p|720p|480p)\b/gi, ' ')
    .replace(/\b(?:temporada|season)\s*\d+\b/gi, ' ')
    .replace(/\b(?:s\s*\d+\s*e\s*\d+(?:\s*[\/-]\s*e?\s*\d+)?|t\s*\d+\s*e\s*\d+(?:\s*[\/-]\s*e?\s*\d+)?|\d+\s*x\s*\d+(?:\s*[\/-]\s*\d+)?)\b/gi, ' ')
    .replace(/^[+\-–—\s]+/, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function cleanGroupTitle(value: unknown) {
  return String(value ?? '')
    .replace(/\b(?:LEG(?:ENDADO)?|SUB|DUB(?:LADO)?|DUAL|MOB(?:ILE)?|PT[- ]?BR|4K|FHD|UHD|FULL\s*HD|HD|SD|1080P|720P|480P)\b/gi, ' ')
    .replace(/[|_]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function tokenSimilarity(a: string, b: string) {
  const aa = new Set(normalizeTitle(a).split(' ').filter(Boolean));
  const bb = new Set(normalizeTitle(b).split(' ').filter(Boolean));
  if (!aa.size || !bb.size) return 0;
  let common = 0;
  aa.forEach(token => { if (bb.has(token)) common += 1; });
  return common / Math.max(aa.size, bb.size);
}

function titleFromEpisodeRest(rest: string) {
  const value = cleanText(rest, 500);
  const split = value.match(/^(.+?)(?:\s*[:|]\s*|\s+[-–—]\s+).+$/);
  return cleanText(split?.[1] || value, 500);
}

function chooseEpisodeBase(rest: string, group: string) {
  const fromTitle = titleFromEpisodeRest(rest);
  const fromGroup = cleanGroupTitle(group);
  if (!fromGroup) return fromTitle;
  const g = normalizeTitle(fromGroup);
  const t = normalizeTitle(fromTitle);
  const generic = /^(series?|seriados?|shows?|animes?|filmes?|movies?|tv|vod|dublado|legendado|dual|outros|geral)$/.test(g);
  if (generic || !g || !t) return fromTitle;
  if (g === t || g.startsWith(`${t} `) || t.startsWith(`${g} `) || tokenSimilarity(g, t) >= 0.6) return fromGroup;
  return fromTitle;
}

type ParsedEpisode = { base: string; season: number; episode: number; episodeEnd: number | null; marker: string };

function parseEpisode(title: string, group = ''): ParsedEpisode | null {
  const raw = String(title || '').trim();

  let m = raw.match(/^0*(\d{1,3})\s*[xX]\s*0*(\d{1,4})(?:\s*[\/-]\s*0*(\d{1,4}))?([A-Za-z]{0,3})\s+(.+)$/i);
  if (m) return {
    base: chooseEpisodeBase(m[5], group),
    season: Number(m[1]) || 1,
    episode: Number(m[2]) || 1,
    episodeEnd: m[3] ? (Number(m[3]) || null) : null,
    marker: String(m[4] || '').toUpperCase()
  };

  m = raw.match(/^S\s*0*(\d{1,3})\s*E\s*0*(\d{1,4})(?:\s*[\/-]\s*(?:E\s*)?0*(\d{1,4}))?([A-Za-z]{0,3})\s+(.+)$/i);
  if (m) return {
    base: chooseEpisodeBase(m[5], group),
    season: Number(m[1]) || 1,
    episode: Number(m[2]) || 1,
    episodeEnd: m[3] ? (Number(m[3]) || null) : null,
    marker: String(m[4] || '').toUpperCase()
  };

  const suffixPatterns: Array<[RegExp, number, number]> = [
    [/^(.*?)[\s._-]+S\s*0*(\d{1,3})\s*E\s*0*(\d{1,4})(?:\D.*)?$/i, 2, 3],
    [/^(.*?)[\s._-]+T\s*0*(\d{1,3})\s*E\s*0*(\d{1,4})(?:\D.*)?$/i, 2, 3],
    [/^(.*?)[\s._-]+0*(\d{1,3})\s*[xX]\s*0*(\d{1,4})(?:\D.*)?$/i, 2, 3]
  ];
  for (const [re, seasonGroup, episodeGroup] of suffixPatterns) {
    const hit = raw.match(re);
    if (hit) return {
      base: cleanText(hit[1], 500),
      season: Number(hit[seasonGroup]) || 1,
      episode: Number(hit[episodeGroup]) || 1,
      episodeEnd: null,
      marker: ''
    };
  }

  const simple = raw.match(/^(.*?)(?:\s*[-–—|:]?\s*)(?:ep(?:is[oó]dio|isode)?\.?|e)\s*0*(\d{1,4})(?:\D.*)?$/i);
  if (simple?.[1]) return {
    base: cleanText(simple[1], 500),
    season: 1,
    episode: Number(simple[2]) || 1,
    episodeEnd: null,
    marker: ''
  };
  return null;
}

function detectAudio(title: string, group = '', url = '', marker = '') {
  const mark = String(marker || '').toUpperCase();
  if (mark.includes('L')) return 'sub';
  if (mark.includes('D')) return 'dub';
  const text = `${title} ${group} ${url}`.toLowerCase();
  if (/\bdual\b/.test(text)) return 'dual';
  if (/dublad|\bdub\b/.test(text)) return 'dub';
  if (/legendad|\bleg\b|\bsub\b/.test(text)) return 'sub';
  return '';
}

function detectLanguage(title: string, group = '') {
  const text = `${title} ${group}`.toLowerCase();
  if (/pt[- ]?br|portugu[eê]s|brasil|dublad|legendad|\bleg\b|\bdub\b/.test(text)) return 'pt-BR';
  return '';
}

function inferMediaType(title: string, group: string, url: string, hint = 'auto', ep: ParsedEpisode | null = null) {
  const h = String(hint || 'auto').toLowerCase();
  const text = `${group} ${title}`.toLowerCase();
  const path = String(url || '').toLowerCase();
  if (ep) return 'series';
  if (h === 'movies') return 'movies';
  if (h === 'series' || h === 'anime') {
    if (/filme|movie|longa/.test(text) && /anime|anima/.test(text)) return 'movies';
    return 'series';
  }
  if (/\/movie\//.test(path) || /\bfilmes?\b|\bmovies?\b|cinema/.test(text)) return 'movies';
  if (/\/series\//.test(path) || /\bs[eé]ries?\b|\banimes?\b/.test(text)) return 'series';
  if (/\/live\//.test(path) || /\btv\b|canais|ao vivo/.test(text)) return 'live';
  return 'series';
}

function parseExtinf(line: string) {
  const attrs: Record<string, string> = {};
  for (const match of line.matchAll(/([\w-]+)=\"([^\"]*)\"/g)) attrs[match[1].toLowerCase()] = match[2];
  const comma = line.indexOf(',');
  return { attrs, name: cleanText(comma >= 0 ? line.slice(comma + 1) : attrs['tvg-name'] || '', 500) };
}

function isObviousPlaceholder(urlText: string, title: string, ep: ParsedEpisode | null) {
  if (ep) return false;
  try {
    const url = new URL(urlText);
    const host = url.hostname.toLowerCase();
    const path = url.pathname.toLowerCase();
    if (/\.(mp4|m3u8?|ts|mkv|avi|mov|webm)$/.test(path)) return false;
    if (/myonseries\.blogspot\./.test(host)) return true;
    if (/(blogspot\.|wordpress\.|facebook\.com|twitter\.com|x\.com)$/.test(host) && /(renovad|cancelad|em breve|atualizad|site|doa[cç][aã]o)/i.test(title)) return true;
  } catch (_) {}
  return false;
}

function sourceQuality(urlText: string) {
  let score = 0;
  try {
    const url = new URL(urlText);
    if (url.protocol === 'https:') score += 2;
    if (/\.(mp4|m3u8?)$/i.test(url.pathname)) score += 2;
  } catch (_) {}
  return score;
}

function hashCode(value: string) {
  let hash = 0;
  for (let i = 0; i < value.length; i++) hash = ((hash << 5) - hash + value.charCodeAt(i)) | 0;
  return hash;
}

function parseM3U(text: string, hint = 'auto', secureVideosOnly = false) {
  const lines = String(text || '').split(/\r?\n/);
  const byLogicalKey = new Map<string, any>();
  let info: ReturnType<typeof parseExtinf> | null = null;
  let skippedPlaceholders = 0;
  let skippedInvalid = 0;
  let skippedHttp = 0;

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) continue;
    if (line.startsWith('#EXTINF:')) { info = parseExtinf(line); continue; }
    if (line.startsWith('#')) continue;
    if (!info || !/^https?:\/\//i.test(line)) { info = null; continue; }

    if (secureVideosOnly && /^http:\/\//i.test(line)) {
      skippedHttp += 1;
      info = null;
      continue;
    }

    const group = cleanText(info.attrs['group-title'] || '', 300);
    const originalTitle = info.name || cleanText(info.attrs['tvg-name'] || '', 500) || 'Sem título';
    const ep = parseEpisode(originalTitle, group);
    if (isObviousPlaceholder(line, originalTitle, ep)) {
      skippedPlaceholders += 1;
      info = null;
      continue;
    }

    const type = inferMediaType(originalTitle, group, line, hint, ep);
    const baseTitle = ep && type === 'series' ? ep.base : originalTitle;
    const normalized = normalizeTitle(baseTitle);
    if (!normalized) {
      skippedInvalid += 1;
      info = null;
      continue;
    }

    const yearMatch = `${originalTitle} ${group}`.match(/\b(19\d{2}|20\d{2})\b/);
    const isAnime = /anime|donghua/.test(`${group} ${hint}`.toLowerCase());
    const audio = detectAudio(originalTitle, group, line, ep?.marker || '');
    const sourceKey = `${line}|${normalized}|${ep?.season || 0}|${ep?.episode || 0}`;
    const logicalKey = ep && type === 'series'
      ? `${normalized}|s${ep.season}|e${ep.episode}|${audio || 'default'}`
      : sourceKey;

    const item: any = {
      title: originalTitle,
      canonical_title: baseTitle,
      normalized_title: normalized,
      media_type: type,
      year: yearMatch ? Number(yearMatch[1]) : null,
      season: ep?.season ?? null,
      episode: ep?.episode ?? null,
      episode_title: ep ? originalTitle : '',
      poster: cleanText(info.attrs['tvg-logo'] || '', 2000),
      url: line,
      language: detectLanguage(originalTitle, group),
      audio,
      source_key: `${normalized}:${ep?.season || 0}:${ep?.episode || 0}:${audio || 'x'}:${Math.abs(hashCode(line)).toString(36)}`,
      metadata: {
        group,
        original_title: originalTitle,
        anime: isAnime,
        tvg_id: cleanText(info.attrs['tvg-id'] || '', 200),
        episode_marker: ep?.marker || '',
        episode_end: ep?.episodeEnd ?? null
      }
    };

    const current = byLogicalKey.get(logicalKey);
    if (!current || sourceQuality(item.url) > sourceQuality(current.url)) byLogicalKey.set(logicalKey, item);
    info = null;
  }

  return {
    items: [...byLogicalKey.values()],
    stats: {
      parsed: byLogicalKey.size,
      skipped_placeholders: skippedPlaceholders,
      skipped_invalid: skippedInvalid,
      skipped_http: skippedHttp
    }
  };
}

async function fetchText(url: string, timeoutMs = 45000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      redirect: 'follow',
      signal: controller.signal,
      headers: { 'User-Agent': 'Lux-Canonical-Sync/1.6.3-secondary-https-only' }
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const text = await response.text();
    if (!text) throw new Error('Fonte vazia.');
    if (text.length > 60 * 1024 * 1024) throw new Error('Fonte excede 60 MB.');
    return text;
  } finally {
    clearTimeout(timer);
  }
}

async function resolveAccount(db: any, body: any, adminOnly = true) {
  const username = cleanText(body?.username, 160);
  const credential = String(body?.password ?? '');
  if (!username || !credential) return { error: json({ error: 'Login necessário.' }, 401) };
  const { data: account, error } = await db.rpc('lux_auth_resolve', { p_username: username, p_credential: credential });
  if (error) throw error;
  if (!account) return { error: json({ error: 'Credencial inválida ou sessão expirada.' }, 401) };
  if (adminOnly && String(account.cargo || '').toLowerCase() !== 'admin') return { error: json({ error: 'Acesso exclusivo de administrador.' }, 403) };
  return { account, username, credential };
}

async function ingestItems(db: any, layer: string, sourceId: string, sourceName: string, priority: number, items: any[]) {
  const seenAt = new Date().toISOString();
  const { error: staleError } = await db.from('lux_catalog_sources')
    .update({ available: false, updated_at: seenAt })
    .eq('source_layer', layer)
    .eq('source_id', sourceId);
  if (staleError) throw staleError;

  const totals = { processed: 0, new_titles: 0, new_episodes: 0, new_sources: 0, updated_sources: 0 };
  for (let offset = 0; offset < items.length; offset += 600) {
    const batch = items.slice(offset, offset + 600);
    const { data, error } = await db.rpc('lux_catalog_ingest_batch', {
      p_layer: layer,
      p_source_id: sourceId,
      p_source_name: sourceName,
      p_priority: priority,
      p_items: batch,
      p_seen_at: seenAt
    });
    if (error) throw error;
    for (const key of Object.keys(totals)) (totals as any)[key] += Number(data?.[key] || 0);
  }
  return totals;
}

function addStats(base: any, name: string, result: any) {
  const next = base && typeof base === 'object' ? { ...base } : {};
  next.tasks = Array.isArray(next.tasks) ? [...next.tasks] : [];
  next.tasks.push({ name, ...result });
  for (const key of ['processed', 'new_titles', 'new_episodes', 'new_sources', 'updated_sources']) {
    next[key] = Number(next[key] || 0) + Number(result[key] || 0);
  }
  return next;
}

Deno.serve(async (request: Request) => {
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
  if (request.method !== 'POST') return json({ error: 'Método não permitido.' }, 405);

  try {
    let body: any;
    try { body = await request.json(); } catch { return json({ error: 'JSON inválido.' }, 400); }

    const db = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
      { auth: { persistSession: false } }
    );
    const auth = await resolveAccount(db, body, true);
    if (auth.error) return auth.error;
    const action = cleanText(body?.action, 40).toLowerCase();

    if (action === 'options') {
      const { data: accountRow } = await db.from('usuarios')
        .select('usuario,lista_m3u,lista_m3u_https')
        .eq('usuario', auth.username)
        .single();
      const { data: secondary } = await db.from('secondary_content_sources')
        .select('id,name,source_type,priority,enabled,last_status')
        .order('priority');
      const { count: titleCount } = await db.from('lux_catalog_titles').select('id', { count: 'exact', head: true });
      const { count: sourceCount } = await db.from('lux_catalog_sources').select('id', { count: 'exact', head: true }).eq('available', true);
      return json({
        principal: {
          available: Boolean(accountRow?.lista_m3u_https || accountRow?.lista_m3u),
          name: 'Lista principal'
        },
        providers: [],
        secondary: secondary || [],
        catalog: { titles: titleCount || 0, active_sources: sourceCount || 0 }
      });
    }

    if (action === 'begin') {
      const layers = body?.layers && typeof body.layers === 'object' ? body.layers : {};
      const tasks: any[] = [];
      if (layers.principal) tasks.push({ kind: 'principal', id: 'principal', name: 'Lista principal' });
      if (layers.secondary) {
        const { data } = await db.from('secondary_content_sources')
          .select('id,name,enabled')
          .eq('enabled', true)
          .order('priority');
        const wanted = new Set(Array.isArray(body?.secondary_ids) ? body.secondary_ids.map(String) : []);
        (data || [])
          .filter((s: any) => !wanted.size || wanted.has(String(s.id)))
          .forEach((s: any) => tasks.push({ kind: 'secondary', id: s.id, name: s.name }));
      }
      if (!tasks.length) return json({ error: 'Selecione ao menos uma fonte principal ou secundária ativa.' }, 400);

      const requestedLayers = ['principal', 'secondary'].filter(k => Boolean(layers[k]));
      const { data: run, error } = await db.from('lux_catalog_sync_runs').insert({
        requested_by: auth.username,
        requested_layers: requestedLayers,
        status: 'running',
        current_phase: 'preparando',
        progress_total: tasks.length,
        stats: { tasks: [] }
      }).select('*').single();
      if (error) throw error;
      return json({ run_id: run.id, tasks });
    }

    if (action === 'sync_task') {
      const runId = cleanText(body?.run_id, 80);
      const kind = cleanText(body?.kind, 30);
      const id = cleanText(body?.id, 200);
      const { data: run, error: runError } = await db.from('lux_catalog_sync_runs')
        .select('*')
        .eq('id', runId)
        .eq('requested_by', auth.username)
        .single();
      if (runError || !run) return json({ error: 'Sincronização não encontrada.' }, 404);

      let layer = '';
      let sourceId = '';
      let sourceName = '';
      let priority = 100;
      let items: any[] = [];
      let parseStats: any = {};

      await db.from('lux_catalog_sync_runs')
        .update({ current_phase: `sincronizando:${kind}:${id}` })
        .eq('id', runId);

      if (kind === 'principal') {
        const { data: accountRow, error } = await db.from('usuarios')
          .select('lista_m3u,lista_m3u_https')
          .eq('usuario', auth.username)
          .single();
        if (error) throw error;
        const url = String(accountRow?.lista_m3u_https || accountRow?.lista_m3u || '').trim();
        if (!/^https?:\/\//i.test(url)) throw new Error('A lista principal não possui URL sincronizável.');

        const parsed = parseM3U(await fetchText(url), 'auto', false);
        items = parsed.items;
        parseStats = parsed.stats;
        layer = 'principal';
        sourceId = `principal:${auth.username}`;
        sourceName = 'Lista principal';
        priority = 0;
      } else if (kind === 'secondary') {
        const { data: source, error } = await db.from('secondary_content_sources')
          .select('*')
          .eq('id', id)
          .eq('enabled', true)
          .single();
        if (error || !source) throw new Error('Fonte secundária está desativada ou não existe.');

        try {
          // A URL da própria M3U pode ser HTTP ou HTTPS. A restrição vale somente
          // para os vídeos/episódios contidos nela.
          const parsed = parseM3U(
            await fetchText(source.source_url),
            source.source_type || 'auto',
            true
          );
          items = parsed.items;
          parseStats = parsed.stats;
          layer = 'secondary';
          sourceId = String(source.id);
          sourceName = source.name;
          priority = Number(source.priority) || 100;

          await db.from('secondary_content_sources').update({
            last_checked_at: new Date().toISOString(),
            last_status: 'success',
            last_error: null,
            updated_at: new Date().toISOString()
          }).eq('id', id);
        } catch (error: any) {
          await db.from('secondary_content_sources').update({
            last_checked_at: new Date().toISOString(),
            last_status: 'error',
            last_error: cleanText(error?.message || 'Falha ao ler fonte.', 1000),
            updated_at: new Date().toISOString()
          }).eq('id', id);
          throw error;
        }
      } else {
        return json({ error: 'Tarefa inválida. Providers estão desativados por enquanto.' }, 400);
      }

      if (!items.length) {
        if (kind === 'secondary' && Number(parseStats?.skipped_http || 0) > 0) {
          throw new Error(`Nenhum vídeo HTTPS utilizável foi encontrado. ${parseStats.skipped_http} link(s) HTTP foram ignorados.`);
        }
        throw new Error('Nenhuma entrada reproduzível foi encontrada nessa fonte.');
      }

      const result = await ingestItems(db, layer, sourceId, sourceName, priority, items);
      const enrichedResult = { ...result, ...parseStats };
      const nextStats = addStats(run.stats, sourceName, enrichedResult);
      const nextProgress = Math.min(Number(run.progress_total) || 1, (Number(run.progress_current) || 0) + 1);

      await db.from('lux_catalog_sync_runs').update({
        stats: nextStats,
        progress_current: nextProgress,
        current_phase: `concluído:${sourceName}`
      }).eq('id', runId);

      return json({
        name: sourceName,
        ...enrichedResult,
        progress_current: nextProgress,
        progress_total: run.progress_total
      });
    }

    if (action === 'enrich') {
      return json({ checked: 0, matched: 0, review: 0, remaining: 0, disabled: true });
    }

    if (action === 'finish') {
      const runId = cleanText(body?.run_id, 80);
      const { data: run, error } = await db.from('lux_catalog_sync_runs')
        .select('*')
        .eq('id', runId)
        .eq('requested_by', auth.username)
        .single();
      if (error || !run) return json({ error: 'Sincronização não encontrada.' }, 404);

      const status = Number(run.progress_current) >= Number(run.progress_total) ? 'success' : 'partial';
      const { data: updated, error: updateError } = await db.from('lux_catalog_sync_runs').update({
        status,
        current_phase: 'finalizado',
        finished_at: new Date().toISOString()
      }).eq('id', runId).select('*').single();
      if (updateError) throw updateError;
      return json({ run: updated });
    }

    if (action === 'status') {
      const runId = cleanText(body?.run_id, 80);
      const { data: run, error } = await db.from('lux_catalog_sync_runs')
        .select('*')
        .eq('id', runId)
        .eq('requested_by', auth.username)
        .single();
      if (error || !run) return json({ error: 'Sincronização não encontrada.' }, 404);
      return json({ run });
    }

    return json({ error: 'Ação inválida.' }, 400);
  } catch (error: any) {
    console.error('content-catalog-sync:', error);
    return json({
      error: error?.name === 'AbortError'
        ? 'A fonte demorou demais para responder.'
        : (error?.message || 'Falha na sincronização do catálogo.')
    }, 500);
  }
});
