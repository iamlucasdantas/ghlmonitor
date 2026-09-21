import type { Tier } from '../types.js';
import { TIER_CONFIRM_DAYS } from './config.js';

/**
 * A tier only moves after it has held for TIER_CONFIRM_DAYS days in a row (RF-04.3),
 * so a single quiet Sunday doesn't flip a healthy sub-account into "at risk".
 *
 * `recentRawTiers` is newest-first and starts with today's raw tier.
 */
export function confirmTier(
  currentTier: Tier | null,
  recentRawTiers: Tier[],
): Tier {
  const today = recentRawTiers[0];
  if (!today) return currentTier ?? 'onboarding';
  if (currentTier === null) return today;
  if (today === currentTier) return currentTier;

  // Onboarding is a data-availability state, not a health verdict: leaving it is immediate.
  if (currentTier === 'onboarding' || today === 'onboarding') return today;

  const streak = recentRawTiers.slice(0, TIER_CONFIRM_DAYS);
  const confirmed =
    streak.length >= TIER_CONFIRM_DAYS && streak.every((t) => t === today);
  return confirmed ? today : currentTier;
}
