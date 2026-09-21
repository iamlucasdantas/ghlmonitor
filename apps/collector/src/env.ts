function required(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`${name} is not set`);
  return v;
}

export const env = {
  port: Number(process.env['PORT'] ?? 3001),
  host: process.env['HOST'] ?? '0.0.0.0',
  redisUrl: process.env['REDIS_URL'] ?? 'redis://127.0.0.1:6379',
  geoipPath: process.env['GEOIP_PATH'] ?? './GeoLite2-City.mmdb',
  /** Shared secret HighLevel signs its webhooks with. */
  ghlWebhookSecret: process.env['GHL_WEBHOOK_SECRET'] ?? '',
  appUrl: process.env['APP_URL'] ?? 'http://localhost:3000',
  ghl: {
    clientId: process.env['GHL_CLIENT_ID'] ?? '',
    clientSecret: process.env['GHL_CLIENT_SECRET'] ?? '',
    redirectUri: process.env['GHL_REDIRECT_URI'] ?? 'http://localhost:3001/oauth/callback',
  },
  get databaseUrl(): string {
    return required('DATABASE_URL');
  },
};

/** Scopes from PRD §6.2. */
export const GHL_SCOPES = [
  'locations.readonly',
  'users.readonly',
  'contacts.readonly',
  'conversations.readonly',
  'conversations/message.readonly',
  'opportunities.readonly',
  'calendars/events.readonly',
  'workflows.readonly',
  'saas/company.read',
  'oauth.readonly',
].join(' ');
