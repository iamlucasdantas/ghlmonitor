-- Pulse 0001 — core schema (PRD §8)
-- Idempotent-ish: safe to run once on a fresh Supabase project.

create extension if not exists "pgcrypto";

-- ---------------------------------------------------------------- agencies

create table agencies (
  id uuid primary key default gen_random_uuid(),
  ghl_company_id text unique not null,
  name text not null,
  timezone text not null default 'America/Sao_Paulo',
  hmac_secret text not null,
  oauth_access_token text,
  oauth_refresh_token text,
  oauth_expires_at timestamptz,
  install_status text not null default 'active'
    check (install_status in ('active','uninstalled','error')),
  -- integration health (RF-01.3 / RF-09.1)
  last_script_event_at timestamptz,
  last_sync_at timestamptz,
  last_sync_status text check (last_sync_status in ('ok','partial','error')),
  created_at timestamptz not null default now()
);

create table agency_users (
  id uuid primary key default gen_random_uuid(),
  agency_id uuid not null references agencies(id) on delete cascade,
  auth_user_id uuid unique,                 -- supabase auth.users.id
  email text not null,
  name text,
  role text not null check (role in ('owner','admin','manager')),
  is_super_admin boolean not null default false,
  invited_at timestamptz,
  accepted_at timestamptz,
  created_at timestamptz not null default now(),
  unique (agency_id, email)
);
create index on agency_users (agency_id);

create table user_permissions (
  agency_user_id uuid not null references agency_users(id) on delete cascade,
  resource text not null check (resource in
    ('billing','sessions_ip','users_detail','export','notes','alerts_config')),
  allowed boolean not null default true,
  primary key (agency_user_id, resource)
);

-- --------------------------------------------------------------- locations

create table locations (
  id uuid primary key default gen_random_uuid(),
  agency_id uuid not null references agencies(id) on delete cascade,
  ghl_location_id text unique not null,
  name text,
  niche text,
  plan_name text,
  plan_value numeric(10,2),
  saas_status text,
  status text not null default 'active' check (status in ('active','archived')),
  installed_at timestamptz not null default now(),
  first_data_at timestamptz,                -- day zero for the "< 14 days" rule
  manager_id uuid references agency_users(id) on delete set null,
  location_token text,
  location_token_expires_at timestamptz
);
create index on locations (agency_id);
create index on locations (manager_id);

create table user_location_access (
  agency_user_id uuid not null references agency_users(id) on delete cascade,
  location_id uuid not null references locations(id) on delete cascade,
  primary key (agency_user_id, location_id)
);
create index on user_location_access (location_id);

create table ghl_users (
  id uuid primary key default gen_random_uuid(),
  location_id uuid not null references locations(id) on delete cascade,
  ghl_user_id text not null,
  name text,
  email text,
  role text,
  pending boolean not null default false,   -- seen by the script before the sync imported it
  last_seen_at timestamptz,
  last_ip inet,
  last_city text,
  last_region text,
  last_country text,
  last_page text,
  created_at timestamptz not null default now(),
  unique (location_id, ghl_user_id)
);
create index on ghl_users (location_id, last_seen_at desc);

-- ---------------------------------------------------------------- sessions

create table sessions (
  id uuid primary key,
  location_id uuid not null references locations(id) on delete cascade,
  ghl_user_id uuid references ghl_users(id) on delete set null,
  started_at timestamptz not null,
  ended_at timestamptz,
  duration_s int,
  active_s int,
  heartbeats int not null default 0,
  ip inet,
  city text,
  region text,
  country text,
  user_agent text,
  device text,
  pages jsonb,                              -- [{path, seconds}]
  end_reason text,
  counted boolean not null default false,   -- >= 2 valid heartbeats (PRD §6.1)
  ip_anonymized_at timestamptz,
  updated_at timestamptz not null default now()
);
create index on sessions (location_id, started_at desc);
create index on sessions (ghl_user_id, started_at desc);
create index on sessions (started_at);

-- ----------------------------------------------------------------- metrics

