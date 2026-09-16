import { createClient } from 'npm:@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Cache-Control': 'no-store',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type'
};

const MAX_SAVE_BYTES = 6 * 1024 * 1024;
const R2_SAVE_GATEWAY = 'https://lux-r2-gateway.professorsouza-tech.workers.dev/api/saves';

function json(data: unknown, status = 200) {
  return Response.json(data, { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
}

function fromBase64(value: string) {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index++) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

function toBase64(buffer: ArrayBuffer) {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

async function tryR2Gateway(body: Record<string, unknown>) {
  try {
    const response = await fetch(R2_SAVE_GATEWAY, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });

    const text = await response.text();
    let data: unknown = null;
    if (text) {
      try { data = JSON.parse(text); } catch { data = { error: text }; }
    }

    // 404/503 mean the new Worker is not deployed/configured yet. In those two
    // cases only, keep the old Supabase Storage path as a rollout fallback.
    if (response.status === 404 || response.status === 503) return null;

    return { status: response.status, data };
  } catch {
    // Temporary network failure during rollout: preserve the existing save path.
    return null;
  }
}

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (request.method !== 'POST') return json({ error: 'Método não permitido' }, 405);

  try {
    let body: Record<string, unknown>;
    try { body = await request.json(); }
    catch { return json({ error: 'JSON inválido.' }, 400); }
    if (!body || typeof body !== 'object' || Array.isArray(body)) return json({ error: 'Dados inválidos.' }, 400);

    // Primary path: authenticated Cloudflare Worker + private luxsaves R2 bucket.
    // The Worker keeps the Supabase table only as metadata and stores the binary
    // save in R2. The app contract remains identical (list/load/save).
    const r2Result = await tryR2Gateway(body);
    if (r2Result) return json(r2Result.data, r2Result.status);

    // Legacy fallback kept only until the Worker has been deployed and verified.
    const {
      action,
      username,
      password,
      gameKey: requestedGameKey,
      slot,
      updatedAt,
      dataBase64,
      format,
      expectedCloudAt = null
    } = body as Record<string, any>;

    if (typeof username !== 'string' || !username || username.length > 256
        || typeof password !== 'string' || !password || password.length > 1024) {
      return json({ error: 'Login necessário.' }, 401);
    }
    if (typeof requestedGameKey !== 'string' || !requestedGameKey || requestedGameKey.length > 500
        || ![0, 1, 2, 3].includes(slot)) {
      return json({ error: 'Dados do save inválidos.' }, 400);
    }

    const url = Deno.env.get('SUPABASE_URL');
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    if (!url || !serviceRoleKey) throw new Error('Configuração do Supabase indisponível.');
    const admin = createClient(url, serviceRoleKey, { auth: { persistSession: false } });

    const { data: account, error: accountError } = await admin.rpc('lux_auth_resolve', {
      p_username: username,
      p_credential: password
    });
    if (accountError) throw accountError;
    if (!account) return json({ error: 'Credencial inválida ou sessão expirada.' }, 401);

    const expiry = String(account.vencimento || '').split('/');
    if (expiry.length === 3
        && Date.now() > new Date(`${expiry[2]}-${expiry[1].padStart(2, '0')}-${expiry[0].padStart(2, '0')}T23:59:59-03:00`).getTime()) {
      return json({ error: 'Acesso vencido.' }, 403);
    }

    const userName = String(account.usuario);
    const profileSlot = body.profileSlot ?? 1;
    if (![1, 2, 3, 4].includes(profileSlot as number)) return json({ error: 'Perfil inválido.' }, 400);

    const { data: profile, error: profileError } = await admin
      .from('account_profiles')
      .select('slot,data_key')
      .eq('user_name', userName)
      .eq('slot', profileSlot)
      .maybeSingle();
    if (profileError) throw profileError;
    if (!profile || (profile.data_key || '') !== (body.profileKey || '')) {
      return json({ error: 'Perfil alterado. Selecione o perfil novamente.' }, 403);
    }
    if (requestedGameKey.startsWith('profile:')) return json({ error: 'Chave inválida.' }, 400);

    const gameKey = (profile.data_key
      ? `profile:${profile.data_key}:`
      : profileSlot === 1 ? '' : `profile:${profileSlot}:`) + requestedGameKey;

    if (action === 'list') {
      const { data, error } = await admin
        .from('user_game_saves')
        .select('slot, client_updated_at')
        .eq('user_name', userName)
        .eq('game_key', gameKey);
      if (error) throw error;
      return json({ slots: (data || []).map(row => ({ slot: Number(row.slot), updatedAt: Number(row.client_updated_at) })) });
    }

    if (action === 'load') {
      const { data: row, error } = await admin
        .from('user_game_saves')
        .select('storage_path, state_format, client_updated_at')
        .eq('user_name', userName)
        .eq('game_key', gameKey)
        .eq('slot', Number(slot))
        .maybeSingle();
      if (error) throw error;
      if (!row) return json({ save: null });

      const { data: file, error: fileError } = await admin.storage.from('game-saves').download(row.storage_path);
      if (fileError) throw fileError;
      const buffer = await file.arrayBuffer();
      if (buffer.byteLength > MAX_SAVE_BYTES) return json({ error: 'Save excede o limite permitido.' }, 413);
      return json({ save: { updatedAt: Number(row.client_updated_at), format: row.state_format, dataBase64: toBase64(buffer) } });
    }

    if (action !== 'save' || typeof dataBase64 !== 'string'
        || !Number.isSafeInteger(updatedAt) || updatedAt <= 0 || updatedAt > Date.now() + 300000
        || !['arraybuffer', 'text', 'json', 'uint8array'].includes(format)) {
      return json({ error: 'Dados do save inválidos.' }, 400);
    }
    if (expectedCloudAt !== null && (!Number.isSafeInteger(expectedCloudAt) || expectedCloudAt < 0)) {
      return json({ error: 'Versão de save inválida.' }, 400);
    }

    const incomingTime = Math.floor(Number(updatedAt));
    const { data: current, error: currentError } = await admin
      .from('user_game_saves')
      .select('client_updated_at')
      .eq('user_name', userName)
      .eq('game_key', gameKey)
      .eq('slot', Number(slot))
      .maybeSingle();
    if (currentError) throw currentError;
    if (current && Number(current.client_updated_at) >= incomingTime) return json({ saved: false, newerCloud: true });

    if (dataBase64.length > Math.ceil(MAX_SAVE_BYTES / 3) * 4) return json({ error: 'Save excede o limite de 6 MB.' }, 413);
    let bytes: Uint8Array;
    try { bytes = fromBase64(dataBase64); }
    catch { return json({ error: 'Save inválido.' }, 400); }
    if (!bytes.byteLength) return json({ error: 'Save vazio.' }, 400);
    if (bytes.byteLength > MAX_SAVE_BYTES) return json({ error: 'Save excede o limite de 6 MB.' }, 413);

    const path = `${encodeURIComponent(userName)}/${encodeURIComponent(gameKey)}/slot-${Number(slot)}-${crypto.randomUUID()}.bin`;
    const { error: uploadError } = await admin.storage
      .from('game-saves')
      .upload(path, bytes, { contentType: 'application/octet-stream', upsert: false });
    if (uploadError) throw uploadError;

    const { data: saved, error: saveError } = await admin.rpc('commit_game_save_checked', {
      p_user_name: userName,
      p_game_key: gameKey,
      p_slot: Number(slot),
      p_storage_path: path,
      p_state_format: format,
      p_updated_at: incomingTime,
      p_expected_at: expectedCloudAt
    });
    if (saveError) throw saveError;
    if (!saved) await admin.storage.from('game-saves').remove([path]);
    return json({ saved: !!saved, newerCloud: !saved, conflict: !saved });
  } catch {
    return json({ error: 'Não foi possível sincronizar o save. Tente novamente.' }, 500);
  }
});
