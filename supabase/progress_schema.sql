-- Sincronizacao de progresso Lux Play.
-- O cliente nao tem acesso direto: somente a Edge Function progress-sync usa esta tabela.
create table if not exists public.user_progress (
  user_name text not null,
  sync_key text not null,
  payload jsonb not null default '{}'::jsonb,
  client_updated_at bigint not null,
  updated_at timestamptz not null default now(),
  primary key (user_name, sync_key)
);

create index if not exists user_progress_user_updated_idx
  on public.user_progress (user_name, client_updated_at desc);

alter table public.user_progress enable row level security;
revoke all on table public.user_progress from anon, authenticated;

-- Nao crie policy publica nesta tabela. A Edge Function usa a service role e
-- valida usuario/senha antes de ler ou gravar qualquer registro.
