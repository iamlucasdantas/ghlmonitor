-- Pulse 0004 — retention & privacy jobs (PRD §12 LGPD/GDPR)
-- events_raw purged at 90 days; session IPs anonymised to /24 at 180 days.

create or replace function purge_events_raw() returns int
language plpgsql security definer set search_path = public as $$
declare removed int;
begin
  delete from events_raw where received_at < now() - interval '90 days';
  get diagnostics removed = row_count;
  return removed;
end $$;

create or replace function anonymize_session_ips() returns int
language plpgsql security definer set search_path = public as $$
declare touched int;
begin
  update sessions
     set ip = set_masklen(network(set_masklen(ip, 24)), 32),
         ip_anonymized_at = now()
   where ip is not null
     and ip_anonymized_at is null
     and started_at < now() - interval '180 days'
     and family(ip) = 4;
  get diagnostics touched = row_count;
  return touched;
end $$;

-- Right to erasure: drop everything tied to one HighLevel user (§12).
create or replace function forget_ghl_user(p_location uuid, p_ghl_user_id text) returns void
language plpgsql security definer set search_path = public as $$
declare uid uuid;
begin
  select id into uid from ghl_users
   where location_id = p_location and ghl_user_id = p_ghl_user_id;
  if uid is null then return; end if;

  update sessions set ip = null, city = null, region = null, user_agent = null,
                      ghl_user_id = null, ip_anonymized_at = now()
   where ghl_user_id = uid;
  delete from events_raw
   where location_id = p_location and payload->>'userId' = p_ghl_user_id;
  delete from ghl_users where id = uid;
end $$;

-- pg_cron only exists on a managed Postgres (Supabase enables it per project). The
-- functions above are the contract; scheduling them is environment-specific, so a
-- local database without the extension still gets a complete, testable schema.
do $$
begin
  if exists (select 1 from pg_available_extensions where name = 'pg_cron') then
    create extension if not exists pg_cron;
    perform cron.schedule('pulse-purge-events-raw', '15 4 * * *', $c$select purge_events_raw()$c$);
    perform cron.schedule('pulse-anonymize-ips',    '30 4 * * *', $c$select anonymize_session_ips()$c$);
  else
    raise notice 'pg_cron not available: schedule purge_events_raw() and anonymize_session_ips() daily by other means';
  end if;
end $$;
