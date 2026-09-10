select jsonb_build_object(
 'user_columns',(select jsonb_agg(jsonb_build_object('name',column_name,'required',is_nullable='NO','default',column_default)) from information_schema.columns where table_schema='public' and table_name='usuarios'),
 'policies',(select coalesce(jsonb_agg(jsonb_build_object('table',tablename,'name',policyname,'roles',roles,'command',cmd,'condition',qual,'write_condition',with_check)),'[]'::jsonb) from pg_policies where schemaname='public' and tablename in('usuarios','user_progress','user_game_saves','account_profiles','games','reading_records','reading_catalog')),
 'grants',(select jsonb_agg(jsonb_build_object('table',table_name,'role',grantee,'privilege',privilege_type)) from information_schema.role_table_grants where table_schema='public' and table_name in('usuarios','user_progress','user_game_saves','account_profiles','games','reading_records','reading_catalog') and grantee in('anon','authenticated'))
) as inspection;
