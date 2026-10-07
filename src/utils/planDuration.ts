// Plan duration: subscription endAt and days-left math.
import { istDayIndex } from "./istJson";

export interface ComputeEndAtInput {
  startAt: Date;
  durationMonths: number;
  /** Treat `durationMonths` as days (setDate). Plan price-row `duration` is in days. */
  asDays?: boolean;
}

/**
 * `endAt` for a plan grant. Month mode uses setMonth so calendar-month length
 * is honoured; pass `asDays: true` for plan `duration` values, which are days.
 */
export const computeEndAt = ({
  startAt,
  durationMonths,
  asDays = false,
}: ComputeEndAtInput): Date => {
  const endAt = new Date(startAt.getTime());
  const n = Math.max(0, Math.floor(durationMonths || 0));
  if (asDays) {
    endAt.setDate(endAt.getDate() + n);
  } else {
    endAt.setMonth(endAt.getMonth() + n);
  }
  return endAt;
};

/**
 * Stacks a new window onto `currentEndAt` if still active, else onto `now`.
 *
 * @deprecated Unused: every product writes one subscription row per order, so a
 * renewal inserts a new row starting at `existing.endAt > now ? existing.endAt : now`
 * and calls computeEndAt. Duplicate "My Subscription" cards are deduped at the
 * read layer (furthest endAt per target), not by folding rows.
 */
export const extendEndAt = ({
  currentEndAt,
  durationMonths,
  asDays = false,
  now = new Date(),
}: {
  currentEndAt: Date | null | undefined;
  durationMonths: number;
  asDays?: boolean;
  now?: Date;
}): Date => {
  const base =
    currentEndAt && currentEndAt.getTime() > now.getTime()
      ? currentEndAt
      : now;
  return computeEndAt({ startAt: base, durationMonths, asDays });
};

/**
 * Days remaining on a subscription, in IST calendar days (not 24h chunks) so
 * every response computed on the same IST day agrees, including 24h-cached
 * routes filled minutes apart (route caches are also capped at IST midnight).
 *
 * Active: at least 1 (expires today → 1). Expired: 0. `null` endAt (lifetime) → `null`.
 */
export const computeDaysLeft = (
  endAt: Date | null | undefined,
  now: Date = new Date()
): number | null => {
  if (!endAt) return null;
  const end = new Date(endAt);
  if (end.getTime() <= now.getTime()) return 0;
  return Math.max(1, istDayIndex(end) - istDayIndex(now));
};
