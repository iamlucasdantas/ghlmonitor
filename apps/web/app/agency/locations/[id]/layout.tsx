import Link from 'next/link';
import { notFound } from 'next/navigation';
import { auditView, supabaseServer } from '@/lib/supabase/server';
import { TierBadge } from '@/components/ui/primitives';
import { dateTime, money, type Tier } from '@/lib/format';
import { Tabs } from './tabs';

export default async function LocationLayout({
  children, params,
}: { children: React.ReactNode; params: Promise<{ id: string }> }) {
  const { id } = await params;
  const db = await supabaseServer();

  // RLS decides this: a manager without access gets no row, and the page 404s.
  const { data } = await db
    .from('v_location_overview')
    .select('location_id, name, tier, score, manager_name, plan_name, plan_value, installed_at, niche')
    .eq('location_id', id)
    .maybeSingle();

  if (!data) notFound();
  await auditView(id);

  return (
    <div className="space-y-5">
      <header className="flex flex-wrap items-start gap-x-6 gap-y-3">
        <div>
          <Link href="/agency" className="text-xs text-ink-dim hover:text-ink">← Subcontas</Link>
          <h1 className="mt-1 text-xl font-semibold">{data.name ?? '—'}</h1>
          <p className="text-xs text-ink-dim">
            {data.niche ?? 'sem nicho'} · instalada em {dateTime(data.installed_at)}
          </p>
        </div>
        <div className="flex items-center gap-4">
          <div>
            <div className="text-xs uppercase tracking-wide text-ink-dim">Score</div>
            <div className="text-2xl font-semibold">{data.score ?? '—'}</div>
          </div>
          <TierBadge tier={data.tier as Tier} />
        </div>
        <div className="ml-auto text-right text-xs text-ink-dim">
          <div>Gerente: {data.manager_name ?? 'não atribuído'}</div>
          <div>
            Plano: {data.plan_name ?? '—'}
            {data.plan_value != null && ` (${money(data.plan_value)})`}
          </div>
        </div>
      </header>

      <Tabs id={id} />
      {children}
    </div>
  );
}
