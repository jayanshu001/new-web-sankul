// src/middlewares/authenticate.ts
import { Request, Response, NextFunction } from "express";
import { failure } from "../utils/httpResponse";
import { redisClient } from "../config/redis";
import { verifyAccessToken } from "../utils/jwtSigner";
import { isRevoked, UserType } from "../libs/tokenRevocation";
import { updateContext } from "../utils/requestContext";
import { customerAuthRepository } from "../modules/customer-auth/customer-auth.repository";

// Per-request customer gate state, cached briefly in Redis so the live DB read
// doesn't fire on every authenticated request. Busted on block/delete; the
// short TTL is the fallback for direct-DB edits that bypass the app.
type CustomerGate = { deleted: boolean; disabled: boolean };
const CUSTOMER_GATE_TTL_SECONDS = 30;
const customerGateKey = (id: string) => `customer_gate:${id}`;

/**
 * Returns the live block/delete state for a customer, reading the customer-auth
 * MySQL backend. Cached in Redis
 * for CUSTOMER_GATE_TTL_SECONDS. Returns `null` only when the customer row is
 * missing entirely (treated as deleted by the caller). Fail-open on errors so a
 * transient DB/Redis blip never locks every customer out.
 */
const getCustomerGate = async (id: string): Promise<CustomerGate | null> => {
  const key = customerGateKey(id);
  try {
    const cached = await redisClient.get(key);
    if (cached) return JSON.parse(cached) as CustomerGate;
  } catch {
    // Redis miss/unreachable → fall through to a live read.
  }

  let gate: CustomerGate | null = null;
  const numId = Number(id);
  if (Number.isInteger(numId) && numId > 0) {
    const row = await customerAuthRepository.getAuthStateById(numId);
    gate = row ? { deleted: !!row.isAccountDeleted, disabled: !row.status } : null;
  }

  try {
    // Only cache a concrete result; a missing row stays uncached so a freshly
    // created/restored account isn't shadowed by a negative cache entry.
    if (gate) await redisClient.set(key, JSON.stringify(gate), "EX", CUSTOMER_GATE_TTL_SECONDS);
  } catch {
    // Best-effort cache; ignore write failures.
  }
  return gate;
};

/** Drop a customer's cached gate so a block/delete/restore takes effect now. */
export const invalidateCustomerGate = async (id: string | number): Promise<void> => {
  try {
    await redisClient.del(customerGateKey(String(id)));
  } catch {
    // Non-fatal: the TTL will expire the stale entry shortly anyway.
  }
};

// Augment Request to carry the decoded token payload
declare module "express-serve-static-core" {
  interface Request {
    user?: {
      id: string;
      phone?: string;
      email?: string;
      role: "customer" | "admin" | "super_admin" | "editor" | "educator" | "promoter";
      [k: string]: any;
    };
  }
}

/**
 * Verifies the Bearer JWT and attaches decoded payload to req.user.
 * Works for both customer tokens (role: "customer") and admin tokens
 * (role: "admin" | "super_admin" | "editor").
 *
 * Verification consults the access-key ring (utils/jwtSigner.ts) so we can
 * rotate JWT secrets without invalidating existing sessions. Tokens with a
 * `kid` header are checked against the ring; legacy tokens (no kid) are
 * verified with the ring's legacy secret (= JWT_ACCESS_SECRET).
 */
