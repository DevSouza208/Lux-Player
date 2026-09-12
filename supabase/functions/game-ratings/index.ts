import { createClient } from 'npm:@supabase/supabase-js@2';

const headers = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Cache-Control': 'no-store'
};

const json = (data: unknown, status = 200) => Response.json(data, { status, headers });
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

Deno.serve(async (request: Request) => {
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers });
  if (request.method !== 'POST') return json({ error: 'Método não permitido.' }, 405);

  try {
    let body;
    try { body = await request.json(); } catch { return json({ error: 'JSON inválido.' }, 400); }

    const { action, gameId, username, password } = body || {};
    if (typeof username !== 'string' || !username || typeof password !== 'string' || !password) {
      return json({ error: 'Login necessário.' }, 401);
    }
    if (typeof gameId !== 'string' || !uuidPattern.test(gameId)) {
      return json({ error: 'Jogo inválido.' }, 400);
    }
    if (!['get', 'save'].includes(action)) return json({ error: 'Ação inválida.' }, 400);

    const db = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
      { auth: { persistSession: false } }
    );

    const { data: account, error: accountError } = await db
      .from('usuarios')
      .select('usuario, vencimento')
      .eq('usuario', username)
      .eq('senha', password)
      .maybeSingle();
    if (accountError) throw accountError;
    if (!account) return json({ error: 'Credenciais inválidas.' }, 401);

    const expiry = String(account.vencimento || '').split('/');
    if (expiry.length === 3 && Date.now() > new Date(
      `${expiry[2]}-${expiry[1].padStart(2, '0')}-${expiry[0].padStart(2, '0')}T23:59:59-03:00`
    ).getTime()) return json({ error: 'Acesso vencido.' }, 403);

    const profileSlot = body.profileSlot ?? 1;
    const profileKey = body.profileKey || '';
    if (![1, 2, 3, 4].includes(profileSlot)) return json({ error: 'Perfil inválido.' }, 400);

    const { data: profile, error: profileError } = await db
      .from('account_profiles')
      .select('slot, data_key')
      .eq('user_name', account.usuario)
      .eq('slot', profileSlot)
      .maybeSingle();
    if (profileError) throw profileError;
    if (!profile || String(profile.data_key || '') !== String(profileKey)) {
      return json({ error: 'Perfil alterado. Selecione o perfil novamente.' }, 403);
    }

    const { data: game, error: gameError } = await db
      .from('games')
      .select('id')
      .eq('id', gameId)
      .maybeSingle();
    if (gameError) throw gameError;
    if (!game) return json({ error: 'Jogo não encontrado.' }, 404);

    if (action === 'save') {
      const rating = Number(body.rating);
      if (!Number.isInteger(rating) || rating < 1 || rating > 5) {
        return json({ error: 'A nota deve estar entre 1 e 5.' }, 400);
      }

      const { error } = await db.from('game_ratings').upsert({
        game_id: gameId,
        user_name: account.usuario,
        profile_slot: profileSlot,
        profile_key: profileKey,
        rating
      }, { onConflict: 'game_id,user_name,profile_key' });
      if (error) throw error;
    }

    const { data: ratings, error: ratingsError } = await db
      .from('game_ratings')
      .select('rating, user_name, profile_key')
      .eq('game_id', gameId);
    if (ratingsError) throw ratingsError;

    const rows = ratings || [];
    const total = rows.length;
    const average = total ? rows.reduce((sum, row) => sum + Number(row.rating), 0) / total : 0;
    const mine = rows.find(row => row.user_name === account.usuario && String(row.profile_key || '') === String(profileKey || ''));

    return json({
      average: Math.round(average * 10) / 10,
      total,
      userRating: mine ? Number(mine.rating) : 0
    });
  } catch (error) {
    console.error('game-ratings:', error);
    return json({ error: 'Não foi possível carregar as avaliações.' }, 500);
  }
});
