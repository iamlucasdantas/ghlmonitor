import { addDays, toDay } from '@pulse/core';
import {
  agencyByCompanyId, agencyById, locationsForAgency, query, one,
  type AgencyRow, type LocationRow,
} from '@pulse/db';
import {
  countActiveWorkflows, countAppointments, countContacts, listLocations, listUsers,
  searchConversations, searchOpportunities,
} from '../ghl/api.js';
import { GhlError } from '../ghl/client.js';
import { log } from '../log.js';

export interface BootstrapJob { agencyId: string }
export interface InstallStatusJob { type: 'INSTALL' | 'UNINSTALL'; body: Record<string, unknown> }
export interface NightlySyncJob { agencyId: string; date?: string }

/**
 * First run after OAuth (RF-01.1): import every sub-account and its users, then take
 * the day-zero snapshot. No attempt is made to reconstruct message history — the PRD
 * is explicit that deltas accumulate from here (§6.2).
 */
export async function bootstrapAgency(job: BootstrapJob): Promise<void> {
  const agency = await agencyById(job.agencyId);
  if (!agency) throw new Error(`agency ${job.agencyId} not found`);

  const locations = await listLocations(agency);
  log.info('bootstrap: importing sub-accounts', { agencyId: agency.id, count: locations.length });

  for (const loc of locations) {
    await query(
      `insert into locations (agency_id, ghl_location_id, name, niche)
       values ($1, $2, $3, $4)
       on conflict (ghl_location_id) do update
         set name = coalesce(excluded.name, locations.name),
             niche = coalesce(excluded.niche, locations.niche),
             status = 'active'`,
      [agency.id, loc.id, loc.name ?? null, loc.businessType ?? null],
    );
  }

  // The agency name comes back on the locations payload before anything else does.
  await query(`update agencies set name = coalesce(nullif($2,''), name) where id = $1`, [
    agency.id, locations[0]?.name ? `Agência ${agency.ghl_company_id}` : '',
  ]);

  await syncAgency({ agencyId: agency.id });
}

export async function setInstallStatus(job: InstallStatusJob): Promise<void> {
  const companyId = String(job.body['companyId'] ?? job.body['company_id'] ?? '');
  if (!companyId) return;
  const agency = await agencyByCompanyId(companyId);
  if (!agency) return;

  const status = job.type === 'UNINSTALL' ? 'uninstalled' : 'active';
  await query(`update agencies set install_status = $2 where id = $1`, [agency.id, status]);
  log.info('install status changed', { agencyId: agency.id, status });
}

/**
 * Nightly reconciliation (RF-03.2). Runs at 02:00 in the agency's own timezone and
 * recomputes totals from the API, overwriting whatever the webhooks accumulated.
 *
 * Sub-accounts are walked in risk order so that if a 500-sub-account agency runs out
 * of rate-limit budget, the ones that matter are already up to date (§15).
 */
export async function syncAgency(job: NightlySyncJob): Promise<void> {
  const agency = await agencyById(job.agencyId);
  if (!agency) throw new Error(`agency ${job.agencyId} not found`);
  if (agency.install_status !== 'active') {
    log.info('skipping sync for inactive agency', { agencyId: agency.id });
    return;
  }

  const date = job.date ?? toDay(new Date());
  const locations = await prioritise(agency.id);
  let failures = 0;

  for (const loc of locations) {
    try {
      await syncLocation(agency, loc, date);
    } catch (err) {
      failures++;
      const status = err instanceof GhlError ? err.status : undefined;
      log.error('location sync failed', {
        agencyId: agency.id, locationId: loc.id, status, err: (err as Error).message,
      });
    }
  }

  await query(
    `update agencies set last_sync_at = now(), last_sync_status = $2 where id = $1`,
    [agency.id, failures === 0 ? 'ok' : failures < locations.length ? 'partial' : 'error'],
  );
  log.info('agency sync finished', {
    agencyId: agency.id, locations: locations.length, failures,
  });
}

