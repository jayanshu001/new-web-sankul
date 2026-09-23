import type { Request } from "express";

/**
 * Resolve the originating client IP for persistence.
 *
 * `app.set("trust proxy", 1)` (src/app.ts) already makes Express parse
 * `X-Forwarded-For` and expose the real client as `req.ip`, so we read that
 * rather than the raw header: the raw value is a comma-separated hop list that
 * a client can prepend to, and taking it verbatim would store a spoofed address
 * (and can overflow a short column).
 *
 * Returns null when no address is available, and clamps to `maxLength` so the
 * value always fits its column — callers pass the column width (IPv6 needs 45).
 */
export const getClientIp = (req: Request, maxLength = 45): string | null => {
  const raw = req.ip;
  if (!raw) return null;

  // Normalise the IPv4-mapped IPv6 form Node reports on dual-stack sockets
  // (::ffff:1.2.3.4) so the stored value is the plain dotted quad.
  const ip = raw.startsWith("::ffff:") ? raw.slice(7) : raw;
  const trimmed = ip.trim();

  return trimmed ? trimmed.slice(0, maxLength) : null;
};
