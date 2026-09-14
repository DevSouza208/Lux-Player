import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Content-Type': 'application/json; charset=utf-8',
  'Cache-Control': 'no-store'
};

const ALLOWED_HOSTS = new Set([
  'assets.footylogos.com', 'logodetimes.com', 'www.logodetimes.com',
  'escudosfc.com.br', 'www.escudosfc.com.br'
]);

const normalize = (value: unknown) => String(value ?? '')
  .normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
  .replace(/&/g, ' e ').replace(/[^a-z0-9]+/g, ' ').replace(/\s+/g, ' ').trim();
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: cors });

function isPrivateHost(hostname: string) {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, '');
  if (host === 'localhost' || host === '::1' || host.endsWith('.local')) return true;
  if (/^127\./.test(host) || /^10\./.test(host) || /^192\.168\./.test(host) || /^169\.254\./.test(host)) return true;
  const m = host.match(/^172\.(\d{1,3})\./);
  if (m) { const second = Number(m[1]); if (second >= 16 && second <= 31) return true; }
  if (/^(?:fc|fd)[0-9a-f]{2}:/i.test(host) || /^fe80:/i.test(host)) return true;
  return false;
}

async function validateImageUrl(rawUrl: string, allowAnyPublicHttps = false) {
  let parsed: URL;
  try { parsed = new URL(rawUrl); } catch { throw new Error('URL inválida'); }
  const hostname = parsed.hostname.toLowerCase();
  if (parsed.protocol !== 'https:') throw new Error('A imagem precisa usar HTTPS');
  if (isPrivateHost(hostname)) throw new Error('Destino privado não permitido');
  if (!allowAnyPublicHttps && !ALLOWED_HOSTS.has(hostname)) throw new Error('Fonte de imagem não permitida');

  const response = await fetch(parsed.toString(), {
    method: 'GET', redirect: 'follow', signal: AbortSignal.timeout(7000),
    headers: { 'accept': 'image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8', 'user-agent': 'Mozilla/5.0 LuxPlay/1.6.3' }
  });
  const finalUrl = new URL(response.url || parsed.toString());
  const finalHost = finalUrl.hostname.toLowerCase();
  if (finalUrl.protocol !== 'https:' || isPrivateHost(finalHost)) { try { await response.body?.cancel(); } catch (_) {} throw new Error('Redirecionamento não permitido'); }
  if (!allowAnyPublicHttps && !ALLOWED_HOSTS.has(finalHost)) { try { await response.body?.cancel(); } catch (_) {} throw new Error('Redirecionamento para fonte não permitida'); }
  if (!response.ok) { try { await response.body?.cancel(); } catch (_) {} throw new Error(`Imagem respondeu HTTP ${response.status}`); }
  const type = String(response.headers.get('content-type') || '').toLowerCase();
  const length = Number(response.headers.get('content-length') || 0);
  if (type && !type.startsWith('image/')) { try { await response.body?.cancel(); } catch (_) {} throw new Error('Conteúdo não é uma imagem'); }
  if (Number.isFinite(length) && length > 5 * 1024 * 1024) { try { await response.body?.cancel(); } catch (_) {} throw new Error('Imagem excede o limite de 5 MB'); }
  try { await response.body?.cancel(); } catch (_) {}
  return finalUrl.toString();
}

// [LUX-AUTH-007] O campo password aceita a senha legada ou o token revogável.
async function assertAdmin(db: any, username: unknown, password: unknown) {
  if (typeof username !== 'string' || !username || typeof password !== 'string' || !password) {
    return { ok: false, status: 401, error: 'Login de administrador necessário.' };
  }
  const { data, error } = await db.rpc('lux_auth_resolve', { p_username: username, p_credential: password });
  if (error) throw error;
  if (!data || String(data.cargo || '').trim().toLowerCase() !== 'admin') {
    return { ok: false, status: 403, error: 'Acesso exclusivo de administrador.' };
  }
  return { ok: true, username: String(data.usuario || username) };
}

