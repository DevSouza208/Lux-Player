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

    const auth = await resolveAccount(db, body, action === 'pending' || action === 'resolve');
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
