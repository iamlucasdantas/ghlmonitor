import { one, query, type AgencyRow } from '@pulse/db';
import { env } from '../env.js';
import { log } from '../log.js';
import { limiterFor, sleep } from './ratelimit.js';

const TOKEN_URL = `${env.ghl.apiBase}/oauth/token`;
const LOCATION_TOKEN_URL = `${env.ghl.apiBase}/oauth/locationToken`;
/** Location tokens last 24h; refresh at 23h (PRD §6.2). */
const LOCATION_TOKEN_TTL_MS = 23 * 60 * 60 * 1000;

export class GhlError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly body: string,
  ) {
    super(message);
    this.name = 'GhlError';
  }
}

interface RequestOpts {
  method?: string;
  body?: unknown;
  query?: Record<string, string | number | undefined>;
  /** Rate-limit bucket. Location calls use the locationId, agency calls the companyId. */
  bucket: string;
  token: string;
}

async function request<T>(path: string, opts: RequestOpts): Promise<T> {
  const url = new URL(path.startsWith('http') ? path : `${env.ghl.apiBase}${path}`);
  for (const [k, v] of Object.entries(opts.query ?? {})) {
    if (v !== undefined && v !== null) url.searchParams.set(k, String(v));
  }

  const maxAttempts = 5;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    await limiterFor(opts.bucket).acquire();

    const res = await fetch(url, {
      method: opts.method ?? 'GET',
      headers: {
        Authorization: `Bearer ${opts.token}`,
        Version: env.ghl.apiVersion,
        Accept: 'application/json',
        ...(opts.body ? { 'content-type': 'application/json' } : {}),
      },
      ...(opts.body ? { body: JSON.stringify(opts.body) } : {}),
    });

    if (res.ok) return (await res.json()) as T;

    const text = await res.text();
    // 429 and 5xx are worth retrying; a 4xx is a bug in the request, not bad luck.
    const retriable = res.status === 429 || res.status >= 500;
    if (!retriable || attempt === maxAttempts) {
      throw new GhlError(`${opts.method ?? 'GET'} ${url.pathname} -> ${res.status}`, res.status, text);
    }

    const retryAfter = Number(res.headers.get('retry-after'));
    const delay = Number.isFinite(retryAfter) && retryAfter > 0
      ? retryAfter * 1000
      : 2 ** attempt * 500 + Math.random() * 250;
    log.warn('ghl retry', { path: url.pathname, status: res.status, attempt, delay });
    await sleep(delay);
  }
  throw new GhlError('unreachable', 0, '');
}

/** Refreshes the agency token in place when it is within five minutes of expiring. */
export async function agencyToken(agency: AgencyRow): Promise<string> {
  const stillValid =
    agency.oauth_access_token &&
    agency.oauth_expires_at &&
    agency.oauth_expires_at.getTime() - Date.now() > 5 * 60_000;
  if (stillValid) return agency.oauth_access_token!;

  if (!agency.oauth_refresh_token) {
    throw new Error(`agency ${agency.id} has no refresh token — it needs to reinstall`);
  }

  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
    body: new URLSearchParams({
      client_id: env.ghl.clientId,
      client_secret: env.ghl.clientSecret,
      grant_type: 'refresh_token',
      refresh_token: agency.oauth_refresh_token,
      user_type: 'Company',
    }),
  });

  if (!res.ok) {
    const body = await res.text();
    await query(`update agencies set install_status = 'error' where id = $1`, [agency.id]);
    throw new GhlError('agency token refresh failed', res.status, body);
  }

  const token = (await res.json()) as {
    access_token: string; refresh_token: string; expires_in: number;
  };
  const expiresAt = new Date(Date.now() + token.expires_in * 1000);
  await query(
    `update agencies
        set oauth_access_token = $2, oauth_refresh_token = $3, oauth_expires_at = $4,
            install_status = 'active'
      where id = $1`,
    [agency.id, token.access_token, token.refresh_token, expiresAt],
  );
  agency.oauth_access_token = token.access_token;
  agency.oauth_refresh_token = token.refresh_token;
  agency.oauth_expires_at = expiresAt;
  return token.access_token;
}

/** Location tokens are minted from the agency token and cached for 23h in `locations`. */
export async function locationToken(
  agency: AgencyRow,
  locationRowId: string,
  ghlLocationId: string,
): Promise<string> {
  const cached = await one<{ location_token: string | null; location_token_expires_at: Date | null }>(
    `select location_token, location_token_expires_at from locations where id = $1`,
    [locationRowId],
  );
  if (
    cached?.location_token &&
    cached.location_token_expires_at &&
    cached.location_token_expires_at.getTime() > Date.now()
  ) {
    return cached.location_token;
  }

  const res = await fetch(LOCATION_TOKEN_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${await agencyToken(agency)}`,
      Version: env.ghl.apiVersion,
      'content-type': 'application/x-www-form-urlencoded',
      Accept: 'application/json',
    },
    body: new URLSearchParams({ companyId: agency.ghl_company_id, locationId: ghlLocationId }),
  });

  if (!res.ok) throw new GhlError('locationToken failed', res.status, await res.text());

  const body = (await res.json()) as { access_token: string };
  await query(
    `update locations set location_token = $2, location_token_expires_at = $3 where id = $1`,
    [locationRowId, body.access_token, new Date(Date.now() + LOCATION_TOKEN_TTL_MS)],
  );
  return body.access_token;
}

export const ghl = {
  request,
  agencyToken,
  locationToken,
};
