import { createServerClient, type CookieOptions } from '@supabase/ssr';
import { cookies } from 'next/headers';
import { requireSupabaseEnv, supabaseEnv } from './env';

/**
 * Every query from a page goes through this client, which carries the user's own JWT.
 * That is deliberate: authorisation lives in RLS (RF-07.4), so a page cannot
 * accidentally widen what someone sees by forgetting a filter. The service-role key
 * never reaches this app.
 */
export async function supabaseServer() {
  const store = await cookies();
  const env = requireSupabaseEnv();
  return createServerClient(
    env.url,
    env.anonKey,
    {
      cookies: {
        getAll: () => store.getAll(),
        setAll: (list: { name: string; value: string; options: CookieOptions }[]) => {
          try {
            for (const { name, value, options } of list) store.set(name, value, options);
          } catch {
            // Called from a Server Component: middleware refreshes the session instead.
          }
        },
      },
    },
  );
}

export interface CurrentUser {
  agencyUserId: string;
  agencyId: string;
  email: string;
  name: string | null;
  role: 'owner' | 'admin' | 'manager';
  isSuperAdmin: boolean;
  permissions: Record<string, boolean>;
}

/** Resolves the signed-in staff member, or null when there is no session. */
export async function currentUser(): Promise<CurrentUser | null> {
  // Sem configuração ninguém está logado — e quem chama já trata o null.
  if (!supabaseEnv()) return null;
  const db = await supabaseServer();
  const { data: auth } = await db.auth.getUser();
  if (!auth.user) return null;

  const { data: row } = await db
    .from('agency_users')
    .select('id, agency_id, email, name, role, is_super_admin')
    .eq('auth_user_id', auth.user.id)
    .single();
  if (!row) return null;

  const { data: perms } = await db
    .from('user_permissions')
    .select('resource, allowed')
    .eq('agency_user_id', row.id);

  const permissions: Record<string, boolean> = {
    billing: true, sessions_ip: true, users_detail: true,
    export: true, notes: true, alerts_config: true,
  };
  for (const p of perms ?? []) permissions[p.resource] = p.allowed;

  return {
    agencyUserId: row.id,
    agencyId: row.agency_id,
    email: row.email,
    name: row.name,
    role: row.role,
    isSuperAdmin: row.is_super_admin,
    permissions,
  };
}

/** Records who opened which sub-account (RF-07.5). */
export async function auditView(locationId: string, action = 'view_location'): Promise<void> {
  const db = await supabaseServer();
  const me = await currentUser();
  if (!me) return;
  await db.from('audit_log').insert({
    agency_user_id: me.agencyUserId,
    action,
    location_id: locationId,
  });
}
