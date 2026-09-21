-- Two agencies, so cross-tenant leakage has something to leak to.

insert into agencies (id, ghl_company_id, name, hmac_secret) values
  ('11111111-1111-1111-1111-111111111111', 'company-a', 'Magnetic Funnels', 'secret-a'),
  ('22222222-2222-2222-2222-222222222222', 'company-b', 'Outra Agência',    'secret-b');

insert into agency_users (id, agency_id, auth_user_id, email, name, role) values
  ('aaaaaaa1-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111',
   'f0000000-0000-0000-0000-000000000001', 'owner@a.com',   'Owner A',   'owner'),
  ('aaaaaaa1-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111',
   'f0000000-0000-0000-0000-000000000002', 'admin@a.com',   'Admin A',   'admin'),
  ('aaaaaaa1-0000-0000-0000-000000000003', '11111111-1111-1111-1111-111111111111',
   'f0000000-0000-0000-0000-000000000003', 'manager@a.com', 'Gerente A', 'manager'),
  ('bbbbbbb2-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222',
   'f0000000-0000-0000-0000-000000000011', 'owner@b.com',   'Owner B',   'owner');

insert into locations (id, agency_id, ghl_location_id, name, plan_name, plan_value, manager_id, first_data_at) values
  ('10000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111',
   'loc-a1', 'TDA Corretora', 'Pro', 997, 'aaaaaaa1-0000-0000-0000-000000000003', now() - interval '60 days'),
  ('10000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111',
   'loc-a2', 'Clínica Bem Viver', 'Pro', 497, null, now() - interval '60 days'),
  ('20000000-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222',
   'loc-b1', 'Subconta da outra agência', 'Basic', 197, null, now() - interval '60 days');

-- The manager is assigned exactly one of agency A's two sub-accounts.
insert into user_location_access (agency_user_id, location_id) values
  ('aaaaaaa1-0000-0000-0000-000000000003', '10000000-0000-0000-0000-000000000001');

insert into ghl_users (id, location_id, ghl_user_id, name, email, role, last_seen_at, last_ip, last_city, last_country) values
  ('30000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001',
   'ghl-u1', 'Ana Souza', 'ana@tda.com', 'admin', now() - interval '2 days',
   '189.40.10.7', 'Porto Alegre', 'BR');

insert into sessions (id, location_id, ghl_user_id, started_at, ended_at, duration_s, active_s,
                      heartbeats, ip, city, region, country, device, pages, end_reason, counted)
values
  ('40000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001',
   '30000000-0000-0000-0000-000000000001', now() - interval '2 days',
   now() - interval '2 days' + interval '20 minutes', 1200, 600, 20,
   '189.40.10.7', 'Porto Alegre', 'RS', 'BR', 'desktop',
   '[{"path":"/conversations","seconds":600}]'::jsonb, 'hidden', true),
  -- A heartbeat-only session: recorded, but counted = false so it never reaches a panel.
  ('40000000-0000-0000-0000-000000000002', '10000000-0000-0000-0000-000000000001',
   '30000000-0000-0000-0000-000000000001', now() - interval '1 day',
   now() - interval '1 day' + interval '3 minutes', 180, 30, 1,
   '189.40.10.7', 'Porto Alegre', 'RS', 'BR', 'desktop', '[]'::jsonb, 'stale', false);

insert into metrics_daily (location_id, date, contacts_total, contacts_new, msgs_in, msgs_out,
                           opps_open, revenue_won, revenue_coverage, sessions, active_s, users_total)
values
  ('10000000-0000-0000-0000-000000000001', current_date, 1200, 4, 30, 44, 12, 15000, 82.5, 1, 600, 3),
  ('10000000-0000-0000-0000-000000000002', current_date, 300,  0,  1,  0,  2,     0,  0.0, 0,   0, 2);

insert into health_scores (location_id, date, score, raw_tier, tier, drivers, delta_7d) values
  ('10000000-0000-0000-0000-000000000001', current_date, 82, 'healthy', 'healthy', '[]'::jsonb, 3),
  ('10000000-0000-0000-0000-000000000002', current_date, 31, 'critical', 'critical',
   '[{"signal":"S1","label":"Sem login há 12 dias","points":25}]'::jsonb, -18),
  ('20000000-0000-0000-0000-000000000001', current_date, 90, 'healthy', 'healthy', '[]'::jsonb, 0);

insert into location_notes (location_id, author_id, body) values
  ('10000000-0000-0000-0000-000000000001', 'aaaaaaa1-0000-0000-0000-000000000001',
   'Renovação em novembro, cliente pediu treinamento.');