async function getControl(db: any) {
  const { data, error } = await db.from('team_logo_cache_control').select('version,updated_at,updated_by').eq('id', 1).maybeSingle();
  if (error) throw error;
  if (data) return data;
  const row = { id: 1, version: 1, updated_at: new Date().toISOString(), updated_by: null };
  const { data: created, error: createError } = await db.from('team_logo_cache_control').insert(row).select('version,updated_at,updated_by').single();
  if (createError) throw createError;
  return created;
}

async function bumpControl(db: any, username: string) {
  const current = await getControl(db);
  const version = Number(current?.version || 0) + 1;
  const updated_at = new Date().toISOString();
  const { data, error } = await db.from('team_logo_cache_control')
    .update({ version, updated_at, updated_by: username || null })
    .eq('id', 1).select('version,updated_at,updated_by').single();
  if (error) throw error;
  return data;
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405);
  const url = Deno.env.get('SUPABASE_URL');
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!url || !serviceKey) return json({ error: 'Configuração do servidor incompleta' }, 500);
  const db = createClient(url, serviceKey, { auth: { persistSession: false } });
  let body: any = {};
  try { body = await req.json(); } catch (_) { return json({ error: 'JSON inválido' }, 400); }
  const action = String(body?.action || 'lookup');

  try {
    if (action === 'control') return json({ control: await getControl(db) });

    if (action === 'lookup') {
      const names = Array.isArray(body?.teams) ? body.teams.slice(0, 100) : [];
      const keys = [...new Set(names.map(normalize).filter(Boolean))];
      const control = await getControl(db);
      if (!keys.length) return json({ logos: {}, missing: [], control });
      const { data, error } = await db.from('team_logo_cache')
        .select('team_key,display_name,logo_url,source,status,retry_after,updated_at').in('team_key', keys);
      if (error) throw error;
      const rows = new Map((data || []).map((row: any) => [row.team_key, row]));
      const logos: Record<string, any> = {}, missing: string[] = [];
      const now = Date.now();
      for (const key of keys) {
        const row: any = rows.get(key);
        if (row?.status === 'ready' && row.logo_url) {
          logos[key] = { url: row.logo_url, source: row.source || 'cache', name: row.display_name || key, updated_at: row.updated_at };
          continue;
        }
        if (row?.status === 'missing' && row.retry_after && Date.parse(row.retry_after) > now) continue;
        missing.push(key);
      }
      return json({ logos, missing, control });
    }

    if (action === 'report') {
      const displayName = String(body?.team || '').trim().slice(0, 160);
      const teamKey = normalize(displayName || body?.team_key);
      const candidate = String(body?.url || '').trim();
      const source = String(body?.source || 'unknown').trim().toLowerCase().slice(0, 40);
      if (!teamKey || !displayName || !candidate) return json({ error: 'Dados incompletos' }, 400);
      const { data: existing, error: existingError } = await db.from('team_logo_cache').select('logo_url,source,status,display_name,updated_at').eq('team_key', teamKey).maybeSingle();
      if (existingError) throw existingError;
      if (existing?.source === 'admin' && existing?.logo_url) return json({ ok: true, protected: true, logo: existing });
      const validUrl = await validateImageUrl(candidate, false);
      const now = new Date().toISOString();
      const row = { team_key: teamKey, display_name: displayName, logo_url: validUrl, source, status: 'ready', fail_count: 0, retry_after: null, last_checked_at: now, updated_at: now };
      const { data, error } = await db.from('team_logo_cache').upsert(row, { onConflict: 'team_key' }).select().single();
      if (error) throw error;
      return json({ ok: true, logo: data });
    }

    if (action === 'invalidate') {
      const teamKey = normalize(body?.team || body?.team_key);
      const currentUrl = String(body?.url || '').trim();
      if (!teamKey) return json({ error: 'Time inválido' }, 400);
      const { data: existing, error: existingError } = await db.from('team_logo_cache').select('logo_url,fail_count,source').eq('team_key', teamKey).maybeSingle();
      if (existingError) throw existingError;
      if (!existing || existing.source === 'admin' || (currentUrl && existing.logo_url !== currentUrl)) return json({ ok: true, ignored: true });
      const fails = Number(existing.fail_count || 0) + 1;
      const retryHours = Math.min(24 * 7, 6 * Math.pow(2, Math.min(fails - 1, 5)));
      const retryAfter = new Date(Date.now() + retryHours * 3600000).toISOString();
      const { error } = await db.from('team_logo_cache').update({ status: 'missing', logo_url: null, source: null, fail_count: fails, retry_after: retryAfter, last_checked_at: new Date().toISOString(), updated_at: new Date().toISOString() }).eq('team_key', teamKey);
      if (error) throw error;
      return json({ ok: true, retry_after: retryAfter });
    }

    if (action === 'mark_missing') {
      const displayName = String(body?.team || '').trim().slice(0, 160);
      const teamKey = normalize(displayName || body?.team_key);
      if (!teamKey) return json({ error: 'Time inválido' }, 400);
      const { data: existing, error: existingError } = await db.from('team_logo_cache').select('source').eq('team_key', teamKey).maybeSingle();
      if (existingError) throw existingError;
      if (existing?.source === 'admin') return json({ ok: true, ignored: true });
      const retryAfter = new Date(Date.now() + 24 * 3600000).toISOString();
      const { error } = await db.from('team_logo_cache').upsert({ team_key: teamKey, display_name: displayName || teamKey, logo_url: null, source: null, status: 'missing', retry_after: retryAfter, last_checked_at: new Date().toISOString(), updated_at: new Date().toISOString() }, { onConflict: 'team_key' });
      if (error) throw error;
      return json({ ok: true, retry_after: retryAfter });
    }

    if (action === 'admin_search') {
      const admin = await assertAdmin(db, body.username, body.password);
      if (!admin.ok) return json({ error: admin.error }, admin.status);
      const query = String(body?.query || '').trim().replace(/[%_]/g, '').slice(0, 80);
      let request = db.from('team_logo_cache').select('team_key,display_name,logo_url,source,status,fail_count,retry_after,updated_at').order('updated_at', { ascending: false }).limit(50);
      if (query) request = request.ilike('display_name', `%${query}%`);
      const { data, error } = await request;
      if (error) throw error;
      return json({ rows: data || [], control: await getControl(db) });
    }

    if (action === 'admin_set') {
      const admin = await assertAdmin(db, body.username, body.password);
      if (!admin.ok) return json({ error: admin.error }, admin.status);
      const displayName = String(body?.team || '').trim().replace(/\s+/g, ' ').slice(0, 160);
      const teamKey = normalize(displayName || body?.team_key);
      const candidate = String(body?.url || '').trim();
      if (!teamKey || !displayName || !candidate) return json({ error: 'Informe o time e a URL do escudo.' }, 400);
      const validUrl = await validateImageUrl(candidate, true);
      const now = new Date().toISOString();
      const row = { team_key: teamKey, display_name: displayName, logo_url: validUrl, source: 'admin', status: 'ready', fail_count: 0, retry_after: null, last_checked_at: now, updated_at: now };
      const { data, error } = await db.from('team_logo_cache').upsert(row, { onConflict: 'team_key' }).select().single();
      if (error) throw error;
      const control = await bumpControl(db, admin.username || String(body.username || 'admin'));
      return json({ ok: true, logo: data, control });
    }

    if (action === 'admin_delete') {
      const admin = await assertAdmin(db, body.username, body.password);
      if (!admin.ok) return json({ error: admin.error }, admin.status);
      const teamKey = normalize(body?.team || body?.team_key);
      if (!teamKey) return json({ error: 'Time inválido.' }, 400);
      const { error } = await db.from('team_logo_cache').delete().eq('team_key', teamKey);
      if (error) throw error;
      const control = await bumpControl(db, admin.username || String(body.username || 'admin'));
      return json({ ok: true, control });
    }

    if (action === 'admin_bump') {
      const admin = await assertAdmin(db, body.username, body.password);
      if (!admin.ok) return json({ error: admin.error }, admin.status);
      return json({ ok: true, control: await bumpControl(db, admin.username || String(body.username || 'admin')) });
    }

    return json({ error: 'Ação inválida' }, 400);
  } catch (error) {
    console.error('[team-logo-cache]', error);
    return json({ error: error instanceof Error ? error.message : 'Erro interno' }, 500);
  }
});