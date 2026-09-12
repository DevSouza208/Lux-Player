-- Saves de jogos sincronizados. Execute uma vez no SQL Editor do Supabase.
create table if not exists public.user_game_saves (
  user_name text not null,
  game_key text not null,
  slot smallint not null check (slot between 0 and 3),
  storage_path text not null,
  state_format text not null default 'arraybuffer',
  client_updated_at bigint not null,
  updated_at timestamptz not null default now(),
  primary key (user_name, game_key, slot)
);

create index if not exists user_game_saves_user_game_idx
  on public.user_game_saves (user_name, game_key, client_updated_at desc);

-- Slot 0 stores native saves; slots 1-3 remain save states.
alter table public.user_game_saves drop constraint if exists user_game_saves_slot_check;
alter table public.user_game_saves add constraint user_game_saves_slot_check check (slot between 0 and 3);

insert into storage.buckets (id, name, public)
values ('game-saves', 'game-saves', false)
on conflict (id) do update set public = false;

alter table public.user_game_saves enable row level security;
revoke all on table public.user_game_saves from anon, authenticated;
grant select, insert, update, delete on public.user_game_saves to service_role;

-- Each upload has its own object. Commit the pointer only if it is newer,
-- atomically, so concurrent devices cannot mix file data and timestamps.
create or replace function public.commit_game_save(
  p_user_name text, p_game_key text, p_slot smallint,
  p_storage_path text, p_state_format text, p_updated_at bigint
) returns boolean language plpgsql set search_path = '' as $$
declare affected integer;
begin
  insert into public.user_game_saves(user_name, game_key, slot, storage_path, state_format, client_updated_at)
  values (p_user_name, p_game_key, p_slot, p_storage_path, p_state_format, p_updated_at)
  on conflict (user_name, game_key, slot) do update
    set storage_path = excluded.storage_path, state_format = excluded.state_format,
        client_updated_at = excluded.client_updated_at, updated_at = now()
    where public.user_game_saves.client_updated_at < excluded.client_updated_at;
  get diagnostics affected = row_count;
  return affected = 1;
end;
$$;
revoke all on function public.commit_game_save(text, text, smallint, text, text, bigint) from public, anon, authenticated;
grant execute on function public.commit_game_save(text, text, smallint, text, text, bigint) to service_role;

-- O bucket fica privado e somente a Edge Function game-save-sync o acessa.

-- Optimistic version check for clients that resolve local/cloud conflicts.
create or replace function public.commit_game_save_checked(
  p_user_name text, p_game_key text, p_slot smallint, p_storage_path text,
  p_state_format text, p_updated_at bigint, p_expected_at bigint
) returns boolean language plpgsql set search_path = '' as $$
declare affected integer;
begin
  if p_expected_at is null then
    return public.commit_game_save(p_user_name, p_game_key, p_slot, p_storage_path, p_state_format, p_updated_at);
  end if;
  if p_expected_at = 0 then
    insert into public.user_game_saves(user_name, game_key, slot, storage_path, state_format, client_updated_at)
    values (p_user_name, p_game_key, p_slot, p_storage_path, p_state_format, p_updated_at)
    on conflict (user_name, game_key, slot) do nothing;
  else
    update public.user_game_saves set storage_path = p_storage_path, state_format = p_state_format,
      client_updated_at = p_updated_at, updated_at = now()
    where user_name = p_user_name and game_key = p_game_key and slot = p_slot
      and client_updated_at = p_expected_at and client_updated_at < p_updated_at;
  end if;
  get diagnostics affected = row_count;
  return affected = 1;
end;
$$;
revoke all on function public.commit_game_save_checked(text,text,smallint,text,text,bigint,bigint) from public, anon, authenticated;
grant execute on function public.commit_game_save_checked(text,text,smallint,text,text,bigint,bigint) to service_role;
