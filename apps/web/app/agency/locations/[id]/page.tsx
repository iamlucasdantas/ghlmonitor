import { supabaseServer } from '@/lib/supabase/server';
import { Card, Empty } from '@/components/ui/primitives';
import { ScoreHistory } from './score-history';
import { count, minutes } from '@/lib/format';

export const dynamic = 'force-dynamic';

interface Driver {
  signal: string; label: string; points: number;
  value: number | null; baseline: number | null; weight: number;
}

export default async function LocationOverview({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const db = await supabaseServer();

  const [scoreRes, historyRes, metricsRes] = await Promise.all([
    db.from('health_scores').select('score, tier, drivers, delta_7d, date')
      .eq('location_id', id).order('date', { ascending: false }).limit(1).maybeSingle(),
    db.from('health_scores').select('date, score')
      .eq('location_id', id).order('date', { ascending: true }).limit(90),
    db.from('v_metrics_daily')
      .select('date, active_s, msgs_out, msgs_in, contacts_new, sessions')
      .eq('location_id', id).order('date', { ascending: false }).limit(30),
  ]);

  const drivers = (scoreRes.data?.drivers ?? []) as Driver[];
  const metrics = metricsRes.data ?? [];
  const last7 = metrics.slice(0, 7);
  const sum = (key: string) => last7.reduce((a, r) => a + ((r[key as keyof typeof r] as number) ?? 0), 0);

  return (
    <div className="grid gap-5 lg:grid-cols-3">
      <Card title="Por que este score" className="lg:col-span-2">
        {drivers.length === 0 ? (
          <Empty>Nenhum sinal puxando o score para baixo.</Empty>
        ) : (
          <ul className="divide-y divide-edge">
            {drivers.map((d) => (
              <li key={d.signal} className="flex items-start gap-4 py-3">
                <span className="mt-0.5 rounded bg-panel-2 px-1.5 py-0.5 text-xs text-ink-dim">
                  {d.signal}
                </span>
                <div className="flex-1">
                  <div className="text-sm">{d.label}</div>
                  {d.baseline != null && (
                    <div className="mt-0.5 text-xs text-ink-dim">
                      Atual {fmt(d.value)} · média 30d {fmt(d.baseline)}
                    </div>
                  )}
                </div>
                <span className="text-sm font-semibold text-rose-300">−{Math.round(d.points)}</span>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card title="Últimos 7 dias">
        <dl className="space-y-2 text-sm">
          <Row label="Tempo ativo" value={minutes(sum('active_s'))} />
          <Row label="Sessões" value={count(sum('sessions'))} />
          <Row label="Mensagens enviadas" value={count(sum('msgs_out'))} />
          <Row label="Mensagens recebidas" value={count(sum('msgs_in'))} />
          <Row label="Contatos novos" value={count(sum('contacts_new'))} />
        </dl>
      </Card>

      <Card title="Histórico de score" hint="90 dias" className="lg:col-span-3">
        {(historyRes.data ?? []).length < 2
          ? <Empty>Histórico começa a aparecer após alguns dias de dados.</Empty>
          : <ScoreHistory data={(historyRes.data ?? []) as { date: string; score: number }[]} />}
      </Card>
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

function fmt(v: number | null): string {
  if (v === null) return '—';
  return Math.abs(v) < 1 ? `${Math.round(v * 100)}%` : count(Math.round(v));
}
