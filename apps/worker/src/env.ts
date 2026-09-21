export const env = {
  redisUrl: process.env['REDIS_URL'] ?? 'redis://127.0.0.1:6379',
  concurrency: Number(process.env['WORKER_CONCURRENCY'] ?? 8),
  ghl: {
    clientId: process.env['GHL_CLIENT_ID'] ?? '',
    clientSecret: process.env['GHL_CLIENT_SECRET'] ?? '',
    apiBase: process.env['GHL_API_BASE'] ?? 'https://services.leadconnectorhq.com',
    apiVersion: process.env['GHL_API_VERSION'] ?? '2021-07-28',
  },
  smtp: {
    url: process.env['SMTP_URL'] ?? '',
    from: process.env['ALERT_FROM'] ?? 'Pulse <alerts@pulse.app>',
  },
  appUrl: process.env['APP_URL'] ?? 'http://localhost:3000',
};
