create table if not exists public.emulator_core_statuses (
  core_id text primary key,
  status text not null check (status in ('tested', 'untested')),
  updated_at timestamptz not null default now()
);

alter table public.emulator_core_statuses enable row level security;
revoke all on public.emulator_core_statuses from anon, authenticated;
grant select, insert, update, delete on public.emulator_core_statuses to service_role;

-- Inicializa os mesmos valores do catálogo existente, preservando edições publicadas.
insert into public.emulator_core_statuses (core_id, status) values
  ('gb', 'tested'), ('gbc', 'tested'), ('gba', 'tested'),
  ('nes', 'tested'), ('snes', 'tested'), ('megadrive', 'tested'),
  ('mastersystem', 'tested'), ('n64', 'tested'), ('psp', 'untested')
on conflict (core_id) do nothing;

create or replace function public.touch_emulator_core_status_updated_at()
returns trigger
language plpgsql
set search_path=''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists emulator_core_statuses_updated_at on public.emulator_core_statuses;
create trigger emulator_core_statuses_updated_at
before update on public.emulator_core_statuses
for each row execute function public.touch_emulator_core_status_updated_at();

revoke all on function public.touch_emulator_core_status_updated_at() from public, anon, authenticated;
grant execute on function public.touch_emulator_core_status_updated_at() to service_role;
