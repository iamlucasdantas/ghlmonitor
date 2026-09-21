import Fastify from 'fastify';
import { env } from './env.js';
import { initGeoip } from './geoip.js';
import { collectRoutes } from './routes/collect.js';
import { healthRoutes } from './routes/health.js';
import { oauthRoutes } from './routes/oauth.js';
import { scriptRoutes } from './routes/script.js';
import { webhookRoutes } from './routes/webhooks.js';

declare module 'fastify' {
  interface FastifyRequest {
    /** Exact bytes as received — the webhook signature is computed over these. */
    rawBody?: string;
  }
}

export async function buildServer() {
  const app = Fastify({
    logger: { level: process.env['LOG_LEVEL'] ?? 'info' },
    trustProxy: true,
    bodyLimit: 512 * 1024,
  });

  // Keep the raw bytes around: re-serialising a parsed body would break the HMAC.
  app.addContentTypeParser(
    'application/json',
    { parseAs: 'string' },
    (req, body: string, done) => {
      req.rawBody = body;
      try {
        done(null, body.length === 0 ? {} : JSON.parse(body));
      } catch (err) {
        done(err as Error, undefined);
      }
    },
  );
  // sendBeacon posts text/plain; the body is still JSON.
  app.addContentTypeParser(
    ['text/plain', 'application/x-www-form-urlencoded'],
    { parseAs: 'string' },
    (req, body: string, done) => {
      req.rawBody = body;
      try {
        done(null, body.length === 0 ? {} : JSON.parse(body));
      } catch {
        done(null, {});
      }
    },
  );

  app.addHook('onRequest', async (req, reply) => {
    // The script runs on every agency's white-label domain, so the collector has to
    // accept any origin. It carries no cookies and no credentials, so there is
    // nothing for a hostile origin to ride on.
    reply.header('access-control-allow-origin', '*');
    reply.header('access-control-allow-headers', 'content-type,x-pulse-signature');
    reply.header('access-control-max-age', '86400');
    if (req.method === 'OPTIONS') return reply.code(204).send();
  });

  await app.register(healthRoutes);
  await app.register(collectRoutes);
  await app.register(webhookRoutes);
  await app.register(oauthRoutes);
  await app.register(scriptRoutes);

  return app;
}

async function main(): Promise<void> {
  const hasGeoip = await initGeoip();
  const app = await buildServer();
  if (!hasGeoip) {
    app.log.warn(
      { path: env.geoipPath },
      'GeoLite2 database not found — sessions will be stored without a city',
    );
  }
  await app.listen({ port: env.port, host: env.host });

  for (const sig of ['SIGTERM', 'SIGINT'] as const) {
    process.on(sig, () => {
      app.log.info('shutting down');
      void app.close().then(() => process.exit(0));
    });
  }
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].split('/').pop() ?? '')) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
