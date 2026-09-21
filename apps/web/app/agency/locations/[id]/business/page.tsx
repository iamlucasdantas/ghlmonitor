import { currentUser, supabaseServer } from '@/lib/supabase/server';
import { Card, Empty, Stat } from '@/components/ui/primitives';
import { count, money } from '@/lib/format';
import { BusinessCharts } from './charts';

export const dynamic = 'force-dynamic';

export default async function BusinessTab({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const db = await supabaseServer();
  const me = await currentUser();
  const canSeeBilling = me?.permissions.billing !== false;

  const { data } = await db
    .from('v_metrics_daily')
    .select('date, contacts_total, contacts_new, conversations_active, msgs_in, msgs_out, msgs_by_channel, opps_open, opps_created, opps_won, opps_lost, revenue_won, revenue_coverage, appointments, workflows_active')
    .eq('location_id', id)
    .order('date', { ascending: false })
    .limit(90);

  const rows = data ?? [];
  if (rows.length === 0) {
    return <Empty>Sem métricas de negócio ainda. O primeiro sync roda às 02:00.</Empty>;
  }

  const latest = rows[0]!;
  const last30 = rows.slice(0, 30);
  const sum = (k: string) => last30.reduce((a, r) => a + ((r[k as keyof typeof r] as number) ?? 0), 0);

  const channels = new Map<string, number>();
  for (const r of last30) {
    for (const [ch, n] of Object.entries((r.msgs_by_channel ?? {}) as Record<string, number>)) {
      channels.set(ch, (channels.get(ch) ?? 0) + n);
    }
  }

  const series = [...rows].reverse().map((r) => ({
    date: r.date as string,
    msgsOut: (r.msgs_out as number) ?? 0,
    msgsIn: (r.msgs_in as number) ?? 0,
    contactsNew: (r.contacts_new as number) ?? 0,
  }));

  return (
    <div className="space-y-5">
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
        <Stat label="Contatos" value={count(latest.contacts_total as number)}
              sub={`${count(sum('contacts_new'))} novos em 30d`} />
        <Stat label="Conversas ativas" value={count(latest.conversations_active as number)} />
        <Stat label="Mensagens 30d" value={count(sum('msgs_out') + sum('msgs_in'))}
              sub={`${count(sum('msgs_out'))} enviadas`} />
        <Stat label="Oportunidades abertas" value={count(latest.opps_open as number)}
              sub={`${count(sum('opps_won'))} ganhas em 30d`} />
        {canSeeBilling ? (
          <Stat
            label="Faturamento 30d"
            value={money(sum('revenue_won'))}
            sub={`cobertura ${Math.round((latest.revenue_coverage as number) ?? 0)}%`}
          />
        ) : (
          <Stat label="Faturamento 30d" value="—" sub="sem permissão" />
        )}
      </div>

      <Card title="Mensagens e contatos" hint="90 dias">
        <BusinessCharts data={series} />
      </Card>

      <div className="grid gap-5 lg:grid-cols-2">
        <Card title="Mensagens por canal" hint="30 dias">
          {channels.size === 0 ? <Empty>Sem mensagens no período.</Empty> : (
            <ul className="space-y-2 text-sm">
              {[...channels.entries()].sort((a, b) => b[1] - a[1]).map(([ch, n]) => (
                <li key={ch} className="flex items-center gap-3">
                  <span className="w-24 text-ink-dim capitalize">{ch}</span>
                  <span className="h-2 flex-1 overflow-hidden rounded bg-panel-2">
                    <span
                      className="block h-full rounded bg-blue-500"
                      style={{ width: `${(n / Math.max(...channels.values())) * 100}%` }}
                    />
                  </span>
                  <span className="w-12 text-right">{count(n)}</span>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card title="Funil e automação" hint="Situação atual">
          <dl className="space-y-2 text-sm">
            <Row label="Oportunidades abertas" value={count(latest.opps_open as number)} />
            <Row label="Criadas em 30d" value={count(sum('opps_created'))} />
            <Row label="Ganhas em 30d" value={count(sum('opps_won'))} />
            <Row label="Perdidas em 30d" value={count(sum('opps_lost'))} />
            <Row label="Agendamentos 30d" value={count(sum('appointments'))} />
            <Row label="Workflows ativos" value={count(latest.workflows_active as number)} />
            {canSeeBilling && (
              <Row
                label="Cobertura de faturamento"
                value={`${Math.round((latest.revenue_coverage as number) ?? 0)}%`}
              />
            )}
          </dl>
        </Card>
      </div>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-4">
      <dt className="text-ink-dim">{label}</dt>
      <dd className="font-medium">{value}</dd>
    </div>
  );
}
