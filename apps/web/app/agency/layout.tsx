import Link from 'next/link';
import { redirect } from 'next/navigation';
import { currentUser } from '@/lib/supabase/server';

const NAV = [
  { href: '/agency', label: 'Visão geral' },
  { href: '/agency/team', label: 'Equipe' },
  { href: '/agency/alerts', label: 'Alertas' },
  { href: '/agency/setup', label: 'Integração' },
] as const;

export default async function AgencyLayout({ children }: { children: React.ReactNode }) {
  const me = await currentUser();
  if (!me) redirect('/login');

  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-10 border-b border-edge bg-surface/90 backdrop-blur">
        <div className="mx-auto flex max-w-[1400px] flex-wrap items-center gap-x-6 gap-y-2 px-4 py-3">
          <Link href="/agency" className="text-sm font-semibold tracking-tight">Pulse</Link>
          <nav className="flex flex-1 flex-wrap items-center gap-4 text-sm">
            {NAV.map((item) => (
              <Link key={item.href} href={item.href} className="text-ink-dim hover:text-ink">
                {item.label}
              </Link>
            ))}
            {me.isSuperAdmin && (
              <Link href="/superadmin" className="text-ink-dim hover:text-ink">Super-admin</Link>
            )}
          </nav>
          <span className="text-xs text-ink-dim">
            {me.name ?? me.email} · {roleLabel(me.role)}
          </span>
        </div>
      </header>
      <main className="mx-auto max-w-[1400px] px-4 py-6">{children}</main>
    </div>
  );
}

function roleLabel(role: string): string {
  return { owner: 'Owner', admin: 'Admin', manager: 'Gerente' }[role] ?? role;
}
