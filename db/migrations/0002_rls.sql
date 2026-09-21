-- Pulse 0002 — RLS (PRD §8 / RF-07.4)
-- Every read of tenant data goes through these policies. The frontend never filters
-- by agency or by location on its own; the API never accepts an agency_id from the
-- client (§12 multi-tenant).

-- ------------------------------------------------------------- helper fns
-- SECURITY DEFINER so they can read agency_users without re-entering RLS.

create or replace function current_agency_user_id() returns uuid
language sql stable security definer set search_path = public as $$
  select id from agency_users where auth_user_id = auth.uid()
$$;

create or replace function current_agency_id() returns uuid
language sql stable security definer set search_path = public as $$
  select agency_id from agency_users where auth_user_id = auth.uid()
$$;

create or replace function current_role_in_agency() returns text
language sql stable security definer set search_path = public as $$
  select role from agency_users where auth_user_id = auth.uid()
$$;

create or replace function is_super_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select is_super_admin from agency_users where auth_user_id = auth.uid()), false)
$$;

-- Owners and admins see every sub-account of their agency; managers only the ones
-- assigned to them (RF-07.2).
create or replace function has_location_access(loc uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1
    from locations l
    join agency_users au on au.auth_user_id = auth.uid()
    where l.id = loc
      and l.agency_id = au.agency_id
      and (
        au.role in ('owner','admin')
        or exists (
          select 1 from user_location_access ula
          where ula.agency_user_id = au.id and ula.location_id = l.id
        )
      )
  )
$$;

-- Feature toggles per user (RF-07.3). Absent row = allowed.
create or replace function has_permission(res text) returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(
    (select allowed from user_permissions up
      where up.agency_user_id = current_agency_user_id() and up.resource = res),
    true)
$$;

-- -------------------------------------------------------------- enable RLS

alter table agencies            enable row level security;
alter table agency_users        enable row level security;
alter table user_permissions    enable row level security;
alter table locations           enable row level security;
alter table user_location_access enable row level security;
alter table ghl_users           enable row level security;
alter table sessions            enable row level security;
alter table metrics_daily       enable row level security;
alter table health_scores       enable row level security;
alter table tier_changes        enable row level security;
alter table alert_rules         enable row level security;
alter table alerts              enable row level security;
alter table events_raw          enable row level security;
alter table location_notes      enable row level security;
alter table timeline_events     enable row level security;
alter table audit_log           enable row level security;

-- -------------------------------------------------------------- policies

create policy agency_self on agencies for select
  using (id = current_agency_id() or is_super_admin());

create policy agency_admin_update on agencies for update
  using (id = current_agency_id() and current_role_in_agency() = 'owner');

create policy agency_users_read on agency_users for select
  using (agency_id = current_agency_id() or is_super_admin());

create policy agency_users_write on agency_users for all
  using (agency_id = current_agency_id() and current_role_in_agency() in ('owner','admin'))
  with check (agency_id = current_agency_id() and current_role_in_agency() in ('owner','admin'));

create policy user_permissions_read on user_permissions for select
  using (agency_user_id in (select id from agency_users where agency_id = current_agency_id()));

create policy user_permissions_write on user_permissions for all
  using (current_role_in_agency() = 'owner'
    and agency_user_id in (select id from agency_users where agency_id = current_agency_id()))
  with check (current_role_in_agency() = 'owner'
    and agency_user_id in (select id from agency_users where agency_id = current_agency_id()));

create policy location_access on locations for select
  using (
    agency_id = current_agency_id()
    and (
      current_role_in_agency() in ('owner','admin')
      or id in (select location_id from user_location_access
                 where agency_user_id = current_agency_user_id())
    )
  );

create policy location_manage on locations for update
  using (agency_id = current_agency_id() and current_role_in_agency() in ('owner','admin'))
  with check (agency_id = current_agency_id() and current_role_in_agency() in ('owner','admin'));

create policy ula_read on user_location_access for select
  using (agency_user_id in (select id from agency_users where agency_id = current_agency_id()));

create policy ula_write on user_location_access for all
  using (current_role_in_agency() in ('owner','admin')
    and agency_user_id in (select id from agency_users where agency_id = current_agency_id()))
  with check (current_role_in_agency() in ('owner','admin')
    and agency_user_id in (select id from agency_users where agency_id = current_agency_id()));

-- Child tables inherit the location policy above.
create policy ghl_users_read       on ghl_users       for select using (has_location_access(location_id));
create policy sessions_read        on sessions        for select using (has_location_access(location_id));
create policy metrics_daily_read   on metrics_daily   for select using (has_location_access(location_id));
create policy health_scores_read   on health_scores   for select using (has_location_access(location_id));
create policy tier_changes_read    on tier_changes    for select using (has_location_access(location_id));
create policy timeline_read        on timeline_events for select using (has_location_access(location_id));
create policy alerts_read          on alerts          for select using (location_id is null or has_location_access(location_id));

create policy notes_read on location_notes for select
  using (has_location_access(location_id) and has_permission('notes'));
create policy notes_write on location_notes for insert
  with check (has_location_access(location_id) and has_permission('notes')
    and author_id = current_agency_user_id());

create policy alert_rules_read on alert_rules for select
  using (agency_id = current_agency_id());
create policy alert_rules_write on alert_rules for all
  using (agency_id = current_agency_id() and current_role_in_agency() in ('owner','admin')
    and has_permission('alerts_config'))
  with check (agency_id = current_agency_id() and current_role_in_agency() in ('owner','admin')
    and has_permission('alerts_config'));

-- events_raw is operational data: only the worker (service role) touches it.
create policy events_raw_none on events_raw for select using (is_super_admin());

-- Audit log is append-from-app, readable by owners/admins of the same agency.
create policy audit_read on audit_log for select
  using (
    is_super_admin()
    or (current_role_in_agency() in ('owner','admin')
        and agency_user_id in (select id from agency_users where agency_id = current_agency_id()))
  );
create policy audit_insert on audit_log for insert
  with check (agency_user_id = current_agency_user_id());
