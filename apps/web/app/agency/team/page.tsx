import { revalidatePath } from 'next/cache';
import { currentUser, supabaseServer } from '@/lib/supabase/server';
import { Card, Empty } from '@/components/ui/primitives';
import { TeamMember, type MemberRow } from './member';

export const dynamic = 'force-dynamic';

const RESOURCES = [
  { key: 'billing', label: 'Faturamento' },
  { key: 'sessions_ip', label: 'IP e cidade' },
  { key: 'users_detail', label: 'Detalhe de usuários' },
  { key: 'export', label: 'Exportar' },
  { key: 'notes', label: 'Notas' },
  { key: 'alerts_config', label: 'Configurar alertas' },
] as const;

export default async function TeamPage() {
  const db = await supabaseServer();
  const me = await currentUser();
  const canManage = me?.role === 'owner' || me?.role === 'admin';

  const [membersRes, permsRes, locationsRes, accessRes] = await Promise.all([
    db.from('agency_users').select('id, name, email, role, accepted_at').order('role'),
    db.from('user_permissions').select('agency_user_id, resource, allowed'),
    db.from('v_location_overview').select('location_id, name').order('name'),
    db.from('user_location_access').select('agency_user_id, location_id'),
  ]);

  const permsByUser = new Map<string, Record<string, boolean>>();
  for (const p of permsRes.data ?? []) {
    const bucket = permsByUser.get(p.agency_user_id as string) ?? {};
    bucket[p.resource as string] = p.allowed as boolean;
    permsByUser.set(p.agency_user_id as string, bucket);
  }

  const accessByUser = new Map<string, string[]>();
  for (const a of accessRes.data ?? []) {
    const list = accessByUser.get(a.agency_user_id as string) ?? [];
    list.push(a.location_id as string);
    accessByUser.set(a.agency_user_id as string, list);
  }

  const locations = (locationsRes.data ?? []).map((l) => ({
    id: l.location_id as string,
    name: (l.name as string) ?? '—',
  }));

  /** RF-07.1 — the owner invites by e-mail; Supabase Auth links the login later. */
  async function invite(formData: FormData) {
    'use server';
    const email = String(formData.get('email') ?? '').trim().toLowerCase();
    const role = String(formData.get('role') ?? 'manager');
    if (!email || !['admin', 'manager'].includes(role)) return;

    const supabase = await supabaseServer();
    const inviter = await currentUser();
    if (!inviter) return;

    await supabase.from('agency_users').insert({
      agency_id: inviter.agencyId, email, role, invited_at: new Date().toISOString(),
    });
    revalidatePath('/agency/team');
  }

  const members = (membersRes.data ?? []).map((m) => ({
    id: m.id as string,
    name: m.name as string | null,
    email: m.email as string,
    role: m.role as MemberRow['role'],
    acceptedAt: m.accepted_at as string | null,
    permissions: permsByUser.get(m.id as string) ?? {},
    locationIds: accessByUser.get(m.id as string) ?? [],
  }));

  return (
    <div className="space-y-5">
      {canManage && (
        <Card title="Convidar" hint="O acesso é criado no primeiro login">
          <form action={invite} className="flex flex-wrap gap-2">
            <input
              name="email" type="email" required placeholder="pessoa@agencia.com"
              className="min-w-[14rem] flex-1 rounded-lg border border-edge bg-panel-2 px-3 py-1.5 text-sm outline-none focus:ring-2 focus:ring-blue-500/40"
            />
            <select name="role" className="rounded-lg border border-edge bg-panel-2 px-3 py-1.5 text-sm">
              <option value="manager">Gerente</option>
              <option value="admin">Admin</option>
            </select>
            <button className="rounded-lg bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-500">
              Convidar
            </button>
          </form>
        </Card>
      )}

      <Card title="Equipe" hint={`${members.length} pessoa(s)`}>
        {members.length === 0 ? (
          <Empty>Nenhum usuário ainda.</Empty>
        ) : (
          <ul className="divide-y divide-edge">
            {members.map((m) => (
              <TeamMember
                key={m.id}
                member={m}
                locations={locations}
                resources={RESOURCES as unknown as { key: string; label: string }[]}
                canManagePermissions={me?.role === 'owner'}
                canManageAccess={canManage}
              />
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
