// Per-endpoint RBAC: the real security boundary behind the frontend's permission
// gating. `requireRole` checks only the coarse role; this checks the caller's effective
// catalog permission keys. RBAC_ENFORCE !== "true" is shadow mode (missing key is logged
// as would-block, request proceeds); "true" answers 403 "Forbidden". Super-admins bypass.

import { Request, Response, NextFunction } from "express";
import { failure } from "../utils/httpResponse";
import logger from "../utils/logger";
import { getEffectivePermissionKeys } from "../modules/admin-auth/admin-permission-resolver";

export const isRbacEnforced = (): boolean =>
  String(process.env.RBAC_ENFORCE).trim().toLowerCase() === "true";

export const isSuperAdmin = (req: Request): boolean =>
  req.user?.role === "super_admin" ||
  (Array.isArray(req.user?.permissions) && req.user!.permissions.includes("*"));

/**
 * Allows callers holding at least one of `requiredKeys` (OR semantics, e.g.
 * `requirePermission("books.view", "books.list")`). Must run after `authenticate`.
 */
export const requirePermission = (...requiredKeys: string[]) =>
  buildRequirePermission(requiredKeys, false);

/**
 * Same check, but always hard-denies regardless of RBAC_ENFORCE. For role/permission/
 * administrator management, where a shadow-mode pass would be a privilege hole.
 */
export const requirePermissionStrict = (...requiredKeys: string[]) =>
  buildRequirePermission(requiredKeys, true);

const buildRequirePermission = (requiredKeys: string[], strict: boolean) => {
  return async (req: Request, res: Response, next: NextFunction) => {
    // CORS preflight carries no auth; authenticate already skips OPTIONS.
    if (req.method === "OPTIONS") return next();

    if (!req.user) {
      // No identity to authorize: 401, not 403.
      return failure(res, "Authentication token is required.", 401);
    }

    if (isSuperAdmin(req)) return next();

    let effectiveKeys: string[];
    try {
      effectiveKeys = await getEffectivePermissionKeys(String(req.user.id));
    } catch (err) {
      // Resolver/DB blip: fail open (logged) rather than lock the panel out on a transient
      // error. Denial is reserved for a successful resolve where the key is absent.
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

    if (strict || isRbacEnforced()) {
      logger.warn("requirePermission DENIED (enforced)", {
        adminId: req.user.id,
        role: req.user.role,
        method: req.method,
        path: req.originalUrl,
        requiredKeys,
      });
      return failure(res, "Forbidden", 403);
    }

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
