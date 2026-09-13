-- Permite o mesmo título em consoles diferentes e mantém o bloqueio
-- para título repetido dentro do mesmo console.
create or replace function public.prevent_duplicate_game_title()
returns trigger language plpgsql set search_path='' as $$
declare
 normalized text;
 normalized_console text;
begin
 normalized:=lower(regexp_replace(regexp_replace(trim(new.title),'[^[:alnum:]]+',' ','g'),'\s+',' ','g'));
 normalized_console:=lower(regexp_replace(regexp_replace(trim(coalesce(new.console,'')),'[^[:alnum:]]+',' ','g'),'\s+',' ','g'));
 new.normalized_title:=normalized;

 if exists(
   select 1
   from public.games game
   where game.id is distinct from new.id
     and lower(regexp_replace(regexp_replace(trim(game.title),'[^[:alnum:]]+',' ','g'),'\s+',' ','g'))=normalized
     and lower(regexp_replace(regexp_replace(trim(coalesce(game.console,'')),'[^[:alnum:]]+',' ','g'),'\s+',' ','g'))=normalized_console
 ) then
   raise exception 'Já existe um jogo com este título neste console.' using errcode='23505';
 end if;

 return new;
end;$$;

drop trigger if exists games_prevent_duplicate_title on public.games;
create trigger games_prevent_duplicate_title
before insert or update of title, console on public.games
for each row execute function public.prevent_duplicate_game_title();
