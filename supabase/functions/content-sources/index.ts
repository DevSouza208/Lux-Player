import { createClient } from 'npm:@supabase/supabase-js@2';

const headers = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Cache-Control': 'no-store'
};

const json = (data: unknown, status = 200) => Response.json(data, { status, headers });
const SOURCE_TYPES = new Set(['auto', 'anime', 'series', 'movies', 'live']);
const REVIEW_STATES = new Set(['merged', 'separate', 'ignored']);
const MAX_REVIEW_BATCH = 60;
const CHECK_BYTES = 2 * 1024 * 1024;

function cleanText(value: unknown, max = 200) {
  return String(value ?? '').trim().slice(0, max);
}

function parseSource(body: any) {
  const name = cleanText(body?.name, 80);
  const sourceUrl = cleanText(body?.source_url, 4000);
  const sourceType = cleanText(body?.source_type || 'auto', 20).toLowerCase();
  const priority = Math.min(999, Math.max(1, Number(body?.priority) || 10));
  let url: URL;
  try { url = new URL(sourceUrl); } catch { throw new Error('URL da fonte inválida.'); }
  if (!['http:', 'https:'].includes(url.protocol)) throw new Error('A fonte precisa usar HTTP ou HTTPS.');
  if (!name) throw new Error('Informe um nome para a fonte.');
  if (!SOURCE_TYPES.has(sourceType)) throw new Error('Tipo de fonte inválido.');
  return {
    name,
    source_url: url.toString(),
    source_type: sourceType,
    priority,
    enabled: body?.enabled !== false,
    fill_only: body?.fill_only !== false,
    review_duplicates: body?.review_duplicates !== false,
    updated_at: new Date().toISOString()
  };
}

async function resolveAccount(db: any, body: any, adminOnly = false) {
  const username = cleanText(body?.username, 160);
  const credential = String(body?.password ?? '');
  if (!username || !credential) return { error: json({ error: 'Login necessário.' }, 401) };
  // [LUX-AUTH-007] Aceita token revogável luxsess_ ou senha durante a migração.
  const { data: account, error } = await db.rpc('lux_auth_resolve', {
    p_username: username,
    p_credential: credential
  });
  if (error) throw error;
  if (!account) return { error: json({ error: 'Credencial inválida ou sessão expirada.' }, 401) };
  if (adminOnly && String(account.cargo || '').trim().toLowerCase() !== 'admin') {
    return { error: json({ error: 'Acesso exclusivo de administrador.' }, 403) };
  }
  return { account, username };
}

async function fetchSource(url: string, timeoutMs = 45000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, {
      redirect: 'follow',
      signal: controller.signal,
      headers: { 'User-Agent': 'Lux-Secondary-Source/1.6.3' }
    });
  } finally {
    clearTimeout(timer);
  }
}

async function samplePlaylist(response: Response) {
  const reader = response.body?.getReader();
  if (!reader) return '';
  const decoder = new TextDecoder();
  let bytes = 0;
  let text = '';
  try {
    while (bytes < CHECK_BYTES) {
      const { value, done } = await reader.read();
      if (done) break;
      if (!value) continue;
      bytes += value.byteLength;
      text += decoder.decode(value, { stream: true });
      if (bytes >= CHECK_BYTES) break;
    }
    text += decoder.decode();
  } finally {
    try { await reader.cancel(); } catch (_) {}
  }
  return text;
}