/** Worst score first, then never-synced, so the risky sub-accounts get the budget. */
async function prioritise(agencyId: string): Promise<LocationRow[]> {
  const rows = await query<LocationRow>(
    `select l.*
       from locations l
       left join lateral (
         select score from health_scores h
          where h.location_id = l.id order by h.date desc limit 1
       ) s on true
      where l.agency_id = $1 and l.status = 'active'
      order by coalesce(s.score, -1) asc`,
    [agencyId],
  );
  return rows;
}

async function syncLocation(agency: AgencyRow, loc: LocationRow, date: string): Promise<void> {
  const dayStart = new Date(`${date}T00:00:00.000Z`);
  const windowStart = new Date(`${addDays(date, -1)}T00:00:00.000Z`);

  const users = await listUsers(agency, loc.id, loc.ghl_location_id);
  for (const u of users) {
    await query(
      `insert into ghl_users (location_id, ghl_user_id, name, email, role, pending)
       values ($1, $2, $3, $4, $5, false)
       on conflict (location_id, ghl_user_id) do update
         set name = coalesce(excluded.name, ghl_users.name),
             email = coalesce(excluded.email, ghl_users.email),
             role = coalesce(excluded.role, ghl_users.role),
             pending = false`,
      [
        loc.id, u.id,
        u.name ?? ([u.firstName, u.lastName].filter(Boolean).join(' ') || null),
        u.email ?? null,
        u.roles?.role ?? u.roles?.type ?? null,
      ],
    );
  }

  const contacts = await countContacts(agency, loc.id, loc.ghl_location_id, windowStart);
  const conversations = await searchConversations(agency, loc.id, loc.ghl_location_id, windowStart);
  const opportunities = await searchOpportunities(agency, loc.id, loc.ghl_location_id);
  const appointments = await countAppointments(
    agency, loc.id, loc.ghl_location_id, windowStart, dayStart,
  );
  const workflows = await countActiveWorkflows(agency, loc.id, loc.ghl_location_id);

  const msgs = countMessages(conversations, windowStart);
  const opps = summariseOpportunities(opportunities, windowStart);

  await query(
    `insert into metrics_daily (
       location_id, date, contacts_total, contacts_new, conversations_active,
       msgs_in, msgs_out, msgs_by_channel, opps_open, opps_created, opps_moved,
       opps_won, opps_lost, revenue_won, revenue_coverage, appointments,
       workflows_active, users_total, updated_at)
     values ($1,$2::date,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,now())
     on conflict (location_id, date) do update set
       contacts_total = excluded.contacts_total,
       contacts_new = greatest(coalesce(metrics_daily.contacts_new, 0), excluded.contacts_new),
       conversations_active = excluded.conversations_active,
       msgs_in = greatest(coalesce(metrics_daily.msgs_in, 0), excluded.msgs_in),
       msgs_out = greatest(coalesce(metrics_daily.msgs_out, 0), excluded.msgs_out),
       msgs_by_channel = excluded.msgs_by_channel,
       opps_open = excluded.opps_open,
       opps_created = greatest(coalesce(metrics_daily.opps_created, 0), excluded.opps_created),
       opps_moved = greatest(coalesce(metrics_daily.opps_moved, 0), excluded.opps_moved),
       opps_won = excluded.opps_won,
       opps_lost = excluded.opps_lost,
       revenue_won = excluded.revenue_won,
       revenue_coverage = excluded.revenue_coverage,
       appointments = excluded.appointments,
       workflows_active = excluded.workflows_active,
       users_total = excluded.users_total,
       updated_at = now()`,
    [
      loc.id, date, contacts.total, contacts.created, conversations.length,
      msgs.in, msgs.out, JSON.stringify(msgs.byChannel),
      opps.open, opps.created, opps.moved, opps.won, opps.lost,
      opps.revenueWon, opps.coverage, appointments, workflows, users.length,
    ],
  );

  await query(
    `update locations set first_data_at = coalesce(first_data_at, now()) where id = $1`,
    [loc.id],
  );
}

