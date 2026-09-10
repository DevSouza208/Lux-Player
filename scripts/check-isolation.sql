select tablename,policyname,roles,cmd,qual,with_check from pg_policies
where schemaname='public' and tablename in ('usuarios','user_progress','user_game_saves','account_profiles','games');
select c.relname,c.relrowsecurity from pg_class c join pg_namespace n on n.oid=c.relnamespace
where n.nspname='public' and c.relname in ('user_progress','user_game_saves','account_profiles','games');
