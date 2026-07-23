// The public origin for share / deep-link URLs (e.g. https://share.example.com).
//
// Deliberately NOT derived from the request `Host` header: that value is
// client-supplied, so reading it would let a caller mint share links pointing at
// a domain they choose. Production presence is enforced at boot via
// REQUIRED_IN_PROD in config/env.ts, so the dev fallback below can never apply
// in production.
//
// Read once at module load — this is deployment config, not per-request state.
const CONFIGURED = (process.env.SHARE_BASE_URL || "").replace(/\/+$/, "");

/** Origin that every share link is built on. Never has a trailing slash. */
export const shareBase = (): string =>
  CONFIGURED || (process.env.ORIGIN || "http://localhost:4001").replace(/\/+$/, "");

/**
 * Hostname (no port, no scheme) of the share origin — used to tell a request
 * arriving on the share host from one arriving on the API host.
 *
 * `hostname` and not `host`: Express's `req.hostname` strips the port, so
 * comparing against `host` would never match on a non-443 local setup and would
 * send every local /share request into a redirect loop.
 */
export const shareHostname = (): string => {
  try {
    return new URL(shareBase()).hostname;
  } catch {
    return "";
  }
};
