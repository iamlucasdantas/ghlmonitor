import type { FastifyInstance } from 'fastify';
import { verify, type ScriptEvent } from '@pulse/core';
import { agencyByIngestKey } from '@pulse/db';
import { clientIp, lookup } from '../geoip.js';
import { defaultJobOpts, sessionQueue } from '../queue.js';
import { RateLimiter } from '../ratelimit.js';

/** 200 events/s per agency (§12), with headroom for a burst after a reconnect. */
const perAgency = new RateLimiter(2000, 200);
const perIp = new RateLimiter(120, 20);
setInterval(() => { perAgency.sweep(); perIp.sweep(); }, 300_000).unref();

const MAX_EVENTS = 200;
const VALID_TYPES = new Set(['session_start', 'heartbeat', 'page_view', 'session_end']);

interface Batch {
  key?: string;
  sentAt?: number;
  events?: unknown[];
}

export async function collectRoutes(app: FastifyInstance): Promise<void> {
  /**
   * Hot path. Everything expensive — session building, user upserts, metric
   * aggregation — happens in the worker; this handler only authenticates the batch
   * and drops it on the queue, so it can answer 204 inside 50 ms (§12).
   */
  app.post('/collect', async (req, reply) => {
    const ip = clientIp(req.headers['x-forwarded-for'] as string | undefined, req.ip);
    if (!perIp.take(ip ?? 'unknown')) return reply.code(429).send();

    const raw = typeof req.body === 'string' ? req.body : JSON.stringify(req.body);
    let batch: Batch;
    try {
      batch = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body as Batch);
    } catch {
      return reply.code(400).send();
    }

    const key = typeof batch.key === 'string' ? batch.key : '';
    if (!key) return reply.code(400).send();
    if (!perAgency.take(key)) return reply.code(429).send();

    const agency = await agencyByIngestKey(key);
    // An unknown or uninstalled key gets 204 too: the snippet is public, and telling a
    // scanner which keys are live is free information.
    if (!agency) return reply.code(204).send();

    const events = Array.isArray(batch.events) ? batch.events.slice(0, MAX_EVENTS) : [];
    if (events.length === 0) return reply.code(204).send();

    const signature = req.headers['x-pulse-signature'];
    const signed =
      typeof signature === 'string' &&
      verify(agency.hmac_secret, signature, raw).ok;

    /* The unload path uses sendBeacon, which cannot set a signature header. Those
       batches may only close sessions that were opened by a signed batch — the worker
       ignores a session_end for a session it has never seen. */
    const accepted = (signed ? events : events.filter(isUnsignedSafe)) as ScriptEvent[];
    if (accepted.length === 0) return reply.code(204).send();

    const clean = accepted.filter(isWellFormed);
    if (clean.length === 0) return reply.code(204).send();

    const geo = lookup(ip);
    await sessionQueue.add(
      'script-batch',
      {
        agencyId: agency.id,
        receivedAt: Date.now(),
        clientSentAt: typeof batch.sentAt === 'number' ? batch.sentAt : null,
        signed,
        ip,
        geo,
        userAgent: req.headers['user-agent'] ?? null,
        events: clean,
      },
      { ...defaultJobOpts, jobId: undefined },
    );

    return reply.code(204).send();
  });
}

function isUnsignedSafe(e: unknown): boolean {
  return isRecord(e) && e['type'] === 'session_end';
}

function isWellFormed(e: unknown): e is ScriptEvent {
  if (!isRecord(e)) return false;
  return (
    typeof e['type'] === 'string' && VALID_TYPES.has(e['type']) &&
    typeof e['sessionId'] === 'string' && e['sessionId'].length <= 64 &&
    typeof e['locationId'] === 'string' && e['locationId'].length <= 64 &&
    typeof e['userId'] === 'string' && e['userId'].length <= 64 &&
    typeof e['ts'] === 'number' && Number.isFinite(e['ts'])
  );
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null;
}
