import { createClient } from 'npm:@supabase/supabase-js@2';

const headers = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Cache-Control': 'no-store',
};

const json = (data: unknown, status = 200) => Response.json(data, { status, headers });

function normalizeConsole(value: unknown) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '')
    .replace(/[^a-z0-9_-]/g, '');
}

async function listConsoles(db: ReturnType<typeof createClient>) {
  const stats = new Map<string, { total: number; approved: number }>();
  const pageSize = 1000;
  let from = 0;

  while (true) {
    const { data, error } = await db
      .from('games')
      .select('console,status')
      .range(from, from + pageSize - 1);
    if (error) throw error;

    const rows = data || [];
    for (const row of rows) {
      const id = normalizeConsole(row.console);
      if (!id) continue;
      const current = stats.get(id) || { total: 0, approved: 0 };
      current.total += 1;
      if (row.status === 'approved') current.approved += 1;
      stats.set(id, current);
    }

    if (rows.length < pageSize) break;
    from += pageSize;
  }

  const { data: settings, error: settingsError } = await db
    .from('game_console_visibility')
    .select('console,enabled,updated_at');
  if (settingsError) throw settingsError;

  const enabledByConsole = new Map<string, boolean>();
  for (const row of settings || []) {
    const id = normalizeConsole(row.console);
    if (id) enabledByConsole.set(id, row.enabled !== false);
  }

  const ids = new Set<string>([...stats.keys(), ...enabledByConsole.keys()]);
  return [...ids]
    .sort((a, b) => a.localeCompare(b, 'pt-BR'))
    .map(id => ({
      id,
      enabled: enabledByConsole.has(id) ? enabledByConsole.get(id) !== false : true,
      total: stats.get(id)?.total || 0,
      approved: stats.get(id)?.approved || 0,
    }));
}

Deno.serve(async (request: Request) => {
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers });
  if (request.method !== 'POST') return json({ error: 'Método não permitido.' }, 405);

  try {
    let body: any;
    try { body = await request.json(); }
    catch { return json({ error: 'JSON inválido.' }, 400); }

    const action = String(body?.action || 'get');
    if (!['get', 'save'].includes(action)) return json({ error: 'Ação inválida.' }, 400);

    const db = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
      { auth: { persistSession: false } },
    );

    if (action === 'save') {
      const username = body?.username;
      const password = body?.password;
      if (typeof username !== 'string' || !username || typeof password !== 'string' || !password) {
        return json({ error: 'Login de administrador necessário.' }, 401);
      }

      const { data: account, error: accountError } = await db.rpc('lux_auth_resolve', {
        p_username: username,
        p_credential: password,
      });
      if (accountError) throw accountError;
      if (!account || String(account.cargo || '').trim().toLowerCase() !== 'admin') {
        return json({ error: 'Acesso exclusivo de administrador.' }, 403);
      }

      const consoleId = normalizeConsole(body?.console);
      if (!consoleId || consoleId.length > 40 || typeof body?.enabled !== 'boolean') {
        return json({ error: 'Console ou estado inválido.' }, 400);
      }

      const { error: saveError } = await db
        .from('game_console_visibility')
        .upsert({ console: consoleId, enabled: body.enabled, updated_at: new Date().toISOString() }, { onConflict: 'console' });
      if (saveError) throw saveError;
    }

    const consoles = await listConsoles(db);
    return json({ consoles });
  } catch (error) {
    console.error('game-console-visibility:', error);
    return json({ error: 'Não foi possível carregar a visibilidade dos consoles.' }, 500);
  }
});
