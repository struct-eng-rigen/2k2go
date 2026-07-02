begin;

-- Keep arbitrary objects out of the public schema while preserving runtime
-- access for Supabase client roles. Table/function-level grants still decide
-- what each role can execute or read.
revoke create on schema public from public;
grant usage on schema public to anon, authenticated, service_role;

-- The deck download event table is intentionally write-only through Edge
-- Functions/service role. Force RLS so table owners do not accidentally bypass
-- policies during future function changes.
alter table if exists public.deck_download_events force row level security;

-- Security-definer functions must not depend on writable schemas in search_path.
-- All referenced schemas inside get_app_admin_overview_v1 are qualified.
do $migration$
begin
  if pg_catalog.to_regprocedure('public.get_app_admin_overview_v1()') is not null then
    execute $sql$alter function public.get_app_admin_overview_v1() set search_path to 'pg_catalog'$sql$;
    execute $sql$revoke all on function public.get_app_admin_overview_v1() from public$sql$;
    execute $sql$grant execute on function public.get_app_admin_overview_v1() to authenticated$sql$;
    execute $sql$grant execute on function public.get_app_admin_overview_v1() to service_role$sql$;
  end if;
end;
$migration$;

-- submit_review_batch_v1 is callable by signed-in users only. Avoid the default
-- PUBLIC execute grant and pin the search path even though the function is
-- security-invoker today.
do $migration$
begin
  if pg_catalog.to_regprocedure('public.submit_review_batch_v1(uuid, jsonb)') is not null then
    execute $sql$alter function public.submit_review_batch_v1(uuid, jsonb) set search_path to 'pg_catalog'$sql$;
    execute $sql$revoke all on function public.submit_review_batch_v1(uuid, jsonb) from public$sql$;
    execute $sql$grant execute on function public.submit_review_batch_v1(uuid, jsonb) to authenticated$sql$;
    execute $sql$grant execute on function public.submit_review_batch_v1(uuid, jsonb) to service_role$sql$;
  end if;
end;
$migration$;

commit;
