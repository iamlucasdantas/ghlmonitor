-- Acceptance criteria §16, items 6 and 7, checked against the real policies.
-- Run with: scripts/test-db.sh

\set ON_ERROR_STOP on
\pset tuples_only on
\pset format unaligned

-- Helpers are created as the superuser; the assertions below run as `authenticated`,
-- which is the role Supabase gives a logged-in user.
create or replace function assert_eq(actual bigint, expected bigint, what text) returns void
language plpgsql as $$
begin
  if actual is distinct from expected then
    raise exception 'FAIL: % — esperado %, veio %', what, expected, actual;
  end if;
  raise notice 'ok: % (%)', what, actual;
end $$;

create or replace function assert_null(actual anyelement, what text) returns void
language plpgsql as $$
begin
  if actual is not null then
    raise exception 'FAIL: % — esperado null, veio %', what, actual;
  end if;
  raise notice 'ok: %', what;
end $$;

set role authenticated;

-- ------------------------------------------------------------------- owner
set "pulse.test_user" = 'f0000000-0000-0000-0000-000000000001';

select assert_eq((select count(*) from locations), 2,
  'owner enxerga as 2 subcontas da própria agência e nenhuma da outra');
select assert_eq((select count(*) from v_location_overview), 2,
  'owner na view de overview');
select assert_eq((select count(*) from sessions), 2,
  'owner enxerga as sessões da própria agência');
select assert_eq((select count(*) from location_notes), 1, 'owner lê notas');

-- Money and IP are visible to an owner with no permission row.
select assert_eq((select (plan_value)::bigint from v_location_overview
                   where location_id = '10000000-0000-0000-0000-000000000001'), 997,
  'owner vê plan_value');
select assert_eq((select (revenue_won)::bigint from v_metrics_daily
                   where location_id = '10000000-0000-0000-0000-000000000001'), 15000,
  'owner vê faturamento');

-- ----------------------------------------------------------------- manager
set "pulse.test_user" = 'f0000000-0000-0000-0000-000000000003';

-- §16.6: a manager cannot read a sub-account that was not assigned to them, even
-- going straight at the table rather than through the app.
select assert_eq((select count(*) from locations), 1,
  'manager só enxerga a subconta atribuída');
select assert_eq((select count(*) from locations
                   where id = '10000000-0000-0000-0000-000000000002'), 0,
  'manager NÃO lê a subconta não atribuída da própria agência');
select assert_eq((select count(*) from health_scores), 1,
  'scores herdam a política de location');
select assert_eq((select count(*) from metrics_daily), 1,
  'métricas herdam a política de location');
select assert_eq((select count(*) from sessions), 2,
  'manager lê as sessões da subconta que é dele');
select assert_eq((select count(*) from v_sessions), 1,
  'a view esconde a sessão não contabilizada (heartbeat solto)');

-- ------------------------------------------- §16.7: owner desliga billing
set role postgres;
insert into user_permissions (agency_user_id, resource, allowed)
values ('aaaaaaa1-0000-0000-0000-000000000002', 'billing', false);
insert into user_permissions (agency_user_id, resource, allowed)
values ('aaaaaaa1-0000-0000-0000-000000000002', 'sessions_ip', false);
set role authenticated;

set "pulse.test_user" = 'f0000000-0000-0000-0000-000000000002';
select assert_eq((select count(*) from locations), 2, 'admin enxerga tudo da agência');
select assert_null((select plan_value from v_location_overview
                     where location_id = '10000000-0000-0000-0000-000000000001'),
  'admin sem billing NÃO vê plan_value');
select assert_null((select revenue_won from v_metrics_daily
                     where location_id = '10000000-0000-0000-0000-000000000001'),
  'admin sem billing NÃO vê faturamento');
select assert_null((select ip from v_sessions
                     where id = '40000000-0000-0000-0000-000000000001'),
  'admin sem sessions_ip NÃO vê IP');
select assert_null((select city from v_sessions
                     where id = '40000000-0000-0000-0000-000000000001'),
  'admin sem sessions_ip NÃO vê cidade');
-- The rows themselves are still there; only the sensitive columns are withheld.
select assert_eq((select count(*) from v_sessions), 1,
  'admin ainda enxerga a sessão, só sem as colunas sensíveis');

-- -------------------------------------------------- outra agência (tenant)
set "pulse.test_user" = 'f0000000-0000-0000-0000-000000000011';
select assert_eq((select count(*) from locations), 1, 'owner B só enxerga a agência B');
select assert_eq((select count(*) from locations
                   where agency_id = '11111111-1111-1111-1111-111111111111'), 0,
  'owner B NÃO lê nada da agência A');
select assert_eq((select count(*) from sessions), 0, 'owner B não lê sessões da agência A');
select assert_eq((select count(*) from location_notes), 0, 'owner B não lê notas da agência A');

-- ------------------------------------------------------------ sem sessão
set "pulse.test_user" = '';
select assert_eq((select count(*) from locations), 0, 'sem login não lê nada');
select assert_eq((select count(*) from sessions), 0, 'sem login não lê sessões');
select assert_eq((select count(*) from health_scores), 0, 'sem login não lê scores');

-- ------------------------------------------------ snippet só para owner/admin
set "pulse.test_user" = 'f0000000-0000-0000-0000-000000000001';
select assert_eq((select length(ingest_token)::bigint from v_agency_setup), 8,
  'owner vê o token de ingestão no snippet');

set "pulse.test_user" = 'f0000000-0000-0000-0000-000000000003';
select assert_null((select ingest_token from v_agency_setup),
  'manager NÃO vê o token de ingestão');
select assert_eq((select count(*) from v_agency_setup), 1,
  'manager ainda vê o status da integração');

set role postgres;
\echo 'RLS: todos os casos passaram'
