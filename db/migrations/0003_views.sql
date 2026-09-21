-- Pulse 0003 — permission-gated views and pre-joined read models
-- security_invoker = true makes each view run under the caller's RLS (RF-07.4),
-- so a manager selecting straight from the view still only sees their locations.

-- Sensitive columns (§8): ip / city gated by 'sessions_ip', money by 'billing'.

create or replace view v_sessions with (security_invoker = true) as
select
  s.id, s.location_id, s.ghl_user_id, s.started_at, s.ended_at,
  s.duration_s, s.active_s, s.heartbeats, s.pages, s.device, s.user_agent,
  s.end_reason, s.counted,
  case when has_permission('sessions_ip') then s.ip end     as ip,
  case when has_permission('sessions_ip') then s.city end   as city,
  case when has_permission('sessions_ip') then s.region end as region,
  s.country
from sessions s
where s.counted;

create or replace view v_ghl_users with (security_invoker = true) as
select
  u.id, u.location_id, u.ghl_user_id, u.name, u.role, u.pending, u.last_seen_at, u.last_page,
  case when has_permission('users_detail') then u.email end    as email,
  case when has_permission('sessions_ip') then u.last_ip end   as last_ip,
  case when has_permission('sessions_ip') then u.last_city end as last_city,
  u.last_country
from ghl_users u;

create or replace view v_metrics_daily with (security_invoker = true) as
select
  m.location_id, m.date, m.contacts_total, m.contacts_new, m.conversations_active,
  m.msgs_in, m.msgs_out, m.msgs_by_channel,
  m.opps_open, m.opps_created, m.opps_moved, m.opps_won, m.opps_lost,
  m.appointments, m.workflows_active, m.users_total, m.users_active,
  m.sessions, m.active_s,
  case when has_permission('billing') then m.revenue_won end      as revenue_won,
  case when has_permission('billing') then m.revenue_coverage end as revenue_coverage
from metrics_daily m;

-- One row per sub-account with everything the agency table needs (RF-05.3).
-- Reads only pre-aggregated tables — never sessions — so 500 rows stay under 2s (§12).
create or replace view v_location_overview with (security_invoker = true) as
select
  l.id                as location_id,
  l.agency_id,
  l.ghl_location_id,
  l.name,
  l.niche,
  l.plan_name,
  case when has_permission('billing') then l.plan_value end as plan_value,
  l.installed_at,
  l.first_data_at,
  l.manager_id,
  mu.name             as manager_name,
  mu.email            as manager_email,
  hs.score,
  hs.tier,
  hs.drivers,
  hs.delta_7d,
  lastseen.last_seen_at,
  extract(day from now() - lastseen.last_seen_at)::int as days_since_login
from locations l
left join agency_users mu on mu.id = l.manager_id
left join lateral (
  select h.score, h.tier, h.drivers, h.delta_7d
  from health_scores h
  where h.location_id = l.id
  order by h.date desc
  limit 1
) hs on true
left join lateral (
  select max(u.last_seen_at) as last_seen_at
  from ghl_users u where u.location_id = l.id
) lastseen on true
where l.status = 'active';

-- Sparkline source: 30 days of active minutes + messages per location (RF-05.3).
create or replace view v_location_sparkline with (security_invoker = true) as
select location_id, date,
       coalesce(active_s,0) / 60 as active_min,
       coalesce(msgs_out,0)      as msgs_out
from metrics_daily
where date >= current_date - interval '30 days';

-- Agency header cards (RF-05.1).
create or replace view v_agency_summary with (security_invoker = true) as
select
  o.agency_id,
  count(*)                                              as locations_total,
  count(*) filter (where o.tier = 'healthy')            as healthy,
  count(*) filter (where o.tier = 'at_risk')            as at_risk,
  count(*) filter (where o.tier = 'critical')           as critical,
  count(*) filter (where o.tier = 'onboarding')         as onboarding,
  coalesce(sum(o.plan_value) filter (where o.tier in ('at_risk','critical')), 0) as mrr_at_risk
from v_location_overview o
group by o.agency_id;

-- "Mudou de tier esta semana" (RF-05.4).
create or replace view v_recent_tier_changes with (security_invoker = true) as
select tc.location_id, l.name, tc.from_tier, tc.to_tier, tc.score, tc.changed_at
from tier_changes tc
join locations l on l.id = tc.location_id
where tc.changed_at >= now() - interval '7 days'
order by tc.changed_at desc;
