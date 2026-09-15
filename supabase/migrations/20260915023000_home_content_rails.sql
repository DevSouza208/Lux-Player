create table if not exists public.lux_home_rail_items (
  id uuid primary key default gen_random_uuid(),
  rail text not null check (rail in ('movies','games','books')),
  source_key text not null,
  title text not null default '',
  subtitle text not null default '',
  image_url text not null default '',
  payload jsonb not null default '{}'::jsonb,
  position integer not null default 0,
  enabled boolean not null default true,
  created_by text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists lux_home_rail_items_unique_source
  on public.lux_home_rail_items (rail, source_key);

create index if not exists lux_home_rail_items_order_idx
  on public.lux_home_rail_items (rail, enabled, position, created_at);

-- Access is mediated by the home-rails Edge Function; no project RLS settings are changed.
revoke all on table public.lux_home_rail_items from anon, authenticated;
grant all on table public.lux_home_rail_items to service_role;
