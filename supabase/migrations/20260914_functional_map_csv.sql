-- ============================================================
-- [LUX-BACKEND-016] / [LUX-ARCH-023]
-- CSV do mapa funcional separado por branch.
-- ============================================================
-- A tabela não é consumida diretamente pelo navegador. RLS permanece ligado aqui
-- e somente a service role usada pela Edge Function functional-map recebe acesso.
-- Isso NÃO altera o RLS da tabela usuarios, que continua no estado atual até a
-- migração do painel de clientes para backend.

create table if not exists public.functional_map_csv (
  branch text primary key check (branch in ('main', 'develop')),
  csv_text text not null,
  encoding text not null default 'plain' check (encoding in ('plain', 'gzip-base64')),
  updated_at timestamptz not null default now(),
  updated_by text not null default 'system'
);

alter table public.functional_map_csv enable row level security;

revoke all on table public.functional_map_csv from anon, authenticated;
grant select, insert, update, delete on table public.functional_map_csv to service_role;

comment on table public.functional_map_csv is
  'CSV mestre do mapa funcional do Lux Player, separado por branch e acessível somente pelo backend admin.';
