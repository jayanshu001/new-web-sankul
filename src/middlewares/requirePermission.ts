// src/middlewares/requirePermission.ts
//
// Per-endpoint RBAC enforcement — the actual security boundary behind the
// frontend's permission gating (docs backend-request rbac-module-visibility.md
// §4). `requireRole` only checks the coarse role string; this checks the
// caller's EFFECTIVE catalog permission keys for the specific action.
//
// Rollout is shadow-first, controlled by the RBAC_ENFORCE env flag:
//   - RBAC_ENFORCE unset / !== "true"  → SHADOW MODE (default): a caller missing
//     the key is LOGGED (level: would-block) but the request proceeds. This lets
//     us verify every role's grants from logs in prod before turning on hard
//     denial — zero lock-out risk.
//   - RBAC_ENFORCE === "true"          → ENFORCE MODE: a caller missing the key
//     gets 403 { success:false, message:"Forbidden" }.
//
// Super-admins always bypass (role === super_admin, i.e. the "*" wildcard) and
// never hit the resolver.

import { Request, Response, NextFunction } from "express";
import { failure } from "../utils/httpResponse";
import logger from "../utils/logger";
import { getEffectivePermissionKeys } from "../modules/admin-auth/admin-permission-resolver";

/** Hard-enforce 403s only when RBAC_ENFORCE is explicitly "true"; else shadow. */
export const isRbacEnforced = (): boolean =>
  String(process.env.RBAC_ENFORCE).trim().toLowerCase() === "true";

const isSuperAdmin = (req: Request): boolean =>
  req.user?.role === "super_admin" ||
  (Array.isArray(req.user?.permissions) && req.user!.permissions.includes("*"));

/**
 * Restrict an admin endpoint to callers holding AT LEAST ONE of `requiredKeys`
 * (OR semantics — pass both view/list keys for a read route, e.g.
 * `requirePermission("books.view", "books.list")`).
 *
 * Must run AFTER `authenticate` (needs `req.user`). Intended for admin routes;
 * super-admins bypass. See the shadow/enforce behavior in the file header.
 */
export const requirePermission = (...requiredKeys: string[]) => {
  return async (req: Request, res: Response, next: NextFunction) => {
    // CORS preflight carries no auth; authenticate already skips OPTIONS.
    if (req.method === "OPTIONS") return next();

    if (!req.user) {
      // authenticate should have populated req.user; if not, this is a 401 not
      // a 403 (no identity to authorize).
      return failure(res, "Authentication token is required.", 401);
    }

    // Super-admins get everything without a resolver round-trip.
    if (isSuperAdmin(req)) return next();

    let effectiveKeys: string[];
    try {
      effectiveKeys = await getEffectivePermissionKeys(String(req.user.id));
    } catch (err) {
      // Resolver/DB blip: fail OPEN with an error log rather than locking the
      // whole panel out on a transient infra error (matches the customer-gate
      // philosophy in authenticate.ts). Denial is reserved for a definitive
      // "resolved successfully and the key is absent" outcome below.
      logger.error("requirePermission resolver error — allowing (fail-open)", {
        adminId: req.user.id,
        method: req.method,
        path: req.originalUrl,
        requiredKeys,
        error: (err as Error).message,
      });
      return next();
    }

    const hasKey = requiredKeys.some((k) => effectiveKeys.includes(k));
    if (hasKey) return next();

    if (isRbacEnforced()) {
      logger.warn("requirePermission DENIED (enforced)", {
        adminId: req.user.id,
        role: req.user.role,
        method: req.method,
        path: req.originalUrl,
        requiredKeys,
      });
      return failure(res, "Forbidden", 403);
    }

    // Shadow mode: record what WOULD have been blocked, then allow.
    logger.warn("requirePermission would-block (shadow mode)", {
      adminId: req.user.id,
      role: req.user.role,
      method: req.method,
      path: req.originalUrl,
      requiredKeys,
      rbac: "shadow",
    });
    return next();
  };
};

export default requirePermission;
