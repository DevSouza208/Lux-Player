create table if not exists public.secondary_locale_reviews (
  id bigint generated always as identity primary key,
  source_id uuid not null references public.secondary_content_sources(id) on delete cascade,
  fingerprint text not null,
  incoming_title text not null default '',
  incoming_type text not null default '',
  incoming_group text not null default '',
  source_name text not null default '',
  status text not null default 'pending' check (status in ('pending','pt','international','ignored')),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  resolved_at timestamptz,
  resolved_by text,
  unique (source_id, fingerprint)
);

alter table public.secondary_locale_reviews enable row level security;

create index if not exists secondary_locale_reviews_status_idx
  on public.secondary_locale_reviews(status, created_at);
create index if not exists secondary_locale_reviews_source_idx
  on public.secondary_locale_reviews(source_id, status);
