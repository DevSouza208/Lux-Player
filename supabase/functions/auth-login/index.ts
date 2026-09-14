import { createClient } from 'npm:@supabase/supabase-js@2';

// ============================================================
// [LUX-AUTH-006] LOGIN SERVER-SIDE DO LUX PLAYER
// [LUX-ARCH-001] AUTENTICACAO FORA DO FRONTEND
// ============================================================
// Objetivo:
// - o navegador envia somente usuario + senha para esta Edge Function;
// - SOMENTE o servidor decide se as credenciais sao validas;
// - o backend consulta apenas a conta correspondente;
// - a tabela completa `usuarios` nunca volta para o frontend;
// - a senha armazenada no banco nunca volta na resposta;
// - a validade da conta tambem e conferida no servidor.
//
// FASE ATUAL:
// - RLS de `usuarios` continua DESLIGADO de proposito nesta etapa;
// - o painel Admin legado ainda possui acessos diretos que serao migrados depois;
// - NAO ativar RLS antes dessa migracao, para nao quebrar o Admin atual.
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

// Converte os dois formatos que ja existem/foram usados no projeto para YYYY-MM-DD.
// Comparamos apenas datas, mantendo a conta valida durante TODO o dia do vencimento.
function normalizeDueDate(value: unknown): string {
  const raw = clean(value, 30);
  if (!raw) return '';
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;
  const br = raw.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  return br ? `${br[3]}-${br[2]}-${br[1]}` : '';
}

function todayInSaoPaulo(): string {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Sao_Paulo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date());
  const get = (type: string) => parts.find(part => part.type === type)?.value || '';
  return `${get('year')}-${get('month')}-${get('day')}`;
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

    // O SELECT * existe SOMENTE no servidor para suportar colunas legadas como
    // `senha18+`. A consulta ja filtra por UMA conta e pela senha antes de retornar.
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

    // A validade faz parte da autorizacao. O browser nao decide mais se uma conta
    // vencida pode entrar; ele apenas apresenta o motivo retornado pelo servidor.
    const dueDate = normalizeDueDate((account as Record<string, unknown>).vencimento);
    if (dueDate && dueDate < todayInSaoPaulo()) {
      return json({ ok: false, reason: 'expired', dueDate: (account as Record<string, unknown>).vencimento || dueDate });
    }

    // Nunca devolver a senha do banco. Outros dados da propria conta continuam
    // sendo enviados porque o app ainda precisa deles para catalogo/perfis.
    const { senha: _senha, ...safeAccount } = account as Record<string, unknown>;
    return json({ ok: true, account: safeAccount, authenticatedBy: 'server' });
  } catch (error) {
    console.error('[LUX-AUTH-006] Erro inesperado:', error);
    return json({ ok: false, error: 'backend_unavailable' }, 500);
  }
});
