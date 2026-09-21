import {
  addDays, computeScore, confirmTier, toDay,
  type DailyMetrics, type Tier,
} from '@pulse/core';
import { addTimelineEvent, query, saveHealthScore, one } from '@pulse/db';
import { log } from '../log.js';

export interface ScoreJob { agencyId: string; date?: string }

/**
 * Daily score for every sub-account of one agency (RF-04.1), run at 03:00 after the
 * 02:00 sync. Everything it needs comes out of metrics_daily and ghl_users — the
 * sessions table is never touched here, which is what keeps the 500-sub-account case
 * inside its time budget (§12).
 */
export async function scoreAgency(job: ScoreJob): Promise<void> {
  const date = job.date ?? toDay(new Date());
  const from = addDays(date, -36);

  const locations = await query<{
    id: string; name: string | null; first_data_at: Date | null; saas_status: string | null;
  }>(
    `select id, name, first_data_at, saas_status
       from locations where agency_id = $1 and status = 'active'`,
    [job.agencyId],
  );

  for (const loc of locations) {
    try {
      await scoreLocation(loc, date, from);
    } catch (err) {
      log.error('score failed', { locationId: loc.id, err: (err as Error).message });
    }
  }
  log.info('agency scored', { agencyId: job.agencyId, locations: locations.length, date });
}

async function scoreLocation(
  loc: { id: string; name: string | null; first_data_at: Date | null; saas_status: string | null },
  date: string,
  from: string,
): Promise<void> {
  const metrics = await query<{
    date: string; contacts_new: number | null; msgs_out: number | null;
    opps_created: number | null; opps_moved: number | null; appointments: number | null;
    workflows_active: number | null; active_s: number | null;
    users_total: number | null; users_active: number | null;
  }>(
    `select to_char(date, 'YYYY-MM-DD') as date, contacts_new, msgs_out, opps_created,
            opps_moved, appointments, workflows_active, active_s, users_total, users_active
       from metrics_daily
      where location_id = $1 and date between $2::date and $3::date
      order by date asc`,
    [loc.id, from, date],
  );

  const rows: DailyMetrics[] = metrics.map((m) => ({
    date: m.date,
    contactsNew: m.contacts_new ?? 0,
    msgsOut: m.msgs_out ?? 0,
    oppsCreated: m.opps_created ?? 0,
    oppsMoved: m.opps_moved ?? 0,
    appointments: m.appointments ?? 0,
    workflowsActive: m.workflows_active ?? 0,
    activeS: m.active_s ?? 0,
    usersTotal: m.users_total ?? 0,
    usersActive: m.users_active ?? 0,
  }));

  const usage = await one<{ last_login: Date | null; users_total: number; users_active_30d: number }>(
    `select max(u.last_seen_at)                                            as last_login,
            count(*)                                                       as users_total,
            count(*) filter (where u.last_seen_at >= now() - interval '30 days') as users_active_30d
       from ghl_users u
      where u.location_id = $1 and not u.pending`,
    [loc.id],
  );

  const result = computeScore({
    date,
    metrics: rows,
    lastLoginAt: usage?.last_login ?? null,
    firstDataAt: loc.first_data_at,
    usersTotal: Number(usage?.users_total ?? 0),
    usersActive30d: Number(usage?.users_active_30d ?? 0),
    saasStatus: (loc.saas_status as 'ok' | 'failed' | 'cancelled' | null) ?? null,
  });

  // RF-04.3: confirm the tier against yesterday's raw tier before moving.
  const history = await query<{ tier: Tier; raw_tier: Tier; score: number; date: string }>(
    `select tier, raw_tier, score, to_char(date,'YYYY-MM-DD') as date
       from health_scores where location_id = $1 and date < $2::date
      order by date desc limit 7`,
    [loc.id, date],
  );
  const currentTier = history[0]?.tier ?? null;
  const rawStreak: Tier[] = [result.rawTier, ...history.map((h) => h.raw_tier)];
  const tier = confirmTier(currentTier, rawStreak);

  const weekAgo = history.find((h) => h.date === addDays(date, -7));
  const delta7d = weekAgo ? result.score - weekAgo.score : null;

  await saveHealthScore({
    locationId: loc.id, date, score: result.score,
    rawTier: result.rawTier, tier, drivers: result.drivers, delta7d,
  });

  if (currentTier && tier !== currentTier) {
    await query(
      `insert into tier_changes (location_id, from_tier, to_tier, score)
       values ($1, $2, $3, $4)`,
      [loc.id, currentTier, tier, result.score],
    );
    await addTimelineEvent({
      locationId: loc.id,
      type: 'tier_changed',
      title: `Tier mudou de ${label(currentTier)} para ${label(tier)}`,
      meta: { from: currentTier, to: tier, score: result.score, drivers: result.drivers },
    });
  }
}

function label(t: Tier): string {
  return { onboarding: 'Onboarding', healthy: 'Saudável', at_risk: 'Em risco', critical: 'Crítico' }[t];
}
