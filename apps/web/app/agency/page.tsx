import Link from 'next/link';
import { locationHref } from '@/lib/routes';
import { currentUser, supabaseServer } from '@/lib/supabase/server';
import { Card, Empty, Stat, TierBadge } from '@/components/ui/primitives';
import { ActivityChart } from './activity-chart';
import { LocationsTable, type LocationRow } from './locations-table';
import { count, dayLabel, minutes, money } from '@/lib/format';
import type { Tier } from '@/lib/format';

export const dynamic = 'force-dynamic';

interface Summary {
  locations_total: number; healthy: number; at_risk: number;
  critical: number; onboarding: number; mrr_at_risk: number;
}

export default async function AgencyDashboard() {
  const db = await supabaseServer();
  const me = await currentUser();

  /**
   * Every read here hits a pre-aggregated view. The sessions table is never queried
   * from a dashboard — that is what keeps 157 (and 500) sub-accounts under 2s (§12).
   */
  const [summaryRes, locationsRes, seriesRes, changesRes] = await Promise.all([
    db.from('v_agency_summary').select('*').maybeSingle(),
    db.from('v_location_overview')
      .select('location_id, name, tier, score, drivers, delta_7d, last_seen_at, days_since_login, manager_name, plan_name, plan_value, niche')
      .order('score', { ascending: true, nullsFirst: false }),
    db.from('v_metrics_daily').select('date, active_s, msgs_out, msgs_in'),
    db.from('v_recent_tier_changes').select('*').limit(12),
  ]);

  const summary = (summaryRes.data ?? null) as Summary | null;
  const locations = (locationsRes.data ?? []) as LocationRow[];

  // Roll the per-location daily rows up into one agency-wide series (RF-05.2).
  const byDay = new Map<string, { date: string; activeMin: number; msgs: number }>();
  for (const row of seriesRes.data ?? []) {
    const d = row.date as string;
    const bucket = byDay.get(d) ?? { date: d, activeMin: 0, msgs: 0 };
    bucket.activeMin += Math.round(((row.active_s as number) ?? 0) / 60);
    bucket.msgs += ((row.msgs_out as number) ?? 0) + ((row.msgs_in as number) ?? 0);
    byDay.set(d, bucket);
  }
  const series = [...byDay.values()].sort((a, b) => a.date.localeCompare(b.date)).slice(-90);

  const sevenDayActive = series.slice(-7).reduce((a, b) => a + b.activeMin, 0);
  const sevenDayMsgs = series.slice(-7).reduce((a, b) => a + b.msgs, 0);
  const canSeeBilling = me?.permissions.billing !== false;

  return (
    <div className="space-y-6">
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-6">
        <Stat label="Subcontas" value={count(summary?.locations_total ?? locations.length)}
              sub={`${count(summary?.onboarding ?? 0)} em onboarding`} />
        <Stat label="Saudáveis" value={count(summary?.healthy ?? 0)} tone="good" />
        <Stat label="Em risco" value={count(summary?.at_risk ?? 0)} tone="warn" />
        <Stat label="Críticas" value={count(summary?.critical ?? 0)} tone="bad" />
        {canSeeBilling && (
          <Stat label="MRR em risco" value={money(summary?.mrr_at_risk ?? 0)} tone="bad"
                sub="Risco + Crítico" />
        )}
        <Stat label="Atividade 7d" value={minutes(sevenDayActive * 60)}
              sub={`${count(sevenDayMsgs)} mensagens`} />
      </div>

      <Card title="Atividade da agência" hint="Minutos ativos e mensagens por dia">
        {series.length === 0
          ? <Empty>Sem dados ainda. Cole o script de tracking em Integração para começar.</Empty>
          : <ActivityChart data={series} />}
      </Card>

      {(changesRes.data ?? []).length > 0 && (
        <Card title="Mudou de tier esta semana">
          <ul className="divide-y divide-edge text-sm">
            {(changesRes.data ?? []).map((c, i) => (
              <li key={i} className="flex flex-wrap items-center gap-2 py-2">
                <Link href={locationHref(c.location_id)} className="font-medium hover:underline">
                  {c.name ?? '—'}
                </Link>
                <TierBadge tier={c.from_tier as Tier} />
                <span className="text-ink-dim">→</span>
                <TierBadge tier={c.to_tier as Tier} />
                <span className="ml-auto text-xs text-ink-dim">{dayLabel(c.changed_at)}</span>
              </li>
            ))}
          </ul>
        </Card>
      )}

      <Card title="Subcontas" hint="Pior score primeiro">
        {locations.length === 0
          ? <Empty>Nenhuma subconta atribuída a você.</Empty>
          : <LocationsTable rows={locations} canSeeBilling={canSeeBilling} />}
      </Card>
    </div>
  );
}
