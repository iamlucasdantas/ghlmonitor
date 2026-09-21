-- Pulse 0005 — default alert rules created at onboarding (PRD §11)

create or replace function seed_default_alert_rules(p_agency uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  insert into alert_rules (agency_id, type, params, channels) values
    (p_agency, 'entered_critical', '{}'::jsonb,                   '[{"kind":"email","to":"manager"}]'::jsonb),
    (p_agency, 'no_login',         '{"days":7}'::jsonb,           '[{"kind":"email","to":"manager"}]'::jsonb),
    (p_agency, 'messages_drop',    '{"drop_pct":50}'::jsonb,      '[{"kind":"email","to":"manager"}]'::jsonb),
    (p_agency, 'weekly_digest',    '{"dow":1,"hour":8}'::jsonb,   '[{"kind":"email","to":"owner"}]'::jsonb)
  on conflict do nothing;
end $$;
