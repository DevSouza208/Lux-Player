alter table public.lux_home_rail_items
  drop constraint if exists lux_home_rail_items_rail_check;

alter table public.lux_home_rail_items
  add constraint lux_home_rail_items_rail_check
  check (rail in ('movies','series','games','books'));
