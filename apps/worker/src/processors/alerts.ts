import { toDay, type Tier } from '@pulse/core';
import { one, query } from '@pulse/db';
import { env } from '../env.js';
import { log } from '../log.js';
import { sendEmail } from '../mailer.js';

export interface AlertJob { agencyId: string; date?: string }

/** RF-08.3 — one alert per rule + sub-account per 72 h. */
const COOLDOWN_HOURS = 72;

interface RuleRow {
  id: string;
  agency_id: string;
  type: string;
  params: Record<string, unknown>;
  channels: { kind: string; to?: string; url?: string }[];
}

interface Candidate {
  locationId: string;
  ghlLocationId: string;
  name: string;
  tier: Tier;
  fromTier: Tier | null;
  score: number;
  drivers: { label: string }[];
  managerName: string | null;
  managerEmail: string | null;
  ownerEmail: string | null;
  daysSinceLogin: number | null;
}

export async function dispatchAlerts(job: AlertJob): Promise<void> {
  const date = job.date ?? toDay(new Date());
  const rules = await query<RuleRow>(
    `select id, agency_id, type, params, channels
       from alert_rules where agency_id = $1 and enabled`,
    [job.agencyId],
  );

  for (const rule of rules) {
    if (rule.type === 'weekly_digest') continue; // handled by its own cron
    try {
      const candidates = await candidatesFor(rule, date);
      for (const c of candidates) {
        if (await onCooldown(rule.id, c.locationId)) continue;
        await fire(rule, c);
      }
    } catch (err) {
      log.error('alert rule failed', { ruleId: rule.id, err: (err as Error).message });
    }
  }
}

async function candidatesFor(rule: RuleRow, date: string): Promise<Candidate[]> {
  switch (rule.type) {
    case 'entered_critical':
      return baseQuery(
        rule.agency_id,
        `and tc.to_tier = 'critical' and tc.changed_at >= now() - interval '24 hours'`,
        date,
      );

    case 'no_login': {
      const days = Number(rule.params['days'] ?? 7);
      return baseQuery(
        rule.agency_id,
        `and (lastseen.last_seen_at is null
              or lastseen.last_seen_at < now() - ($2 || ' days')::interval)`,
        date,
        [String(days)],
      );
    }

    case 'messages_drop': {
      const dropPct = Number(rule.params['drop_pct'] ?? 50);
      return baseQuery(
        rule.agency_id,
        `and exists (
           select 1 from health_scores h
            where h.location_id = l.id and h.date = $1::date
              and h.drivers @> '[{"signal":"S3"}]'::jsonb
         )
         and coalesce(msgs.recent, 0) < coalesce(msgs.baseline, 0) * (1 - $2::numeric / 100)`,
        date,
        [String(dropPct)],
      );
    }

    case 'new_country_login':
      return baseQuery(
        rule.agency_id,
        `and exists (
           select 1 from sessions s
            where s.location_id = l.id and s.counted
              and s.started_at >= now() - interval '24 hours'
              and s.country is not null
              and s.country not in (
                select distinct s2.country from sessions s2
                 where s2.location_id = l.id and s2.counted and s2.country is not null
                   and s2.started_at < now() - interval '24 hours'
              )
         )`,
        date,
      );

    default:
      return [];
  }
}

/**
 * All rules select the same shape, so the per-rule SQL is only a predicate. The join
 * to the manager is what routes the alert (RF-08.4).
 */
async function baseQuery(
  agencyId: string,
  predicate: string,
  date: string,
  extraParams: string[] = [],
): Promise<Candidate[]> {
  const rows = await query<{
    location_id: string; ghl_location_id: string; name: string | null;
    tier: Tier; from_tier: Tier | null; score: number; drivers: { label: string }[];
    manager_name: string | null; manager_email: string | null; owner_email: string | null;
    days_since_login: number | null;
  }>(
    `select l.id as location_id, l.ghl_location_id, l.name,
            hs.tier, tc.from_tier, hs.score, hs.drivers,
            mu.name as manager_name, mu.email as manager_email,
            ow.email as owner_email,
            extract(day from now() - lastseen.last_seen_at)::int as days_since_login
       from locations l
       left join agency_users mu on mu.id = l.manager_id
       left join lateral (
         select email from agency_users
          where agency_id = l.agency_id and role = 'owner' order by created_at limit 1
       ) ow on true
       left join lateral (
         select tier, score, drivers from health_scores
          where location_id = l.id and date = $1::date limit 1
       ) hs on true
       left join lateral (
         select from_tier, to_tier, changed_at from tier_changes
          where location_id = l.id order by changed_at desc limit 1
       ) tc on true
       left join lateral (
         select max(last_seen_at) as last_seen_at from ghl_users where location_id = l.id
       ) lastseen on true
       left join lateral (
         select
           sum(msgs_out) filter (where date > current_date - 7)  as recent,
           sum(msgs_out) filter (where date <= current_date - 7) / 30.0 * 7 as baseline
           from metrics_daily where location_id = l.id and date > current_date - 37
       ) msgs on true
      where l.agency_id = $${extraParams.length + 2} and l.status = 'active'
        and hs.tier is not null
        ${predicate}`,
    [date, ...extraParams, agencyId],
  );

  return rows.map((r) => ({
    locationId: r.location_id,
    ghlLocationId: r.ghl_location_id,
    name: r.name ?? r.ghl_location_id,
    tier: r.tier,
    fromTier: r.from_tier,
    score: r.score,
    drivers: r.drivers ?? [],
    managerName: r.manager_name,
    managerEmail: r.manager_email,
    ownerEmail: r.owner_email,
    daysSinceLogin: r.days_since_login,
  }));
}

