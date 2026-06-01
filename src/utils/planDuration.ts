// src/utils/planDuration.ts
//
// Plan `duration` on PackageCourseEbookPrice / live-course price rows is
// stored in MONTHS. We must use `Date#setMonth` (not naive day arithmetic) so
// calendar-month length is honoured — a 6-month plan that starts Jan 31
// should end Jul 31, not Jul 30 / Aug 1.
//
// This helper centralizes that contract so every callsite (subscription
// creation, webhook activation, manual admin grants) produces identical
// `endAt` values.

export interface ComputeEndAtInput {
  startAt: Date;
  durationMonths: number;
  /**
   * When true, treat `durationMonths` as days instead (e.g. trial grants
   * expressed as "10 days"). Uses setDate so day-precision is preserved.
   */
  asDays?: boolean;
}

/**
 * Compute the `endAt` date for a plan grant.
 *
 * @example
 *   computeEndAt({ startAt: new Date("2026-01-31"), durationMonths: 6 })
 *   // -> 2026-07-31
 *
 * @example
 *   computeEndAt({ startAt: now, durationMonths: 10, asDays: true })
 *   // -> now + 10 days
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
 * Compute the new `endAt` when EXTENDING an existing subscription, rather than
 * granting a fresh one. The new window stacks onto whatever time is left:
 *
 *   - If the current sub is still active (currentEndAt in the future), the new
 *     duration is added on top of currentEndAt — the customer keeps the days
 *     they already paid for and the extension lands after them.
 *   - If it has already lapsed (or has no endAt), the window starts from `now`.
 *
 * This is what makes "extend availability" idempotent at the row level: we
 * update the single existing row's endAt instead of inserting a second row,
 * which is the source of the duplicate "My Subscription" cards.
 *
 * @example
 *   // active sub ending Sep 11, extend by a 3-month plan on Aug 1
 *   extendEndAt({ currentEndAt: 2026-09-11, durationMonths: 3, now: 2026-08-01 })
 *   // -> 2026-12-11  (stacks onto Sep 11, not onto Aug 1)
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
 * Days remaining on a subscription, for frontend "Extend Validity" UX.
 * Returns ceil((endAt - now) / 1 day), floored at 0 for expired rows.
 * `null` endAt (lifetime grants) -> `null` so the UI can hide the counter.
 */
export const computeDaysLeft = (
  endAt: Date | null | undefined,
  now: Date = new Date()
): number | null => {
  if (!endAt) return null;
  const ms = endAt.getTime() - now.getTime();
  return Math.max(0, Math.ceil(ms / 86_400_000));
};

/**
 * Sum the saved-materials + saved-videos + active-ebook-downloads counts
 * for a profile dashboard's `downloads` field. Pinned by audit memory:
 * composition must remain exactly these three terms.
 */
export const composeDownloadsCount = (parts: {
  savedMaterials: number;
  savedVideos: number;
  activeEbookDownloads: number;
}): number =>
  (parts.savedMaterials || 0) +
  (parts.savedVideos || 0) +
  (parts.activeEbookDownloads || 0);
