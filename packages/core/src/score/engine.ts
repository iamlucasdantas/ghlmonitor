import type {
  DailyMetrics, Driver, ScoreInput, ScoreResult, SignalId, Tier,
} from '../types.js';
import { addDays, daysBetween, toDay } from '../date.js';
import { AUTOMATION_MODEL, ONBOARDING_DAYS, SIGNALS, TIER_THRESHOLDS } from './config.js';
import { driverLabel, type LabelCtx } from './labels.js';

type MetricKey = 'contactsNew' | 'msgsOut' | 'oppsCreated' | 'oppsMoved' | 'appointments' | 'activeS';

interface RawSignal {
  id: SignalId;
  /** Points lost on the PRD's own scale (i.e. out of the signal's base weight). */
  points: number;
  value: number | null;
  baseline: number | null;
  applicable: boolean;
  ctx: LabelCtx;
}

function sum(rows: DailyMetrics[], key: MetricKey): number {
  let total = 0;
  for (const r of rows) total += Number(r[key] ?? 0);
  return total;
}

function inRange(rows: DailyMetrics[], from: string, to: string): DailyMetrics[] {
  return rows.filter((r) => daysBetween(from, r.date) >= 0 && daysBetween(r.date, to) >= 0);
}

/** Relative drop vs. baseline, clamped to 0..1. Negative growth reads as 0. */
function dropVs(current: number, baseline: number): number {
  if (baseline <= 0) return 0;
  return Math.max(0, Math.min(1, (baseline - current) / baseline));
}

/** Points for a bucketed "drop vs. baseline" signal. `buckets` is [[threshold, points], ...]. */
function bucket(drop: number, buckets: [number, number][]): number {
  let points = 0;
  for (const b of buckets) {
    const edge = b[0];
    const pts = b[1];
    if (drop > edge) points = pts;
  }
  return points;
}

export function tierForScore(score: number): Tier {
  if (score >= TIER_THRESHOLDS.healthy) return 'healthy';
  if (score >= TIER_THRESHOLDS.atRisk) return 'at_risk';
  return 'critical';
}

/**
 * Daily churn score (PRD §9).
 *
 * Starts at 100 and loses points. Every windowed signal compares the last 7 days with
 * the sub-account's own baseline — the 30 days immediately *before* that window, scaled
 * to a 7-day equivalent, so a slow decline doesn't hide inside its own average.
 *
 * Two normalisations, and they are deliberately different:
 *  - a signal with no baseline (the sub-account never had it) or one that is switched
 *    off is dropped from the denominator, so the rest scale back up to 100;
 *  - the automation-model exception only halves what S1/S2 can take away. That slack is
 *    *not* redistributed — halving it and then scaling it back up would undo the point.
 */
