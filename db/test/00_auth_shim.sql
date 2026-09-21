-- Supabase provides auth.uid() and the authenticated/anon roles. A plain Postgres does
-- not, so tests stand up the same surface and then exercise the real policies.
-- This file is for local testing only and is never applied to a Supabase project.

create schema if not exists auth;

create or replace function auth.uid() returns uuid
language sql stable as $$
  select nullif(current_setting('pulse.test_user', true), '')::uuid
$$;

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then
    create role authenticated nologin;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then
    create role service_role nologin bypassrls;
  end if;
end $$;
