import { createClient } from 'npm:@supabase/supabase-js@2';

const headers = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Cache-Control': 'no-store'
};

const json = (data: unknown, status = 200) => Response.json(data, { status, headers });
const gameIdPattern = /^[1-9][0-9]*$/;
const MAX_COMMENT_LENGTH = 500;

function normalizeAccount(value: any) {
  return Array.isArray(value) ? value[0] || null : value || null;
}

async function ensureGame(db: any, gameId: string) {
  const { data, error } = await db.from('games').select('id').eq('id', gameId).maybeSingle();
  if (error) throw error;
  return Boolean(data);
}

async function buildRatingResponse(db: any, gameId: string, mineUser = '', mineProfileKey = '') {
  const { data: ratings, error: ratingsError } = await db
    .from('game_ratings')
    .select('rating, user_name, profile_slot, profile_key, comment, updated_at')
    .eq('game_id', gameId)
    .order('updated_at', { ascending: false });
  if (ratingsError) throw ratingsError;

  const rows = ratings || [];
  const total = rows.length;
  const average = total ? rows.reduce((sum: number, row: any) => sum + Number(row.rating), 0) / total : 0;
  const mine = mineUser
    ? rows.find((row: any) => row.user_name === mineUser && String(row.profile_key || '') === String(mineProfileKey || ''))
    : null;

  const userNames = [...new Set(rows.filter((row: any) => String(row.comment || '').trim()).map((row: any) => row.user_name))];
  let profiles: any[] = [];
  if (userNames.length) {
    const { data, error } = await db
      .from('account_profiles')
      .select('user_name, slot, data_key, name')
      .in('user_name', userNames);
    if (error) throw error;
    profiles = data || [];
  }

  const reviews = rows
    .filter((row: any) => String(row.comment || '').trim())
    .map((row: any) => {
      const rowKey = String(row.profile_key || '');
      const profile = profiles.find((item: any) =>
        item.user_name === row.user_name &&
        (rowKey ? String(item.data_key || '') === rowKey : Number(item.slot) === Number(row.profile_slot))
      );
      return {
        rating: Number(row.rating) || 0,
        comment: String(row.comment || '').trim(),
        profileName: String(profile?.name || 'Jogador Lux').slice(0, 80),
        updatedAt: row.updated_at || null,
        mine: Boolean(mineUser && row.user_name === mineUser && rowKey === String(mineProfileKey || ''))
      };
    });

  return {
    average: Math.round(average * 10) / 10,
    total,
    userRating: mine ? Number(mine.rating) : 0,
    userComment: mine ? String(mine.comment || '') : '',
    reviews
  };
}

Deno.serve(async (request: Request) => {
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers });
  if (request.method !== 'POST') return json({ error: 'Método não permitido.' }, 405);

  try {
    let body: any;
    try {
      body = await request.json();
    } catch {
      return json({ error: 'JSON inválido.' }, 400);
    }

    const { action, gameId, username, password } = body || {};
    const normalizedGameId = String(gameId ?? '');
    if (!gameIdPattern.test(normalizedGameId)) return json({ error: 'Jogo inválido.' }, 400);
    if (!['get', 'save'].includes(action)) return json({ error: 'Ação inválida.' }, 400);

    const db = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
      { auth: { persistSession: false } }
    );

    if (action === 'get' && (!username || !password)) {
      if (!(await ensureGame(db, normalizedGameId))) return json({ error: 'Jogo não encontrado.' }, 404);
      return json(await buildRatingResponse(db, normalizedGameId));
    }

    if (typeof username !== 'string' || !username || typeof password !== 'string' || !password) {
      return json({ error: 'Login necessário.' }, 401);
    }

    const { data: accountResult, error: accountError } = await db.rpc('lux_auth_resolve', {
      p_username: username,
      p_credential: password
    });
    if (accountError) throw accountError;
    const account = normalizeAccount(accountResult);
    if (!account) return json({ error: 'Credencial inválida ou sessão expirada.' }, 401);

    const expiry = String(account.vencimento || '').split('/');
    if (
      expiry.length === 3 &&
      Date.now() > new Date(`${expiry[2]}-${expiry[1].padStart(2, '0')}-${expiry[0].padStart(2, '0')}T23:59:59-03:00`).getTime()
    ) {
      return json({ error: 'Acesso vencido.' }, 403);
    }

    const profileSlot = Number(body.profileSlot ?? 1);
    const profileKey = String(body.profileKey || '');
    if (![1, 2, 3, 4].includes(profileSlot)) return json({ error: 'Perfil inválido.' }, 400);

    const { data: profile, error: profileError } = await db
      .from('account_profiles')
      .select('slot, data_key')
      .eq('user_name', account.usuario)
      .eq('slot', profileSlot)
      .maybeSingle();
    if (profileError) throw profileError;
    if (!profile || String(profile.data_key || '') !== profileKey) {
      return json({ error: 'Perfil alterado. Selecione o perfil novamente.' }, 403);
    }

    if (!(await ensureGame(db, normalizedGameId))) return json({ error: 'Jogo não encontrado.' }, 404);

    if (action === 'save') {
      const rating = Number(body.rating);
      if (!Number.isInteger(rating) || rating < 1 || rating > 5) {
        return json({ error: 'A nota deve estar entre 1 e 5.' }, 400);
      }

      const payload: Record<string, unknown> = {
        game_id: normalizedGameId,
        user_name: account.usuario,
        profile_slot: profileSlot,
        profile_key: profileKey,
        rating
      };

      if (Object.prototype.hasOwnProperty.call(body, 'comment')) {
        if (typeof body.comment !== 'string') return json({ error: 'Comentário inválido.' }, 400);
        const comment = body.comment.trim();
        if (comment.length > MAX_COMMENT_LENGTH) {
          return json({ error: `O comentário pode ter no máximo ${MAX_COMMENT_LENGTH} caracteres.` }, 400);
        }
        payload.comment = comment || null;
      }

      const { error } = await db
        .from('game_ratings')
        .upsert(payload, { onConflict: 'game_id,user_name,profile_key' });
      if (error) throw error;
    }

    return json(await buildRatingResponse(db, normalizedGameId, account.usuario, profileKey));
  } catch (error) {
    console.error('game-ratings:', error);
    return json({ error: 'Não foi possível carregar as avaliações.' }, 500);
  }
});
