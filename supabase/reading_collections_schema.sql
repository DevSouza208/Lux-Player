-- Additive collection metadata; no changes to legacy authentication.
begin;
alter table public.reading_catalog add column if not exists collection_path text not null default '';
create or replace function public.prepare_reading_book(p_record jsonb)
returns public.reading_catalog language plpgsql set search_path='' as $$
declare result public.reading_catalog;
begin
 insert into public.reading_catalog(id,content_hash,title,authors,category,description,cover_url,publisher,published_year,isbn,metadata_source,age_rating,format,file_name,size_bytes,object_key,created_by,collection_path)
 values((p_record->>'id')::uuid,p_record->>'content_hash',p_record->>'title',p_record->>'authors',p_record->>'category',p_record->>'description',p_record->>'cover_url',p_record->>'publisher',p_record->>'published_year',p_record->>'isbn',p_record->>'metadata_source',(p_record->>'age_rating')::smallint,p_record->>'format',p_record->>'file_name',(p_record->>'size_bytes')::bigint,p_record->>'object_key',p_record->>'created_by',coalesce(p_record->>'collection_path',''))
 on conflict(content_hash) do nothing;
 select * into result from public.reading_catalog where content_hash=p_record->>'content_hash';return result;
end;$$;
revoke all on function public.prepare_reading_book(jsonb) from public,anon,authenticated;
grant execute on function public.prepare_reading_book(jsonb) to service_role;
commit;
