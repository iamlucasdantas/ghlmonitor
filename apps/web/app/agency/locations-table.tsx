'use client';

import Link from 'next/link';
import { locationHref } from '@/lib/routes';
import { useMemo, useState } from 'react';
import { DriverChip, Delta, TierBadge } from '@/components/ui/primitives';
import { money, sinceDays, TIER_LABEL, type Tier } from '@/lib/format';

export interface LocationRow {
  location_id: string;
  name: string | null;
  tier: Tier | null;
  score: number | null;
  drivers: { label: string; points: number }[] | null;
  delta_7d: number | null;
  last_seen_at: string | null;
  days_since_login: number | null;
  manager_name: string | null;
  plan_name: string | null;
  plan_value: number | null;
  niche: string | null;
}

const TIERS: Tier[] = ['critical', 'at_risk', 'healthy', 'onboarding'];

/**
 * The table is the tool. Default order is worst score first (RF-05.3) — the point is
 * that the sub-account about to churn is the first thing on screen, not something you
 * have to sort for.
 */
export function LocationsTable({
  rows, canSeeBilling,
}: { rows: LocationRow[]; canSeeBilling: boolean }) {
  const [search, setSearch] = useState('');
  const [tier, setTier] = useState<Tier | 'all'>('all');
  const [manager, setManager] = useState<string>('all');

  const managers = useMemo(
    () => [...new Set(rows.map((r) => r.manager_name).filter(Boolean))] as string[],
    [rows],
  );

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rows.filter((r) => {
      if (tier !== 'all' && r.tier !== tier) return false;
      if (manager !== 'all' && r.manager_name !== manager) return false;
      if (q && !(r.name ?? '').toLowerCase().includes(q) && !(r.niche ?? '').toLowerCase().includes(q)) {
        return false;
      }
      return true;
    });
  }, [rows, search, tier, manager]);

  return (
    <div>
      <div className="mb-3 flex flex-wrap gap-2">
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Buscar subconta ou nicho"
          className="min-w-[12rem] flex-1 rounded-lg border border-edge bg-panel-2 px-3 py-1.5 text-sm outline-none focus:ring-2 focus:ring-blue-500/40"
        />
        <select
          value={tier}
          onChange={(e) => setTier(e.target.value as Tier | 'all')}
          className="rounded-lg border border-edge bg-panel-2 px-3 py-1.5 text-sm"
        >
          <option value="all">Todos os tiers</option>
          {TIERS.map((t) => <option key={t} value={t}>{TIER_LABEL[t]}</option>)}
        </select>
        {managers.length > 0 && (
          <select
            value={manager}
            onChange={(e) => setManager(e.target.value)}
            className="rounded-lg border border-edge bg-panel-2 px-3 py-1.5 text-sm"
          >
            <option value="all">Todos os gerentes</option>
            {managers.map((m) => <option key={m} value={m}>{m}</option>)}
          </select>
        )}
        <span className="self-center text-xs text-ink-dim">
          {filtered.length} de {rows.length}
        </span>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full min-w-[56rem] text-sm">
          <thead>
            <tr className="border-b border-edge text-left text-xs uppercase tracking-wide text-ink-dim">
              <th className="py-2 pr-3 font-medium">Subconta</th>
              <th className="py-2 pr-3 font-medium">Tier</th>
              <th className="py-2 pr-3 font-medium">Score</th>
              <th className="py-2 pr-3 font-medium">7d</th>
              <th className="py-2 pr-3 font-medium">Por quê</th>
              <th className="py-2 pr-3 font-medium">Último login</th>
              <th className="py-2 pr-3 font-medium">Gerente</th>
              <th className="py-2 font-medium">Plano</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-edge">
            {filtered.map((r) => (
              <tr key={r.location_id} className="hover:bg-panel-2">
                <td className="py-2 pr-3">
                  <Link href={locationHref(r.location_id)} className="font-medium hover:underline">
                    {r.name ?? '—'}
                  </Link>
                  {r.niche && <div className="text-xs text-ink-dim">{r.niche}</div>}
                </td>
                <td className="py-2 pr-3"><TierBadge tier={r.tier} /></td>
                <td className="py-2 pr-3 font-semibold">{r.score ?? '—'}</td>
                <td className="py-2 pr-3"><Delta value={r.delta_7d} /></td>
                <td className="py-2 pr-3">
                  <div className="flex flex-wrap gap-1">
                    {(r.drivers ?? []).slice(0, 2).map((d, i) => <DriverChip key={i} label={d.label} />)}
                    {(r.drivers ?? []).length > 2 && (
                      <span className="text-xs text-ink-dim">+{(r.drivers ?? []).length - 2}</span>
                    )}
                  </div>
                </td>
                <td className="py-2 pr-3 text-ink-dim">{sinceDays(r.last_seen_at)}</td>
                <td className="py-2 pr-3 text-ink-dim">{r.manager_name ?? '—'}</td>
                <td className="py-2 text-ink-dim">
                  {r.plan_name ?? '—'}
                  {canSeeBilling && r.plan_value != null && (
                    <span className="ml-1 text-xs">({money(r.plan_value)})</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
