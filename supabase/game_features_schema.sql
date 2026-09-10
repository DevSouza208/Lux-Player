-- Additive migration: existing games retain unknown co-op status.
begin;
alter table public.games add column if not exists coop boolean;
alter table public.games drop constraint if exists games_coop_players_check;
alter table public.games add constraint games_coop_players_check check (coop is not true or players >= 2);
comment on column public.games.coop is 'Cooperative mode: true/false, null when not reviewed. Not inferred from player count.';
notify pgrst, 'reload schema';
commit;
