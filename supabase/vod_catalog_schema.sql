create table if not exists public.vod_catalog (
  id uuid primary key default gen_random_uuid(),
  url text not null unique check (length(url) <= 2048),
  title text not null check (length(title) between 1 and 300),
  category text not null default 'VOD R2' check (length(category) <= 200),
  poster text not null default '' check (length(poster) <= 2048),
  "objectKey" text not null default '' check (length("objectKey") <= 1024),
  bucket text not null default 'luxvod',
  created_at timestamptz not null default now()
);
alter table public.vod_catalog enable row level security;
revoke all on public.vod_catalog from anon, authenticated;
grant select, insert, update, delete on public.vod_catalog to service_role;
