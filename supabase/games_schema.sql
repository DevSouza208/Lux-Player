-- Execute no SQL Editor do Supabase antes de usar o formulário de importação.
create extension if not exists pgcrypto;

create table if not exists public.games (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  normalized_title text,
  console text not null,
  release_year integer,
  genres text[] not null default '{}',
  coop boolean,
  players smallint not null default 1 check (players between 1 and 8),
  synopsis text,
  cover_url text,
  cover_path text,
  rom_path text not null,
  rom_url text,
  source_file_name text,
  rom_sha256 text,
  status text not null default 'pending'
    check (status in ('pending', 'approved', 'rejected')),
  metadata_source text,
  metadata_external_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Caso a tabela games já exista, estes comandos completam as colunas usadas pelo app.
alter table public.games add column if not exists id uuid default gen_random_uuid();
alter table public.games add column if not exists title text;
alter table public.games add column if not exists normalized_title text;
alter table public.games add column if not exists console text;
alter table public.games add column if not exists release_year integer;
alter table public.games add column if not exists genres text[] not null default '{}';
alter table public.games add column if not exists coop boolean;
alter table public.games add column if not exists players smallint not null default 1;
alter table public.games add column if not exists synopsis text;
alter table public.games add column if not exists cover_url text;
alter table public.games add column if not exists cover_path text;
alter table public.games add column if not exists rom_path text;
alter table public.games add column if not exists rom_url text;
alter table public.games add column if not exists source_file_name text;
alter table public.games add column if not exists rom_sha256 text;
alter table public.games add column if not exists status text not null default 'pending';
alter table public.games add column if not exists metadata_source text;
alter table public.games add column if not exists metadata_external_id text;
alter table public.games add column if not exists created_at timestamptz not null default now();
alter table public.games add column if not exists updated_at timestamptz not null default now();

create index if not exists games_status_title_idx on public.games (status, title);
create unique index if not exists games_id_unique_idx on public.games (id);
create unique index if not exists games_rom_path_unique_idx on public.games (rom_path);
create unique index if not exists games_rom_sha256_unique_idx on public.games (rom_sha256) where rom_sha256 is not null;

-- O mesmo jogo pode existir em plataformas diferentes. Só bloqueamos título
-- repetido quando título normalizado E console normalizado são iguais.
create or replace function public.prevent_duplicate_game_title()
returns trigger language plpgsql set search_path='' as $$
declare
 normalized text;
 normalized_console text;
begin
 normalized:=lower(regexp_replace(regexp_replace(trim(new.title),'[^[:alnum:]]+',' ','g'),'\s+',' ','g'));
 normalized_console:=lower(regexp_replace(regexp_replace(trim(coalesce(new.console,'')),'[^[:alnum:]]+',' ','g'),'\s+',' ','g'));
 new.normalized_title:=normalized;
 if exists(
   select 1
   from public.games game
   where game.id is distinct from new.id
     and lower(regexp_replace(regexp_replace(trim(game.title),'[^[:alnum:]]+',' ','g'),'\s+',' ','g'))=normalized
     and lower(regexp_replace(regexp_replace(trim(coalesce(game.console,'')),'[^[:alnum:]]+',' ','g'),'\s+',' ','g'))=normalized_console
 ) then
  raise exception 'Já existe um jogo com este título neste console.' using errcode='23505';
 end if;
 return new;
end;$$;
drop trigger if exists games_prevent_duplicate_title on public.games;
create trigger games_prevent_duplicate_title before insert or update of title, console on public.games for each row execute function public.prevent_duplicate_game_title();

-- Configure o bucket Storage `games` como público apenas se quiser que o EmulatorJS
-- baixe as ROMs por URL pública. Para produção, use Supabase Auth + RLS ou uma Edge
-- Function que entregue URLs assinadas; não crie políticas INSERT para `anon`.
