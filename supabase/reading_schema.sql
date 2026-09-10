-- Additive migration: catalog files in R2; private reader data in Postgres.
begin;
create table if not exists public.reading_catalog (
 id uuid primary key default gen_random_uuid(), content_hash text not null unique check(content_hash ~ '^[a-f0-9]{64}$'), normalized_title text not null default '', language_code text not null default '', translation_available boolean not null default false,
 title text not null check(length(title) between 1 and 300), authors text not null default '',
 category text not null default 'Livros', description text not null default '', cover_url text not null default '',
 publisher text not null default '', published_year text not null default '', isbn text not null default '',
 metadata_source text not null default '', collection_path text not null default '', age_rating smallint not null default 0 check(age_rating between 0 and 18),
 format text not null check(format in ('pdf','epub','cbr','cbz')), file_name text not null,
 size_bytes bigint not null check(size_bytes between 1 and 268435456), object_key text not null,
 status text not null default 'pending' check(status in ('pending','approved','rejected')),
 upload_complete boolean not null default false, created_by text not null,
 created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
alter table public.reading_catalog enable row level security;
alter table public.reading_catalog add column if not exists collection_path text not null default '';
alter table public.reading_catalog add column if not exists normalized_title text not null default '';
alter table public.reading_catalog add column if not exists language_code text not null default '';
alter table public.reading_catalog add column if not exists translation_available boolean not null default false;
update public.reading_catalog set normalized_title=lower(regexp_replace(regexp_replace(trim(title),'[^[:alnum:]]+',' ','g'),'\s+',' ','g')) where normalized_title='';
revoke all on public.reading_catalog from anon,authenticated;
grant select,insert,update,delete on public.reading_catalog to service_role;
create index if not exists reading_catalog_status_title on public.reading_catalog(status,title);
create unique index if not exists reading_catalog_normalized_title_unique on public.reading_catalog(normalized_title) where normalized_title<>'';

create or replace function public.prepare_reading_book(p_record jsonb)
returns public.reading_catalog language plpgsql set search_path='' as $$
declare result public.reading_catalog;
begin
 insert into public.reading_catalog(id,content_hash,normalized_title,language_code,translation_available,title,authors,category,description,cover_url,publisher,published_year,isbn,metadata_source,age_rating,format,file_name,size_bytes,object_key,created_by,collection_path)
 values((p_record->>'id')::uuid,p_record->>'content_hash',p_record->>'normalized_title',coalesce(p_record->>'language_code',''),coalesce((p_record->>'translation_available')::boolean,false),p_record->>'title',p_record->>'authors',p_record->>'category',p_record->>'description',p_record->>'cover_url',p_record->>'publisher',p_record->>'published_year',p_record->>'isbn',p_record->>'metadata_source',(p_record->>'age_rating')::smallint,p_record->>'format',p_record->>'file_name',(p_record->>'size_bytes')::bigint,p_record->>'object_key',p_record->>'created_by',coalesce(p_record->>'collection_path',''))
 on conflict(content_hash) do nothing;
 select * into result from public.reading_catalog where content_hash=p_record->>'content_hash';return result;
end;$$;
revoke all on function public.prepare_reading_book(jsonb) from public,anon,authenticated;
grant execute on function public.prepare_reading_book(jsonb) to service_role;

create table if not exists public.reading_records (
 user_name text not null, profile_slot smallint not null, profile_key text not null,
 book_id text not null check(book_id ~ '^[a-f0-9]{64}$'), record_key text not null,
 payload jsonb not null, revision bigint not null default 1, updated_at timestamptz not null default now(),
 primary key(user_name,profile_key,book_id,record_key),
 foreign key(user_name,profile_slot) references public.account_profiles(user_name,slot) on delete cascade,
 check(length(payload::text)<=250000)
);
alter table public.reading_records enable row level security;
revoke all on public.reading_records from anon,authenticated;
grant select,insert,update,delete on public.reading_records to service_role;

create or replace function public.commit_reading_record(p_user text,p_slot smallint,p_profile text,p_book text,p_key text,p_payload jsonb,p_expected bigint)
returns jsonb language plpgsql set search_path='' as $$
declare current_row public.reading_records; actual_key text;
begin
 -- Lock the profile as well: deleting/recreating a slot cannot race a save.
 select case when data_key='' then 'slot:'||slot else data_key end into actual_key
 from public.account_profiles where user_name=p_user and slot=p_slot for key share;
 if actual_key is null or actual_key<>p_profile then raise exception 'Perfil alterado';end if;
 perform pg_advisory_xact_lock(hashtextextended(jsonb_build_array(p_user,p_profile,p_book,p_key)::text,0));
 select * into current_row from public.reading_records where user_name=p_user and profile_key=p_profile and book_id=p_book and record_key=p_key;
 if coalesce(current_row.revision,0)<>p_expected then
  return jsonb_build_object('saved',false,'record',jsonb_build_object('key',current_row.record_key,'payload',current_row.payload,'revision',current_row.revision));
 end if;
 insert into public.reading_records(user_name,profile_slot,profile_key,book_id,record_key,payload,revision)
 values(p_user,p_slot,p_profile,p_book,p_key,p_payload,p_expected+1)
 on conflict(user_name,profile_key,book_id,record_key) do update set payload=excluded.payload,revision=excluded.revision,updated_at=now();
 return jsonb_build_object('saved',true,'record',jsonb_build_object('key',p_key,'payload',p_payload,'revision',p_expected+1));
end;$$;
revoke all on function public.commit_reading_record(text,smallint,text,text,text,jsonb,bigint) from public,anon,authenticated;
grant execute on function public.commit_reading_record(text,smallint,text,text,text,jsonb,bigint) to service_role;

-- Atomic compare-and-update for the existing movie/series/favorites service.
create or replace function public.commit_user_progress(p_user text,p_records jsonb)
returns integer language plpgsql set search_path='' as $$
declare affected integer;
begin
 insert into public.user_progress(user_name,sync_key,payload,client_updated_at,updated_at)
 select p_user,r->>'key',r->'payload',(r->>'updatedAt')::bigint,now() from jsonb_array_elements(p_records) r
 on conflict(user_name,sync_key) do update set payload=excluded.payload,client_updated_at=excluded.client_updated_at,updated_at=now()
 where public.user_progress.client_updated_at<excluded.client_updated_at;
 get diagnostics affected=row_count;return affected;
end;$$;
revoke all on function public.commit_user_progress(text,jsonb) from public,anon,authenticated;
grant execute on function public.commit_user_progress(text,jsonb) to service_role;
commit;
