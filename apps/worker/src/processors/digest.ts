import { toDay } from '@pulse/core';
import { query } from '@pulse/db';
import { env } from '../env.js';
import { log } from '../log.js';
import { sendEmail } from '../mailer.js';

export interface DigestJob { agencyId: string }

/** RF-08.3 / §11 — Monday 08:00 summary to the owner. */
export async function sendWeeklyDigest(job: DigestJob): Promise<void> {
  const rows = await query<{
    name: string | null; tier: string; score: number; location_id: string;
    from_tier: string | null; drivers: { label: string }[] | null;
  }>(
    `select l.name, hs.tier, hs.score, l.id as location_id, tc.from_tier, hs.drivers
       from locations l
       join lateral (
         select tier, score, drivers from health_scores
          where location_id = l.id order by date desc limit 1
       ) hs on true
       left join lateral (
         select from_tier from tier_changes
          where location_id = l.id and changed_at >= now() - interval '7 days'
          order by changed_at desc limit 1
       ) tc on true
      where l.agency_id = $1 and l.status = 'active' and hs.tier in ('at_risk','critical')
      order by hs.score asc
      limit 25`,
    [job.agencyId],
  );

  const owners = await query<{ email: string }>(
    `select email from agency_users where agency_id = $1 and role = 'owner'`,
    [job.agencyId],
  );
  if (owners.length === 0) {
    log.warn('digest skipped, agency has no owner', { agencyId: job.agencyId });
    return;
  }

  const list = rows.length === 0
    ? '<p>Nenhuma subconta em risco. Boa semana.</p>'
    : `<table style="border-collapse:collapse;width:100%">
         <tr style="text-align:left;color:#666">
           <th style="padding:6px 0">Subconta</th><th>Tier</th><th>Score</th><th>Motivo</th>
         </tr>
         ${rows.map((r) => `
           <tr style="border-top:1px solid #eee">
             <td style="padding:8px 0">
               <a href="${env.appUrl}/agency/locations/${r.location_id}">${esc(r.name ?? '—')}</a>
             </td>
             <td>${r.tier === 'critical' ? 'Crítico' : 'Em risco'}</td>
             <td>${r.score}</td>
             <td style="color:#666">${esc(r.drivers?.[0]?.label ?? '—')}</td>
           </tr>`).join('')}
       </table>`;

  const html = `
    <div style="font-family:system-ui,-apple-system,Segoe UI,sans-serif;max-width:680px">
      <h2 style="margin:0 0 4px">Resumo semanal — ${toDay(new Date())}</h2>
      <p style="color:#666;margin:0 0 16px">${rows.length} subconta(s) pedindo atenção.</p>
      ${list}
    </div>`;

  for (const owner of owners) {
    await sendEmail(owner.email, `[Pulse] Resumo semanal — ${rows.length} em risco`, html);
  }
}

function esc(s: string): string {
  return s.replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}
