import { createHmac, timingSafeEqual } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { newHmacSecret } from '@pulse/core';
import { one, query } from '@pulse/db';
import { env, GHL_SCOPES } from '../env.js';
import { defaultJobOpts, syncQueue } from '../queue.js';

const AUTHORIZE = 'https://marketplace.gohighlevel.com/oauth/chooselocation';
const TOKEN = 'https://services.leadconnectorhq.com/oauth/token';

export async function oauthRoutes(app: FastifyInstance): Promise<void> {
  /** RF-01.1 — the "Instalar" button. Agency-level install (user_type=Company). */
  app.get('/oauth/install', async (_req, reply) => {
    const url = new URL(AUTHORIZE);
    url.searchParams.set('response_type', 'code');
    url.searchParams.set('client_id', env.ghl.clientId);
    url.searchParams.set('redirect_uri', env.ghl.redirectUri);
    url.searchParams.set('scope', GHL_SCOPES);
    url.searchParams.set('state', issueState());
    return reply.redirect(url.toString());
  });

  app.get<{ Querystring: { code?: string; state?: string } }>('/oauth/callback', async (req, reply) => {
    const code = req.query.code;
    if (!code) return reply.code(400).send({ error: 'missing code' });
    if (!checkState(req.query.state)) {
      return reply.code(400).send({ error: 'invalid or expired state' });
    }

    const res = await fetch(TOKEN, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
      body: new URLSearchParams({
        client_id: env.ghl.clientId,
        client_secret: env.ghl.clientSecret,
        grant_type: 'authorization_code',
        code,
        user_type: 'Company',
        redirect_uri: env.ghl.redirectUri,
      }),
    });

    if (!res.ok) {
      req.log.error({ status: res.status, body: await res.text() }, 'oauth token exchange failed');
      return reply.code(502).send({ error: 'token exchange failed' });
    }

    const token = (await res.json()) as {
      access_token: string;
      refresh_token: string;
      expires_in: number;
      companyId?: string;
      locationId?: string;
    };

    const companyId = token.companyId;
    if (!companyId) {
      return reply.code(400).send({
        error: 'Pulse installs at agency level. Reinstall choosing the agency, not a sub-account.',
      });
    }

    const expiresAt = new Date(Date.now() + token.expires_in * 1000);
    const agency = await one<{ id: string }>(
      `insert into agencies (ghl_company_id, name, hmac_secret,
                             oauth_access_token, oauth_refresh_token, oauth_expires_at,
                             install_status)
       values ($1, $2, $3, $4, $5, $6, 'active')
       on conflict (ghl_company_id) do update
         set oauth_access_token = excluded.oauth_access_token,
             oauth_refresh_token = excluded.oauth_refresh_token,
             oauth_expires_at = excluded.oauth_expires_at,
             install_status = 'active'
       returning id`,
      [companyId, `Agency ${companyId}`, newHmacSecret(),
       token.access_token, token.refresh_token, expiresAt],
    );

    await query(`select seed_default_alert_rules($1)`, [agency!.id]);
    // Import sub-accounts and users right away so the panel is populated in < 5 min (§16).
    await syncQueue.add('bootstrap-agency', { agencyId: agency!.id }, defaultJobOpts);

    return reply.redirect(`${env.appUrl}/agency/setup?installed=1`);
  });
}

/**
 * Stateless CSRF state: `<issued-at>.<hmac>`, signed with the client secret. No cookie
 * and no server-side store, which matters because the install can start on one
 * collector instance and come back on another.
 */
const STATE_TTL_S = 600;

function issueState(): string {
  const t = Math.floor(Date.now() / 1000);
  return `${t}.${stateMac(t)}`;
}

function checkState(state: string | undefined): boolean {
  if (!env.ghl.clientSecret) return true; // local dev without credentials
  if (!state) return false;
  const [tRaw, mac] = state.split('.');
  const t = Number(tRaw);
  if (!Number.isFinite(t) || !mac) return false;
  if (Math.abs(Math.floor(Date.now() / 1000) - t) > STATE_TTL_S) return false;
  const expected = Buffer.from(stateMac(t), 'utf8');
  const got = Buffer.from(mac, 'utf8');
  return expected.length === got.length && timingSafeEqual(expected, got);
}

function stateMac(t: number): string {
  return createHmac('sha256', env.ghl.clientSecret || 'dev').update(String(t)).digest('hex');
}
