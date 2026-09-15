import { createClient } from 'npm:@supabase/supabase-js@2';

const headers = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Cache-Control': 'no-store'
};

const json = (data: unknown, status = 200) => Response.json(data, { status, headers });
const MAX_QUEUE = 100;
const ALLOWED = new Set(['pt', 'international', 'ignored']);

function clean(value: unknown, max = 300) {
  return String(value ?? '').trim().slice(0, max);
}

function normalize(value: unknown) {
  return String(value ?? '')
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

async function resolveAccount(db: any, body: any, adminOnly = false) {
  const username = clean(body?.username, 160);
  const credential = String(body?.password ?? '');
  if (!username || !credential) return { error: json({ error: 'Login necessário.' }, 401) };

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

async function buildPreview(db: any, review: any) {
  const sourceId = clean(review?.source_id, 80);
  const incomingGroup = clean(review?.incoming_group, 300);
  const incomingTitle = clean(review?.incoming_title, 300);
  if (!sourceId) throw new Error('A revisão não possui uma fonte associada.');

  let query = db
    .from('lux_catalog_sources')
    .select('url,locator,locator_type,source_name,metadata,episode:lux_catalog_episodes(season,episode,episode_title)')
    .eq('source_layer', 'secondary')
    .eq('source_id', sourceId)
    .eq('available', true);

  if (incomingGroup) query = query.contains('metadata', { group: incomingGroup });
  let { data, error } = await query.limit(80);
  if (error) throw error;

  let candidates = Array.isArray(data) ? data : [];
  if (!candidates.length) {
    const fallback = await db
      .from('lux_catalog_sources')
      .select('url,locator,locator_type,source_name,metadata,episode:lux_catalog_episodes(season,episode,episode_title)')
      .eq('source_layer', 'secondary')
      .eq('source_id', sourceId)
      .eq('available', true)
      .limit(800);
    if (fallback.error) throw fallback.error;
    const titleKey = normalize(incomingTitle);
    const groupKey = normalize(incomingGroup);
    candidates = (fallback.data || []).filter((row: any) => {
      const metaGroup = normalize(row?.metadata?.group);
      const originalTitle = normalize(row?.metadata?.original_title);
      return Boolean(
        (groupKey && metaGroup === groupKey) ||
        (titleKey && (originalTitle.includes(titleKey) || metaGroup.includes(titleKey)))
      );
    });
  }

  candidates = candidates.filter((row: any) => /^https?:\/\//i.test(String(row?.url || row?.locator || '')));
  if (!candidates.length) throw new Error('Nenhum episódio reproduzível foi encontrado para esta revisão.');

  candidates.sort((a: any, b: any) => {
    const ae = a?.episode || {};
    const be = b?.episode || {};
    const seasonDelta = (Number(ae.season) || 999) - (Number(be.season) || 999);
    if (seasonDelta) return seasonDelta;
    const episodeDelta = (Number(ae.episode) || 9999) - (Number(be.episode) || 9999);
    if (episodeDelta) return episodeDelta;
    const aHttps = /^https:/i.test(String(a?.url || a?.locator || '')) ? 0 : 1;
    const bHttps = /^https:/i.test(String(b?.url || b?.locator || '')) ? 0 : 1;
    return aHttps - bHttps;
  });

  const sample = candidates[0];
  const episode = sample?.episode || {};
  return {
    url: String(sample?.url || sample?.locator || ''),
    title: incomingTitle || clean(sample?.metadata?.group, 300) || 'Amostra',
    group: incomingGroup || clean(sample?.metadata?.group, 300),
    source_name: clean(review?.source_name || sample?.source_name, 120),
    season: Number(episode?.season) || null,
    episode: Number(episode?.episode) || null,
    episode_title: clean(episode?.episode_title || sample?.metadata?.original_title, 300),
    original_title: clean(sample?.metadata?.original_title, 300),
    locator_type: clean(sample?.locator_type, 40)
  };
}

Deno.serve(async (request: Request) => {
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers });
  if (request.method !== 'POST') return json({ error: 'Método não permitido.' }, 405);

  try {
    let body: any;
    try { body = await request.json(); } catch { return json({ error: 'JSON inválido.' }, 400); }
    const action = clean(body?.action, 40);
    if (!action) return json({ error: 'Ação inválida.' }, 400);

    const db = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
      { auth: { persistSession: false } }
    );

    const auth = await resolveAccount(db, body, action === 'pending' || action === 'resolve' || action === 'preview');
    if (auth.error) return auth.error;

    if (action === 'decisions') {
      const { data, error } = await db
        .from('secondary_locale_reviews')
        .select('source_id,fingerprint,status')
        .neq('status', 'pending')
        .order('updated_at', { ascending: false })
        .limit(5000);
      if (error) throw error;
      return json({ decisions: data || [] });
    }

    if (action === 'queue') {
      const items = Array.isArray(body?.items) ? body.items.slice(0, MAX_QUEUE) : [];
      if (!items.length) return json({ queued: 0 });

      const keys = items
        .map((item: any) => ({ source_id: clean(item?.source_id, 80), fingerprint: clean(item?.fingerprint, 300) }))
        .filter((item: any) => item.source_id && item.fingerprint);
      if (!keys.length) return json({ queued: 0 });

      const sourceIds = [...new Set(keys.map((item: any) => item.source_id))];
      const fingerprints = [...new Set(keys.map((item: any) => item.fingerprint))];
      const { data: existing, error: existingError } = await db
        .from('secondary_locale_reviews')
        .select('source_id,fingerprint,status')
        .in('source_id', sourceIds)
        .in('fingerprint', fingerprints);
      if (existingError) throw existingError;

      const locked = new Set((existing || [])
        .filter((row: any) => row.status !== 'pending')
        .map((row: any) => `${row.source_id}|${row.fingerprint}`));

      const now = new Date().toISOString();
      const rows = items
        .map((item: any) => ({
          source_id: clean(item?.source_id, 80),
          fingerprint: clean(item?.fingerprint, 300),
          incoming_title: clean(item?.incoming_title, 300),
          incoming_type: clean(item?.incoming_type, 40),
          incoming_group: clean(item?.incoming_group, 300),
          source_name: clean(item?.source_name, 120),
          metadata: item?.metadata && typeof item.metadata === 'object' ? item.metadata : {},
          status: 'pending',
          updated_at: now
        }))
        .filter((row: any) => row.source_id && row.fingerprint && !locked.has(`${row.source_id}|${row.fingerprint}`));

      if (rows.length) {
        const { error } = await db
          .from('secondary_locale_reviews')
          .upsert(rows, { onConflict: 'source_id,fingerprint' });
        if (error) throw error;
      }
      return json({ queued: rows.length });
    }

    if (action === 'pending') {
      const { data, error } = await db
        .from('secondary_locale_reviews')
        .select('id,source_id,fingerprint,incoming_title,incoming_type,incoming_group,source_name,metadata,created_at')
        .eq('status', 'pending')
        .order('created_at', { ascending: true })
        .limit(200);
      if (error) throw error;
      return json({ reviews: data || [] });
    }

    if (action === 'preview') {
      const id = Number(body?.id);
      if (!Number.isSafeInteger(id) || id <= 0) return json({ error: 'Revisão inválida.' }, 400);
      const { data: review, error } = await db
        .from('secondary_locale_reviews')
        .select('id,source_id,incoming_title,incoming_type,incoming_group,source_name,status,metadata')
        .eq('id', id)
        .single();
      if (error || !review) return json({ error: 'Revisão não encontrada.' }, 404);
      const preview = await buildPreview(db, review);
      return json({ preview });
    }

    if (action === 'resolve') {
      const id = Number(body?.id);
      const status = clean(body?.status, 30);
      if (!Number.isSafeInteger(id) || id <= 0 || !ALLOWED.has(status)) {
        return json({ error: 'Decisão inválida.' }, 400);
      }
      const { error } = await db
        .from('secondary_locale_reviews')
        .update({
          status,
          resolved_at: new Date().toISOString(),
          resolved_by: auth.username,
          updated_at: new Date().toISOString()
        })
        .eq('id', id);
      if (error) throw error;
      return json({ ok: true, status });
    }

    return json({ error: 'Ação inválida.' }, 400);
  } catch (error: any) {
    console.error('content-locale-reviews:', error);
    return json({ error: error?.message || 'Não foi possível revisar o idioma do conteúdo.' }, 500);
  }
});
