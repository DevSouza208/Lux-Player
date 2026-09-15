create table if not exists public.lux_home_banners (
  id uuid primary key default gen_random_uuid(),
  kind text not null default 'custom' check (kind in ('sport','game','book','movie','series','custom')),
  title text not null default '',
  subtitle text not null default '',
  description text not null default '',
  badge text not null default '',
  poster_url text not null default '',
  backdrop_url text not null default '',
  logo_url text not null default '',
  left_image_url text not null default '',
  right_image_url text not null default '',
  competition_name text not null default '',
  competition_logo_url text not null default '',
  classic_name text not null default '',
  phase text not null default '',
  channels jsonb not null default '[]'::jsonb,
  event_at timestamptz,
  cta_label text not null default '',
  cta_type text not null default 'none' check (cta_type in ('none','media','live','game','book','url')),
  cta_value text not null default '',
  source_key text not null default '',
  source_payload jsonb not null default '{}'::jsonb,
  starts_at timestamptz,
  ends_at timestamptz,
  priority integer not null default 0,
  enabled boolean not null default true,
  created_by text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists lux_home_banners_active_idx
  on public.lux_home_banners (enabled, starts_at, ends_at, priority desc);

-- Access is intentionally mediated by the home-banners Edge Function.
-- Keep direct browser access disabled without changing project RLS settings.
revoke all on table public.lux_home_banners from anon, authenticated;
grant all on table public.lux_home_banners to service_role;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'lux-home-banners',
  'lux-home-banners',
  true,
  8388608,
  array['image/jpeg','image/png','image/webp','image/gif']::text[]
)
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;
