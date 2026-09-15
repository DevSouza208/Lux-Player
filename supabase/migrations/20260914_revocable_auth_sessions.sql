-- ============================================================
-- [LUX-AUTH-007] SESSÕES REVOGÁVEIS / MANTER CONECTADO
-- [LUX-ARCH-002] NÃO PERSISTIR SENHA NO NAVEGADOR
-- ============================================================
-- A tabela guarda SOMENTE SHA-256 do token. O token em texto puro existe apenas
-- no dispositivo do usuário. RLS de `usuarios` permanece inalterado/desligado.

create table if not exists public.auth_sessions (
  token_hash text primary key,
  user_name text not null,
  persistent boolean not null default false,
  created_at timestamptz not null default now(),
  last_used_at timestamptz not null default now(),
  expires_at timestamptz not null,
  revoked_at timestamptz null
);

create index if not exists auth_sessions_user_name_idx
  on public.auth_sessions ((lower(user_name)));
create index if not exists auth_sessions_expires_at_idx
  on public.auth_sessions (expires_at);

alter table public.auth_sessions enable row level security;

comment on table public.auth_sessions is
  '[LUX-AUTH-007][LUX-ARCH-002] Sessões revogáveis do Lux. Guarda somente SHA-256 do token; nunca a senha nem o token em texto puro.';

-- Compatibilidade de migração: Edge Functions podem receber a senha antiga ou um
-- token luxsess_. Somente service_role pode executar esta função.
create or replace function public.lux_auth_resolve(
  p_username text,
  p_credential text
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  v_user public.usuarios%rowtype;
  v_hash text;
begin
  if coalesce(trim(p_username), '') = '' or coalesce(p_credential, '') = '' then
    return null;
  end if;

  if p_credential like 'luxsess_%' then
    v_hash := encode(extensions.digest(p_credential, 'sha256'), 'hex');

    select u.*
      into v_user
      from public.auth_sessions s
      join public.usuarios u on lower(u.usuario) = lower(s.user_name)
     where s.token_hash = v_hash
       and lower(s.user_name) = lower(trim(p_username))
       and s.revoked_at is null
       and s.expires_at > now()
     limit 1;

    if not found then return null; end if;

    update public.auth_sessions
       set last_used_at = now()
     where token_hash = v_hash;
  else
    select u.*
      into v_user
      from public.usuarios u
     where lower(u.usuario) = lower(trim(p_username))
       and u.senha = p_credential
     limit 1;

    if not found then return null; end if;
  end if;

  return (to_jsonb(v_user) - 'senha');
end;
$$;

revoke all on function public.lux_auth_resolve(text, text) from public;
revoke all on function public.lux_auth_resolve(text, text) from anon;
revoke all on function public.lux_auth_resolve(text, text) from authenticated;
grant execute on function public.lux_auth_resolve(text, text) to service_role;

comment on function public.lux_auth_resolve(text, text) is
  '[LUX-AUTH-007] Resolve senha legada ou token luxsess_ somente para Edge Functions com service_role.';
