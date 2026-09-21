import { Queue } from 'bullmq';
import { Redis } from 'ioredis';
import { env } from './env.js';

export const connection = new Redis(env.redisUrl, { maxRetriesPerRequest: null });

/** Script batches. Concurrency is keyed by location downstream so one noisy
 *  sub-account can't starve the others. */
export const sessionQueue = new Queue('sessions', { connection });

/** Business webhooks. */
export const webhookQueue = new Queue('webhooks', { connection });

/** One-off jobs kicked off by the install flow. */
export const syncQueue = new Queue('sync', { connection });

export const defaultJobOpts = {
  removeOnComplete: 1000,
  removeOnFail: 5000,
  attempts: 5,
  backoff: { type: 'exponential' as const, delay: 2000 },
};
