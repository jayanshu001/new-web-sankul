/**
 * Computes the `isNew` flag for catalogue items (books, ebooks, …).
 *
 * `isNew` is derived, never stored: an item is "new" for the first week after
 * its creation, then flips to false automatically. Because it's computed from
 * `createdAt` at request time, no cron job or scheduled write is needed.
 */

// A book/ebook is "new" for this long after creation.
export const NEW_WINDOW_DAYS = 7;
const MS_PER_DAY = 1000 * 60 * 60 * 24;

/**
 * True when `createdAt` is within the last `NEW_WINDOW_DAYS` days.
 * Missing/invalid `createdAt` is treated as not new.
 */
export function isNewItem(
  createdAt: Date | string | null | undefined,
  now: Date = new Date()
): boolean {
  if (!createdAt) return false;
  const created = createdAt instanceof Date ? createdAt : new Date(createdAt);
  const ms = created.getTime();
  if (Number.isNaN(ms)) return false;
  return now.getTime() - ms < NEW_WINDOW_DAYS * MS_PER_DAY;
}
