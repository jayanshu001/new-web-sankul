// Client IP: spoof-safe caller IP for persistence.
import type { Request } from "express";

/**
 * Client IP for persistence. Reads `req.ip` (resolved via `trust proxy`) rather than
 * the raw X-Forwarded-For, which a client can prepend spoofed hops to. Clamped to
 * `maxLength` (the column width; IPv6 needs 45).
 */
export const getClientIp = (req: Request, maxLength = 45): string | null => {
  const raw = req.ip;
  if (!raw) return null;

  // Dual-stack sockets report IPv4 as ::ffff:1.2.3.4.
  const ip = raw.startsWith("::ffff:") ? raw.slice(7) : raw;
  const trimmed = ip.trim();

  return trimmed ? trimmed.slice(0, maxLength) : null;
};
