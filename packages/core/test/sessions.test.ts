import { strict as assert } from 'node:assert';
import test from 'node:test';
import { buildSessions, HEARTBEAT_S } from '../src/sessions/builder.js';
import { locationIdFromUrl, normalizeRoute } from '../src/sessions/routes.js';
import type { ScriptEvent } from '../src/types.js';

const T0 = Date.parse('2026-09-20T12:00:00Z');

function ev(over: Partial<ScriptEvent> & { type: ScriptEvent['type']; ts: number }): ScriptEvent {
  return {
    sessionId: 's1', locationId: 'loc1', userId: 'u1',
    ...over,
  } as ScriptEvent;
}

function beats(n: number, everyS = HEARTBEAT_S, page = '/conversations'): ScriptEvent[] {
  return Array.from({ length: n }, (_, i) =>
    ev({ type: 'heartbeat', ts: T0 + i * everyS * 1000, page }),
  );
}

test('a single heartbeat is not a session (kills the "10 sessions, 0 min" bug)', () => {
  const [s] = buildSessions([ev({ type: 'session_start', ts: T0 }), ...beats(1)]);
  assert.equal(s!.counted, false);
  assert.equal(s!.activeS, HEARTBEAT_S);
});

test('an open tab with no heartbeats at all is not a session', () => {
  const [s] = buildSessions([
    ev({ type: 'session_start', ts: T0 }),
    ev({ type: 'session_end', ts: T0 + 3_600_000, reason: 'beforeunload' }),
  ]);
  assert.equal(s!.counted, false);
  assert.equal(s!.activeS, 0);
  assert.equal(s!.heartbeats, 0);
});

test('active time is valid heartbeats x 30s, not wall clock', () => {
  const [s] = buildSessions([
    ev({ type: 'session_start', ts: T0 }),
    ...beats(10),
    ev({ type: 'session_end', ts: T0 + 20 * 60_000, reason: 'hidden' }),
  ]);
  assert.equal(s!.counted, true);
  assert.equal(s!.heartbeats, 10);
  assert.equal(s!.activeS, 300);
  assert.equal(s!.durationS, 20 * 60);
  assert.equal(s!.endReason, 'hidden');
});

test('duplicate heartbeats from a retry do not inflate active time', () => {
  const dupes = [...beats(4), ev({ type: 'heartbeat', ts: T0 + 1000 })];
  const [s] = buildSessions([ev({ type: 'session_start', ts: T0 }), ...dupes]);
  assert.equal(s!.heartbeats, 4);
});

test('a gap over 30 minutes splits one client id into two sessions', () => {
  const later = beats(3).map((b) => ({ ...b, ts: b.ts + 45 * 60_000 }));
  const built = buildSessions([ev({ type: 'session_start', ts: T0 }), ...beats(3), ...later]);
  assert.equal(built.length, 2);
  assert.equal(built[0]!.sessionId, 's1');
  assert.equal(built[1]!.sessionId, 's1:1');
  assert.ok(built.every((s) => s.counted));
});

test('time is attributed to the page the user was actually on', () => {
  const events: ScriptEvent[] = [
    ev({ type: 'session_start', ts: T0, page: '/dashboard' }),
    ev({ type: 'heartbeat', ts: T0, page: '/v2/location/abc123/dashboard' }),
    ev({ type: 'page_view', ts: T0 + 20_000, from: '/dashboard', to: '/v2/location/abc123/conversations' }),
    ev({ type: 'heartbeat', ts: T0 + 30_000 }),
    ev({ type: 'heartbeat', ts: T0 + 60_000 }),
  ];
  const [s] = buildSessions(events);
  assert.deepEqual(s!.pages, [
    { path: '/conversations', seconds: 60 },
    { path: '/dashboard', seconds: 30 },
  ]);
});

test('events arriving out of order still build one ordered session', () => {
  const shuffled = [...beats(4)].reverse();
  const [s] = buildSessions(shuffled);
  assert.equal(s!.heartbeats, 4);
  assert.equal(s!.startedAt.getTime(), T0);
});

test('routes are normalised so ids do not explode the page list', () => {
  assert.equal(normalizeRoute('/v2/location/abc123XYZ/conversations/conv_9f8e7d6c5b4a3210'), '/conversations/:id');
  assert.equal(normalizeRoute('/v2/location/abc123XYZ/dashboard'), '/dashboard');
  assert.equal(normalizeRoute('/contacts/smart_list/All?page=2'), '/contacts/smart_list/all');
  assert.equal(normalizeRoute(''), '/');
});

test('locationId is recoverable from the app URL', () => {
  assert.equal(locationIdFromUrl('https://app.agency.com/v2/location/Abc123/dashboard'), 'Abc123');
  assert.equal(locationIdFromUrl('https://app.agency.com/agency/dashboard'), null);
});
