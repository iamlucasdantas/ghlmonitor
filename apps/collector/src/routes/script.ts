import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import type { FastifyInstance } from 'fastify';

const here = dirname(fileURLToPath(import.meta.url));

/**
 * Serves the tracking script the snippet points at. It is served from the collector
 * rather than a CDN so that an agency only has to allow one origin, and so a fix
 * reaches every sub-account on the next page load.
 */
export async function scriptRoutes(app: FastifyInstance): Promise<void> {
  const candidates = [
    process.env['TRACKING_SCRIPT_PATH'],
    resolve(here, '../../../../tracking/pulse.min.js'),
    resolve(here, '../../../tracking/pulse.min.js'),
    resolve(process.cwd(), 'tracking/pulse.min.js'),
  ].filter(Boolean) as string[];

  let body: Buffer | null = null;
  for (const path of candidates) {
    try {
      body = await readFile(path);
      app.log.info({ path, bytes: body.length }, 'tracking script loaded');
      break;
    } catch {
      continue;
    }
  }

  if (!body) {
    app.log.error({ candidates }, 'tracking script not found — run npm run build:script');
  }

  const etag = body ? `"${createHash('sha256').update(body).digest('hex').slice(0, 16)}"` : null;

  app.get('/pulse.min.js', async (req, reply) => {
    if (!body || !etag) return reply.code(503).send('// tracking script not built');

    if (req.headers['if-none-match'] === etag) return reply.code(304).send();

    return reply
      .header('content-type', 'application/javascript; charset=utf-8')
      // Short max-age with revalidation: a fix propagates within the hour, but a
      // sub-account reloading the app all day doesn't refetch it every time.
      .header('cache-control', 'public, max-age=3600, must-revalidate')
      .header('etag', etag)
      .send(body);
  });
}
