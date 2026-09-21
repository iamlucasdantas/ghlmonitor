export type Tier = 'onboarding' | 'healthy' | 'at_risk' | 'critical';

export const TIER_LABEL: Record<Tier, string> = {
  onboarding: 'Onboarding',
  healthy: 'Saudável',
  at_risk: 'Em risco',
  critical: 'Crítico',
};

/** Tier colours are the one piece of colour the panel spends (§10). */
export const TIER_CLASS: Record<Tier, string> = {
  onboarding: 'bg-slate-500/15 text-slate-300 ring-slate-500/30',
  healthy: 'bg-emerald-500/15 text-emerald-300 ring-emerald-500/30',
  at_risk: 'bg-amber-500/15 text-amber-300 ring-amber-500/30',
  critical: 'bg-rose-500/15 text-rose-300 ring-rose-500/30',
};

export function minutes(seconds: number | null | undefined): string {
  const s = seconds ?? 0;
  if (s < 60) return `${Math.round(s)}s`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  return `${h}h ${m % 60}min`;
}

export function money(value: number | null | undefined): string {
  if (value === null || value === undefined) return '—';
  return new Intl.NumberFormat('pt-BR', {
    style: 'currency', currency: 'BRL', maximumFractionDigits: 0,
  }).format(value);
}

export function count(value: number | null | undefined): string {
  if (value === null || value === undefined) return '—';
  return new Intl.NumberFormat('pt-BR').format(value);
}

export function dateTime(value: string | Date | null | undefined): string {
  if (!value) return '—';
  return new Intl.DateTimeFormat('pt-BR', {
    day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit',
  }).format(new Date(value));
}

export function dayLabel(value: string | Date | null | undefined): string {
  if (!value) return '—';
  return new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: '2-digit' })
    .format(new Date(value));
}

/** "há 12 dias" / "hoje" — the phrasing the driver text uses. */
export function sinceDays(value: string | Date | null | undefined): string {
  if (!value) return 'nunca';
  const days = Math.floor((Date.now() - new Date(value).getTime()) / 86_400_000);
  if (days <= 0) return 'hoje';
  if (days === 1) return 'ontem';
  return `há ${days} dias`;
}
