// Shared parser for the standard client list query params: `search`, `page`,
// `limit`. Centralised so every list endpoint reads these IDENTICALLY (param
// names, defaults, caps) and the response `pagination` block stays uniform
// project-wide.
//
// Conventions (matching the existing per-controller blocks):
//   - page  : 1-based, default 1, floored at 1
//   - limit : default 20, clamped to [1, 100]
//   - search: trimmed; empty => undefined
//
// Pair with buildRegexCondition(search) from ./searchFilter for the Mongo regex.

export interface ListQuery {
  search?: string;
  page: number;
  limit: number;
  skip: number;
}

export function parseListQuery(
  query: Record<string, any>,
  opts: { defaultLimit?: number; maxLimit?: number } = {}
): ListQuery {
  const defaultLimit = opts.defaultLimit ?? 20;
  const maxLimit = opts.maxLimit ?? 100;

  const page = Math.max(parseInt(String(query.page ?? "1"), 10) || 1, 1);
  const limit = Math.min(
    Math.max(parseInt(String(query.limit ?? String(defaultLimit)), 10) || defaultLimit, 1),
    maxLimit
  );
  const rawSearch = typeof query.search === "string" ? query.search.trim() : "";
  return {
    search: rawSearch || undefined,
    page,
    limit,
    skip: (page - 1) * limit,
  };
}

// Build the uniform pagination envelope returned alongside `data`.
export function buildPagination(total: number, page: number, limit: number) {
  return {
    total,
    page,
    limit,
    totalPages: Math.ceil(total / limit),
  };
}
