/**
 * full_name ↔ first/middle/last helpers for the MySQL profile branch.
 *
 * MySQL `ws_customer.full_name` is a single column, but the profile API contract
 * exposes firstName/middleName/lastName (Mongo shape). Decision: **split on read,
 * join on write** (heuristic — first token = first, last token = last, the rest =
 * middle). Single-token names → firstName only.
 */

export interface NameParts {
  firstName: string;
  middleName: string;
  lastName: string;
}

/** "DIXIT KUMAR PATEL" → { first: "DIXIT", middle: "KUMAR", last: "PATEL" } */
export const splitFullName = (fullName: string | null | undefined): NameParts => {
  const parts = (fullName ?? "").trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return { firstName: "", middleName: "", lastName: "" };
  if (parts.length === 1) return { firstName: parts[0], middleName: "", lastName: "" };
  if (parts.length === 2) return { firstName: parts[0], middleName: "", lastName: parts[1] };
  return {
    firstName: parts[0],
    middleName: parts.slice(1, -1).join(" "),
    lastName: parts[parts.length - 1],
  };
};

/**
 * Join provided parts into full_name, falling back to the existing parsed parts
 * for any field not supplied (so a partial update of just `lastName` keeps the
 * rest). Returns a single trimmed string.
 */
export const joinFullName = (
  parts: Partial<NameParts>,
  existing: NameParts
): string =>
  [
    parts.firstName ?? existing.firstName,
    parts.middleName ?? existing.middleName,
    parts.lastName ?? existing.lastName,
  ]
    .map((s) => (s ?? "").trim())
    .filter(Boolean)
    .join(" ");