async function onCooldown(ruleId: string, locationId: string): Promise<boolean> {
  const row = await one<{ fired_at: Date }>(
    `select fired_at from alerts
      where rule_id = $1 and location_id = $2
        and fired_at > now() - ($3 || ' hours')::interval
      order by fired_at desc limit 1`,
    [ruleId, locationId, String(COOLDOWN_HOURS)],
  );
  return row !== null;
}

async function fire(rule: RuleRow, c: Candidate): Promise<void> {
  const payload = {
    event: rule.type === 'entered_critical' ? 'tier_changed' : rule.type,
    agency_id: rule.agency_id,
    location_id: c.locationId,
    ghl_location_id: c.ghlLocationId,
    location_name: c.name,
    from: c.fromTier,
    to: c.tier,
    score: c.score,
    drivers: c.drivers.map((d) => d.label),
    manager: c.managerEmail ? { name: c.managerName, email: c.managerEmail } : null,
    fired_at: new Date().toISOString(),
  };

  const alert = await one<{ id: string }>(
    `insert into alerts (rule_id, location_id, payload) values ($1, $2, $3) returning id`,
    [rule.id, c.locationId, JSON.stringify(payload)],
  );

  // RF-08.4: the assigned manager gets it; with no manager it falls back to the owner.
  const recipient = c.managerEmail ?? c.ownerEmail;
  let delivered = false;

  for (const channel of rule.channels ?? []) {
    if (channel.kind === 'email') {
      const to = channel.to === 'owner' ? (c.ownerEmail ?? recipient) : recipient;
      if (!to) continue;
      delivered = (await sendEmail(to, subjectFor(rule.type, c), emailBody(c, payload))) || delivered;
    } else if (channel.kind === 'webhook' && channel.url) {
      delivered = (await postWebhook(channel.url, payload)) || delivered;
    }
  }

  await query(`update alerts set delivery_status = $2 where id = $1`, [
    alert!.id, delivered ? 'sent' : 'failed',
  ]);
  log.info('alert fired', { rule: rule.type, locationId: c.locationId, delivered });
}

async function postWebhook(url: string, payload: unknown): Promise<boolean> {
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(10_000),
    });
    return res.ok;
  } catch (err) {
    log.error('alert webhook failed', { url, err: (err as Error).message });
    return false;
  }
}

function subjectFor(type: string, c: Candidate): string {
  switch (type) {
    case 'entered_critical': return `[Pulse] ${c.name} entrou em Crítico (score ${c.score})`;
    case 'no_login': return `[Pulse] ${c.name} sem login há ${c.daysSinceLogin ?? '?'} dias`;
    case 'messages_drop': return `[Pulse] Queda de mensagens em ${c.name}`;
    case 'new_country_login': return `[Pulse] Login de país novo em ${c.name}`;
    default: return `[Pulse] Alerta em ${c.name}`;
  }
}

function emailBody(c: Candidate, payload: { drivers: string[] }): string {
  const drivers = payload.drivers.map((d) => `<li>${escapeHtml(d)}</li>`).join('');
  return `
    <div style="font-family:system-ui,-apple-system,Segoe UI,sans-serif;max-width:560px">
      <h2 style="margin:0 0 4px">${escapeHtml(c.name)}</h2>
      <p style="margin:0 0 16px;color:#666">Score ${c.score} · ${escapeHtml(c.tier)}</p>
      ${drivers ? `<p style="margin:0 0 8px"><strong>Por quê:</strong></p><ul>${drivers}</ul>` : ''}
      <p><a href="${env.appUrl}/agency/locations/${c.locationId}"
            style="background:#2563eb;color:#fff;padding:10px 16px;border-radius:6px;
                   text-decoration:none;display:inline-block">Abrir no Pulse</a></p>
    </div>`;
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (ch) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch]!);
}
