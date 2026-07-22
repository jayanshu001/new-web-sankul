/**
 * Shallow field-projection helpers for slimming CLIENT API responses down to only
 * the fields the mobile app actually reads (see docs/api-optimization audit).
 *
 * The projection is applied at the client-controller edge, NOT in the shared
 * module transformers — so the admin/other surfaces that reuse the same DTO keep
 * their full response shape. A key that is absent on the source object is simply
 * skipped, so keep-lists may be supersets of the fields a given row carries.
 */
export const pick = <T extends Record<string, any>>(
  obj: T | null | undefined,
  keys: readonly string[]
): Partial<T> => {
  const out: Partial<T> = {};
  if (obj == null) return out;
  for (const k of keys) {
    if (Object.prototype.hasOwnProperty.call(obj, k)) {
      (out as any)[k] = (obj as any)[k];
    }
  }
  return out;
};

/** Project every row in a list to the given keep-list (see {@link pick}). */
export const pickList = <T extends Record<string, any>>(
  rows: T[] | null | undefined,
  keys: readonly string[]
): Partial<T>[] => (rows ?? []).map((r) => pick(r, keys));
