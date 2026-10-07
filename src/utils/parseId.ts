/** Never throws: a malformed id becomes `undefined` ("no filter") rather than a
 * BigInt() SyntaxError surfacing as a 500. */
export const parseOptionalBigInt = (value: unknown): bigint | undefined => {
  if (typeof value !== "string" || !/^\d+$/.test(value)) return undefined;
  return BigInt(value);
};
