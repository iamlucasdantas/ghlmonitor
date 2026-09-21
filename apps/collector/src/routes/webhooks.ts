import { createHmac, timingSafeEqual } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { agencyByCompanyId } from '@pulse/db';
import { env } from '../env.js';
import { defaultJobOpts, syncQueue, webhookQueue } from '../queue.js';

/** Webhook types Pulse acts on (PRD §6.2). Anything else is acknowledged and dropped. */
const HANDLED = new Set([
  'INSTALL', 'UNINSTALL',
  'LocationCreate', 'LocationUpdate',
  'UserCreate',
  'ContactCreate', 'ContactDelete',
  'InboundMessage', 'OutboundMessage',
  'OpportunityCreate', 'OpportunityStageUpdate',
  'OpportunityStatusUpdate', 'OpportunityMonetaryValueUpdate',
  'AppointmentCreate',
]);

export async function webhookRoutes(app: FastifyInstance): Promise<void> {
  /**
   * HighLevel retries on a non-2xx, so this answers 204 as soon as the payload is
   * queued. A webhook that is lost anyway gets picked up by the nightly reconciling
   * sync (§15) — that is the safety net, not this handler.
   */
  app.post('/webhooks/ghl', async (req, reply) => {
    if (env.ghlWebhookSecret && !validSignature(req.headers, req.rawBody ?? '')) {
      return reply.code(401).send();
    }

    const body = req.body as Record<string, unknown> | undefined;
    const type = typeof body?.['type'] === 'string' ? (body['type'] as string) : null;
    if (!type) return reply.code(400).send();
    if (!HANDLED.has(type)) return reply.code(204).send();

    const companyId = pickString(body, ['companyId', 'company_id']);
    const locationId = pickString(body, ['locationId', 'location_id']);

    if (type === 'INSTALL' || type === 'UNINSTALL') {
      await syncQueue.add('install-status', { type, body }, defaultJobOpts);
      return reply.code(204).send();
    }

    // Resolving the agency here keeps unknown tenants out of the queue entirely.
    const agency = companyId ? await agencyByCompanyId(companyId) : null;
    await webhookQueue.add(
      type,
      { agencyId: agency?.id ?? null, ghlCompanyId: companyId, ghlLocationId: locationId, type, body },
      defaultJobOpts,
    );
    return reply.code(204).send();
  });
}

function pickString(body: Record<string, unknown> | undefined, keys: string[]): string | null {
  if (!body) return null;
  for (const k of keys) {
    const v = body[k];
    if (typeof v === 'string' && v.length > 0) return v;
  }
  return null;
}

function validSignature(headers: Record<string, unknown>, raw: string): boolean {
  const header = headers['x-wh-signature'] ?? headers['x-ghl-signature'];
  if (typeof header !== 'string' || header.length === 0) return false;
  const expected = createHmac('sha256', env.ghlWebhookSecret).update(raw).digest('hex');
  const a = Buffer.from(expected, 'utf8');
  const b = Buffer.from(header, 'utf8');
  return a.length === b.length && timingSafeEqual(a, b);
}
