/** Normalize an origin for allowlist comparison (strip trailing slash). */
export const normalizeOrigin = (origin: string): string =>
  origin.trim().replace(/\/+$/, "");

/** Parse ALLOWED_ORIGINS CSV into a normalized allowlist. */
export const parseAllowedOrigins = (raw?: string, fallback?: string): string[] => {
  const source = raw ?? fallback ?? "";
  return source
    .split(",")
    .map(normalizeOrigin)
    .filter(Boolean);
};

/** True when `origin` is in the normalized allowlist. */
export const isAllowedOrigin = (origin: string, allowed: string[]): boolean =>
  allowed.includes(normalizeOrigin(origin));
