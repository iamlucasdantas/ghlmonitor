import { supabaseServer } from '@/lib/supabase/server';
import { Card, Empty } from '@/components/ui/primitives';
import { count, dateTime, minutes, sinceDays } from '@/lib/format';

export const dynamic = 'force-dynamic';

export default async function UsersTab({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const db = await supabaseServer();

  // The view nulls email / city / ip for users without those permissions (RF-07.3),
  // so the page renders the same either way — nothing to branch on here.
  const [usersRes, statsRes] = await Promise.all([
    db.from('v_ghl_users')
      .select('id, name, email, role, last_seen_at, last_city, last_ip, last_country, last_page, pending')
      .eq('location_id', id)
      .order('last_seen_at', { ascending: false, nullsFirst: false }),
    db.from('v_sessions')
      .select('ghl_user_id, active_s, pages')
      .eq('location_id', id)
      .gte('started_at', new Date(Date.now() - 30 * 86_400_000).toISOString()),
  ]);

  const byUser = new Map<string, { sessions: number; activeS: number; pages: Map<string, number> }>();
  for (const s of statsRes.data ?? []) {
    const key = s.ghl_user_id as string;
    if (!key) continue;
    const entry = byUser.get(key) ?? { sessions: 0, activeS: 0, pages: new Map() };
    entry.sessions += 1;
    entry.activeS += (s.active_s as number) ?? 0;
    for (const p of (s.pages ?? []) as { path: string; seconds: number }[]) {
      entry.pages.set(p.path, (entry.pages.get(p.path) ?? 0) + p.seconds);
    }
    byUser.set(key, entry);
  }

  const users = usersRes.data ?? [];

  return (
    <Card title="Usuários da subconta" hint={`${users.length} cadastrados`}>
      {users.length === 0 ? (
        <Empty>Nenhum usuário importado ainda.</Empty>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[52rem] text-sm">
            <thead>
              <tr className="border-b border-edge text-left text-xs uppercase tracking-wide text-ink-dim">
                <th className="py-2 pr-3 font-medium">Usuário</th>
                <th className="py-2 pr-3 font-medium">Papel</th>
                <th className="py-2 pr-3 font-medium">Último login</th>
                <th className="py-2 pr-3 font-medium">Última origem</th>
                <th className="py-2 pr-3 font-medium">Sessões 30d</th>
                <th className="py-2 pr-3 font-medium">Média/sessão</th>
                <th className="py-2 font-medium">Páginas mais usadas</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-edge">
              {users.map((u) => {
                const stats = byUser.get(u.id as string);
                const sessions = stats?.sessions ?? 0;
                const topPages = [...(stats?.pages ?? new Map()).entries()]
                  .sort((a, b) => b[1] - a[1]).slice(0, 3);
                return (
                  <tr key={u.id as string} className="hover:bg-panel-2">
                    <td className="py-2 pr-3">
                      <div className="font-medium">{(u.name as string) ?? '—'}</div>
                      <div className="text-xs text-ink-dim">
                        {(u.email as string) ?? 'e-mail oculto'}
                        {u.pending ? ' · aguardando sync' : ''}
                      </div>
                    </td>
                    <td className="py-2 pr-3 text-ink-dim">{(u.role as string) ?? '—'}</td>
                    <td className="py-2 pr-3">
                      <div>{sinceDays(u.last_seen_at as string)}</div>
                      <div className="text-xs text-ink-dim">{dateTime(u.last_seen_at as string)}</div>
                    </td>
                    <td className="py-2 pr-3 text-ink-dim">
                      {[u.last_city, u.last_country].filter(Boolean).join(', ') || '—'}
                      {u.last_ip ? <div className="text-xs">{String(u.last_ip)}</div> : null}
                    </td>
                    <td className="py-2 pr-3">{count(sessions)}</td>
                    <td className="py-2 pr-3">
                      {sessions > 0 ? minutes((stats?.activeS ?? 0) / sessions) : '—'}
                    </td>
                    <td className="py-2 text-xs text-ink-dim">
                      {topPages.length === 0
                        ? '—'
                        : topPages.map(([p, s]) => `${p} (${minutes(s)})`).join(' · ')}
                    </td>
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
