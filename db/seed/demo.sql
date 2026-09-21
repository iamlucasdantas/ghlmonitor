-- Pulse — dados de demonstração
--
-- Popula uma agência fictícia com 18 subcontas cujos perfis exercitam cada regra do
-- §9: queda real, automação pura, subconta nova, sinal sem baseline, conta morta.
--
-- Só grava dados *brutos* — métricas diárias, usuários e sessões. Os scores NÃO são
-- escritos aqui: quem os calcula é o motor de verdade, via `pulse backfill`. Um seed
-- que escrevesse os tiers à mão demonstraria o seed, não o produto.
--
-- Idempotente: apaga e recria a agência de demonstração a cada execução.

-- SQL puro, sem meta-comandos do psql: este arquivo também é aplicado pela CLI do
-- Supabase (supabase db reset), que não interpreta \set nem \echo.
begin;

delete from agencies where id = '0de3a8b2-1c4d-4f6e-8a90-000000000001'::uuid;

insert into agencies (id, ghl_company_id, name, timezone, hmac_secret, install_status,
                      last_script_event_at, last_sync_at, last_sync_status)
values ('0de3a8b2-1c4d-4f6e-8a90-000000000001'::uuid, 'demo-company', 'Magnetic Funnels (demo)', 'America/Sao_Paulo',
        'demo-ingest-token-nao-use-em-producao', 'active',
        now() - interval '3 minutes', now() - interval '6 hours', 'ok');

select seed_default_alert_rules('0de3a8b2-1c4d-4f6e-8a90-000000000001'::uuid);

-- ------------------------------------------------------------------ equipe

insert into agency_users (id, agency_id, auth_user_id, email, name, role, accepted_at) values
  ('0de3a8b2-0000-4000-8000-000000000001', '0de3a8b2-1c4d-4f6e-8a90-000000000001'::uuid, null,
   'owner@demo.pulse', 'Lucas (owner)', 'owner', now()),
  ('0de3a8b2-0000-4000-8000-000000000002', '0de3a8b2-1c4d-4f6e-8a90-000000000001'::uuid, null,
   'admin@demo.pulse', 'Camila (admin)', 'admin', now()),
  ('0de3a8b2-0000-4000-8000-000000000003', '0de3a8b2-1c4d-4f6e-8a90-000000000001'::uuid, null,
   'gerente@demo.pulse', 'Rafael (gerente)', 'manager', now());

-- O admin fica sem faturamento, para dar o que ver no toggle de permissão (RF-07.3).
insert into user_permissions (agency_user_id, resource, allowed) values
  ('0de3a8b2-0000-4000-8000-000000000002', 'billing', false);

-- --------------------------------------------------------------- perfis

create temporary table demo_profile (
  slug            text primary key,
  name            text,
  niche           text,
  plan_name       text,
  plan_value      numeric,
  -- volume típico por dia, antes da janela recente
  base_contacts   numeric,
  base_msgs_out   numeric,
  base_opps       numeric,
  base_active_s   numeric,
  appointments    numeric,
  workflows       int,
  -- multiplicador aplicado aos últimos 7 dias
  recent_factor   numeric,
  days_since_login int,     -- último acesso do usuário mais recente; null = nunca logou
  login_gap_days  int,      -- espaçamento até o acesso do usuário seguinte
  users_total     int,
  age_days        int       -- há quanto tempo a subconta manda dados
) on commit drop;

