import { createClient } from 'npm:@supabase/supabase-js@2';

// ============================================================
// [LUX-AUTH-006] LOGIN SERVER-SIDE DO LUX PLAYER
// [LUX-AUTH-007] SESSÃO REVOGÁVEL / MANTER CONECTADO
// [LUX-ARCH-002] SENHA NÃO PERSISTE NO NAVEGADOR
// ============================================================
// Fluxo:
// - login manual envia usuário + senha UMA vez;
// - o servidor valida a conta e emite um token opaco `luxsess_...`;
// - somente o SHA-256 do token é salvo em auth_sessions;
// - o navegador passa a usar esse token nas demais Edge Functions;
// - "manter conectado" define apenas a duração do token (30 dias);
// - sem a opção, a sessão dura 12 h e o frontend a mantém só na aba;
// - logout revoga o token no servidor.
//
// Compatibilidade:
// - lux_auth_resolve aceita temporariamente senha legada OU token;
// - isso permite migrar as Edge Functions sem ligar RLS de `usuarios` agora;
// - a senha do banco nunca é devolvida ao navegador.
// ============================================================

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Cache-Control': 'no-store',
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
    year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(new Date());
  const get = (type: string) => parts.find(part => part.type === type)?.value || '';
  return `${get('year')}-${get('month')}-${get('day')}`;
}

function isSessionCredential(value: string) {
  return /^luxsess_[A-Za-z0-9_-]{40,200}$/.test(value);
}

function randomToken() {
  const bytes = crypto.getRandomValues(new Uint8Array(48));
  const base64 = btoa(String.fromCharCode(...bytes))
    .replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/g, '');
  return `luxsess_${base64}`;
}

async function sha256(value: string) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest))
    .map(byte => byte.toString(16).padStart(2, '0')).join('');
}

Deno.serve(async (request: Request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (request.method !== 'POST') return json({ ok: false, error: 'method_not_allowed' }, 405);

  try {
    const body = await request.json().catch(() => ({}));
    const action = clean(body?.action || 'login', 30);
    const username = clean(body?.username, 120);
    const credential = clean(body?.password ?? body?.credential, 500);
    const remember = body?.remember === true;

    const supabaseUrl = Deno.env.get('SUPABASE_URL');
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    if (!supabaseUrl || !serviceRoleKey) {
      console.error('[LUX-AUTH-007] Supabase env ausente.');
      return json({ ok: false, error: 'backend_unavailable' }, 500);
    }

    const admin = createClient(supabaseUrl, serviceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    if (action === 'logout') {
      if (!username || !isSessionCredential(credential)) return json({ ok: true, revoked: false });
      const tokenHash = await sha256(credential);
      const { error } = await admin.from('auth_sessions')
        .update({ revoked_at: new Date().toISOString() })
        .eq('token_hash', tokenHash)
        .ilike('user_name', username);
      if (error) throw error;
      return json({ ok: true, revoked: true });
    }

    if (action !== 'login') return json({ ok: false, error: 'action_not_allowed' }, 400);
    if (!username || !credential) return json({ ok: false, reason: 'invalid_credentials' });

    // [LUX-AUTH-007] A função SQL é executável somente por service_role e resolve
    // tanto a senha legada quanto o token revogável durante a fase de migração.
    const { data: account, error } = await admin.rpc('lux_auth_resolve', {
      p_username: username,
      p_credential: credential,
    });
    if (error) {
      console.error('[LUX-AUTH-007] Falha ao resolver credencial:', error.message);
      return json({ ok: false, error: 'database_error' }, 500);
    }
    if (!account || typeof account !== 'object') {
      return json({ ok: false, reason: 'invalid_credentials' });
    }

    const dueDate = normalizeDueDate((account as Record<string, unknown>).vencimento);
    if (dueDate && dueDate < todayInSaoPaulo()) {
      return json({
        ok: false,
        reason: 'expired',
        dueDate: (account as Record<string, unknown>).vencimento || dueDate,
      });
    }

    // Se já entrou com token válido, apenas reutilizamos a própria sessão. Assim um
    // reload não cria dezenas de tokens para a mesma instalação.
    if (isSessionCredential(credential)) {
      const tokenHash = await sha256(credential);
      const { data: session } = await admin.from('auth_sessions')
        .select('persistent,expires_at')
        .eq('token_hash', tokenHash)
        .maybeSingle();
      return json({
        ok: true,
        account,
        sessionCredential: credential,
        persistent: Boolean(session?.persistent),
        expiresAt: session?.expires_at || null,
        authenticatedBy: 'session',
      });
    }

    // Login por senha: emite token novo e guarda somente o hash no banco.
    const sessionCredential = randomToken();
    const tokenHash = await sha256(sessionCredential);
    const ttlMs = remember ? 30 * 24 * 60 * 60 * 1000 : 12 * 60 * 60 * 1000;
    const expiresAt = new Date(Date.now() + ttlMs).toISOString();
    const canonicalUser = clean((account as Record<string, unknown>).usuario || username, 120);

    // Limpeza oportunista: sessões vencidas/revogadas não precisam ficar acumuladas.
    await admin.from('auth_sessions')
      .delete()
      .ilike('user_name', canonicalUser)
      .or(`expires_at.lt.${new Date().toISOString()},revoked_at.not.is.null`);

    const { error: sessionError } = await admin.from('auth_sessions').insert({
      token_hash: tokenHash,
      user_name: canonicalUser,
      persistent: remember,
      expires_at: expiresAt,
      last_used_at: new Date().toISOString(),
    });
    if (sessionError) throw sessionError;

    return json({
      ok: true,
      account,
      sessionCredential,
      persistent: remember,
      expiresAt,
      authenticatedBy: 'password',
    });
  } catch (error) {
    console.error('[LUX-AUTH-007] Erro inesperado:', error);
    return json({ ok: false, error: 'backend_unavailable' }, 500);
  }
});
