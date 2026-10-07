// Customer profile: full-name split and join helpers.

/**
 * `ws_customer.full_name` is one column but the API exposes first/middle/last:
 * split on read (first token, last token, the rest is middle), join on write.
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

/** Fields not supplied fall back to the existing parsed parts, so partial updates keep the rest. */
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
