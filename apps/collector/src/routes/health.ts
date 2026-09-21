import type { FastifyInstance } from 'fastify';
import { one } from '@pulse/db';
import { connection } from '../queue.js';

export async function healthRoutes(app: FastifyInstance): Promise<void> {
  app.get('/health', async () => ({ ok: true }));

  /** Readiness: the collector is only useful if it can reach both Postgres and Redis. */
  app.get('/ready', async (_req, reply) => {
    const checks: Record<string, string> = {};
    try {
      await one('select 1 as ok');
      checks['postgres'] = 'ok';
    } catch (err) {
      checks['postgres'] = (err as Error).message;
    }
    try {
      await connection.ping();
      checks['redis'] = 'ok';
    } catch (err) {
      checks['redis'] = (err as Error).message;
    }
    const ok = Object.values(checks).every((v) => v === 'ok');
    return reply.code(ok ? 200 : 503).send({ ok, checks });
  });
}
