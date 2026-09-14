import { createClient } from 'npm:@supabase/supabase-js@2';

// ============================================================
// [LUX-AUTH-006] LOGIN SERVER-SIDE DO LUX PLAYER
// ============================================================
// Objetivo:
// - impedir que o navegador baixe a tabela inteira `usuarios` para validar login;
// - consultar somente a conta informada pelo usuário;
// - nunca devolver a senha armazenada no banco;
// - manter compatibilidade com o fluxo atual de perfis e catálogo.
//
// IMPORTANTE:
// Esta é a primeira etapa da correção de autenticação. O painel Admin ainda acessa
// `usuarios` diretamente no frontend, portanto RLS NÃO deve ser ativado ainda.
// Quando o Admin também migrar para Edge Functions, o acesso direto à tabela pode
// ser bloqueado com segurança.
// ============================================================

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const json = (data: unknown, status = 200) =>
  Response.json(data, {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });

const text = (value: unknown, max = 180) => String(value ?? '').trim().slice(0, max);

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (request.method !== 'POST') return json({ ok: false, error: 'Método não permitido.' }, 405);

  try {
    const body = await request.json().catch(() => ({}));
    const username = text(body?.username, 120);
    const password = text(body?.password, 300);

    // Resposta deliberadamente genérica: não informa se foi usuário ou senha que
    // falhou e evita facilitar enumeração de contas.
    if (!username || !password) {
      return json({ ok: false, reason: 'invalid_credentials' });
    }

    const url = Deno.env.get('SUPABASE_URL');
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    if (!url || !serviceRoleKey) throw new Error('Configuração do backend indisponível.');

    // A service role fica somente no servidor. Ela nunca é enviada ao navegador.
    const admin = createClient(url, serviceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    // [LUX-AUTH-006]
    // A consulta filtra a própria credencial no PostgreSQL. Diferente do fluxo
    // antigo, nenhuma lista de clientes é entregue ao browser para comparação.
    const { data: account, error } = await admin
      .from('usuarios')
      .select([
        'nome',
        'usuario',
        'vencimento',
        'lista_m3u',
        'cargo',
        'userxc',
        'senhaxc',
        'urlxc',
        'senha18+',
        'lista_m3u_https',
        'lista_m3u_sync_at',
        'lista_m3u_sync_status',
        'lista_m3u_sync_error',
        'categorias_compartilhadas',
        'acesso_jogos',
        'acesso_livros',
        'provider_status',
        'provider_exp_date',
        'provider_exp_at',
        'provider_sync_at',
        'stream_limit',
      ].join(','))
      .ilike('usuario', username)
      .eq('senha', password)
      .maybeSingle();

    if (error) throw error;
    if (!account) return json({ ok: false, reason: 'invalid_credentials' });

    // A senha digitada não volta na resposta. O frontend já a possui na memória
    // durante esta fase de compatibilidade porque outras Edge Functions legadas
    // ainda autenticam com usuário/senha. Isso será removido na migração de sessão.
    return json({ ok: true, account });
  } catch (error) {
    console.error('[auth-login]', error);
    return json({ ok: false, error: 'Não foi possível entrar agora.' }, 500);
  }
});
