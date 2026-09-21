import type { Tier } from '@pulse/core';
import { one, query } from './pool.js';

export interface AgencyRow {
  id: string;
  ghl_company_id: string;
  name: string;
  timezone: string;
  hmac_secret: string;
  oauth_access_token: string | null;
  oauth_refresh_token: string | null;
  oauth_expires_at: Date | null;
  install_status: string;
}

export interface LocationRow {
  id: string;
  agency_id: string;
  ghl_location_id: string;
  name: string | null;
  manager_id: string | null;
  first_data_at: Date | null;
  location_token: string | null;
  location_token_expires_at: Date | null;
}

/** The ingest key is the agency id; the secret it maps to is what signs the batch. */
export function agencyByIngestKey(key: string): Promise<AgencyRow | null> {
  return one<AgencyRow>(
    `select * from agencies where id = $1 and install_status = 'active'`,
    [key],
  );
}

export function agencyByCompanyId(companyId: string): Promise<AgencyRow | null> {
  return one<AgencyRow>(`select * from agencies where ghl_company_id = $1`, [companyId]);
}

export function agencyById(id: string): Promise<AgencyRow | null> {
  return one<AgencyRow>(`select * from agencies where id = $1`, [id]);
}

/** Resolves a HighLevel locationId *within one agency* — the tenancy check of RF-02.1. */
export function locationByGhlId(
  agencyId: string,
  ghlLocationId: string,
): Promise<LocationRow | null> {
  return one<LocationRow>(
    `select * from locations where agency_id = $1 and ghl_location_id = $2`,
    [agencyId, ghlLocationId],
  );
}

export function locationsForAgency(agencyId: string): Promise<LocationRow[]> {
  return query<LocationRow>(
    `select * from locations where agency_id = $1 and status = 'active' order by name`,
    [agencyId],
  );
}

export async function recordRawEvent(input: {
  agencyId: string | null;
  locationId: string | null;
  source: 'webhook' | 'script';
  type: string;
  payload: unknown;
}): Promise<void> {
  await query(
    `insert into events_raw (agency_id, location_id, source, type, payload)
     values ($1, $2, $3, $4, $5)`,
    [input.agencyId, input.locationId, input.source, input.type, JSON.stringify(input.payload)],
  );
}

export async function touchAgencyScriptEvent(agencyId: string): Promise<void> {
  await query(`update agencies set last_script_event_at = now() where id = $1`, [agencyId]);
}

/** Upserts a HighLevel user seen by the script before the nightly sync imported it. */
export async function upsertGhlUser(input: {
  locationId: string;
  ghlUserId: string;
  name?: string | null;
  email?: string | null;
  role?: string | null;
  pending: boolean;
}): Promise<string> {
  const row = await one<{ id: string }>(
    `insert into ghl_users (location_id, ghl_user_id, name, email, role, pending)
     values ($1, $2, $3, $4, $5, $6)
     on conflict (location_id, ghl_user_id) do update
       set name    = coalesce(excluded.name, ghl_users.name),
           email   = coalesce(excluded.email, ghl_users.email),
           role    = coalesce(excluded.role, ghl_users.role),
           pending = ghl_users.pending and excluded.pending
     returning id`,
    [input.locationId, input.ghlUserId, input.name ?? null, input.email ?? null,
     input.role ?? null, input.pending],
  );
  return row!.id;
}

export async function saveHealthScore(input: {
  locationId: string;
  date: string;
  score: number;
  rawTier: Tier;
  tier: Tier;
  drivers: unknown;
  delta7d: number | null;
}): Promise<void> {
  await query(
    `insert into health_scores (location_id, date, score, raw_tier, tier, drivers, delta_7d)
     values ($1, $2, $3, $4, $5, $6, $7)
     on conflict (location_id, date) do update
       set score = excluded.score, raw_tier = excluded.raw_tier, tier = excluded.tier,
           drivers = excluded.drivers, delta_7d = excluded.delta_7d`,
    [input.locationId, input.date, input.score, input.rawTier, input.tier,
     JSON.stringify(input.drivers), input.delta7d],
  );
}

export async function addTimelineEvent(input: {
  locationId: string;
  type: string;
  title: string;
  meta?: Record<string, unknown>;
}): Promise<void> {
  await query(
    `insert into timeline_events (location_id, type, title, meta) values ($1, $2, $3, $4)`,
    [input.locationId, input.type, input.title, JSON.stringify(input.meta ?? {})],
  );
}