Deno.serve(async (request: Request) => {
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers });
  if (request.method !== 'POST') return json({ error: 'Método não permitido.' }, 405);

  try {
    let body: any;
    try { body = await request.json(); } catch { return json({ error: 'JSON inválido.' }, 400); }
    const action = cleanText(body?.action, 40);
    if (!action) return json({ error: 'Ação inválida.' }, 400);

    const db = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
      { auth: { persistSession: false } }
    );

    const adminActions = new Set(['admin_list', 'save', 'delete', 'check', 'reviews', 'resolve_review']);
    const auth = await resolveAccount(db, body, adminActions.has(action));
    if (auth.error) return auth.error;

    if (action === 'list') {
      const { data, error } = await db
        .from('secondary_content_sources')
        .select('id,name,source_type,priority,fill_only,review_duplicates,last_checked_at,last_status,last_error,updated_at')
        .eq('enabled', true)
        .order('priority', { ascending: true })
        .order('created_at', { ascending: true });
      if (error) throw error;

      const { data: decisions, error: decisionError } = await db
        .from('secondary_content_reviews')
        .select('source_id,fingerprint,status,candidate_key,candidate_title')
        .neq('status', 'pending')
        .order('updated_at', { ascending: false })
        .limit(2000);
      if (decisionError) throw decisionError;
      return json({ sources: data || [], decisions: decisions || [] });
    }

    if (action === 'admin_list') {
      const { data, error } = await db
        .from('secondary_content_sources')
        .select('*')
        .order('priority', { ascending: true })
        .order('created_at', { ascending: true });
      if (error) throw error;
      return json({ sources: data || [] });
    }

    if (action === 'save') {
      const payload = parseSource(body);
      const id = cleanText(body?.id, 80);
      if (id) {
        const { data, error } = await db
          .from('secondary_content_sources')
          .update(payload)
          .eq('id', id)
          .select('*')
          .single();
        if (error) throw error;
        return json({ source: data });
      }
      const { data, error } = await db
        .from('secondary_content_sources')
        .insert({ ...payload, created_by: auth.username })
        .select('*')
        .single();
      if (error) throw error;
      return json({ source: data }, 201);
    }

    if (action === 'delete') {
      const id = cleanText(body?.id, 80);
      if (!id) return json({ error: 'Fonte não informada.' }, 400);
      const { error } = await db.from('secondary_content_sources').delete().eq('id', id);
      if (error) throw error;
      return json({ ok: true });
    }

    if (action === 'check') {
      const id = cleanText(body?.id, 80);
      const { data: source, error } = await db
        .from('secondary_content_sources')
        .select('id,source_url')
        .eq('id', id)
        .single();
      if (error || !source) return json({ error: 'Fonte não encontrada.' }, 404);

      let status = 'error';
      let message = '';
      let entries = 0;
      try {
        const response = await fetchSource(source.source_url, 30000);
        if (!response.ok) throw new Error(`A origem respondeu HTTP ${response.status}.`);
        const text = await samplePlaylist(response);
        entries = (text.match(/#EXTINF:/gi) || []).length;
        if (!/#EXTM3U|#EXTINF:/i.test(text)) throw new Error('A resposta não parece ser uma playlist M3U.');
        status = 'success';
        message = entries ? `${entries}+ entradas detectadas na amostra.` : 'Playlist M3U detectada.';
      } catch (error: any) {
        message = error?.name === 'AbortError' ? 'A fonte demorou demais para responder.' : (error?.message || 'Falha ao validar a fonte.');
      }

      await db.from('secondary_content_sources').update({
        last_checked_at: new Date().toISOString(),
        last_status: status,
        last_error: status === 'success' ? null : message,
        updated_at: new Date().toISOString()
      }).eq('id', id);

      return json({ ok: status === 'success', status, message, entries }, status === 'success' ? 200 : 502);
    }

    if (action === 'playlist') {
      const id = cleanText(body?.id, 80);
      const { data: source, error } = await db
        .from('secondary_content_sources')
        .select('id,source_url,enabled')
        .eq('id', id)
        .single();
      if (error || !source || !source.enabled) return json({ error: 'Fonte indisponível.' }, 404);
      const response = await fetchSource(source.source_url);
      if (!response.ok || !response.body) return json({ error: `A fonte respondeu HTTP ${response.status}.` }, 502);
      const streamHeaders = new Headers(headers);
      streamHeaders.set('Content-Type', 'audio/x-mpegurl; charset=utf-8');
      const length = response.headers.get('content-length');
      if (length && /^\d+$/.test(length)) streamHeaders.set('Content-Length', length);
      return new Response(response.body, { status: 200, headers: streamHeaders });
    }

    if (action === 'queue_reviews') {
      const sourceId = cleanText(body?.source_id, 80);
      const items = Array.isArray(body?.items) ? body.items.slice(0, MAX_REVIEW_BATCH) : [];
      if (!sourceId || !items.length) return json({ queued: 0 });
      const fingerprints = items.map((item: any) => cleanText(item?.fingerprint, 300)).filter(Boolean);
      const { data: existing, error: existingError } = await db
        .from('secondary_content_reviews')
        .select('fingerprint,status')
        .eq('source_id', sourceId)
        .in('fingerprint', fingerprints);
      if (existingError) throw existingError;
      const locked = new Set((existing || []).filter((row: any) => row.status !== 'pending').map((row: any) => row.fingerprint));
      const rows = items
        .filter((item: any) => item?.fingerprint && !locked.has(cleanText(item.fingerprint, 300)))
        .map((item: any) => ({
          source_id: sourceId,
          fingerprint: cleanText(item.fingerprint, 300),
          incoming_title: cleanText(item.incoming_title, 300),
          incoming_type: cleanText(item.incoming_type, 30),
          candidate_key: cleanText(item.candidate_key, 300),
          candidate_title: cleanText(item.candidate_title, 300),
          score: Math.max(0, Math.min(100, Number(item.score) || 0)),
          incoming_meta: item.incoming_meta && typeof item.incoming_meta === 'object' ? item.incoming_meta : {},
          candidate_meta: item.candidate_meta && typeof item.candidate_meta === 'object' ? item.candidate_meta : {},
          status: 'pending',
          updated_at: new Date().toISOString()
        }));
      if (rows.length) {
        const { error } = await db.from('secondary_content_reviews').upsert(rows, { onConflict: 'source_id,fingerprint' });
        if (error) throw error;
      }
      return json({ queued: rows.length });
    }

    if (action === 'reviews') {
      const { data, error } = await db
        .from('secondary_content_reviews')
        .select('id,source_id,fingerprint,incoming_title,incoming_type,candidate_key,candidate_title,score,incoming_meta,candidate_meta,created_at')
        .eq('status', 'pending')
        .order('score', { ascending: false })
        .order('created_at', { ascending: true })
        .limit(150);
      if (error) throw error;
      return json({ reviews: data || [] });
    }

    if (action === 'resolve_review') {
      const id = Number(body?.id);
      const status = cleanText(body?.status, 20);
      if (!Number.isSafeInteger(id) || id <= 0 || !REVIEW_STATES.has(status)) return json({ error: 'Decisão inválida.' }, 400);
      const { error } = await db.from('secondary_content_reviews').update({
        status,
        resolved_at: new Date().toISOString(),
        resolved_by: auth.username,
        updated_at: new Date().toISOString()
      }).eq('id', id);
      if (error) throw error;
      return json({ ok: true, status });
    }

    return json({ error: 'Ação inválida.' }, 400);
  } catch (error: any) {
    console.error('content-sources:', error);
    return json({ error: error?.message || 'Não foi possível acessar as fontes de conteúdo.' }, 500);
  }
});
