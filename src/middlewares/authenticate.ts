// Authentication: Bearer JWT verification, account/session gates and role checks.
import { Request, Response, NextFunction } from "express";
import { failure } from "../utils/httpResponse";
import { redisClient } from "../config/redis";
import { verifyAccessToken } from "../utils/jwtSigner";
import { isRevoked, UserType } from "../libs/tokenRevocation";
import { updateContext } from "../utils/requestContext";
import { customerAuthRepository } from "../modules/customer-auth/customer-auth.repository";
import { adminAuthRepository } from "../modules/admin-auth/admin-auth.repository";
import logger from "../utils/logger";
import { isDatabaseUnavailableError, sendServiceUnavailable } from "../utils/dbAvailability";
import jwt from "jsonwebtoken";
import { isGuestPayload, isGuestModeOn } from "../libs/guestSession";
import { markCustomerActive } from "../libs/customerActivity";

// Per-request customer gate state, cached briefly in Redis so the live DB read
// doesn't fire on every authenticated request. Busted on block/delete; the
// short TTL is the fallback for direct-DB edits that bypass the app.
type CustomerGate = { deleted: boolean; disabled: boolean; hasLiveToken: boolean };
const CUSTOMER_GATE_TTL_SECONDS = 30;
const customerGateKey = (id: string) => `customer_gate:${id}`;

/**
 * Live block/delete state for a customer, cached for CUSTOMER_GATE_TTL_SECONDS. `null`
 * only when the row is missing (treated as deleted). Fail-open on Redis errors so a
 * transient blip never locks every customer out.
 */
const getCustomerGate = async (id: string): Promise<CustomerGate | null> => {
  const key = customerGateKey(id);
  try {
    const cached = await redisClient.get(key);
    if (cached) return JSON.parse(cached) as CustomerGate;
  } catch {
  }

  let gate: CustomerGate | null = null;
  const numId = Number(id);
  if (Number.isInteger(numId) && numId > 0) {
    // Runs on every authenticated customer request, so the two reads must not serialize.
    const [row, liveToken] = await Promise.all([
      customerAuthRepository.getAuthStateById(numId),
      customerAuthRepository.findLiveTokenId(numId),
    ]);
    gate = row
      ? { deleted: !!row.isAccountDeleted, disabled: !row.status, hasLiveToken: !!liveToken }
      : null;
  }

  try {
    // Only cache a positive result (row exists with a live token). A missing row stays
    // uncached so a new/restored account isn't shadowed. `hasLiveToken: false` stays
    // uncached because the refresh flow has a brief window with no live row; caching it
    // would 401 (= app logout) a healthy session for the full TTL.
    if (gate && gate.hasLiveToken) {
      await redisClient.set(key, JSON.stringify(gate), "EX", CUSTOMER_GATE_TTL_SECONDS);
    }
  } catch {
    // Best-effort cache.
  }
  return gate;
};

// Admin sessions are live only while ws_admin_access_tokens has an active row. Read
// uncached on every request so deactivating rows takes effect immediately.
const hasLiveAdminToken = async (id: string): Promise<boolean> => {
  if (!/^\d+$/.test(id)) return false;
  return !!(await adminAuthRepository.findLiveTokenId(BigInt(id)));
};

/** Drop a customer's cached gate so a block/delete/restore takes effect now. */
export const invalidateCustomerGate = async (id: string | number): Promise<void> => {
  try {
    await redisClient.del(customerGateKey(String(id)));
  } catch {
    // Non-fatal: the TTL expires the stale entry shortly.
  }
};

declare module "express-serve-static-core" {
  interface Request {
    user?: {
      id: string;
      phone?: string;
      email?: string;
      role: "customer" | "admin" | "super_admin" | "editor" | "educator" | "promoter";
      [k: string]: any;
    };
    /** Live guest token on a guest-browsable GET. Set ONLY by `markGuestBrowse`. */
    isGuest?: boolean;
  }
}

/**
 * Verifies the Bearer JWT and attaches the payload to req.user. Uses the access-key ring
 * (utils/jwtSigner.ts) so secrets rotate without killing sessions; tokens without a
 * `kid` verify against the legacy secret (JWT_ACCESS_SECRET).
 */
