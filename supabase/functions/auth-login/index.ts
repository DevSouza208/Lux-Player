import { createClient } from 'npm:@supabase/supabase-js@2';

// ============================================================
// [LUX-AUTH-006] LOGIN SERVER-SIDE DO LUX PLAYER
// ============================================================
// Objetivo:
// - o navegador envia somente usuario + senha para esta Edge Function;
// - o backend consulta somente a conta correspondente;
// - a tabela completa `usuarios` nunca volta para o frontend;
// - a senha armazenada no banco nunca volta na resposta.
//
// FASE ATUAL:
// - RLS de `usuarios` continua DESLIGADO por enquanto, porque o painel Admin
//   legado ainda acessa a tabela diretamente;
// - esta funcao corrige primeiro o caminho de LOGIN;
// - depois migraremos o Admin e so entao ativaremos RLS.
// ============================================================

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json; charset=utf-8' },
  });
}

function clean(value: unknown, max: number) {
  return String(value ?? '').trim().slice(0, max);
}

Deno.serve(async (request: Request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (request.method !== 'POST') return json({ ok: false, error: 'method_not_allowed' }, 405);

  try {
    const body = await request.json().catch(() => ({}));
    const username = clean(body?.username, 120);
    const password = clean(body?.password, 300);

    if (!username || !password) {
      return json({ ok: false, reason: 'invalid_credentials' });
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL');
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    if (!supabaseUrl || !serviceRoleKey) {
      console.error('[LUX-AUTH-006] Supabase env ausente.');
      return json({ ok: false, error: 'backend_unavailable' }, 500);
    }

    const admin = createClient(supabaseUrl, serviceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    // Usamos select('*') SOMENTE NO SERVIDOR para evitar problemas de parsing com
    // nomes de coluna legados como `senha18+`. O navegador ainda recebe somente
    // UMA conta e a senha e removida antes de montar a resposta.
    const { data: account, error } = await admin
      .from('usuarios')
      .select('*')
      .ilike('usuario', username)
      .eq('senha', password)
      .maybeSingle();

    if (error) {
      console.error('[LUX-AUTH-006] Falha na consulta:', error.message);
      return json({ ok: false, error: 'database_error' }, 500);
    }

    if (!account) return json({ ok: false, reason: 'invalid_credentials' });

    // Nunca devolver senha do banco. A senha digitada ja existe no browser nesta
    // fase de compatibilidade e sera eliminada quando migrarmos para sessao/token.
    const { senha: _senha, ...safeAccount } = account as Record<string, unknown>;
    return json({ ok: true, account: safeAccount });
  } catch (error) {
    console.error('[LUX-AUTH-006] Erro inesperado:', error);
    return json({ ok: false, error: 'backend_unavailable' }, 500);
  }
});
