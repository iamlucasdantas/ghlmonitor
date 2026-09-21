'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { locationHref } from '@/lib/routes';

const TABS = [
  { slug: undefined, label: 'Visão geral' },
  { slug: 'users', label: 'Usuários' },
  { slug: 'sessions', label: 'Sessões' },
  { slug: 'business', label: 'Negócio' },
  { slug: 'timeline', label: 'Timeline' },
  { slug: 'notes', label: 'Notas' },
] as const;

export function Tabs({ id }: { id: string }) {
  const pathname = usePathname();

  return (
    <nav className="flex gap-1 overflow-x-auto border-b border-edge">
      {TABS.map((t) => {
        const href = locationHref(id, t.slug);
        const active = pathname === href;
        return (
          <Link
            key={t.slug ?? 'overview'}
            href={href}
            className={`whitespace-nowrap border-b-2 px-3 py-2 text-sm ${
              active
                ? 'border-blue-500 text-ink'
                : 'border-transparent text-ink-dim hover:text-ink'
            }`}
          >
            {t.label}
          </Link>
        );
      })}
    </nav>
  );
}
