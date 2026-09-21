import type { AgencyRow } from '@pulse/db';
import { ghl } from './client.js';

export interface GhlLocation {
  id: string;
  name?: string;
  businessType?: string;
}

export interface GhlUser {
  id: string;
  name?: string;
  firstName?: string;
  lastName?: string;
  email?: string;
  roles?: { type?: string; role?: string };
}

export interface GhlOpportunity {
  id: string;
  status?: string;
  pipelineStageId?: string;
  monetaryValue?: number;
  createdAt?: string;
  updatedAt?: string;
  lastStatusChangeAt?: string;
  lastStageChangeAt?: string;
}

export interface GhlConversation {
  id: string;
  lastMessageDate?: string;
  lastMessageDirection?: string;
  lastMessageType?: string;
  type?: string;
}

/** Every sub-account of the agency (PRD §6.2). Paginated 100 at a time. */
export async function listLocations(agency: AgencyRow): Promise<GhlLocation[]> {
  const token = await ghl.agencyToken(agency);
  const out: GhlLocation[] = [];
  const limit = 100;
  for (let skip = 0; ; skip += limit) {
    const page = await ghl.request<{ locations?: GhlLocation[] }>('/locations/search', {
      bucket: agency.ghl_company_id,
      token,
      query: { companyId: agency.ghl_company_id, limit, skip },
    });
    const batch = page.locations ?? [];
    out.push(...batch);
    if (batch.length < limit) return out;
  }
}

export async function listUsers(
  agency: AgencyRow,
  locationRowId: string,
  ghlLocationId: string,
): Promise<GhlUser[]> {
  const token = await ghl.locationToken(agency, locationRowId, ghlLocationId);
  const res = await ghl.request<{ users?: GhlUser[] }>('/users/', {
    bucket: ghlLocationId,
    token,
    query: { locationId: ghlLocationId },
  });
  return res.users ?? [];
}

/**
 * Contacts are counted, never read. The API has no "count since" endpoint, so a full
 * sync walks the pages; the daily sync only needs the total plus the ones created in
 * the window, which `startAfter` ordering gives cheaply.
 */
export async function countContacts(
  agency: AgencyRow,
  locationRowId: string,
  ghlLocationId: string,
  since?: Date,
): Promise<{ total: number; created: number }> {
  const token = await ghl.locationToken(agency, locationRowId, ghlLocationId);
  const res = await ghl.request<{ total?: number; contacts?: { dateAdded?: string }[] }>(
    '/contacts/',
    { bucket: ghlLocationId, token, query: { locationId: ghlLocationId, limit: 100 } },
  );
  const total = res.total ?? res.contacts?.length ?? 0;
  const created = since
    ? (res.contacts ?? []).filter((c) => c.dateAdded && new Date(c.dateAdded) >= since).length
    : 0;
  return { total, created };
}

export async function searchConversations(
  agency: AgencyRow,
  locationRowId: string,
  ghlLocationId: string,
  since: Date,
): Promise<GhlConversation[]> {
  const token = await ghl.locationToken(agency, locationRowId, ghlLocationId);
  const res = await ghl.request<{ conversations?: GhlConversation[] }>(
    '/conversations/search',
    {
      bucket: ghlLocationId,
      token,
      query: {
        locationId: ghlLocationId,
        lastMessageDate: since.toISOString(),
        limit: 100,
        sortBy: 'last_message_date',
      },
    },
  );
  return res.conversations ?? [];
}

export async function searchOpportunities(
  agency: AgencyRow,
  locationRowId: string,
  ghlLocationId: string,
): Promise<GhlOpportunity[]> {
  const token = await ghl.locationToken(agency, locationRowId, ghlLocationId);
  const out: GhlOpportunity[] = [];
  const limit = 100;
  for (let page = 1; ; page++) {
    const res = await ghl.request<{ opportunities?: GhlOpportunity[] }>(
      '/opportunities/search',
      { bucket: ghlLocationId, token, query: { location_id: ghlLocationId, limit, page } },
    );
    const batch = res.opportunities ?? [];
    out.push(...batch);
    // Guard against a pagination bug turning into an unbounded loop.
    if (batch.length < limit || page >= 50) return out;
  }
}

export async function countAppointments(
  agency: AgencyRow,
  locationRowId: string,
  ghlLocationId: string,
  since: Date,
  until: Date,
): Promise<number> {
  const token = await ghl.locationToken(agency, locationRowId, ghlLocationId);
  const res = await ghl.request<{ events?: unknown[] }>('/calendars/events', {
    bucket: ghlLocationId,
    token,
    query: {
      locationId: ghlLocationId,
      startTime: since.toISOString(),
      endTime: until.toISOString(),
    },
  });
  return res.events?.length ?? 0;
}

export async function countActiveWorkflows(
  agency: AgencyRow,
  locationRowId: string,
  ghlLocationId: string,
): Promise<number> {
  const token = await ghl.locationToken(agency, locationRowId, ghlLocationId);
  const res = await ghl.request<{ workflows?: { status?: string }[] }>('/workflows/', {
    bucket: ghlLocationId,
    token,
    query: { locationId: ghlLocationId },
  });
  return (res.workflows ?? []).filter((w) => (w.status ?? 'published') === 'published').length;
}
