import { strict as assert } from 'node:assert';
import test, { after, before, beforeEach } from 'node:test';
import { Queue } from 'bullmq';
import { Redis } from 'ioredis';
import { newHmacSecret, sign } from '@pulse/core';
import { closeDb, query } from '@pulse/db';
import { buildServer } from '../src/server.js';
import { connection } from '../src/queue.js';

/**
 * End-to-end over the real ingest path: a signed batch from the browser, through the
 * route, onto the queue. The HMAC is checked against the exact bytes received, which
 * is precisely the thing a unit test on verify() cannot prove.
 *
 * Needs DATABASE_URL and REDIS_URL — scripts/test-integration.sh provides both.
 */

const AGENCY_ID = '99999999-9999-9999-9999-999999999999';
const TOKEN = newHmacSecret();

let app: Awaited<ReturnType<typeof buildServer>>;
let queue: Queue;
let redis: Redis;

before(async () => {
  await query(
    `insert into agencies (id, ghl_company_id, name, hmac_secret, install_status)
     values ($1, 'company-test', 'Agência de Teste', $2, 'active')
     on conflict (id) do update set hmac_secret = excluded.hmac_secret,
                                    install_status = 'active'`,
    [AGENCY_ID, TOKEN],
  );
  app = await buildServer();
  redis = new Redis(process.env['REDIS_URL']!, { maxRetriesPerRequest: null });
  queue = new Queue('sessions', { connection: redis });
});

beforeEach(async () => {
  await queue.obliterate({ force: true });
});

after(async () => {
  await query(`delete from agencies where id = $1`, [AGENCY_ID]);
  await app.close();
  await queue.close();
  await redis.quit();
  await connection.quit();
  await closeDb();
});

function batchBody(events: unknown[], key = AGENCY_ID): string {
  return JSON.stringify({ key, sentAt: Date.now(), events });
}

function heartbeat(over: Record<string, unknown> = {}) {
  return {
    type: 'heartbeat', sessionId: 's-int-1', locationId: 'loc-int-1',
    userId: 'u-int-1', ts: Date.now(), page: '/conversations', ...over,
  };
}

function signedHeaders(body: string) {
  const t = Math.floor(Date.now() / 1000);
  return {
    'content-type': 'application/json',
    'x-pulse-signature': `t=${t},v1=${sign(TOKEN, t, body)}`,
  };
}

async function queued() {
  return queue.getJobs(['waiting', 'delayed', 'active', 'prioritized']);
}

test('a correctly signed batch is accepted and queued', async () => {
  const body = batchBody([heartbeat(), heartbeat({ ts: Date.now() + 30_000 })]);
  const res = await app.inject({
    method: 'POST', url: '/collect', headers: signedHeaders(body), payload: body,
  });

  assert.equal(res.statusCode, 204);
  const jobs = await queued();
  assert.equal(jobs.length, 1);
  assert.equal(jobs[0]!.data.agencyId, AGENCY_ID);
  assert.equal(jobs[0]!.data.signed, true);
  assert.equal(jobs[0]!.data.events.length, 2);
});

test('the signature is checked against the bytes received, not a re-serialisation', async () => {
  // Same data, different key order and spacing. A collector that re-serialises the
  // parsed body before verifying would compute a different digest and reject this.
  const body = '{"key":"' + AGENCY_ID + '","events":[' +
    JSON.stringify(heartbeat()) + ',' + JSON.stringify(heartbeat({ ts: Date.now() + 30_000 })) +
    '],  "sentAt": 1}';
  const res = await app.inject({
    method: 'POST', url: '/collect', headers: signedHeaders(body), payload: body,
  });

  assert.equal(res.statusCode, 204);
  const jobs = await queued();
  assert.equal(jobs.length, 1, 'batch should have been accepted as signed');
  assert.equal(jobs[0]!.data.signed, true);
});

test('a tampered body drops the events', async () => {
  const body = batchBody([heartbeat()]);
  const headers = signedHeaders(body);
  const tampered = batchBody([heartbeat({ ts: Date.now() + 999_999 })]);

  const res = await app.inject({
    method: 'POST', url: '/collect', headers, payload: tampered,
  });

  assert.equal(res.statusCode, 204);
  assert.equal((await queued()).length, 0);
});

test("another agency's token cannot sign for this one", async () => {
  const body = batchBody([heartbeat()]);
  const t = Math.floor(Date.now() / 1000);
  const res = await app.inject({
    method: 'POST',
    url: '/collect',
    headers: {
      'content-type': 'application/json',
      'x-pulse-signature': `t=${t},v1=${sign('someone-elses-token', t, body)}`,
    },
    payload: body,
  });

  assert.equal(res.statusCode, 204);
  assert.equal((await queued()).length, 0);
});

test('an unsigned beacon may only close a session', async () => {
  const body = batchBody([
    { type: 'session_end', sessionId: 's-int-1', locationId: 'loc-int-1',
      userId: 'u-int-1', ts: Date.now(), reason: 'beforeunload' },
    heartbeat(),
  ]);

  const res = await app.inject({
    method: 'POST', url: '/collect', headers: { 'content-type': 'text/plain' }, payload: body,
  });

  assert.equal(res.statusCode, 204);
  const jobs = await queued();
  assert.equal(jobs.length, 1);
  assert.equal(jobs[0]!.data.signed, false);
  assert.equal(jobs[0]!.data.events.length, 1, 'the heartbeat must be dropped');
  assert.equal(jobs[0]!.data.events[0].type, 'session_end');
});

test('an unknown key is acknowledged but never queued', async () => {
  const body = batchBody([heartbeat()], '00000000-0000-0000-0000-000000000000');
  const res = await app.inject({
    method: 'POST', url: '/collect', headers: signedHeaders(body), payload: body,
  });

  assert.equal(res.statusCode, 204);
  assert.equal((await queued()).length, 0);
});

test('malformed events are dropped without failing the batch', async () => {
  const body = batchBody([
    heartbeat(),
    { type: 'heartbeat' },                       // no ids
    { type: 'not_a_real_type', sessionId: 'x', locationId: 'y', userId: 'z', ts: 1 },
    'nonsense',
  ]);
  const res = await app.inject({
    method: 'POST', url: '/collect', headers: signedHeaders(body), payload: body,
  });

  assert.equal(res.statusCode, 204);
  const jobs = await queued();
  assert.equal(jobs[0]!.data.events.length, 1);
});

test('an empty batch is a no-op', async () => {
  const body = batchBody([]);
  const res = await app.inject({
    method: 'POST', url: '/collect', headers: signedHeaders(body), payload: body,
  });
  assert.equal(res.statusCode, 204);
  assert.equal((await queued()).length, 0);
});

test('health and readiness report the dependencies', async () => {
  assert.equal((await app.inject({ method: 'GET', url: '/health' })).statusCode, 200);
  const ready = await app.inject({ method: 'GET', url: '/ready' });
  assert.equal(ready.statusCode, 200);
  assert.deepEqual(ready.json().checks, { postgres: 'ok', redis: 'ok' });
});

test('the tracking script is served with a cacheable etag', async () => {
  const res = await app.inject({ method: 'GET', url: '/pulse.min.js' });
  assert.equal(res.statusCode, 200);
  assert.match(res.headers['content-type'] as string, /javascript/);
  const etag = res.headers['etag'] as string;
  assert.ok(etag);

  const cached = await app.inject({
    method: 'GET', url: '/pulse.min.js', headers: { 'if-none-match': etag },
  });
  assert.equal(cached.statusCode, 304);
});
