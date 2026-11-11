-- Local stand-in for Supabase's auth schema so the migration and RLS can be tested on plain Postgres.
create schema if not exists auth;
create or replace function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
do $$ begin if not exists (select from pg_roles where rolname = 'authenticated') then create role authenticated; end if; end $$;
