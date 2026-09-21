import type { BuiltSession, ScriptEvent } from '../types.js';
import { normalizeRoute } from './routes.js';

export const HEARTBEAT_S = 30;
/** A gap longer than this closes the session, even if the tab reused the same id. */
export const SESSION_GAP_S = 30 * 60;
/** Fewer than this many heartbeats and it was never a session (PRD §6.1). */
export const MIN_HEARTBEATS = 2;

/**
 * Turns raw script events into sessions.
 *
 * The Spark Tracker bug this fixes: an open tab firing keep-alives was counted as a
 * session, producing sub-accounts with "10 sessions, 0 minutes". Here a heartbeat only
 * exists when the tab was visible *and* the user typed or moved in the last 60s, and a
 * run of fewer than two of them is recorded with counted = false so it never reaches a
 * dashboard or the score.
 */
export function buildSessions(events: ScriptEvent[]): BuiltSession[] {
  const byId = new Map<string, ScriptEvent[]>();
  for (const e of events) {
    const list = byId.get(e.sessionId);
    if (list) list.push(e);
    else byId.set(e.sessionId, [e]);
  }

  const out: BuiltSession[] = [];
  for (const [sessionId, raw] of byId) {
    const ordered = [...raw].sort((a, b) => a.ts - b.ts);
    const chunks = splitOnGaps(ordered);
    chunks.forEach((chunk, i) => {
      const built = buildOne(sessionId, chunk, i);
      if (built) out.push(built);
    });
  }
  return out.sort((a, b) => a.startedAt.getTime() - b.startedAt.getTime());
}

/** Splits a stream whenever two consecutive heartbeats are more than 30 min apart. */
function splitOnGaps(events: ScriptEvent[]): ScriptEvent[][] {
  const chunks: ScriptEvent[][] = [];
  let current: ScriptEvent[] = [];
  let lastBeat: number | null = null;

  for (const e of events) {
    if (e.type === 'heartbeat') {
      if (lastBeat !== null && (e.ts - lastBeat) / 1000 > SESSION_GAP_S) {
        chunks.push(current);
        current = [];
      }
      lastBeat = e.ts;
    }
    current.push(e);
  }
  if (current.length > 0) chunks.push(current);
  return chunks;
}

function buildOne(
  sessionId: string,
  events: ScriptEvent[],
  index: number,
): BuiltSession | null {
  const first = events[0];
  if (!first) return null;

  // Two heartbeats closer together than one interval are a retry, not extra time.
  const beats: ScriptEvent[] = [];
  for (const e of events) {
    if (e.type !== 'heartbeat') continue;
    const prev = beats[beats.length - 1];
    if (prev && (e.ts - prev.ts) / 1000 < HEARTBEAT_S * 0.8) continue;
    beats.push(e);
  }

  const counted = new Set(beats);
  const pages = new Map<string, number>();
  let currentPage = normalizeRoute(first.page ?? first.to ?? '/');
  for (const e of events) {
    if (e.type === 'page_view') {
      currentPage = normalizeRoute(e.to ?? e.page ?? currentPage);
    } else if (e.type === 'heartbeat') {
      const page = normalizeRoute(e.page ?? currentPage);
      currentPage = page;
      if (counted.has(e)) pages.set(page, (pages.get(page) ?? 0) + HEARTBEAT_S);
    }
  }

  const end = events[events.length - 1]!;
  const explicitEnd = [...events].reverse().find((e) => e.type === 'session_end');
  const startedAt = new Date(first.ts);
  const endedAt = new Date(Math.max(end.ts, first.ts));

  return {
    // A gap split produces a second session from the same client-side id, so the
    // later chunks get a suffix — otherwise they'd collide on the primary key.
    sessionId: index === 0 ? sessionId : `${sessionId}:${index}`,
    locationId: first.locationId,
    userId: first.userId,
    startedAt,
    endedAt,
    durationS: Math.max(0, Math.round((endedAt.getTime() - startedAt.getTime()) / 1000)),
    activeS: beats.length * HEARTBEAT_S,
    heartbeats: beats.length,
    pages: [...pages.entries()]
      .map(([path, seconds]) => ({ path, seconds }))
      .sort((a, b) => b.seconds - a.seconds),
    endReason: explicitEnd?.reason ?? (beats.length > 0 ? 'timeout' : 'no_activity'),
    counted: beats.length >= MIN_HEARTBEATS,
  };
}
