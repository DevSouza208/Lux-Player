create table if not exists public.game_console_visibility (
  console text primary key,
  enabled boolean not null default true,
  updated_at timestamptz not null default now()
);

alter table public.game_console_visibility enable row level security;

insert into public.game_console_visibility (console, enabled)
select distinct lower(trim(console)), true
from public.games
where coalesce(trim(console), '') <> ''
on conflict (console) do nothing;

comment on table public.game_console_visibility is
  'Controls whether an approved game console is visible in the public Lux game catalog.';
