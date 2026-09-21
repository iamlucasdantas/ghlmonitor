import { strict as assert } from 'node:assert';
import test from 'node:test';
import { computeScore } from '../src/score/engine.js';
import { confirmTier } from '../src/score/tier.js';
import { addDays } from '../src/date.js';
import { history, input, TODAY } from './helpers.js';

test('a sub-account doing everything it always did scores 100 and has no drivers', () => {
  const r = computeScore(
    input({
      metrics: history(40, {
        contactsNew: 5, msgsOut: 40, oppsCreated: 2, oppsMoved: 3,
        appointments: 1, workflowsActive: 4, activeS: 3600,
      }),
    }),
  );
  assert.equal(r.score, 100);
  assert.equal(r.rawTier, 'healthy');
  assert.deepEqual(r.drivers, []);
});

test('less than 14 days of data is onboarding, never at risk (RF-04.4)', () => {
  const r = computeScore(
    input({
      firstDataAt: new Date(`${addDays(TODAY, -5)}T00:00:00Z`),
      lastLoginAt: null,
      metrics: history(5, {}),
    }),
  );
  assert.equal(r.rawTier, 'onboarding');
});

test('S1 buckets follow the PRD table', () => {
  const cases: [number, number][] = [[0, 0], [3, 0], [4, 8], [7, 8], [8, 17], [14, 17], [15, 25]];
  for (const [days, expected] of cases) {
    const r = computeScore(
      input({ lastLoginAt: new Date(`${addDays(TODAY, -days)}T12:00:00Z`) }),
    );
    const s1 = r.breakdown.find((d) => d.signal === 'S1')!;
    // Only S1, S6 and S7 are applicable here (no baselines), so weights are redistributed.
    assert.equal(s1.points > 0, expected > 0, `days=${days}`);
  }
});

test('a signal with no baseline is ignored and its weight is redistributed', () => {
  // No history at all for S2..S5: only S1/S6/S7 apply (25 + 10 + 5 = 40 of weight).
  const r = computeScore(
    input({ lastLoginAt: new Date(`${addDays(TODAY, -20)}T12:00:00Z`), metrics: history(40, {}) }),
  );
  assert.deepEqual(r.ignored.sort(), ['S2', 'S3', 'S4', 'S5', 'S8']);
  const s1 = r.breakdown.find((d) => d.signal === 'S1')!;
  // 25 points of a 40-point denominator, rescaled to 100.
  assert.equal(Math.round(s1.weight), 63);
  assert.equal(Math.round(s1.points), 63);
});

test('a real decline lands in critical with readable drivers', () => {
  const r = computeScore(
    input({
      lastLoginAt: new Date(`${addDays(TODAY, -12)}T12:00:00Z`),
      usersTotal: 5,
      usersActive30d: 1,
      metrics: history(
        40,
        { contactsNew: 6, msgsOut: 50, oppsCreated: 2, oppsMoved: 2, activeS: 5400, workflowsActive: 1 },
        { contactsNew: 0, msgsOut: 5, oppsCreated: 0, oppsMoved: 0, activeS: 300 },
      ),
    }),
  );
  assert.equal(r.rawTier, 'critical');
  assert.ok(r.drivers.length >= 3);
  // Drivers are ordered by points lost, so the heaviest signal leads.
  assert.deepEqual(
    r.drivers.map((d) => d.signal),
    [...r.drivers].sort((a, b) => b.points - a.points).map((d) => d.signal),
  );
  assert.ok(r.drivers.some((d) => d.label === 'Sem login há 12 dias'));
  assert.ok(r.drivers.some((d) => d.label === 'Nenhum contato novo em 7 dias'));
});

test('every non-healthy tier exposes at least one legible driver (MVP acceptance §16)', () => {
  const r = computeScore(
    input({
      lastLoginAt: new Date(`${addDays(TODAY, -9)}T12:00:00Z`),
      metrics: history(40, { msgsOut: 30, activeS: 3600, workflowsActive: 2 }, { msgsOut: 2, activeS: 200 }),
    }),
  );
  assert.notEqual(r.rawTier, 'healthy');
  assert.ok(r.drivers.length >= 1);
  assert.ok(r.drivers.every((d) => d.label.length > 0));
});

test('automation-only sub-accounts are not marked dead (PRD §9 exception)', () => {
  const automationHistory = history(
    40,
    { msgsOut: 20, workflowsActive: 5, contactsNew: 3, oppsCreated: 1, oppsMoved: 1, activeS: 600 },
    { msgsOut: 20, workflowsActive: 5, contactsNew: 3, oppsCreated: 1, oppsMoved: 1, activeS: 0 },
  );
  const args = {
    lastLoginAt: new Date(`${addDays(TODAY, -20)}T12:00:00Z`),
    metrics: automationHistory,
  };
  const lenient = computeScore(input(args));
  assert.equal(lenient.automationModel, true);

  // Same numbers with the workflows switched off: no exception, harsher score.
  const strict = computeScore(
    input({
      ...args,
      metrics: history(
        40,
        { msgsOut: 20, workflowsActive: 0, contactsNew: 3, oppsCreated: 1, oppsMoved: 1, activeS: 600 },
        { msgsOut: 20, workflowsActive: 0, contactsNew: 3, oppsCreated: 1, oppsMoved: 1, activeS: 0 },
      ),
    }),
  );
  assert.equal(strict.automationModel, false);
  assert.ok(lenient.score > strict.score, `${lenient.score} should beat ${strict.score}`);
  assert.notEqual(lenient.rawTier, 'critical');
});

test('zero outbound messages in the window takes the whole S3 weight', () => {
  const r = computeScore(
    input({ metrics: history(40, { msgsOut: 40, activeS: 3600, workflowsActive: 1 }, { msgsOut: 0 }) }),
  );
  const s3 = r.breakdown.find((d) => d.signal === 'S3')!;
  assert.equal(s3.points, s3.weight);
  assert.equal(s3.label, 'Nenhuma mensagem enviada em 7 dias');
});

test('growth never costs points', () => {
  const r = computeScore(
    input({
      metrics: history(
        40,
        { msgsOut: 10, contactsNew: 1, oppsCreated: 1, oppsMoved: 1, activeS: 600, workflowsActive: 1 },
        { msgsOut: 90, contactsNew: 9, oppsCreated: 9, oppsMoved: 9, activeS: 7200 },
      ),
    }),
  );
  assert.equal(r.score, 100);
});

test('tier only moves after two consecutive days (RF-04.3)', () => {
  assert.equal(confirmTier('healthy', ['at_risk', 'healthy', 'healthy']), 'healthy');
  assert.equal(confirmTier('healthy', ['at_risk', 'at_risk', 'healthy']), 'at_risk');
  assert.equal(confirmTier('at_risk', ['at_risk', 'healthy']), 'at_risk');
  assert.equal(confirmTier(null, ['critical']), 'critical');
  // Leaving onboarding is immediate — it is a data state, not a verdict.
  assert.equal(confirmTier('onboarding', ['healthy', 'onboarding']), 'healthy');
});