const authenticate = async (req: Request, res: Response, next: NextFunction) => {
  if (req.method === "OPTIONS") return next();

  // Guest browse (middlewares/guestBrowse.ts): no req.user, not-purchased view.
  if (req.isGuest) return next();

  const auth = req.headers.authorization || "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : undefined;

  if (!token) {
    return failure(res, "Authentication token is required.", 401);
  }

  try {
    const decoded = verifyAccessToken<any>(token);

    // A guest token never becomes `req.user`. Reaching here means the route isn't
    // guest-browsable or guest mode is off: on → 403 (needs an account); off → 401 (the
    // guest token is dead everywhere). Applies on every surface, admin included.
    if (isGuestPayload(decoded)) {
      return (await isGuestModeOn())
        ? failure(res, "Please log in to continue.", 403, {}, { reason: "ACCOUNT_REQUIRED" })
        : failure(res, "Guest session has expired.", 401, {}, { reason: "GUEST_SESSION_EXPIRED" });
    }

    const role = decoded.role ?? "customer";

    // Logout-all / forced re-auth cutoff (libs/tokenRevocation.ts): tokens issued before
    // it are rejected. Independent of the single-device session-pointer check below.
    const userType = (decoded.type ?? "customer") as UserType;
    if (await isRevoked(userType, decoded.id, decoded.iat)) {
      // The cutoff doesn't say why; for customers, read live state to surface the precise
      // reason (only on the revoked path). Clients branch on `data.reason`, not the message.
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

    // A valid, non-revoked token is not enough: a since-disabled or deleted account is
    // cut off here on every request (cached gate). Clients branch on `data.reason`.
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
      // The token table is authoritative for customer sessions: a signature-valid token
      // whose rows were deleted or deactivated (logout, deletion, support edit) is
      // rejected. SESSION_REVOKED already means "terminal, go to login" to the app.
      if (!gate.hasLiveToken) {
        return failure(res, "Session was revoked. Please log in again.", 401, {}, {
          reason: "SESSION_REVOKED",
        });
      }
    }

    // Authoritative for admin sessions too.
    if (userType === "admin" && !(await hasLiveAdminToken(String(decoded.id)))) {
      return failure(res, "Session was revoked. Please log in again.", 401, {}, {
        reason: "SESSION_REVOKED",
      });
    }

    // One active device per user, per surface.
    if (decoded.type === "customer") {
      const activeToken = await redisClient.get(`customer_session:${decoded.id}`);
      if (!activeToken || activeToken !== token) {
        // SESSION_REVOKED = terminal for the app (no refresh attempt; the refresh
        // row is already inactive). See docs/client/REFRESH_TOKEN_GUIDE.md.
        return failure(res, "Session expired or logged in on another device.", 401, {}, {
          reason: "SESSION_REVOKED",
        });
      }
    }

    if (decoded.type === "admin") {
      const activeAdminToken = await redisClient.get(`admin_session:${decoded.id}`);
      if (!activeAdminToken || activeAdminToken !== token) {
        return failure(res, "Admin session expired or logged in elsewhere.", 401, {}, {
          reason: "SESSION_REVOKED",
        });
      }
    }

    if (decoded.type === "educator") {
      const activeEducatorToken = await redisClient.get(`educator_session:${decoded.id}`);
      if (!activeEducatorToken || activeEducatorToken !== token) {
        return failure(res, "Educator session expired or logged in elsewhere.", 401);
      }
    }

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

    // Every downstream log line then carries userId + userRole.
    updateContext({ userId: decoded.id, userRole: role });

    // "Used the app today" for the admin dashboard's active-customer counts. Fire-and-forget
    // and Redis-throttled to one write per customer per day — see libs/customerActivity.ts.
    if (userType === "customer") markCustomerActive(decoded.id, req);

    return next();
  } catch (err) {
    // An unreachable database must not look like a bad token: clients treat 401 as
    // "log out", so a brief outage would sign out every customer. 503 + Retry-After
    // keeps the session intact.
    if (isDatabaseUnavailableError(err)) {
      logger.error("[auth] database unavailable during authentication", {
        method: req.method,
        url: req.originalUrl,
        error: (err as Error).message,
      });
      return sendServiceUnavailable(res);
    }
    // A guest token that no longer verifies (key rotated out): tell the app to fetch
    // the guest token again rather than run the customer refresh flow. The
    // unverified peek only picks the reason.
    if (isGuestPayload(jwt.decode(token))) {
      return failure(res, "Guest session has expired.", 401, {}, { reason: "GUEST_SESSION_EXPIRED" });
    }
    return failure(res, "Invalid or expired token.", 401);
  }
};

/**
 * For routes serving both anonymous and authenticated callers: attaches `req.user` when
 * a valid token is present, otherwise continues anonymously (never 401s). Intentionally
 * skips the revocation/account-gate checks; it only enriches the request.
 */
export const optionalAuthenticate = async (req: Request, _res: Response, next: NextFunction) => {
  const auth = req.headers.authorization || "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : undefined;
  if (!token) return next();
  try {
    const decoded = verifyAccessToken<any>(token);
    if (isGuestPayload(decoded)) return next(); // a guest is anonymous, never req.user
    const role = decoded.role ?? "customer";
    req.user = { id: decoded.id, phone: decoded.phone, email: decoded.email, role, ...decoded };
    updateContext({ userId: decoded.id, userRole: role });
  } catch {
  }
  return next();
};

// Coarse role gate: 403 unless req.user.role is one of `roles` (guests pass through).
export const requireRole = (...roles: string[]) => {
  return (req: Request, res: Response, next: NextFunction) => {
    // Per-route requireRole must not 403 a CORS preflight (no Bearer token).
    if (req.method === "OPTIONS") return next();

    // A guest has no role to check; the guest allowlist already scoped the route.
    if (req.isGuest) return next();

    if (!req.user || !roles.includes(req.user.role)) {
      return failure(res, "Access denied. Insufficient permissions.", 403);
    }
    return next();
  };
};

export default authenticate;

