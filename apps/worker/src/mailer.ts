import nodemailer from 'nodemailer';
import { env } from './env.js';
import { log } from './log.js';

let transport: nodemailer.Transporter | null = null;

function get(): nodemailer.Transporter | null {
  if (!env.smtp.url) return null;
  if (!transport) transport = nodemailer.createTransport(env.smtp.url);
  return transport;
}

export async function sendEmail(to: string, subject: string, html: string): Promise<boolean> {
  const t = get();
  if (!t) {
    // Without SMTP configured the alert still lands in the alerts table and the panel.
    log.warn('SMTP not configured, email not sent', { to, subject });
    return false;
  }
  try {
    await t.sendMail({ from: env.smtp.from, to, subject, html });
    return true;
  } catch (err) {
    log.error('email send failed', { to, subject, err: (err as Error).message });
    return false;
  }
}
