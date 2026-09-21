import { revalidatePath } from 'next/cache';
import { currentUser, supabaseServer } from '@/lib/supabase/server';
import { Card, Empty } from '@/components/ui/primitives';
import { dateTime } from '@/lib/format';

export const dynamic = 'force-dynamic';

const TYPE_LABEL: Record<string, string> = {
  entered_critical: 'Entrou em Crítico',
  no_login: 'Sem login há N dias',
  messages_drop: 'Queda de mensagens',
  new_country_login: 'Login de país novo',
  payment_failed: 'Pagamento falhou',
  weekly_digest: 'Digest semanal',
};

export default async function AlertsPage() {
  const db = await supabaseServer();
  const me = await currentUser();
  const canConfigure =
    (me?.role === 'owner' || me?.role === 'admin') && me?.permissions.alerts_config !== false;

  const [rulesRes, historyRes] = await Promise.all([
    db.from('alert_rules').select('id, type, params, channels, enabled').order('type'),
    db.from('alerts')
      .select('id, fired_at, payload, delivery_status, location_id')
      .order('fired_at', { ascending: false })
      .limit(50),
  ]);

  async function toggleRule(formData: FormData) {
    'use server';
    const id = String(formData.get('id'));
    const enabled = formData.get('enabled') === 'true';
    const supabase = await supabaseServer();
    await supabase.from('alert_rules').update({ enabled: !enabled }).eq('id', id);
    revalidatePath('/agency/alerts');
  }

  const rules = rulesRes.data ?? [];
  const history = historyRes.data ?? [];

  return (
    <div className="space-y-5">
      <Card title="Regras" hint={canConfigure ? 'Clique para ligar ou desligar' : 'Somente leitura'}>
        {rules.length === 0 ? (
          <Empty>Nenhuma regra. As padrões são criadas na instalação.</Empty>
        ) : (
          <ul className="divide-y divide-edge">
            {rules.map((r) => (
              <li key={r.id as string} className="flex flex-wrap items-center gap-3 py-3">
                <div className="flex-1">
                  <div className="text-sm font-medium">
                    {TYPE_LABEL[r.type as string] ?? (r.type as string)}
                  </div>
                  <div className="text-xs text-ink-dim">
                    {describeParams(r.params as Record<string, unknown>)} ·{' '}
                    {describeChannels(r.channels as { kind: string; to?: string }[])}
                  </div>
                </div>
                {canConfigure ? (
                  <form action={toggleRule}>
                    <input type="hidden" name="id" value={r.id as string} />
                    <input type="hidden" name="enabled" value={String(r.enabled)} />
                    <button
                      className={`rounded-full px-3 py-1 text-xs ring-1 ring-inset ${
                        r.enabled
                          ? 'bg-emerald-500/15 text-emerald-300 ring-emerald-500/30'
                          : 'bg-slate-500/15 text-slate-300 ring-slate-500/30'
                      }`}
                    >
                      {r.enabled ? 'Ativa' : 'Desligada'}
                    </button>
                  </form>
                ) : (
                  <span className="text-xs text-ink-dim">{r.enabled ? 'Ativa' : 'Desligada'}</span>
                )}
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card title="Disparos recentes" hint="Cooldown de 72h por regra e subconta">
        {history.length === 0 ? (
          <Empty>Nenhum alerta disparado ainda.</Empty>
        ) : (
          <ul className="divide-y divide-edge">
            {history.map((a) => {
              const p = (a.payload ?? {}) as {
                location_name?: string; score?: number; drivers?: string[]; event?: string;
              };
              return (
                <li key={a.id as string} className="flex flex-wrap items-start gap-3 py-3 text-sm">
                  <div className="flex-1">
                    <div className="font-medium">
                      {p.location_name ?? '—'}
                      <span className="ml-2 text-xs text-ink-dim">
                        {TYPE_LABEL[p.event ?? ''] ?? p.event}
                      </span>
                    </div>
                    {p.drivers && p.drivers.length > 0 && (
                      <div className="text-xs text-ink-dim">{p.drivers.join(' · ')}</div>
                    )}
                  </div>
                  <span
                    className={`text-xs ${
                      a.delivery_status === 'sent' ? 'text-emerald-300' : 'text-amber-300'
                    }`}
                  >
                    {a.delivery_status === 'sent' ? 'enviado' : String(a.delivery_status)}
                  </span>
                  <span className="text-xs text-ink-dim">{dateTime(a.fired_at as string)}</span>
                </li>
              );
            })}
          </ul>
        )}
      </Card>
    </div>
  );
}

function describeParams(params: Record<string, unknown>): string {
  if (typeof params['days'] === 'number') return `${params['days']} dias`;
  if (typeof params['drop_pct'] === 'number') return `queda > ${params['drop_pct']}%`;
  if (typeof params['hour'] === 'number') return `segunda ${String(params['hour']).padStart(2, '0')}:00`;
  return 'sem parâmetros';
}

function describeChannels(channels: { kind: string; to?: string }[]): string {
  if (!channels || channels.length === 0) return 'sem canal';
  return channels
    .map((c) => (c.kind === 'email' ? `e-mail para ${c.to ?? 'gerente'}` : c.kind))
    .join(', ');
}