export function computeScore(input: ScoreInput): ScoreResult {
  const today = toDay(input.date);
  const w7from = addDays(today, -6);
  const baseFrom = addDays(today, -36);
  const baseTo = addDays(today, -7);

  const rows = input.metrics;
  const w7 = inRange(rows, w7from, today);
  const base = inRange(rows, baseFrom, baseTo);
  const w30 = inRange(rows, addDays(today, -29), today);

  const baselineDays = base.length;
  /** 30-day average expressed per 7 days, so it compares like-for-like with w7. */
  const per7 = (key: MetricKey): number | null =>
    baselineDays > 0 ? (sum(base, key) / baselineDays) * 7 : null;

  const latest = rows.length > 0 ? rows[rows.length - 1] : undefined;
  const workflowsActive = latest?.workflowsActive ?? 0;
  const msgsOut30d = sum(w30, 'msgsOut');
  const active7 = sum(w7, 'activeS');

  const automationModel =
    workflowsActive >= AUTOMATION_MODEL.minWorkflowsActive &&
    msgsOut30d >= AUTOMATION_MODEL.minMsgsOut30d &&
    active7 < AUTOMATION_MODEL.lowActiveS7d;

  const signals: RawSignal[] = [];

  // S1 — days since the last login of any user. No baseline: always applicable.
  const days = input.lastLoginAt
    ? Math.max(0, daysBetween(toDay(input.lastLoginAt), today))
    : Number.POSITIVE_INFINITY;
  const s1Points = days <= 3 ? 0 : days <= 7 ? 8 : days <= 14 ? 17 : 25;
  signals.push({
    id: 'S1', points: s1Points, value: Number.isFinite(days) ? days : null,
    baseline: null, applicable: true, ctx: { value: null, baseline: null, days },
  });

  // S2 — active time.
  const activeBaseline = per7('activeS');
  const s2Drop = activeBaseline ? dropVs(active7, activeBaseline) : 0;
  signals.push({
    id: 'S2',
    points: bucket(s2Drop, [[0.2, 8], [0.4, 14], [0.7, 20]]),
    value: active7,
    baseline: activeBaseline,
    applicable: (activeBaseline ?? 0) > 0,
    ctx: { value: active7, baseline: activeBaseline, drop: s2Drop },
  });

  // S3 — outbound messages. Zero outbound in the window is the worst bucket outright.
  const msgsOut7 = sum(w7, 'msgsOut');
  const msgsBaseline = per7('msgsOut');
  const s3Drop = msgsBaseline ? dropVs(msgsOut7, msgsBaseline) : 0;
  signals.push({
    id: 'S3',
    points: msgsOut7 === 0 ? 15 : bucket(s3Drop, [[0.3, 6], [0.5, 11], [0.8, 15]]),
    value: msgsOut7,
    baseline: msgsBaseline,
    applicable: (msgsBaseline ?? 0) > 0,
    ctx: { value: msgsOut7, baseline: msgsBaseline, drop: s3Drop },
  });

  // S4 — new contacts.
  const contacts7 = sum(w7, 'contactsNew');
  const contactsBaseline = per7('contactsNew');
  signals.push({
    id: 'S4',
    points: halfBaselinePoints(contacts7, contactsBaseline),
    value: contacts7,
    baseline: contactsBaseline,
    applicable: (contactsBaseline ?? 0) > 0,
    ctx: { value: contacts7, baseline: contactsBaseline },
  });

  // S5 — opportunities created + moved between stages/statuses.
  const opps7 = sum(w7, 'oppsCreated') + sum(w7, 'oppsMoved');
  const oppsBaselineRaw = baselineDays > 0
    ? ((sum(base, 'oppsCreated') + sum(base, 'oppsMoved')) / baselineDays) * 7
    : null;
  signals.push({
    id: 'S5',
    points: halfBaselinePoints(opps7, oppsBaselineRaw),
    value: opps7,
    baseline: oppsBaselineRaw,
    applicable: (oppsBaselineRaw ?? 0) > 0,
    ctx: { value: opps7, baseline: oppsBaselineRaw },
  });

  // S6 — share of registered users who showed up in the last 30 days.
  const ratio = input.usersTotal > 0 ? input.usersActive30d / input.usersTotal : null;
  signals.push({
    id: 'S6',
    points: ratio === null ? 0 : ratio >= 0.5 ? 0 : ratio >= 0.3 ? 5 : 10,
    value: ratio,
    baseline: null,
    applicable: input.usersTotal > 0,
    ctx: { value: ratio, baseline: null },
  });

  // S7 — is anything still running by itself?
  const appts30 = sum(w30, 'appointments');
  const alive = workflowsActive >= 1 || appts30 >= 1;
  signals.push({
    id: 'S7', points: alive ? 0 : 5, value: alive ? 1 : 0,
    baseline: null, applicable: true, ctx: { value: alive ? 1 : 0, baseline: null },
  });

  // S8 — Phase 2. Disabled in config until the SaaS API is wired up.
  const saas = input.saasStatus ?? null;
  signals.push({
    id: 'S8',
    points: saas === 'failed' || saas === 'cancelled' ? 5 : 0,
    value: null, baseline: null, applicable: saas !== null,
    ctx: { value: null, baseline: null },
  });

  // ---------------------------------------------------------------- normalise

  const enabled = new Map(SIGNALS.map((s) => [s.id, s]));
  const active = signals.filter((s) => {
    const cfg = enabled.get(s.id);
    return cfg?.enabled && s.applicable;
  });
  const ignored = signals.filter((s) => !active.includes(s)).map((s) => s.id);

  const denominator = active.reduce((acc, s) => acc + (enabled.get(s.id)?.weight ?? 0), 0);
  const scale = denominator > 0 ? 100 / denominator : 0;

  const breakdown: Driver[] = active.map((s) => {
    const baseWeight = enabled.get(s.id)!.weight;
    const multiplier =
      automationModel && (s.id === 'S1' || s.id === 'S2')
        ? AUTOMATION_MODEL.weightMultiplier
        : 1;
    const points = s.points * multiplier * scale;
    return {
      signal: s.id,
      weight: round1(baseWeight * multiplier * scale),
      value: s.value,
      baseline: s.baseline,
      points: round1(points),
      label: driverLabel(s.id, s.ctx),
    };
  });

  const lost = breakdown.reduce((acc, d) => acc + d.points, 0);
  const score = Math.max(0, Math.min(100, Math.round(100 - lost)));

  const drivers = breakdown
    .filter((d) => d.points > 0)
    .sort((a, b) => b.points - a.points);

  const onboarding =
    !input.firstDataAt ||
    daysBetween(toDay(input.firstDataAt), today) < ONBOARDING_DAYS;

  return {
    score,
    rawTier: onboarding ? 'onboarding' : tierForScore(score),
    drivers,
    breakdown,
    automationModel,
    ignored,
  };
}

/** S4/S5 share one shape: at least half the baseline is fine, zero is the full weight. */
function halfBaselinePoints(current: number, baseline: number | null): number {
  if (!baseline || baseline <= 0) return 0;
  if (current === 0) return 10;
  return current >= baseline * 0.5 ? 0 : 5;
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}
