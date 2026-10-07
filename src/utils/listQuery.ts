// List query: standard client list params so every list endpoint parses them identically:
// page 1-based (default 1), limit default 20 clamped to [1, 100], search trimmed
// (empty => undefined). Pair with buildPrismaSearch from ./searchFilter.

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

export function buildPagination(total: number, page: number, limit: number) {
  return {
    total,
    page,
    limit,
    totalPages: Math.ceil(total / limit),
  };
}
