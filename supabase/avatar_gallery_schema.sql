create table if not exists public.profile_avatar_gallery (
 id uuid primary key default gen_random_uuid(),
 name text not null check(length(name) between 1 and 40),
 avatar_data text not null check(length(avatar_data)<=180000),
 created_at timestamptz not null default now()
);
alter table public.profile_avatar_gallery enable row level security;
revoke all on public.profile_avatar_gallery from anon,authenticated;
grant select,insert,delete on public.profile_avatar_gallery to service_role;
