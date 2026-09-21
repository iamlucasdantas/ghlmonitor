import { redirect } from 'next/navigation';
import { currentUser, supabaseServer } from '@/lib/supabase/server';
import { Card, Empty } from '@/components/ui/primitives';
import { dateTime } from '@/lib/format';

export const dynamic = 'force-dynamic';

/** RF-09.1 — the fleet view. Only super-admins get here; RLS agrees. */
export default async function SuperAdminPage() {
  const me = await currentUser();
  if (!me?.isSuperAdmin) redirect('/agency');

  const db = await supabaseServer();
  const { data } = await db
    .from('agencies')
    .select('id, name, ghl_company_id, install_status, last_script_event_at, last_sync_at, last_sync_status, timezone, created_at')
    .order('created_at', { ascending: false });

  const agencies = data ?? [];

  return (
    <Card title="Agências" hint={`${agencies.length} instaladas`}>
      {agencies.length === 0 ? (
        <Empty>Nenhuma agência instalada.</Empty>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[52rem] text-sm">
            <thead>
              <tr className="border-b border-edge text-left text-xs uppercase tracking-wide text-ink-dim">
                <th className="py-2 pr-3 font-medium">Agência</th>
                <th className="py-2 pr-3 font-medium">OAuth</th>
                <th className="py-2 pr-3 font-medium">Último evento do script</th>
                <th className="py-2 pr-3 font-medium">Último sync</th>
                <th className="py-2 font-medium">Fuso</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-edge">
              {agencies.map((a) => {
                const stale =
                  !a.last_script_event_at ||
                  Date.now() - new Date(a.last_script_event_at).getTime() > 6 * 3600_000;
                return (
                  <tr key={a.id as string} className="hover:bg-panel-2">
                    <td className="py-2 pr-3">
                      <div className="font-medium">{a.name as string}</div>
                      <div className="text-xs text-ink-dim">{a.ghl_company_id as string}</div>
                    </td>
                    <td className="py-2 pr-3">
                      <span className={a.install_status === 'active' ? 'text-emerald-300' : 'text-rose-300'}>
                        {a.install_status as string}
                      </span>
                    </td>
                    <td className={`py-2 pr-3 ${stale ? 'text-amber-300' : 'text-ink-dim'}`}>
                      {dateTime(a.last_script_event_at as string)}
                      {stale && <div className="text-xs">&gt; 6h sem eventos</div>}
                    </td>
                    <td className="py-2 pr-3 text-ink-dim">
                      {dateTime(a.last_sync_at as string)}
                      <div className="text-xs">{(a.last_sync_status as string) ?? '—'}</div>
                    </td>
                    <td className="py-2 text-ink-dim">{a.timezone as string}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}