create table metrics_daily (
  location_id uuid not null references locations(id) on delete cascade,
  date date not null,
  contacts_total int,
  contacts_new int,
  conversations_active int,
  msgs_in int,
  msgs_out int,
  msgs_by_channel jsonb,
  opps_open int,
  opps_created int,
  opps_moved int,                           -- stage/status changes (signal S5)
  opps_won int,
  opps_lost int,
  revenue_won numeric(12,2),
  revenue_coverage numeric(5,2),
  appointments int,
  workflows_active int,
  users_total int,
  users_active int,
  sessions int,
  active_s int,
  updated_at timestamptz not null default now(),
  primary key (location_id, date)
);
create index on metrics_daily (date);

create table health_scores (
  location_id uuid not null references locations(id) on delete cascade,
  date date not null,
  score int not null,
  raw_tier text not null check (raw_tier in ('onboarding','healthy','at_risk','critical')),
  tier text not null check (tier in ('onboarding','healthy','at_risk','critical')),
  drivers jsonb not null default '[]'::jsonb,  -- [{signal, weight, value, baseline, points, label}]
  delta_7d int,
  primary key (location_id, date)
);
create index on health_scores (date, tier);

create table tier_changes (
  id bigserial primary key,
  location_id uuid not null references locations(id) on delete cascade,
  from_tier text,
  to_tier text not null,
  score int,
  changed_at timestamptz not null default now()
);
create index on tier_changes (location_id, changed_at desc);

-- ------------------------------------------------------------------ alerts

create table alert_rules (
  id uuid primary key default gen_random_uuid(),
  agency_id uuid not null references agencies(id) on delete cascade,
  type text not null check (type in
    ('entered_critical','no_login','messages_drop','new_country_login','payment_failed','weekly_digest')),
  params jsonb not null default '{}'::jsonb,
  channels jsonb not null default '[]'::jsonb, -- [{kind:'email'|'webhook', to?, url?}]
  enabled boolean not null default true,
  created_at timestamptz not null default now()
);
create index on alert_rules (agency_id);

create table alerts (
  id uuid primary key default gen_random_uuid(),
  rule_id uuid references alert_rules(id) on delete set null,
  location_id uuid references locations(id) on delete cascade,
  fired_at timestamptz not null default now(),
  payload jsonb not null default '{}'::jsonb,
  delivery_status text not null default 'pending'
    check (delivery_status in ('pending','sent','failed')),
  acknowledged_by uuid references agency_users(id) on delete set null,
  acknowledged_at timestamptz
);
create index on alerts (location_id, fired_at desc);
-- cooldown lookup: last fire per rule+location (RF-08.3)
create index on alerts (rule_id, location_id, fired_at desc);

-- -------------------------------------------------------------------- raw

create table events_raw (
  id bigserial primary key,
  agency_id uuid references agencies(id) on delete cascade,
  location_id uuid references locations(id) on delete cascade,
  source text not null check (source in ('webhook','script')),
  type text,
  payload jsonb not null,
  received_at timestamptz not null default now()
);
create index on events_raw (received_at);
create index on events_raw (location_id, type, received_at desc);

create table location_notes (
  id uuid primary key default gen_random_uuid(),
  location_id uuid not null references locations(id) on delete cascade,
  author_id uuid references agency_users(id) on delete set null,
  body text not null,
  created_at timestamptz not null default now()
);
create index on location_notes (location_id, created_at desc);

create table timeline_events (
  id bigserial primary key,
  location_id uuid not null references locations(id) on delete cascade,
  type text not null,
  title text not null,
  meta jsonb not null default '{}'::jsonb,
  at timestamptz not null default now()
);
create index on timeline_events (location_id, at desc);

create table audit_log (
  id bigserial primary key,
  agency_user_id uuid references agency_users(id) on delete set null,
  action text not null,
  location_id uuid references locations(id) on delete cascade,
  meta jsonb not null default '{}'::jsonb,
  at timestamptz not null default now()
);
create index on audit_log (agency_user_id, at desc);
create index on audit_log (at);
