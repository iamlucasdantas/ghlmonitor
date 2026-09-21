import { toDay } from '@pulse/core';
import { locationByGhlId, query, recordRawEvent } from '@pulse/db';
import { log } from '../log.js';

export interface WebhookJob {
  agencyId: string | null;
  ghlCompanyId: string | null;
  ghlLocationId: string | null;
  type: string;
  body: Record<string, unknown>;
}

/** Column deltas each webhook applies to metrics_daily (RF-03.1). */
const DELTAS: Record<string, { column: string; amount: number }> = {
  ContactCreate: { column: 'contacts_new', amount: 1 },
  InboundMessage: { column: 'msgs_in', amount: 1 },
  OutboundMessage: { column: 'msgs_out', amount: 1 },
  OpportunityCreate: { column: 'opps_created', amount: 1 },
  OpportunityStageUpdate: { column: 'opps_moved', amount: 1 },
  AppointmentCreate: { column: 'appointments', amount: 1 },
};

/**
 * Webhooks keep the dashboard live; the nightly sync is what keeps it *correct*
 * (§15). So this applies optimistic deltas and never blocks on being sure — a
 * duplicate or dropped webhook is reconciled within 24 h.
 */
export async function processWebhook(job: WebhookJob): Promise<void> {
  if (!job.agencyId || !job.ghlLocationId) {
    log.warn('webhook without tenant', { type: job.type });
    return;
  }
  const location = await locationByGhlId(job.agencyId, job.ghlLocationId);
  if (!location) {
    log.warn('webhook for unknown location', { type: job.type, ghlLocationId: job.ghlLocationId });
    return;
  }

  await recordRawEvent({
    agencyId: job.agencyId, locationId: location.id,
    source: 'webhook', type: job.type, payload: job.body,
  });

  const today = toDay(new Date());

  const delta = DELTAS[job.type];
  if (delta) {
    await bump(location.id, today, delta.column, delta.amount);
  }

  switch (job.type) {
    case 'ContactDelete':
      await bump(location.id, today, 'contacts_total', -1);
      break;

    case 'OpportunityStatusUpdate': {
      await bump(location.id, today, 'opps_moved', 1);
      const status = String(job.body['status'] ?? '').toLowerCase();
      if (status === 'won') {
        const value = Number(job.body['monetaryValue'] ?? 0);
        await bump(location.id, today, 'opps_won', 1);
        if (value > 0) await bump(location.id, today, 'revenue_won', value);
      } else if (status === 'lost') {
        await bump(location.id, today, 'opps_lost', 1);
      }
      break;
    }

    case 'OpportunityMonetaryValueUpdate':
      await bump(location.id, today, 'opps_moved', 1);
      break;

    case 'UserCreate': {
      const userId = str(job.body, ['id', 'userId']);
      if (userId) {
        await query(
          `insert into ghl_users (location_id, ghl_user_id, name, email, role, pending)
           values ($1, $2, $3, $4, $5, false)
           on conflict (location_id, ghl_user_id) do update
             set name = coalesce(excluded.name, ghl_users.name),
                 email = coalesce(excluded.email, ghl_users.email),
                 pending = false`,
          [location.id, userId, str(job.body, ['name']), str(job.body, ['email']),
           str(job.body, ['role', 'type'])],
        );
        await query(
          `insert into timeline_events (location_id, type, title, meta)
           values ($1, 'user_created', $2, $3)`,
          [location.id, `Novo usuário: ${str(job.body, ['name', 'email']) ?? userId}`,
           JSON.stringify({ userId })],
        );
      }
      break;
    }

    case 'LocationUpdate':
      await query(`update locations set name = coalesce($2, name) where id = $1`, [
        location.id, str(job.body, ['name']),
      ]);
      break;

    default:
      break;
  }
}

/**
 * One statement per delta so concurrent webhooks for the same sub-account don't lose
 * each other's increments — the `+` happens inside Postgres, not in this process.
 */
async function bump(locationId: string, day: string, column: string, amount: number): Promise<void> {
  if (!/^[a-z_]+$/.test(column)) throw new Error(`refusing to bump column ${column}`);
  await query(
    `insert into metrics_daily (location_id, date, ${column}, updated_at)
     values ($1, $2::date, $3, now())
     on conflict (location_id, date) do update
       set ${column} = coalesce(metrics_daily.${column}, 0) + $3,
           updated_at = now()`,
    [locationId, day, amount],
  );
}

function str(body: Record<string, unknown>, keys: string[]): string | null {
  for (const k of keys) {
    const v = body[k];
    if (typeof v === 'string' && v.length > 0) return v;
  }
  return null;
}
