import {
  buildSessions, sessionUuid, toDay, type ScriptEvent,
} from '@pulse/core';
import {
  locationByGhlId, query, recordRawEvent, touchAgencyScriptEvent, upsertGhlUser, tx,
} from '@pulse/db';
import { log } from '../log.js';

export interface ScriptBatchJob {
  agencyId: string;
  receivedAt: number;
  clientSentAt: number | null;
  signed: boolean;
  ip: string | null;
  geo: { city: string | null; region: string | null; country: string | null };
  userAgent: string | null;
  events: ScriptEvent[];
}

/**
 * Turns one batch of script events into sessions.
 *
 * Two things happen before anything is written: every locationId in the batch is
 * checked against the agency the key belongs to (RF-02.1), and client timestamps are
 * corrected against the server clock. A laptop with a wrong clock used to produce
 * sessions dated in 2035; here the client's own `sentAt` gives the offset.
 */
export async function processScriptBatch(job: ScriptBatchJob): Promise<void> {
  const skew = job.clientSentAt ? job.receivedAt - job.clientSentAt : 0;
  // Only correct for clocks that are meaningfully wrong — a few seconds is just latency.
  const correction = Math.abs(skew) > 120_000 ? skew : 0;

  const byLocation = new Map<string, ScriptEvent[]>();
  for (const e of job.events) {
    const fixed = correction ? { ...e, ts: e.ts + correction } : e;
    const list = byLocation.get(e.locationId);
    if (list) list.push(fixed);
    else byLocation.set(e.locationId, [fixed]);
  }

  for (const [ghlLocationId, events] of byLocation) {
    const location = await locationByGhlId(job.agencyId, ghlLocationId);
    if (!location) {
      // Not an error: a sub-account can start sending before the first sync imported it.
      log.warn('script events for unknown location', { agencyId: job.agencyId, ghlLocationId });
      await recordRawEvent({
        agencyId: job.agencyId, locationId: null, source: 'script',
        type: 'unknown_location', payload: { ghlLocationId, count: events.length },
      });
      continue;
    }

    await recordRawEvent({
      agencyId: job.agencyId, locationId: location.id, source: 'script',
      type: 'batch', payload: { events, ip: job.ip, signed: job.signed },
    });

    const sessions = buildSessions(events);
    for (const s of sessions) {
      const ghlUserRowId = await upsertGhlUser({
        locationId: location.id,
        ghlUserId: s.userId,
        name: firstValue(events, 'userName'),
        email: firstValue(events, 'userEmail'),
        role: firstValue(events, 'role'),
        pending: true,
      });

      await upsertSession({
        id: sessionUuid(ghlLocationId, s.sessionId),
        locationId: location.id,
        ghlUserRowId,
        session: s,
        ip: job.ip,
        geo: job.geo,
        userAgent: job.userAgent,
      });

      if (s.counted) {
        await query(
          `update ghl_users
              set last_seen_at = greatest(coalesce(last_seen_at, to_timestamp(0)), $2),
                  last_ip = coalesce($3::inet, last_ip),
                  last_city = coalesce($4, last_city),
                  last_region = coalesce($5, last_region),
                  last_country = coalesce($6, last_country),
                  last_page = coalesce($7, last_page)
            where id = $1`,
          [ghlUserRowId, s.endedAt, job.ip, job.geo.city, job.geo.region, job.geo.country,
           s.pages[0]?.path ?? null],
        );
      }
    }

    await rollUpSessionMetrics(location.id, sessions.map((s) => toDay(s.startedAt)));
    await query(
      `update locations set first_data_at = coalesce(first_data_at, now()) where id = $1`,
      [location.id],
    );
  }

  await touchAgencyScriptEvent(job.agencyId);
}

/**
 * Sessions arrive in pieces — a batch every 15 s while the tab is open — so each write
 * merges into the row rather than replacing it. Heartbeats and pages are taken as the
 * greatest seen, which keeps a retried batch from double-counting active time.
 */
async function upsertSession(input: {
  id: string;
  locationId: string;
  ghlUserRowId: string;
  session: ReturnType<typeof buildSessions>[number];
  ip: string | null;
  geo: { city: string | null; region: string | null; country: string | null };
  userAgent: string | null;
}): Promise<void> {
  const s = input.session;
  await query(
    `insert into sessions (
       id, location_id, ghl_user_id, started_at, ended_at, duration_s, active_s,
       heartbeats, ip, city, region, country, user_agent, device, pages, end_reason, counted)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9::inet,$10,$11,$12,$13,$14,$15,$16,$17)
     on conflict (id) do update set
       ended_at   = greatest(sessions.ended_at, excluded.ended_at),
       duration_s = greatest(sessions.duration_s, excluded.duration_s),
       active_s   = greatest(sessions.active_s, excluded.active_s),
       heartbeats = greatest(sessions.heartbeats, excluded.heartbeats),
       pages      = case when jsonb_array_length(coalesce(excluded.pages, '[]'::jsonb))
                            >= jsonb_array_length(coalesce(sessions.pages, '[]'::jsonb))
                         then excluded.pages else sessions.pages end,
       end_reason = coalesce(excluded.end_reason, sessions.end_reason),
       counted    = sessions.counted or excluded.counted,
       updated_at = now()`,
    [
      input.id, input.locationId, input.ghlUserRowId, s.startedAt, s.endedAt,
      s.durationS, s.activeS, s.heartbeats, input.ip, input.geo.city, input.geo.region,
      input.geo.country, input.userAgent, deviceFrom(input.userAgent),
      JSON.stringify(s.pages), s.endReason, s.counted,
    ],
  );
}

/** Recomputes the session columns of metrics_daily for the days the batch touched. */
export async function rollUpSessionMetrics(locationId: string, days: string[]): Promise<void> {
  const unique = [...new Set(days)];
  if (unique.length === 0) return;

  await tx(async (c) => {
    for (const day of unique) {
      await c.query(
        `insert into metrics_daily (location_id, date, sessions, active_s, users_active, updated_at)
         select $1, $2::date,
                count(*),
                coalesce(sum(active_s), 0),
                count(distinct ghl_user_id),
                now()
           from sessions
          where location_id = $1
            and counted
            and started_at >= $2::date
            and started_at <  $2::date + interval '1 day'
         on conflict (location_id, date) do update
           set sessions = excluded.sessions,
               active_s = excluded.active_s,
               users_active = excluded.users_active,
               updated_at = now()`,
        [locationId, day],
      );
    }
  });
}

function firstValue(events: ScriptEvent[], key: 'userName' | 'userEmail' | 'role'): string | null {
  for (const e of events) {
    const v = e[key];
    if (typeof v === 'string' && v.length > 0) return v;
  }
  return null;
}

function deviceFrom(ua: string | null): string | null {
  if (!ua) return null;
  if (/iPad|Tablet/i.test(ua)) return 'tablet';
  if (/Mobi|Android|iPhone/i.test(ua)) return 'mobile';
  return 'desktop';
}
