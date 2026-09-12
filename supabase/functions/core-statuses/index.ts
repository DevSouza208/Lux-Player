import { createClient } from 'npm:@supabase/supabase-js@2';

const headers = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Cache-Control': 'no-store'
};

const json = (data: unknown, status = 200) => Response.json(data, { status, headers });
const allowed = new Set(['gb', 'gbc', 'gba', 'nes', 'snes', 'megadrive', 'mastersystem', 'n64', 'psp']);

Deno.serve(async (request: Request) => {
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers });
  if (request.method !== 'POST') return json({ error: 'Método não permitido.' }, 405);

  try {
    const body = await request.json();
    const action = body?.action;
    if (!['get', 'save'].includes(action)) return json({ error: 'Ação inválida.' }, 400);

    const db = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
      { auth: { persistSession: false } }
    );

    if (action === 'save') {
      const username = body?.username;
      const password = body?.password;
      if (typeof username !== 'string' || !username || typeof password !== 'string' || !password) {
        return json({ error: 'Login de administrador necessário.' }, 401);
      }
      const { data: account, error: accountError } = await db
        .from('usuarios')
        .select('cargo')
        .eq('usuario', username)
        .eq('senha', password)
        .maybeSingle();
      if (accountError) throw accountError;
      if (!account || String(account.cargo || '').trim().toLowerCase() !== 'admin') {
        return json({ error: 'Acesso exclusivo de administrador.' }, 403);
      }

      const statuses = body?.statuses;
      if (!statuses || typeof statuses !== 'object') return json({ error: 'Status inválidos.' }, 400);
      const rows = Object.entries(statuses)
        .filter(([coreId, status]) => allowed.has(coreId) && (status === 'tested' || status === 'untested'))
        .map(([coreId, status]) => ({ core_id: coreId, status }));
      if (rows.length) {
        const { error } = await db.from('emulator_core_statuses').upsert(rows, { onConflict: 'core_id' });
        if (error) throw error;
      }
    }

    const { data, error } = await db.from('emulator_core_statuses').select('core_id, status');
    if (error) throw error;
    return json({ statuses: Object.fromEntries((data || []).map(row => [row.core_id, row.status])) });
  } catch (error) {
    console.error('core-statuses:', error);
    return json({ error: 'Não foi possível carregar os status dos cores.' }, 500);
  }
});