/**
 * Message counts come from conversation metadata only — direction, channel and
 * timestamp. Message *content* is explicitly out of scope (§5.4).
 */
function countMessages(
  conversations: { lastMessageDate?: string; lastMessageDirection?: string; lastMessageType?: string }[],
  since: Date,
): { in: number; out: number; byChannel: Record<string, number> } {
  let inbound = 0;
  let outbound = 0;
  const byChannel: Record<string, number> = {};

  for (const c of conversations) {
    if (!c.lastMessageDate || new Date(c.lastMessageDate) < since) continue;
    if (c.lastMessageDirection === 'inbound') inbound++;
    else outbound++;
    const channel = normaliseChannel(c.lastMessageType);
    byChannel[channel] = (byChannel[channel] ?? 0) + 1;
  }
  return { in: inbound, out: outbound, byChannel };
}

function normaliseChannel(type: string | undefined): string {
  if (!type) return 'other';
  const t = type.toUpperCase();
  if (t.includes('SMS')) return 'sms';
  if (t.includes('EMAIL')) return 'email';
  if (t.includes('WHATSAPP')) return 'whatsapp';
  if (t.includes('FB') || t.includes('FACEBOOK')) return 'facebook';
  if (t.includes('IG') || t.includes('INSTAGRAM')) return 'instagram';
  if (t.includes('CALL')) return 'call';
  return 'other';
}

function summariseOpportunities(
  opps: {
    status?: string; monetaryValue?: number; createdAt?: string; updatedAt?: string;
    lastStatusChangeAt?: string; lastStageChangeAt?: string;
  }[],
  since: Date,
): {
  open: number; created: number; moved: number; won: number; lost: number;
  revenueWon: number; coverage: number;
} {
  let open = 0, created = 0, moved = 0, won = 0, lost = 0, revenueWon = 0, withValue = 0;

  for (const o of opps) {
    const status = (o.status ?? '').toLowerCase();
    if (status === 'open') open++;
    if (o.createdAt && new Date(o.createdAt) >= since) created++;

    const movedAt = o.lastStageChangeAt ?? o.lastStatusChangeAt ?? o.updatedAt;
    if (movedAt && new Date(movedAt) >= since && o.createdAt && new Date(o.createdAt) < since) {
      moved++;
    }
    if ((o.monetaryValue ?? 0) > 0) withValue++;

    if (status === 'won') {
      // Revenue is counted on the day the opportunity was won, not the day it was created.
      const wonAt = o.lastStatusChangeAt ?? o.updatedAt;
      if (wonAt && new Date(wonAt) >= since) {
        won++;
        revenueWon += o.monetaryValue ?? 0;
      }
    } else if (status === 'lost' && o.lastStatusChangeAt && new Date(o.lastStatusChangeAt) >= since) {
      lost++;
    }
  }

  // RF-03.3: how much of the revenue number can be trusted.
  const coverage = opps.length > 0 ? Math.round((withValue / opps.length) * 10000) / 100 : 0;
  return { open, created, moved, won, lost, revenueWon, coverage };
}

/** Agencies whose local time has just passed 02:00 (RF-03.2). */
export async function agenciesDueForSync(): Promise<{ id: string; timezone: string }[]> {
  return query<{ id: string; timezone: string }>(
    `select id, timezone
       from agencies
      where install_status = 'active'
        and extract(hour from (now() at time zone timezone)) = 2
        and (last_sync_at is null
             or (now() at time zone timezone)::date > (last_sync_at at time zone timezone)::date)`,
  );
}

export async function agencyTimezone(agencyId: string): Promise<string> {
  const row = await one<{ timezone: string }>(`select timezone from agencies where id = $1`, [agencyId]);
  return row?.timezone ?? 'America/Sao_Paulo';
}
