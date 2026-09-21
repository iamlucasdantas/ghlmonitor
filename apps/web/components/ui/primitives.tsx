import type { ReactNode } from 'react';
import { TIER_CLASS, TIER_LABEL, type Tier } from '@/lib/format';

export function Card({
  title, hint, children, className = '',
}: { title?: string; hint?: string; children: ReactNode; className?: string }) {
  return (
    <section className={`rounded-xl border border-edge bg-panel p-4 ${className}`}>
      {title && (
        <header className="mb-3 flex items-baseline justify-between gap-2">
          <h2 className="text-sm font-medium text-ink">{title}</h2>
          {hint && <span className="text-xs text-ink-dim">{hint}</span>}
        </header>
      )}
      {children}
    </section>
  );
}

export function Stat({
  label, value, sub, tone = 'neutral',
}: { label: string; value: ReactNode; sub?: ReactNode; tone?: 'neutral' | 'warn' | 'bad' | 'good' }) {
  const toneClass = {
    neutral: 'text-ink', warn: 'text-amber-300', bad: 'text-rose-300', good: 'text-emerald-300',
  }[tone];
  return (
    <div className="rounded-xl border border-edge bg-panel p-4">
      <div className="text-xs uppercase tracking-wide text-ink-dim">{label}</div>
      <div className={`mt-1 text-2xl font-semibold ${toneClass}`}>{value}</div>
      {sub && <div className="mt-1 text-xs text-ink-dim">{sub}</div>}
    </div>
  );
}

export function TierBadge({ tier }: { tier: Tier | null }) {
  if (!tier) return <span className="text-ink-dim">—</span>;
  return (
    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset ${TIER_CLASS[tier]}`}>
      {TIER_LABEL[tier]}
    </span>
  );
}

/** A driver chip. The label already arrives ready to read from the score engine. */
export function DriverChip({ label }: { label: string }) {
  return (
    <span className="inline-flex max-w-[22rem] truncate rounded-md bg-panel-2 px-2 py-0.5 text-xs text-ink-dim ring-1 ring-inset ring-edge">
      {label}
    </span>
  );
}

export function Skeleton({ className = '' }: { className?: string }) {
  return <div className={`animate-pulse rounded-md bg-panel-2 ${className}`} />;
}

export function Empty({ children }: { children: ReactNode }) {
  return (
    <div className="rounded-xl border border-dashed border-edge p-8 text-center text-sm text-ink-dim">
      {children}
    </div>
  );
}

export function Delta({ value }: { value: number | null }) {
  if (value === null || value === 0) return <span className="text-ink-dim">—</span>;
  const good = value > 0;
  return (
    <span className={good ? 'text-emerald-300' : 'text-rose-300'}>
      {good ? '▲' : '▼'} {Math.abs(value)}
    </span>
  );
}
