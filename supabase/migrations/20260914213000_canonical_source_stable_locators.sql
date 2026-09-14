alter table public.lux_catalog_sources
  add column if not exists locator_type text not null default 'direct_url',
  add column if not exists locator text not null default '',
  add column if not exists provider_item_id text not null default '',
  add column if not exists last_resolved_at timestamptz;

update public.lux_catalog_sources
   set locator = case when locator = '' then url else locator end,
       locator_type = case when locator_type = '' then 'direct_url' else locator_type end
 where locator = '' or locator_type = '';

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'lux_catalog_sources_locator_type_check'
      and conrelid = 'public.lux_catalog_sources'::regclass
  ) then
    alter table public.lux_catalog_sources
      add constraint lux_catalog_sources_locator_type_check
      check (locator_type in ('direct_url','provider_page','provider_item','playlist_entry'));
  end if;
end $$;

create index if not exists lux_catalog_sources_provider_item_idx
  on public.lux_catalog_sources(source_layer, source_id, provider_item_id)
  where provider_item_id <> '';

create or replace function public.lux_catalog_ingest_batch(
  p_layer text,
  p_source_id text,
  p_source_name text,
  p_priority integer,
  p_items jsonb,
  p_seen_at timestamptz default now()
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  rec jsonb;
  v_title_id uuid;
  v_episode_id uuid;
  v_existing_source uuid;
  v_new_titles integer := 0;
  v_new_episodes integer := 0;
  v_new_sources integer := 0;
  v_updated_sources integer := 0;
  v_media_type text;
  v_title text;
  v_normalized text;
  v_year integer;
  v_episode numeric(8,2);
  v_season integer;
  v_metadata jsonb;
  v_locator_type text;
  v_locator text;
  v_provider_item_id text;
  v_url text;
begin
  if p_layer not in ('principal','provider','secondary') then
    raise exception 'invalid layer';
  end if;
  if p_items is null or jsonb_typeof(p_items) <> 'array' then
    raise exception 'items must be an array';
  end if;

  for rec in select value from jsonb_array_elements(p_items)
  loop
    v_media_type := coalesce(nullif(rec->>'media_type',''),'series');
    if v_media_type not in ('series','movies','live') then v_media_type := 'series'; end if;
    v_title := left(coalesce(nullif(rec->>'canonical_title',''), nullif(rec->>'title',''), 'Sem título'), 500);
    v_normalized := left(coalesce(nullif(rec->>'normalized_title',''), lower(v_title)), 500);
    begin v_year := nullif(rec->>'year','')::integer; exception when others then v_year := null; end;
    v_metadata := coalesce(rec->'metadata','{}'::jsonb);

    v_locator_type := left(coalesce(nullif(rec->>'locator_type',''), case when p_layer='provider' then 'provider_page' else 'direct_url' end), 40);
    if v_locator_type not in ('direct_url','provider_page','provider_item','playlist_entry') then
      v_locator_type := case when p_layer='provider' then 'provider_page' else 'direct_url' end;
    end if;
    v_locator := left(coalesce(nullif(rec->>'locator',''), nullif(rec->>'url',''), ''), 4000);
    v_provider_item_id := left(coalesce(rec->>'provider_item_id',''), 500);
    v_url := case when v_locator_type='direct_url' then v_locator else '' end;

    select id into v_title_id
      from public.lux_catalog_titles
     where media_type = v_media_type
       and normalized_title = v_normalized
       and coalesce(year,0) = coalesce(v_year,0)
     limit 1;

    if v_title_id is null then
      begin
        insert into public.lux_catalog_titles(media_type,canonical_title,normalized_title,year,format,poster,metadata,updated_at)
        values(v_media_type,v_title,v_normalized,v_year,nullif(rec->>'format',''),coalesce(rec->>'poster',''),v_metadata,now())
        returning id into v_title_id;
        v_new_titles := v_new_titles + 1;
      exception when unique_violation then
        select id into v_title_id
          from public.lux_catalog_titles
         where media_type = v_media_type
           and normalized_title = v_normalized
           and coalesce(year,0) = coalesce(v_year,0)
         limit 1;
      end;
    else
      update public.lux_catalog_titles
         set poster = case when poster='' and coalesce(rec->>'poster','')<>'' then rec->>'poster' else poster end,
             metadata = metadata || v_metadata,
             updated_at = now()
       where id = v_title_id;
    end if;

    v_episode_id := null;
    begin v_episode := nullif(rec->>'episode','')::numeric; exception when others then v_episode := null; end;
    begin v_season := coalesce(nullif(rec->>'season','')::integer,1); exception when others then v_season := 1; end;
    if v_episode is not null and v_media_type='series' then
      select id into v_episode_id from public.lux_catalog_episodes
       where title_id=v_title_id and season=v_season and episode=v_episode limit 1;
      if v_episode_id is null then
        insert into public.lux_catalog_episodes(title_id,season,episode,episode_title,updated_at)
        values(v_title_id,v_season,v_episode,left(coalesce(rec->>'episode_title',''),500),now())
        on conflict(title_id,season,episode) do update set
          episode_title=case when public.lux_catalog_episodes.episode_title='' then excluded.episode_title else public.lux_catalog_episodes.episode_title end,
          updated_at=now()
        returning id into v_episode_id;
        v_new_episodes := v_new_episodes + 1;
      end if;
    end if;

    select id into v_existing_source from public.lux_catalog_sources
     where source_layer=p_layer and source_id=p_source_id and source_key=left(coalesce(rec->>'source_key',''),500) limit 1;

    insert into public.lux_catalog_sources(
      title_id,episode_id,source_layer,source_id,source_name,source_key,url,locator_type,locator,provider_item_id,
      language,audio,priority,available,last_seen_at,metadata,updated_at
    ) values (
      v_title_id,v_episode_id,p_layer,p_source_id,left(coalesce(p_source_name,''),200),left(coalesce(rec->>'source_key',''),500),
      v_url,v_locator_type,v_locator,v_provider_item_id,left(coalesce(rec->>'language',''),30),left(coalesce(rec->>'audio',''),30),
      coalesce(p_priority,100),true,p_seen_at,v_metadata,now()
    ) on conflict(source_layer,source_id,source_key) do update set
      title_id=excluded.title_id,
      episode_id=excluded.episode_id,
      source_name=excluded.source_name,
      url=excluded.url,
      locator_type=excluded.locator_type,
      locator=excluded.locator,
      provider_item_id=excluded.provider_item_id,
      language=excluded.language,
      audio=excluded.audio,
      priority=excluded.priority,
      available=true,
      last_seen_at=excluded.last_seen_at,
      metadata=public.lux_catalog_sources.metadata || excluded.metadata,
      updated_at=now();

    if v_existing_source is null then v_new_sources := v_new_sources + 1; else v_updated_sources := v_updated_sources + 1; end if;
  end loop;

  return jsonb_build_object(
    'new_titles',v_new_titles,
    'new_episodes',v_new_episodes,
    'new_sources',v_new_sources,
    'updated_sources',v_updated_sources,
    'processed',jsonb_array_length(p_items)
  );
end;
$$;

create or replace function public.lux_catalog_snapshot_page(p_offset integer default 0, p_limit integer default 250)
returns jsonb
language sql
security definer
set search_path = public
as $$
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
        'metadata', s.metadata,
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
$$;