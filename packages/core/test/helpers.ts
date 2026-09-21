import type { DailyMetrics, ScoreInput } from '../src/types.js';
import { addDays } from '../src/date.js';

export const TODAY = '2026-09-20';

export function day(overrides: Partial<DailyMetrics> & { date: string }): DailyMetrics {
  return {
    contactsNew: 0, msgsOut: 0, oppsCreated: 0, oppsMoved: 0,
    appointments: 0, workflowsActive: 0, activeS: 0,
    usersTotal: 0, usersActive: 0,
    ...overrides,
  };
}

/** `days` rows ending on TODAY, each identical apart from the date. */
export function history(
  days: number,
  fill: Partial<DailyMetrics>,
  last7?: Partial<DailyMetrics>,
): DailyMetrics[] {
  const rows: DailyMetrics[] = [];
  for (let i = days - 1; i >= 0; i--) {
    const d = addDays(TODAY, -i);
    rows.push(day({ date: d, ...fill, ...(i < 7 && last7 ? last7 : {}) }));
  }
  return rows;
}

export function input(over: Partial<ScoreInput> = {}): ScoreInput {
  return {
    date: TODAY,
    metrics: history(40, {}),
    lastLoginAt: new Date(`${TODAY}T10:00:00Z`),
    firstDataAt: new Date('2026-01-01T00:00:00Z'),
    usersTotal: 4,
    usersActive30d: 4,
    ...over,
  };
}
