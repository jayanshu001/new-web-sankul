// New badge: `isNew` is derived from `createdAt` at request time, never stored.
export const NEW_WINDOW_DAYS = 7;
const MS_PER_DAY = 1000 * 60 * 60 * 24;

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
