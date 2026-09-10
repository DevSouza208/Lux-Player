import { createClient } from 'npm:@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Cache-Control': 'no-store',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type'
};
const MAX_SAVE_BYTES = 6 * 1024 * 1024;

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

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (request.method !== 'POST') return json({ error: 'Método não permitido' }, 405);

  try {
    let body;
    try { body = await request.json(); } catch { return json({ error: 'JSON inválido.' }, 400); }
    if (!body || typeof body !== 'object' || Array.isArray(body)) return json({ error: 'Dados inválidos.' }, 400);
    const { action, username, password, gameKey: requestedGameKey, slot, updatedAt, dataBase64, format, expectedCloudAt = null } = body;
    if (typeof username !== 'string' || !username || username.length > 256 || typeof password !== 'string' || !password || password.length > 1024) return json({ error: 'Login necessário.' }, 401);
    if (typeof requestedGameKey !== 'string' || !requestedGameKey || requestedGameKey.length > 500 || ![1, 2, 3].includes(Number(slot))) {
      return json({ error: 'Dados do save inválidos.' }, 400);
    }
    const url = Deno.env.get('SUPABASE_URL');
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    if (!url || !serviceRoleKey) throw new Error('Configuração do Supabase indisponível.');
    const admin = createClient(url, serviceRoleKey, { auth: { persistSession: false } });
    const { data: account, error: accountError } = await admin.from('usuarios').select('usuario,vencimento').eq('usuario', username).eq('senha', password).maybeSingle();
    if (accountError) throw accountError;
    if (!account) return json({ error: 'Credenciais inválidas.' }, 401);

    const expiry = String(account.vencimento || '').split('/');
    if (expiry.length === 3 && Date.now() > new Date(`${expiry[2]}-${expiry[1].padStart(2, '0')}-${expiry[0].padStart(2, '0')}T23:59:59-03:00`).getTime()) return json({ error: 'Acesso vencido.' }, 403);
    const userName = String(account.usuario);
    const profileSlot=body.profileSlot ?? 1;
    if(![1,2,3,4].includes(profileSlot)) return json({error:'Perfil inválido.'},400);
    const {data:profile,error:profileError}=await admin.from('account_profiles').select('slot,data_key').eq('user_name',userName).eq('slot',profileSlot).maybeSingle();
    if(profileError)throw profileError;
    if(!profile || (profile.data_key || '')!==(body.profileKey || ''))return json({error:'Perfil alterado. Selecione o perfil novamente.'},403);
    if(requestedGameKey.startsWith('profile:')) return json({error:'Chave inválida.'},400);
    const gameKey=(profile.data_key?'profile:'+profile.data_key+':':profileSlot===1?'':'profile:'+profileSlot+':')+requestedGameKey;
    if (action === 'list') {
      const { data, error } = await admin.from('user_game_saves')
        .select('slot, client_updated_at').eq('user_name', userName).eq('game_key', gameKey);
      if (error) throw error;
      return json({ slots: (data || []).map(row => ({ slot: Number(row.slot), updatedAt: Number(row.client_updated_at) })) });
    }

    if (action === 'load') {
      const { data: row, error } = await admin.from('user_game_saves')
        .select('storage_path, state_format, client_updated_at').eq('user_name', userName).eq('game_key', gameKey).eq('slot', Number(slot)).maybeSingle();
      if (error) throw error;
      if (!row) return json({ save: null });
      const { data: file, error: fileError } = await admin.storage.from('game-saves').download(row.storage_path);
      if (fileError) throw fileError;
      const buffer = await file.arrayBuffer();
      if (buffer.byteLength > MAX_SAVE_BYTES) return json({ error: 'Save excede o limite permitido.' }, 413);
      return json({ save: { updatedAt: Number(row.client_updated_at), format: row.state_format, dataBase64: toBase64(buffer) } });
    }

    if (action !== 'save' || typeof dataBase64 !== 'string' || !Number.isSafeInteger(updatedAt) || updatedAt <= 0 || updatedAt > Date.now() + 300000 || !['arraybuffer', 'text', 'json', 'uint8array'].includes(format)) {
      return json({ error: 'Dados do save inválidos.' }, 400);
    }
    if (expectedCloudAt !== null && (!Number.isSafeInteger(expectedCloudAt) || expectedCloudAt < 0)) return json({ error: 'Versão de save inválida.' }, 400);
    const incomingTime = Math.floor(Number(updatedAt));
    const { data: current, error: currentError } = await admin.from('user_game_saves')
      .select('client_updated_at').eq('user_name', userName).eq('game_key', gameKey).eq('slot', Number(slot)).maybeSingle();
    if (currentError) throw currentError;
    if (current && Number(current.client_updated_at) >= incomingTime) return json({ saved: false, newerCloud: true });

    if (dataBase64.length > Math.ceil(MAX_SAVE_BYTES / 3) * 4) return json({ error: 'Save excede o limite de 6 MB.' }, 413);
    let bytes;
    try { bytes = fromBase64(dataBase64); } catch { return json({ error: 'Save inválido.' }, 400); }
    if (!bytes.byteLength) return json({ error: 'Save vazio.' }, 400);
    if (bytes.byteLength > MAX_SAVE_BYTES) return json({ error: 'Save excede o limite de 6 MB.' }, 413);
    const path = `${encodeURIComponent(userName)}/${encodeURIComponent(gameKey)}/slot-${Number(slot)}-${crypto.randomUUID()}.bin`;
    const { error: uploadError } = await admin.storage.from('game-saves').upload(path, bytes, {
      contentType: 'application/octet-stream', upsert: false
    });
    if (uploadError) throw uploadError;
    const { data: saved, error: saveError } = await admin.rpc('commit_game_save_checked', {
      p_user_name: userName, p_game_key: gameKey, p_slot: Number(slot), p_storage_path: path,
      p_state_format: format, p_updated_at: incomingTime, p_expected_at: expectedCloudAt
    });
    // On ambiguous database failures keep the object: the commit may have succeeded.
    if (saveError) throw saveError;
    if (!saved) await admin.storage.from('game-saves').remove([path]);
    return json({ saved: !!saved, newerCloud: !saved, conflict: !saved });
  } catch (error) {
    return json({ error: 'Não foi possível sincronizar o save. Tente novamente.' }, 500);
  }
});
