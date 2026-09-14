create or replace function public.lux_catalog_grouping_candidates(p_version text default 'tmdb-v1', p_limit integer default 12)
returns table(
  id uuid,
  canonical_title text,
  normalized_title text,
  year integer,
  tmdb_id bigint,
  poster text,
  metadata jsonb,
  remaining bigint
)
language sql
security definer
set search_path to 'public'
as $function$
  with candidates as (
    select t.id, t.canonical_title, t.normalized_title, t.year, t.tmdb_id, t.poster, t.metadata
    from public.lux_catalog_titles t
    where t.media_type = 'series'
      and exists (
        select 1
        from public.lux_catalog_sources s
        where s.title_id = t.id
          and s.available = true
          and s.source_layer = 'secondary'
      )
      and coalesce(t.metadata->>'grouping_version','') <> coalesce(p_version,'tmdb-v1')
  )
  select c.id, c.canonical_title, c.normalized_title, c.year, c.tmdb_id, c.poster, c.metadata,
         count(*) over() as remaining
  from candidates c
  order by c.normalized_title, c.id
  limit least(greatest(coalesce(p_limit,12),1),25);
$function$;

create or replace function public.lux_catalog_snapshot_page(p_offset integer default 0, p_limit integer default 250)
returns jsonb
language sql
security definer
set search_path to 'public'
as $function$
with selected as (
  select t.*
  from public.lux_catalog_titles t
  where exists (
    select 1 from public.lux_catalog_sources s
    where s.title_id=t.id and s.available=true and s.source_layer in ('provider','secondary')
  )
  order by t.media_type, t.normalized_title, t.id
  offset greatest(p_offset,0)
  limit least(greatest(p_limit,1),500)
)
select coalesce(jsonb_agg(
  jsonb_build_object(
    'id', t.id,
    'media_type', t.media_type,
    'canonical_title', t.canonical_title,
    'normalized_title', t.normalized_title,
    'year', t.year,
    'format', t.format,
    'anilist_id', t.anilist_id,
    'mal_id', t.mal_id,
    'tmdb_id', t.tmdb_id,
    'poster', t.poster,
    'metadata', t.metadata,
    'has_principal', exists(
      select 1 from public.lux_catalog_sources p
      where p.title_id=t.id and p.available=true and p.source_layer='principal'
    ),
    'sources', coalesce((
      select jsonb_agg(jsonb_build_object(
        'source_layer', s.source_layer,
        'source_id', s.source_id,
        'source_name', s.source_name,
        'source_key', s.source_key,
        'locator_type', s.locator_type,
        'locator', s.locator,
        'provider_item_id', nullif(s.provider_item_id,''),
        'url', case when s.locator_type='direct_url' then s.url else s.locator end,
        'language', s.language,
        'audio', s.audio,
        'priority', s.priority,
        'metadata', s.metadata || case
          when nullif(t.metadata->>'lux_group','') is null then '{}'::jsonb
          else jsonb_build_object('group', t.metadata->>'lux_group')
        end,
        'episode', case when e.id is null then null else jsonb_build_object(
          'season', e.season,
          'episode', e.episode,
          'title', e.episode_title
        ) end
      ) order by case s.source_layer when 'provider' then 1 else 2 end, s.priority, s.created_at)
      from public.lux_catalog_sources s
      left join public.lux_catalog_episodes e on e.id=s.episode_id
      where s.title_id=t.id and s.available=true and s.source_layer in ('provider','secondary')
    ), '[]'::jsonb)
  )
), '[]'::jsonb)
from selected t;
$function$;