-- `login_gap_days` é o que faz S6 (usuários ativos / cadastrados) variar: quanto maior
-- o espaçamento, menos usuários caem dentro da janela de 30 dias. A proporção não é
-- declarada em lugar nenhum — ela cai da data de acesso de cada usuário, como na vida real.
insert into demo_profile values
  -- estáveis
  ('boa-1','TDA Corretora','seguros','Pro',997,       6,42,3,4200,1,4, 1.0,  0, 2, 5,120),
  ('boa-2','Clínica Bem Viver','saúde','Pro',997,     4,30,2,3000,2,3, 1.0,  1, 2, 4,120),
  ('boa-3','Studio Alta Performance','fitness','Start',497, 3,18,1,2400,1,2, 1.0, 2, 3, 3,120),
  ('boa-4','Imobiliária Norte','imóveis','Pro',997,   8,55,4,5400,2,6, 1.0,  0, 2, 6,120),
  ('boa-5','Odonto Sorriso','saúde','Start',497,      3,22,2,1800,3,2, 1.0,  1, 3, 3,120),
  -- crescendo
  ('cresce-1','Advocacia Ramos','jurídico','Pro',997, 2,14,1,1500,1,2, 2.4,  0, 2, 4,120),
  ('cresce-2','Pet Care Zona Sul','pet','Start',497,  2,10,1,1200,2,1, 1.9,  1, 2, 2,120),
  -- queda suave. cai-1 cruza o limiar só hoje, de propósito: serve para ver a regra
  -- de confirmação de 2 dias (RF-04.3) segurando o tier em healthy com score 55.
  ('cai-1','Autoescola Direção','educação','Start',497, 5,26,2,2700,1,2, 0.45, 6, 9, 4,120),
  ('cai-2','Buffet Encanto','eventos','Pro',997,        4,20,2,2100,1,3, 0.40, 5,14, 3,120),
  ('cai-3','Curso Aprova','educação','Pro',997,         7,38,3,3600,0,4, 0.50, 8,11, 5,120),
  -- queda forte
  ('cai-forte-1','Loja do Construtor','varejo','Start',497, 5,28,2,2400,1,1, 0.03, 16,20, 4,120),
  ('cai-forte-2','Viagens Horizonte','turismo','Pro',997,   6,34,3,3000,1,2, 0.00, 22,20, 5,120),
  -- automação pura: manda muita mensagem, quase ninguém abre a tela (§9 exceção)
  ('auto-1','Franquia Sabor Caseiro','alimentação','Pro',997, 4,60,2,60,4,6, 1.0, 26,30, 3,120),
  ('auto-2','Rede Bem Estar','saúde','Pro',997,               3,48,2,45,3,5, 1.0, 31,30, 2,120),
  -- subconta nova: menos de 14 dias de dados, nunca pode virar risco (RF-04.4)
  ('nova-1','Barbearia Corte Fino','beleza','Start',497, 2,8,1,900,1,1, 1.0, 0, 2, 2,6),
  ('nova-2','Mecânica Turbo','automotivo','Start',497,   1,5,0,600,0,1, 1.0, 1, 2, 2,4),
  -- cadastrada, nunca acessada
  ('morta-1','Consultoria Vértice','consultoria','Start',497, 0,0,0,0,0,0, 1.0, null, 0, 2,120),
  -- nunca usou o funil: S5 não tem baseline e sai da conta
  ('sem-opp-1','Gráfica Impacto','gráfica','Start',497, 4,24,0,2100,0,2, 1.0, 2, 3, 3,120);

-- ------------------------------------------------------------- subcontas

insert into locations (agency_id, ghl_location_id, name, niche, plan_name, plan_value,
                       manager_id, installed_at, first_data_at)
select '0de3a8b2-1c4d-4f6e-8a90-000000000001'::uuid, 'demo-' || p.slug, p.name, p.niche, p.plan_name, p.plan_value,
       -- metade das subcontas fica com o gerente, para o filtro ter o que filtrar
       case when row_number() over (order by p.slug) % 2 = 0
            then '0de3a8b2-0000-4000-8000-000000000003'::uuid end,
       now() - (p.age_days || ' days')::interval,
       now() - (p.age_days || ' days')::interval
  from demo_profile p;

-- Ser o gerente responsável (locations.manager_id) e ter permissão de ver
-- (user_location_access) são coisas diferentes de propósito: a primeira é para quem
-- o alerta vai, a segunda é o que a RLS consulta. O seed precisa das duas, senão o
-- gerente entra no painel e não enxerga nada.
insert into user_location_access (agency_user_id, location_id)
select l.manager_id, l.id from locations l
 where l.agency_id = '0de3a8b2-1c4d-4f6e-8a90-000000000001'::uuid and l.manager_id is not null;

-- -------------------------------------------------------------- usuários

insert into ghl_users (location_id, ghl_user_id, name, email, role, pending,
                       last_seen_at, last_ip, last_city, last_region, last_country, last_page)
select l.id,
       'demo-' || p.slug || '-u' || g,
       (array['Ana Souza','Bruno Lima','Carla Dias','Diego Prado','Elisa Moraes','Felipe Ramos'])[g],
       'u' || g || '.' || p.slug || '@demo.pulse',
       case when g = 1 then 'admin' else 'user' end,
       false,
       -- o primeiro usuário define o "último login" da subconta (o score usa o máximo);
       -- os seguintes ficam progressivamente mais para trás, por login_gap_days.
       case when p.days_since_login is null then null
            else now() - ((p.days_since_login + (g - 1) * p.login_gap_days) || ' days')::interval
       end,
       ('189.40.' || (10 + g) || '.' || (20 + g))::inet,
       (array['Porto Alegre','São Paulo','Belo Horizonte','Curitiba','Recife','Fortaleza'])[g],
       (array['RS','SP','MG','PR','PE','CE'])[g],
       'BR',
       (array['/conversations','/dashboard','/contacts','/opportunities','/automation','/calendars'])[g]
  from locations l
  join demo_profile p on p.slug = replace(l.ghl_location_id, 'demo-', '')
 cross join generate_series(1, 6) g
 where g <= p.users_total;

