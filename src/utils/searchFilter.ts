// Shared helpers for building uniform free-text search across every module.
//
// One place so all list endpoints behave identically for English / Hindi / Gujarati /
// emoji and are consistently case-insensitive. Design:
//   - Trim the term at both ends, PRESERVE internal spaces.
//   - Tokenize on whitespace; AND each token; each token ORs across the given fields.
//     ("ram sita" over [name] => rows whose name contains BOTH "ram" AND "sita",
//      in any order — the least-surprising multi-word behavior.)
//   - Case- AND accent-insensitivity comes from the column collation
//     (utf8mb4_0900_ai_ci). Prisma MySQL has no `mode:"insensitive"` (Postgres-only),
//     and we deliberately DO NOT wrap columns in LOWER()/BINARY so indexes still apply.
//
// The searchable columns must be utf8mb4 for non-Latin/emoji terms to match — see
// docs/migration/schema-changes/2026-07-16_search_columns_utf8mb4.sql.

// Split a raw term into search tokens: trim the ends, drop empty tokens, split on any
// run of whitespace (so double spaces / tabs collapse). Returns [] when empty.
export function searchTokens(term: string | undefined | null): string[] {
  const trimmed = typeof term === "string" ? term.trim() : "";
  if (!trimmed) return [];
  return trimmed.split(/\s+/);
}

// Build a Prisma `where` fragment that matches `term` across one or more fields,
// tokenized + case-insensitive (see file header). Returns `undefined` when the term is
// empty or no fields are given, so callers can spread/skip it safely:
//
//   const search = buildPrismaSearch(input.search, ["title", "streamId"]);
//   if (search) and.push(search);
//
// Shape: { AND: [ { OR: [ { field: { contains: token } }, ... ] }, ... ] }
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

// Raw-SQL variant for the few repositories that build LIKE clauses by hand (JSON-column
// / cross-table searches Prisma can't express). Emits one AND-joined group per token;
// within a group each column is OR-ed. Values are returned separately so callers keep
// binding them as `?` parameters — NEVER interpolate the term into SQL.
//
//   const s = buildLikeTokens(opts.search, ["c.full_name", "c.phone"]);
//   if (s) { whereParts.push(s.sql); params.push(...s.params); }
//
// `sql` is a parenthesized boolean expression (no leading AND/WHERE), e.g.
//   ((`c`.`full_name` LIKE ? OR `c`.`phone` LIKE ?) AND (`c`.`full_name` LIKE ? ...))
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

// In-memory variant for post-fetch array filters. True when EVERY token appears
// (case-insensitively) in at least one of the provided haystack strings.
//
//   rows.filter((r) => matchesAllTokens(term, [r.title, r.author]))
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
