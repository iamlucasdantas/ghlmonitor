-- Pulse 0006 — table privileges
-- Runs last, after every table and view exists: `grant on all tables` only touches
-- objects that are already there.

-- RLS filters rows, but a role still needs the table privilege to reach them.
-- Writes stay with the worker (service role); the app only reads.

grant usage on schema public to authenticated;
grant select on all tables in schema public to authenticated;

-- The few things the panel itself writes (RF-06.7, RF-07.1/2/3, RF-07.5), each
-- still bounded by the policies above.
grant insert on location_notes, audit_log to authenticated;
grant insert, update, delete on user_permissions, user_location_access to authenticated;
grant insert, update on agency_users to authenticated;
grant update on alert_rules to authenticated;
grant update (name, niche, plan_name, plan_value, manager_id) on locations to authenticated;
grant usage, select on all sequences in schema public to authenticated;
