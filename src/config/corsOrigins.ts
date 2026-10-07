// CORS: parses and matches the ALLOWED_ORIGINS allow-list.
export const normalizeOrigin = (origin: string): string =>
  origin.trim().replace(/\/+$/, "");

export const parseAllowedOrigins = (raw?: string, fallback?: string): string[] => {
  const source = raw ?? fallback ?? "";
  return source
    .split(",")
    .map(normalizeOrigin)
    .filter(Boolean);
};

export const isAllowedOrigin = (origin: string, allowed: string[]): boolean =>
  allowed.includes(normalizeOrigin(origin));