-- ------------------------------------------------------- métricas diárias

insert into metrics_daily (
  location_id, date, contacts_total, contacts_new, conversations_active,
  msgs_in, msgs_out, msgs_by_channel, opps_open, opps_created, opps_moved,
  opps_won, opps_lost, revenue_won, revenue_coverage, appointments,
  workflows_active, users_total, users_active, sessions, active_s)
select
  l.id,
  d::date,
  -- total de contatos cresce ao longo do tempo
  (500 + p.base_contacts * (p.age_days - (current_date - d::date)))::int,
  greatest(0, round(p.base_contacts * f.factor * j.jitter))::int,
  greatest(0, round(p.base_msgs_out * f.factor * j.jitter / 4))::int,
  greatest(0, round(p.base_msgs_out * f.factor * j.jitter * 0.6))::int,
  greatest(0, round(p.base_msgs_out * f.factor * j.jitter))::int,
  case when p.base_msgs_out = 0 then '{}'::jsonb else jsonb_build_object(
    'sms',      greatest(0, round(p.base_msgs_out * f.factor * j.jitter * 0.45))::int,
    'email',    greatest(0, round(p.base_msgs_out * f.factor * j.jitter * 0.30))::int,
    'whatsapp', greatest(0, round(p.base_msgs_out * f.factor * j.jitter * 0.20))::int,
    'call',     greatest(0, round(p.base_msgs_out * f.factor * j.jitter * 0.05))::int) end,
  greatest(0, round(p.base_opps * 6 * j.jitter))::int,
  greatest(0, round(p.base_opps * f.factor * j.jitter))::int,
  greatest(0, round(p.base_opps * f.factor * j.jitter * 1.3))::int,
  greatest(0, round(p.base_opps * f.factor * j.jitter * 0.35))::int,
  greatest(0, round(p.base_opps * f.factor * j.jitter * 0.25))::int,
  greatest(0, round(p.base_opps * f.factor * j.jitter * 0.35) * 1800)::numeric,
  case when p.base_opps = 0 then 0 else 60 + (abs(hashtext(l.ghl_location_id)) % 35) end,
  greatest(0, round(p.appointments * f.factor * j.jitter))::int,
  p.workflows,
  p.users_total,
  active.n,
  greatest(0, round(active.n * f.factor * j.jitter))::int,
  greatest(0, round(p.base_active_s * f.factor * j.jitter))::int
from locations l
join demo_profile p on p.slug = replace(l.ghl_location_id, 'demo-', '')
cross join lateral generate_series(
  current_date - least(p.age_days, 44), current_date, interval '1 day') d
cross join lateral (select case
  when d::date > current_date - 7 then p.recent_factor else 1.0 end as factor) f
-- variação determinística de ±12%, para o gráfico não parecer uma régua
cross join lateral (select
  1 + ((abs(hashtext(l.ghl_location_id || d::text)) % 25) - 12) / 100.0 as jitter) j
cross join lateral (select count(*)::int as n from ghl_users u
   where u.location_id = l.id and u.last_seen_at >= now() - interval '30 days') active;

-- -------------------------------------------------------------- sessões
-- Uma sessão contabilizada por dia de acesso, para as abas de Sessões e Usuários
-- terem conteúdo. O gerador respeita a regra: 2+ heartbeats, senão counted = false.

insert into sessions (id, location_id, ghl_user_id, started_at, ended_at, duration_s,
                      active_s, heartbeats, ip, city, region, country, user_agent,
                      device, pages, end_reason, counted)
select
  gen_random_uuid(),
  u.location_id,
  u.id,
  ts,
  ts + (beats * 30 + 120 || ' seconds')::interval,
  beats * 30 + 120,
  beats * 30,
  beats,
  u.last_ip, u.last_city, u.last_region, u.last_country,
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
  case when n % 5 = 0 then 'mobile' else 'desktop' end,
  jsonb_build_array(
    jsonb_build_object('path', u.last_page, 'seconds', (beats * 30 * 0.7)::int),
    jsonb_build_object('path', '/dashboard', 'seconds', (beats * 30 * 0.3)::int)),
  case when n % 7 = 0 then 'beforeunload' else 'hidden' end,
  beats >= 2
from ghl_users u
cross join lateral generate_series(0, 11) n
cross join lateral (
  select u.last_seen_at - (n * 2 || ' days')::interval as ts) t
cross join lateral (
  -- de vez em quando uma aba aberta sem interação: 1 heartbeat, não conta
  select case when n % 6 = 0 then 1
              else 4 + (abs(hashtext(u.ghl_user_id || n::text)) % 40) end as beats) b
where u.last_seen_at is not null
  and u.last_seen_at - (n * 2 || ' days')::interval > now() - interval '30 days';

commit;
