import { open, type Reader, type CityResponse } from 'maxmind';
import { env } from './env.js';

let reader: Reader<CityResponse> | null = null;
let loadFailed = false;

/**
 * GeoIP is resolved here, on the server, from the request's own IP — never in the
 * browser (RF-02.2), and never through a per-event call to an external service.
 */
export async function initGeoip(): Promise<boolean> {
  if (reader || loadFailed) return reader !== null;
  try {
    reader = await open<CityResponse>(env.geoipPath);
    return true;
  } catch {
    loadFailed = true;
    return false;
  }
}

export interface GeoResult {
  city: string | null;
  region: string | null;
  country: string | null;
}

export function lookup(ip: string | null): GeoResult {
  const empty = { city: null, region: null, country: null };
  if (!ip || !reader) return empty;
  try {
    const r = reader.get(ip);
    if (!r) return empty;
    return {
      city: r.city?.names?.['pt-BR'] ?? r.city?.names?.en ?? null,
      region: r.subdivisions?.[0]?.iso_code ?? null,
      country: r.country?.iso_code ?? null,
    };
  } catch {
    return empty;
  }
}

/** Trusts the left-most X-Forwarded-For hop that isn't private (Railway/Fly/Vercel edge). */
export function clientIp(xff: string | undefined, socketIp: string | undefined): string | null {
  const candidates = (xff ?? '').split(',').map((s) => s.trim()).filter(Boolean);
  candidates.push(socketIp ?? '');
  for (const c of candidates) {
    const ip = c.replace(/^::ffff:/, '');
    if (!ip) continue;
    if (/^(10\.|127\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|169\.254\.|::1$|fc|fd)/.test(ip)) continue;
    return ip;
  }
  return null;
}
