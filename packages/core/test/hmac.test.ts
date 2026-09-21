import { strict as assert } from 'node:assert';
import test from 'node:test';
import { newHmacSecret, sessionUuid, sign, verify } from '../src/hmac.js';

const SECRET = 'agency-secret';
const BODY = JSON.stringify({ events: [{ type: 'heartbeat' }] });

test('a correctly signed payload verifies', () => {
  const t = 1_770_000_000;
  const header = `t=${t},v1=${sign(SECRET, t, BODY)}`;
  assert.deepEqual(verify(SECRET, header, BODY, t), { ok: true });
});

test('a tampered body is rejected', () => {
  const t = 1_770_000_000;
  const header = `t=${t},v1=${sign(SECRET, t, BODY)}`;
  const r = verify(SECRET, header, `${BODY} `, t);
  assert.deepEqual(r, { ok: false, reason: 'bad_signature' });
});

test("another agency's secret cannot sign for this one", () => {
  const t = 1_770_000_000;
  const header = `t=${t},v1=${sign('other-agency', t, BODY)}`;
  assert.equal(verify(SECRET, header, BODY, t).ok, false);
});

test('a replayed payload outside the window is rejected', () => {
  const t = 1_770_000_000;
  const header = `t=${t},v1=${sign(SECRET, t, BODY)}`;
  assert.deepEqual(verify(SECRET, header, BODY, t + 3600), { ok: false, reason: 'stale' });
});

test('a malformed header is rejected without throwing', () => {
  assert.deepEqual(verify(SECRET, 'garbage', BODY, 0), { ok: false, reason: 'malformed' });
  assert.deepEqual(verify(SECRET, 't=abc,v1=', BODY, 0), { ok: false, reason: 'malformed' });
});

test('secrets are unique per call', () => {
  assert.notEqual(newHmacSecret(), newHmacSecret());
});

test('session uuids are deterministic and well-formed', () => {
  const a = sessionUuid('loc1', 's1');
  assert.equal(a, sessionUuid('loc1', 's1'));
  assert.notEqual(a, sessionUuid('loc2', 's1'));
  assert.match(a, /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
});
