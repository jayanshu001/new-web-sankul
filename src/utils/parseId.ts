/** Never throws: a malformed id becomes `undefined` ("no filter") rather than a
 * BigInt() SyntaxError surfacing as a 500. */
export const parseOptionalBigInt = (value: unknown): bigint | undefined => {
  if (typeof value !== "string" || !/^\d+$/.test(value)) return undefined;
  return BigInt(value);
};

/** Positive integer id from a route param / query value, else null. The one copy of
 * the `Number(v)` + `Number.isInteger(n) && n > 0` check; modules alias it by name. */
export const parsePositiveInt = (v: unknown): number | null => {
  const n = Number(v);
  return Number.isInteger(n) && n > 0 ? n : null;
};
