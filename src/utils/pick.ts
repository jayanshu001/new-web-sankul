// Response projection: pick/omit helpers for slimming client responses.
/**
 * Shallow projection for slimming client responses. Apply at the client-controller
 * edge, not in shared transformers, so other surfaces keep the full DTO. Missing
 * keys are skipped, so keep-lists may be supersets.
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

export const pickList = <T extends Record<string, any>>(
  rows: T[] | null | undefined,
  keys: readonly string[]
): Partial<T>[] => (rows ?? []).map((r) => pick(r, keys));

export const omit = <T extends Record<string, any>>(
  obj: T | null | undefined,
  keys: readonly string[]
): Partial<T> => {
  const out: Partial<T> = {};
  if (obj == null) return out;
  const drop = new Set(keys);
  for (const k of Object.keys(obj)) {
    if (!drop.has(k)) (out as any)[k] = (obj as any)[k];
  }
  return out;
};

export const omitList = <T extends Record<string, any>>(
  rows: T[] | null | undefined,
  keys: readonly string[]
): Partial<T>[] => (rows ?? []).map((r) => omit(r, keys));
