// Search filter: uniform free-text search for every module. The term is trimmed and split on
// whitespace; every token must match (AND), each token ORs across the fields.
// Case/accent-insensitivity comes from the utf8mb4_0900_ai_ci column collation:
// Prisma MySQL has no `mode: "insensitive"`, and wrapping columns in LOWER()/BINARY
// would defeat indexes. Searched columns must be utf8mb4 for non-Latin/emoji terms
// (docs/migration/schema-changes/2026-07-16_search_columns_utf8mb4.sql).

export function searchTokens(term: string | undefined | null): string[] {
  const trimmed = typeof term === "string" ? term.trim() : "";
  if (!trimmed) return [];
  return trimmed.split(/\s+/);
}

// Prisma `where` fragment matching `term` across `fields`; `undefined` when there is
// nothing to search, so callers can skip it.
export function buildPrismaSearch(
  term: string | undefined | null,
  fields: string[]
): { AND: Array<{ OR: Array<Record<string, { contains: string }>> }> } | undefined {
  const tokens = searchTokens(term);
  if (tokens.length === 0 || fields.length === 0) return undefined;
  return {
    AND: tokens.map((token) => ({
      OR: fields.map((field) => ({ [field]: { contains: token } })),
    })),
  };
}

// Prefix-anchored variant for large tables (e.g. ws_customer): the first token is
// `LIKE 'token%'`, which can use a B-tree range scan where a leading wildcard cannot.
// Only the first token is anchored; the rest use `contains`. Anchoring every token
// makes multi-word search on one field unsatisfiable ("Week 01" would need a value
// starting with both "Week" and "01"). Trade-off: "Week 01" finds "Week 01 (PSI)" but
// not "Physics Week 01"; use `buildPrismaSearch` when that matters more than speed.
// Same shape as `buildPrismaSearch`, so the two are interchangeable.
export function buildPrismaPrefixSearch(
  term: string | undefined | null,
  fields: string[]
): { AND: Array<{ OR: Array<Record<string, { startsWith: string } | { contains: string }>> }> } | undefined {
  const tokens = searchTokens(term);
  if (tokens.length === 0 || fields.length === 0) return undefined;
  return {
    AND: tokens.map((token, i) => ({
      OR: fields.map((field) => ({
        [field]: i === 0 ? { startsWith: token } : { contains: token },
      })),
    })),
  };
}

// Exact-match companion for numeric id columns a LIKE can't serve (customer id,
// BIGINT tracking AWB). Returns the trimmed term when it is all digits: `big` for
// BIGINT columns, `int` only when it fits a signed INT (Prisma throws past 2^31-1).
// 18 digits max so `big` never overflows signed BIGINT.
export function searchNumericId(term: string | undefined | null): { big: bigint; int?: number } | undefined {
  const t = typeof term === "string" ? term.trim() : "";
  if (!/^\d{1,18}$/.test(t)) return undefined;
  const big = BigInt(t);
  return { big, int: big <= BigInt(2147483647) ? Number(big) : undefined };
}

// Raw-SQL variant for hand-built LIKE clauses. `sql` is a parenthesized boolean
// expression (no leading AND/WHERE); bind `params` as `?` placeholders and never
// interpolate the term into SQL.
export function buildLikeTokens(
  term: string | undefined | null,
  columns: string[]
): { sql: string; params: string[] } | undefined {
  const tokens = searchTokens(term);
  if (tokens.length === 0 || columns.length === 0) return undefined;
  const params: string[] = [];
  const groups = tokens.map((token) => {
    const ors = columns.map((col) => {
      params.push(`%${token}%`);
      return `${col} LIKE ?`;
    });
    return `(${ors.join(" OR ")})`;
  });
  return { sql: `(${groups.join(" AND ")})`, params };
}

// In-memory variant: true when every token appears (case-insensitively) in some haystack.
export function matchesAllTokens(
  term: string | undefined | null,
  haystacks: Array<string | undefined | null>
): boolean {
  const tokens = searchTokens(term);
  if (tokens.length === 0) return true;
  const hay = haystacks
    .filter((h): h is string => typeof h === "string")
    .map((h) => h.toLowerCase());
  return tokens.every((token) => {
    const t = token.toLowerCase();
    return hay.some((h) => h.includes(t));
  });
}
