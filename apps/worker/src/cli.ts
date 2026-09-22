/**
 * Operational CLI for the worker.
 *
 *   pulse score    --agency <uuid> [--date YYYY-MM-DD]
 *   pulse backfill --agency <uuid> [--days 45]
 *   pulse alerts   --agency <uuid> [--date YYYY-MM-DD]
 *   pulse agencies
 *
 * Exists for three jobs the scheduler can't do on demand: recomputing a day after a
 * late sync, rebuilding history when the score weights change (§15 "painel de
 * calibração"), and populating a demo database with scores the real engine produced.
 */
import { readFile } from 'node:fs/promises';
import { addDays, toDay } from '@pulse/core';
import { closeDb, db, query } from '@pulse/db';
import { log } from './log.js';
import { dispatchAlerts } from './processors/alerts.js';
import { scoreAgency } from './processors/score.js';

interface Args {
  command: string;
  agency?: string;
  date?: string;
  days?: number;
  file?: string;
}

function parseArgs(argv: string[]): Args {
  const [command = 'help'] = argv;
  const args: Args = { command };
  for (let i = 1; i < argv.length; i++) {
    const flag = argv[i];
    const value = argv[i + 1];
    if (flag === '--agency' && value) { args.agency = value; i++; }
    else if (flag === '--date' && value) { args.date = value; i++; }
    else if (flag === '--days' && value) { args.days = Number(value); i++; }
    else if (flag === '--file' && value) { args.file = value; i++; }
  }
  return args;
}

const USAGE = `
pulse — ferramentas de operação do worker

  score    --agency <uuid> [--date YYYY-MM-DD]   Calcula o score de um dia
  backfill --agency <uuid> [--days 45]           Recalcula os últimos N dias, em ordem
  alerts   --agency <uuid> [--date YYYY-MM-DD]   Avalia as regras de alerta
  agencies                                       Lista as agências instaladas
  link-auth-users                                Liga agency_users a auth.users pelo e-mail
  seed-demo [--file db/seed/demo.sql]            Aplica o seed de demonstração

O backfill roda dia a dia, do mais antigo para o mais novo, porque a confirmação de
tier depende do tier do dia anterior (RF-04.3) — rodar fora de ordem produz histórico
de tier errado.
`;

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));

  switch (args.command) {
    case 'agencies': {
      const rows = await query<{ id: string; name: string; install_status: string; locations: number }>(
        `select a.id, a.name, a.install_status,
                (select count(*) from locations l where l.agency_id = a.id) as locations
           from agencies a order by a.created_at`,
      );
      if (rows.length === 0) {
        console.log('nenhuma agência instalada');
        break;
      }
      for (const r of rows) {
        console.log(`${r.id}  ${r.install_status.padEnd(12)} ${String(r.locations).padStart(4)} subcontas  ${r.name}`);
      }
      break;
    }

    case 'score': {
      const agencyId = requireAgency(args);
      const date = args.date ?? toDay(new Date());
      await scoreAgency({ agencyId, date });
      await report(agencyId, date);
      break;
    }

    case 'backfill': {
      const agencyId = requireAgency(args);
      const days = args.days ?? 45;
      const today = args.date ?? toDay(new Date());
      const start = addDays(today, -(days - 1));

      log.info('backfill iniciado', { agencyId, from: start, to: today, days });
      for (let d = start; d <= today; d = addDays(d, 1)) {
        await scoreAgency({ agencyId, date: d });
      }
      await report(agencyId, today);
      break;
    }

    case 'seed-demo': {
      // `supabase db reset` só aplica o seed na stack local. Para um projeto na
      // nuvem — ou qualquer Postgres — o seed roda por aqui, pelo mesmo cliente que
      // o worker usa, sem exigir psql instalado.
      const file = args.file ?? 'db/seed/demo.sql';
      const sql = await readFile(file, 'utf8');
      await db().query(sql);
      console.log(`seed aplicado: ${file}`);
      break;
    }

    case 'link-auth-users': {
      // O Supabase Auth cria a linha em auth.users; o Pulse precisa ligá-la ao
      // agency_users correspondente. Feito aqui, em vez de psql, para que o setup
      // não exija um cliente Postgres instalado na máquina.
      const linked = await query<{ email: string }>(
        `update agency_users au
            set auth_user_id = u.id,
                accepted_at = coalesce(au.accepted_at, now())
           from auth.users u
          where u.email = au.email
            and (au.auth_user_id is null or au.auth_user_id <> u.id)
        returning au.email`,
      );
      if (linked.length === 0) console.log('nenhum usuário novo para ligar');
      for (const r of linked) console.log(`ligado: ${r.email}`);
      break;
    }

    case 'alerts': {
      const agencyId = requireAgency(args);
      await dispatchAlerts({ agencyId, date: args.date ?? toDay(new Date()) });
      break;
    }

    default:
      console.log(USAGE);
  }

  await closeDb();
}

function requireAgency(args: Args): string {
  if (!args.agency) {
    console.error('faltou --agency <uuid>. Use `pulse agencies` para listar.');
    process.exit(1);
  }
  return args.agency;
}

/** Prints the tier spread, which is the number worth watching: §3 wants ≤ 30% em risco. */
async function report(agencyId: string, date: string): Promise<void> {
  const rows = await query<{ tier: string; n: number }>(
    `select h.tier, count(*)::int as n
       from health_scores h
       join locations l on l.id = h.location_id
      where l.agency_id = $1 and h.date = $2::date
      group by h.tier order by h.tier`,
    [agencyId, date],
  );
  const total = rows.reduce((a, r) => a + r.n, 0);
  console.log(`\nScores de ${date} (${total} subcontas):`);
  for (const r of rows) {
    const pct = total > 0 ? Math.round((r.n / total) * 100) : 0;
    console.log(`  ${r.tier.padEnd(12)} ${String(r.n).padStart(3)}  ${String(pct).padStart(3)}%`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
