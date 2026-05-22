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
