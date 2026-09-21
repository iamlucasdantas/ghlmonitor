import { Queue, Worker, type Job } from 'bullmq';
import { Redis } from 'ioredis';
import { closeDb, query } from '@pulse/db';
import { env } from './env.js';
import { log } from './log.js';
import { dispatchAlerts, type AlertJob } from './processors/alerts.js';
import { sendWeeklyDigest, type DigestJob } from './processors/digest.js';
import { scoreAgency, type ScoreJob } from './processors/score.js';
import { processScriptBatch, type ScriptBatchJob } from './processors/sessions.js';
import {
  bootstrapAgency, setInstallStatus, syncAgency,
  type BootstrapJob, type InstallStatusJob, type NightlySyncJob,
} from './processors/sync.js';
import { processWebhook, type WebhookJob } from './processors/webhooks.js';

const connection = new Redis(env.redisUrl, { maxRetriesPerRequest: null });

const syncQueue = new Queue('sync', { connection });
const scheduler = new Queue('scheduler', { connection });

const workers: Worker[] = [];

function start(): void {
  workers.push(
    new Worker<ScriptBatchJob>('sessions', (job) => processScriptBatch(job.data), {
      connection,
      // Batches for the same sub-account can land out of order here. That is safe by
      // construction: the session upsert merges with greatest(), so a late batch can
      // only ever raise a counter, never lower one.
      concurrency: env.concurrency,
    }),
  );

  workers.push(
    new Worker<WebhookJob>('webhooks', (job) => processWebhook(job.data), {
      connection,
      concurrency: env.concurrency,
    }),
  );

  workers.push(
    new Worker('sync', async (job: Job) => {
      switch (job.name) {
        case 'bootstrap-agency': return bootstrapAgency(job.data as BootstrapJob);
        case 'install-status': return setInstallStatus(job.data as InstallStatusJob);
        case 'nightly-sync': return syncAgency(job.data as NightlySyncJob);
        case 'score-agency': return scoreAgency(job.data as ScoreJob);
        case 'dispatch-alerts': return dispatchAlerts(job.data as AlertJob);
        case 'weekly-digest': return sendWeeklyDigest(job.data as DigestJob);
        default:
          log.warn('unknown sync job', { name: job.name });
      }
    }, {
      connection,
      // Syncs are long and API-bound; a couple at a time is plenty.
      concurrency: 2,
    }),
  );

  workers.push(
    new Worker('scheduler', () => tick(), { connection, concurrency: 1 }),
  );

  for (const w of workers) {
    w.on('failed', (job, err) => {
      log.error('job failed', { queue: w.name, name: job?.name, attempts: job?.attemptsMade, err: err.message });
    });
  }
}

/**
 * Fires hourly and fans out per agency in that agency's own timezone (RF-03.2):
 * sync at 02:00, score at 03:00, alerts right behind the score, digest Monday 08:00.
 */
export async function tick(): Promise<void> {
  const agencies = await query<{ id: string; hour: number; dow: number; today: string }>(
    `select id,
            extract(hour from (now() at time zone timezone))::int as hour,
            extract(dow  from (now() at time zone timezone))::int as dow,
            to_char((now() at time zone timezone)::date, 'YYYY-MM-DD') as today
       from agencies
      where install_status = 'active'`,
  );

  for (const a of agencies) {
    if (a.hour === 2) {
      await syncQueue.add('nightly-sync', { agencyId: a.id, date: a.today },
        { jobId: `sync:${a.id}:${a.today}` });
    }
    if (a.hour === 3) {
      await syncQueue.add('score-agency', { agencyId: a.id, date: a.today },
        { jobId: `score:${a.id}:${a.today}` });
      await syncQueue.add('dispatch-alerts', { agencyId: a.id, date: a.today },
        { jobId: `alerts:${a.id}:${a.today}`, delay: 5 * 60_000 });
    }
    if (a.dow === 1 && a.hour === 8) {
      await syncQueue.add('weekly-digest', { agencyId: a.id },
        { jobId: `digest:${a.id}:${a.today}` });
    }
  }

  await staleAgencyCheck();
}

/** §12 observability: shout if an agency has gone quiet for more than six hours. */
async function staleAgencyCheck(): Promise<void> {
  const stale = await query<{ id: string; name: string; last_script_event_at: Date | null }>(
    `select id, name, last_script_event_at
       from agencies
      where install_status = 'active'
        and (last_script_event_at is null or last_script_event_at < now() - interval '6 hours')`,
  );
  for (const a of stale) {
    log.warn('agency without script events', {
      agencyId: a.id, name: a.name, lastEvent: a.last_script_event_at,
    });
  }
}

async function main(): Promise<void> {
  start();
  // jobId is derived from the hour so a restart inside the same hour doesn't re-fire.
  await scheduler.upsertJobScheduler('hourly', { pattern: '0 * * * *' }, { name: 'tick' });
  log.info('worker started', { concurrency: env.concurrency });

  for (const sig of ['SIGTERM', 'SIGINT'] as const) {
    process.on(sig, () => {
      log.info('shutting down');
      void Promise.all(workers.map((w) => w.close()))
        .then(() => Promise.all([syncQueue.close(), scheduler.close(), closeDb()]))
        .then(() => connection.quit())
        .then(() => process.exit(0));
    });
  }
}

main().catch((err) => {
  log.error('worker crashed', { err: (err as Error).message });
  process.exit(1);
});
