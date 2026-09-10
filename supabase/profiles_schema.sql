create table if not exists public.account_profiles (
 user_name text not null, slot smallint not null check(slot between 1 and 4),
 name text not null check(length(name) between 1 and 30), is_child boolean not null default false,
 primary key(user_name,slot)
);
alter table public.account_profiles add column if not exists avatar_data text not null default '' check(length(avatar_data)<=180000);
alter table public.account_profiles add column if not exists password_protected boolean not null default false;
alter table public.account_profiles add column if not exists data_key text not null default '';
alter table public.account_profiles enable row level security;
revoke all on public.account_profiles from anon,authenticated;
grant select,insert,update,delete on public.account_profiles to service_role;

-- Preserve legacy accounts when deploying profile-aware sync.
insert into public.account_profiles(user_name,slot,name)
select distinct on (u.usuario) u.usuario,1,left(coalesce(nullif(u.nome,''),'Principal'),30)
from public.usuarios u where u.usuario is not null and u.usuario<>''
and not exists(select 1 from public.account_profiles p where p.user_name=u.usuario)
on conflict do nothing;

create or replace function public.ensure_account_profile(p_user text,p_name text)
returns void language plpgsql set search_path='' as $$
begin
 perform pg_advisory_xact_lock(hashtextextended(p_user,0));
 if not exists(select 1 from public.account_profiles where user_name=p_user) then
  insert into public.account_profiles(user_name,slot,name) values(p_user,1,p_name);
 end if;
end;$$;
revoke all on function public.ensure_account_profile(text,text) from public,anon,authenticated;
grant execute on function public.ensure_account_profile(text,text) to service_role;

drop function if exists public.save_account_profile(text,text,boolean,smallint);
create or replace function public.save_account_profile(p_user text,p_name text,p_child boolean,p_slot smallint default null,p_avatar text default '',p_protected boolean default false)
returns public.account_profiles language plpgsql set search_path='' as $$
declare target_slot smallint; result public.account_profiles;
begin
 perform pg_advisory_xact_lock(hashtextextended(p_user,0));
 if p_slot is null then
  select n::smallint into target_slot from generate_series(1,4) n where not exists(select 1 from public.account_profiles p where p.user_name=p_user and p.slot=n) order by n limit 1;
  if target_slot is null then raise exception 'Limite de 4 perfis atingido';end if;
  insert into public.account_profiles(user_name,slot,name,is_child,avatar_data,password_protected,data_key)
   values(p_user,target_slot,p_name,p_child,p_avatar,p_protected,gen_random_uuid()::text) returning * into result;
 else
  update public.account_profiles set name=p_name,is_child=p_child,avatar_data=p_avatar,password_protected=p_protected
   where user_name=p_user and slot=p_slot returning * into result;
  if not found then raise exception 'Perfil inexistente';end if;
 end if;
 return result;
end;$$;
revoke all on function public.save_account_profile(text,text,boolean,smallint,text,boolean) from public,anon,authenticated;
grant execute on function public.save_account_profile(text,text,boolean,smallint,text,boolean) to service_role;

create or replace function public.delete_account_profile(p_user text,p_slot smallint,p_data_key text)
returns boolean language plpgsql set search_path='' as $$
declare victim public.account_profiles; prefix text;
begin
 perform pg_advisory_xact_lock(hashtextextended(p_user,0));
 select * into victim from public.account_profiles where user_name=p_user and slot=p_slot;
 if not found or victim.data_key<>p_data_key then raise exception 'Perfil não encontrado ou alterado';end if;
 if (select count(*) from public.account_profiles where user_name=p_user)<=1 then raise exception 'Mantenha pelo menos um perfil na conta';end if;
 prefix:=case when victim.data_key<>'' then 'profile:'||victim.data_key||':' when p_slot<>1 then 'profile:'||p_slot||':' else '' end;
 delete from public.user_progress where user_name=p_user and (case when prefix='' then sync_key not like 'profile:%' else starts_with(sync_key,prefix) end);
 delete from public.user_game_saves where user_name=p_user and (case when prefix='' then game_key not like 'profile:%' else starts_with(game_key,prefix) end);
 delete from public.account_profiles where user_name=p_user and slot=p_slot;
 return true;
end;$$;
revoke all on function public.delete_account_profile(text,smallint,text) from public,anon,authenticated;
grant execute on function public.delete_account_profile(text,smallint,text) to service_role;
