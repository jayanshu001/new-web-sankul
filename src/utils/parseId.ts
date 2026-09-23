/** Parses a query-string id into a bigint, or `undefined` for a missing/malformed
 * value — never throws, so a bad param becomes "no filter" (400-free) rather than
 * an uncaught BigInt() SyntaxError surfacing as a 500. */
export const parseOptionalBigInt = (value: unknown): bigint | undefined => {
  if (typeof value !== "string" || !/^\d+$/.test(value)) return undefined;
  return BigInt(value);
};
