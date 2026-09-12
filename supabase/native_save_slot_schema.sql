-- Extend existing saves without modifying files or other permissions.
begin;
alter table public.user_game_saves drop constraint if exists user_game_saves_slot_check;
alter table public.user_game_saves add constraint user_game_saves_slot_check check (slot between 0 and 3);
commit;