const authenticate = async (req: Request, res: Response, next: NextFunction) => {
  // Let CORS preflight through
  if (req.method === "OPTIONS") return next();

  const auth = req.headers.authorization || "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : undefined;

  if (!token) {
    return failure(res, "Authentication token is required.", 401);
  }

  try {
    const decoded = verifyAccessToken<any>(token);
    const role = decoded.role ?? "customer";

    // Coarse revocation check: if the user has triggered "logout all devices"
    // (or a password change / forced re-auth event), every token issued
    // before the cutoff is rejected. See libs/tokenRevocation.ts. This is
    // additive to the single-device session-pointer check below; either can
    // independently invalidate a token.
    const userType = (decoded.type ?? "customer") as UserType;
    if (await isRevoked(userType, decoded.id, decoded.iat)) {
      // The revocation cutoff only knows the token is dead, not WHY. For
      // customers, re-read live DB state so we can surface the precise reason
      // (disabled by admin / deleted / generic logout-all). This DB hit only
      // happens on the already-revoked path, so it costs nothing in steady
      // state. Clients should branch on `data.reason`, not the message text.
      if (userType === "customer") {
        const gate = await getCustomerGate(decoded.id);
        if (!gate || gate.deleted) {
          return failure(res, "This account no longer exists. Please contact support.", 401, {}, {
            reason: "ACCOUNT_DELETED",
          });
        }
        if (gate.disabled) {
          return failure(res, "Your account has been disabled. Please contact support.", 401, {}, {
            reason: "ACCOUNT_DISABLED",
          });
        }
      }
      return failure(res, "Session was revoked. Please log in again.", 401, {}, {
        reason: "SESSION_REVOKED",
      });
    }

    // Live account-gate check for customers on EVERY request (cached, see
    // getCustomerGate). A valid, non-revoked token is not enough — if an admin
    // (or a direct DB edit) has since disabled or soft-deleted the account, cut
    // it off here. Clients should branch on `data.reason`, not the message text.
    if (userType === "customer") {
      const gate = await getCustomerGate(decoded.id);
      if (!gate || gate.deleted) {
        return failure(res, "This account no longer exists. Please contact support.", 401, {}, {
          reason: "ACCOUNT_DELETED",
        });
      }
      if (gate.disabled) {
        return failure(res, "Your account has been disabled. Please contact support.", 401, {}, {
          reason: "ACCOUNT_DISABLED",
        });
      }
    }

    // Enforce 1 active device rule for customers
    // if (decoded.type === "customer") {
    //   const activeToken = await redisClient.get(`customer_session:${decoded.id}`);
    //   if (!activeToken || activeToken !== token) {
    //     return failure(res, "Session expired or logged in on another device.", 401);
    //   }
    // }

    // Enforce 1 active device rule for admins
    // Disabled: admins may stay logged in on multiple devices simultaneously.
    // The DB-side invalidation in adminLogin is also disabled; coarse revocation
    // (logout-all / password change) above still applies.
    // if (decoded.type === "admin") {
    //   const activeAdminToken = await redisClient.get(`admin_session:${decoded.id}`);
    //   if (!activeAdminToken || activeAdminToken !== token) {
    //     return failure(res, "Admin session expired or logged in elsewhere.", 401);
    //   }
    // }

    // Enforce 1 active device rule for educators
    if (decoded.type === "educator") {
      const activeEducatorToken = await redisClient.get(`educator_session:${decoded.id}`);
      if (!activeEducatorToken || activeEducatorToken !== token) {
        return failure(res, "Educator session expired or logged in elsewhere.", 401);
      }
    }

    // Enforce 1 active device rule for promoters
    if (decoded.type === "promoter") {
      const activePromoterToken = await redisClient.get(`promoter_session:${decoded.id}`);
      if (!activePromoterToken || activePromoterToken !== token) {
        return failure(res, "Promoter session expired or logged in elsewhere.", 401);
      }
    }

    req.user = {
      id: decoded.id,
      phone: decoded.phone,
      email: decoded.email,
      role: role,
      ...decoded,
    };

    // Surface the authenticated user into the per-request context so every
    // downstream log line automatically carries `userId` + `userRole`
    // without callers threading them through. See utils/requestContext.ts.
    updateContext({ userId: decoded.id, userRole: role });

    return next();
  } catch {
    return failure(res, "Invalid or expired token.", 401);
  }
};

/**
 * Best-effort auth for routes that serve BOTH anonymous and authenticated
 * callers (e.g. event tracking, offline enquiry). Attaches `req.user` when a
 * valid Bearer token is present; on a missing/invalid/expired token it silently
 * continues anonymously (never 401s). Use strict `authenticate` when an invalid
 * token must block. Note: this intentionally skips the revocation/account-gate
 * checks — it only enriches the request with an identity when one is available.
 */
export const optionalAuthenticate = async (req: Request, _res: Response, next: NextFunction) => {
  const auth = req.headers.authorization || "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : undefined;
  if (!token) return next();
  try {
    const decoded = verifyAccessToken<any>(token);
    const role = decoded.role ?? "customer";
    req.user = { id: decoded.id, phone: decoded.phone, email: decoded.email, role, ...decoded };
    updateContext({ userId: decoded.id, userRole: role });
  } catch {
    // Invalid/expired token on an optional route → proceed anonymously.
  }
  return next();
};

/**
 * Middleware factory — restrict access to specific roles.
 * Usage: router.get("/admin-only", authenticate, requireRole("admin", "super_admin"), handler)
 */
export const requireRole = (...roles: string[]) => {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!req.user || !roles.includes(req.user.role)) {
      return failure(res, "Access denied. Insufficient permissions.", 403);
    }
    return next();
  };
};

export default authenticate;

