import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

/** Requests older (or newer) than this are rejected, so a captured payload can't be replayed. */
export const SIGNATURE_WINDOW_S = 300;

export function newHmacSecret(): string {
  return randomBytes(32).toString('base64url');
}

export function sign(secret: string, timestamp: number, body: string): string {
  return createHmac('sha256', secret).update(`${timestamp}.${body}`).digest('hex');
}

export type VerifyResult =
  | { ok: true }
  | { ok: false; reason: 'stale' | 'bad_signature' | 'malformed' };

/**
 * Verifies the `t=<epoch-seconds>,v1=<hex>` header the tracking script sends.
 * The secret is per agency (PRD §6.1), so a leaked snippet can only forge data for
 * the agency it was issued to — and the collector still checks the locationId belongs
 * to that agency before anything is stored (RF-02.1).
 */
export function verify(
  secret: string,
  header: string,
  body: string,
  nowS: number = Math.floor(Date.now() / 1000),
): VerifyResult {
  const parts = Object.fromEntries(
    header.split(',').map((kv) => {
      const i = kv.indexOf('=');
      return [kv.slice(0, i).trim(), kv.slice(i + 1).trim()];
    }),
  );
  const t = Number(parts['t']);
  const v1 = parts['v1'];
  if (!Number.isFinite(t) || typeof v1 !== 'string' || v1.length === 0) {
    return { ok: false, reason: 'malformed' };
  }
  if (Math.abs(nowS - t) > SIGNATURE_WINDOW_S) return { ok: false, reason: 'stale' };

  const expected = Buffer.from(sign(secret, t, body), 'utf8');
  const got = Buffer.from(v1, 'utf8');
  if (expected.length !== got.length || !timingSafeEqual(expected, got)) {
    return { ok: false, reason: 'bad_signature' };
  }
  return { ok: true };
}

/** Deterministic uuid v5-ish id so retried script batches don't duplicate sessions. */
export function sessionUuid(locationGhlId: string, sessionId: string): string {
  const h = createHmac('sha256', 'pulse-session')
    .update(`${locationGhlId}:${sessionId}`)
    .digest('hex');
  return [
    h.slice(0, 8), h.slice(8, 12),
    `5${h.slice(13, 16)}`,
    ((parseInt(h.slice(16, 17), 16) & 0x3) | 0x8).toString(16) + h.slice(17, 20),
    h.slice(20, 32),
  ].join('-');
}
