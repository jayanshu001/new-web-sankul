// Admin-wide RBAC gate, mounted in admin.routes.ts right after `authenticate`. Looks the
// request up in rbacRouteMap.ts and delegates allow/deny to requirePermission (which
// honors the RBAC_ENFORCE shadow/enforce flag). Unmapped routes are allowed and logged
// so an incomplete map never blocks the panel.

import { Request, Response, NextFunction } from "express";
import logger from "../utils/logger";
import { resolveRequiredKeys } from "./rbacRouteMap";
import { requirePermission, requirePermissionStrict } from "./requirePermission";

const ADMIN_MOUNT = "/api/v1/admin";

/**
 * Admin-router-relative path, e.g. "/books/123". `baseUrl + path` is the full path both
 * on the admin router and inside a sub-router, so this serves `enforceRbac` and `enforceRbacStrict`.
 */
const relativePath = (req: Request): string => {
  let p = `${req.baseUrl}${req.path}`;
  if (p.startsWith(ADMIN_MOUNT)) p = p.slice(ADMIN_MOUNT.length) || "/";
  return p;
};

const buildEnforceRbac =
  (strict: boolean) => (req: Request, res: Response, next: NextFunction) => {
    if (req.method === "OPTIONS") return next();

    const keys = resolveRequiredKeys(req.method, relativePath(req));

    if (!keys || keys.length === 0) {
      // Coverage gap: log so the map can be completed before RBAC_ENFORCE is on; never block.
      logger.warn("rbac unmapped route (allowed)", {
        adminId: req.user?.id,
        method: req.method,
        path: req.originalUrl,
        rbac: "unmapped",
      });
      return next();
    }

    return (strict ? requirePermissionStrict : requirePermission)(...keys)(req, res, next);
  };

export const enforceRbac = buildEnforceRbac(false);

/**
 * Same lookup, but hard-denies regardless of RBAC_ENFORCE. For the RBAC-management
 * sub-routers (administrators/roles/permissions/…), which never run in shadow mode.
 */
export const enforceRbacStrict = buildEnforceRbac(true);

export default enforceRbac;
