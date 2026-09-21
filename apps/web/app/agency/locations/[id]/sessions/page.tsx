import { supabaseServer } from '@/lib/supabase/server';
import { Card, Empty } from '@/components/ui/primitives';
import { dateTime, minutes } from '@/lib/format';

export const dynamic = 'force-dynamic';

const PAGE_SIZE = 50;

export default async function SessionsTab({
  params, searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ page?: string }>;
}) {
  const { id } = await params;
  const { page } = await searchParams;
  const pageNum = Math.max(1, Number(page ?? 1) || 1);
  const from = (pageNum - 1) * PAGE_SIZE;

  const db = await supabaseServer();
  const { data, count: total } = await db
    .from('v_sessions')
    .select('id, started_at, ended_at, duration_s, active_s, heartbeats, pages, ip, city, country, device, end_reason, ghl_user_id', { count: 'exact' })
    .eq('location_id', id)
    .order('started_at', { ascending: false })
    .range(from, from + PAGE_SIZE - 1);

  const { data: users } = await db
    .from('v_ghl_users').select('id, name').eq('location_id', id);
  const nameOf = new Map((users ?? []).map((u) => [u.id as string, (u.name as string) ?? '—']));

  const rows = data ?? [];
  const lastPage = Math.max(1, Math.ceil((total ?? 0) / PAGE_SIZE));

  return (
    <Card title="Log de sessões" hint={`${total ?? 0} sessões contabilizadas`}>
      {rows.length === 0 ? (
        <Empty>
          Nenhuma sessão ainda. Heartbeats sem interação não contam como sessão — é isso
          que impede a contagem de &quot;10 sessões, 0 min&quot;.
        </Empty>
      ) : (
        <>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[56rem] text-sm">
              <thead>
                <tr className="border-b border-edge text-left text-xs uppercase tracking-wide text-ink-dim">
                  <th className="py-2 pr-3 font-medium">Início</th>
                  <th className="py-2 pr-3 font-medium">Usuário</th>
                  <th className="py-2 pr-3 font-medium">Duração</th>
                  <th className="py-2 pr-3 font-medium">Ativo</th>
                  <th className="py-2 pr-3 font-medium">Páginas</th>
                  <th className="py-2 pr-3 font-medium">Origem</th>
                  <th className="py-2 pr-3 font-medium">Dispositivo</th>
                  <th className="py-2 font-medium">Fim</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-edge">
                {rows.map((s) => (
                  <tr key={s.id as string} className="hover:bg-panel-2">
                    <td className="py-2 pr-3">{dateTime(s.started_at as string)}</td>
                    <td className="py-2 pr-3">{nameOf.get(s.ghl_user_id as string) ?? '—'}</td>
                    <td className="py-2 pr-3">{minutes(s.duration_s as number)}</td>
                    <td className="py-2 pr-3 font-medium">{minutes(s.active_s as number)}</td>
                    <td className="py-2 pr-3 text-xs text-ink-dim">
                      {((s.pages ?? []) as { path: string }[]).slice(0, 3).map((p) => p.path).join(' · ') || '—'}
                    </td>
                    <td className="py-2 pr-3 text-ink-dim">
                      {[s.city, s.country].filter(Boolean).join(', ') || '—'}
                      {s.ip ? <div className="text-xs">{String(s.ip)}</div> : null}
                    </td>
                    <td className="py-2 pr-3 text-ink-dim">{(s.device as string) ?? '—'}</td>
                    <td className="py-2 text-xs text-ink-dim">{(s.end_reason as string) ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {lastPage > 1 && (
            <nav className="mt-3 flex items-center justify-between text-sm">
              <a
                aria-disabled={pageNum <= 1}
                href={`?page=${pageNum - 1}`}
                className={pageNum <= 1 ? 'pointer-events-none text-ink-dim/40' : 'text-ink-dim hover:text-ink'}
              >
                ← Anterior
              </a>
              <span className="text-xs text-ink-dim">Página {pageNum} de {lastPage}</span>
              <a
                aria-disabled={pageNum >= lastPage}
                href={`?page=${pageNum + 1}`}
                className={pageNum >= lastPage ? 'pointer-events-none text-ink-dim/40' : 'text-ink-dim hover:text-ink'}
              >
                Próxima →
              </a>
            </nav>
          )}
        </>
      )}
    </Card>
  );
}
