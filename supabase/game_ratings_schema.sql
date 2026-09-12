create table if not exists public.game_ratings (
  game_id bigint not null references public.games(id) on delete cascade,
  user_name text not null,
  profile_slot smallint not null check (profile_slot between 1 and 4),
  profile_key text not null default '',
  rating smallint not null check (rating between 1 and 5),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (game_id, user_name, profile_key)
);

alter table public.game_ratings enable row level security;
revoke all on public.game_ratings from anon, authenticated;
grant select, insert, update, delete on public.game_ratings to service_role;

create index if not exists game_ratings_game_idx on public.game_ratings(game_id);

create or replace function public.touch_game_rating_updated_at()
returns trigger language plpgsql set search_path='' as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists game_ratings_updated_at on public.game_ratings;
create trigger game_ratings_updated_at
before update on public.game_ratings
for each row execute function public.touch_game_rating_updated_at();

revoke all on function public.touch_game_rating_updated_at() from public, anon, authenticated;
grant execute on function public.touch_game_rating_updated_at() to service_role;
