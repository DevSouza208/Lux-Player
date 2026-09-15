-- ============================================================
-- [LUX-BACKEND-017] MAPA FUNCIONAL NORMALIZADO
-- ============================================================
-- Uma funcionalidade por linha, separada por branch (main/develop).
--
-- Objetivo:
-- - permitir edição rápida de um único item sem reconstruir um CSV inteiro;
-- - manter o CSV somente como formato de importação/exportação;
-- - restringir acesso direto ao navegador: somente service_role usa a tabela;
-- - NÃO altera RLS da tabela usuarios.
-- ============================================================

create table if not exists public.functional_map_items (
  branch text not null check (branch in ('main','develop')),
  id text not null,
  area text not null default '',
  funcionalidade text not null default '',
  status text not null default '',
  tag text not null default '',
  o_que_faz text not null default '',
  opiniao text not null default '',
  sugestoes_melhoria text not null default '',
  arquivos_modulos text not null default '',
  funcoes_simbolos text not null default '',
  dependencias_fluxo text not null default '',
  position integer not null default 0,
  updated_at timestamptz not null default now(),
  updated_by text not null default '',
  primary key (branch, id)
);

create index if not exists functional_map_items_branch_position_idx
  on public.functional_map_items (branch, position);
create index if not exists functional_map_items_branch_tag_idx
  on public.functional_map_items (branch, tag);
create index if not exists functional_map_items_branch_area_idx
  on public.functional_map_items (branch, area);

alter table public.functional_map_items enable row level security;
revoke all on table public.functional_map_items from anon, authenticated;
grant select, insert, update, delete on table public.functional_map_items to service_role;

-- Substitui uma branch inteira dentro de uma única transação. A Edge Function
-- envia o CSV já convertido para JSON e esta RPC faz delete + insert de forma
-- atômica, evitando mapas pela metade durante um upload.
create or replace function public.replace_functional_map_items(
  p_branch text,
  p_rows jsonb,
  p_updated_by text default ''
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count integer := 0;
begin
  if p_branch not in ('main','develop') then
    raise exception 'invalid branch';
  end if;
  if jsonb_typeof(p_rows) <> 'array' then
    raise exception 'rows must be an array';
  end if;

  delete from public.functional_map_items where branch = p_branch;

  insert into public.functional_map_items (
    branch, id, area, funcionalidade, status, tag,
    o_que_faz, opiniao, sugestoes_melhoria,
    arquivos_modulos, funcoes_simbolos, dependencias_fluxo,
    position, updated_at, updated_by
  )
  select
    p_branch,
    nullif(trim(item->>'id'), ''),
    coalesce(item->>'area',''),
    coalesce(item->>'funcionalidade',''),
    coalesce(item->>'status',''),
    coalesce(item->>'tag',''),
    coalesce(item->>'o_que_faz',''),
    coalesce(item->>'opiniao',''),
    coalesce(item->>'sugestoes_melhoria',''),
    coalesce(item->>'arquivos_modulos',''),
    coalesce(item->>'funcoes_simbolos',''),
    coalesce(item->>'dependencias_fluxo',''),
    coalesce((item->>'position')::integer, ordinality::integer),
    now(),
    coalesce(p_updated_by,'')
  from jsonb_array_elements(p_rows) with ordinality as t(item, ordinality)
  where nullif(trim(item->>'id'), '') is not null;

  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

revoke all on function public.replace_functional_map_items(text,jsonb,text) from public, anon, authenticated;
grant execute on function public.replace_functional_map_items(text,jsonb,text) to service_role;

-- Remove a RPC temporária de carga antiga que ficou exposta ao PostgREST.
drop function if exists public.lux_seed_functional_map(text,text,text,boolean);
