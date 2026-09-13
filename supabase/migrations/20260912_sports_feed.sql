create table if not exists public.sports_channel_mappings (
  broadcaster_key text primary key,
  broadcaster_name text not null,
  channel_hint text not null,
  updated_by text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.sports_feed_cache (
  cache_key text primary key,
  payload jsonb not null default '{}'::jsonb,
  fetched_at timestamptz not null default now()
);

create index if not exists sports_channel_mappings_name_idx
  on public.sports_channel_mappings (broadcaster_name);

create index if not exists sports_feed_cache_fetched_at_idx
  on public.sports_feed_cache (fetched_at desc);

alter table public.sports_channel_mappings enable row level security;
alter table public.sports_feed_cache enable row level security;

-- Sem policies públicas: leitura e gravação passam pela Edge Function via service role.
