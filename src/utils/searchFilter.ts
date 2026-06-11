// Shared helpers for building safe MongoDB regex search filters from free-text
// user input. Centralized so every list endpoint escapes identically and the
// regex-injection / ReDoS class of bug can't regress per-module.

// Escape all regex metacharacters so user input like "C++", "January(2025)" or
// "(GSSSB)" is matched literally instead of being parsed as a (possibly invalid
// or catastrophically backtracking) regular expression.
export function escapeRegex(input: string): string {
  return input.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// Build a case-insensitive $regex condition for a single field from raw user
// input. Returns null when the trimmed search is empty so callers can skip it.
export function buildRegexCondition(
  search: string | undefined | null
): { $regex: string; $options: string } | null {
  const trimmed = typeof search === "string" ? search.trim() : "";
  if (!trimmed) return null;
  return { $regex: escapeRegex(trimmed), $options: "i" };
}

// Build a Mongo filter fragment that matches `search` across one or more fields.
// - single field  -> { field: { $regex, $options } }
// - multiple      -> { $or: [ { f1: {...} }, { f2: {...} } ] }
// Returns {} when search is empty, so it can be safely spread into a filter.
export function buildSearchFilter(
  search: string | undefined | null,
  fields: string[]
): Record<string, any> {
  const cond = buildRegexCondition(search);
  if (!cond || fields.length === 0) return {};
  if (fields.length === 1) return { [fields[0]]: cond };
  return { $or: fields.map((field) => ({ [field]: cond })) };
}

// Build a safe, case-insensitive RegExp from raw user input — for callers that
// need an actual RegExp (e.g. in-memory .test()/.filter()) rather than a $regex.
export function buildSearchRegExp(
  search: string | undefined | null
): RegExp | null {
  const trimmed = typeof search === "string" ? search.trim() : "";
  if (!trimmed) return null;
  return new RegExp(escapeRegex(trimmed), "i");
}
