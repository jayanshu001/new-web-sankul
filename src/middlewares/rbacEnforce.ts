// src/middlewares/rbacEnforce.ts
//
// Single admin-wide RBAC gate. Mounted once in admin.routes.ts right after
// `authenticate`, so it runs for every admin request with `req.user` already
// populated. It looks the request up in the declarative route map
// (rbacRouteMap.ts) and delegates the actual allow/deny to requirePermission,
// which honors the RBAC_ENFORCE shadow/enforce flag.
//
// Unmapped routes are ALLOWED and logged (coverage gap) so an incomplete map
// never blocks the panel — see rbacRouteMap.ts for the rationale.

import { Request, Response, NextFunction } from "express";
import logger from "../utils/logger";
import { resolveRequiredKeys } from "./rbacRouteMap";
import { requirePermission, requirePermissionStrict } from "./requirePermission";

const ADMIN_MOUNT = "/api/v1/admin";

/**
 * Admin-router-relative path, e.g. "/books/123" (mount prefix stripped).
 * `baseUrl + path` is the full mounted path whether this runs on the admin
 * router itself (baseUrl = "/api/v1/admin") or inside a sub-router
 * (baseUrl = "/api/v1/admin/roles", path = "/:id") — so one resolver serves
 * both `enforceRbac` and the per-router `enforceRbacStrict`.
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
      // No rule for this route yet. Log once per request so we can complete the
      // map before flipping RBAC_ENFORCE on; never block on an unmapped route.
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
 * Same route-map lookup, but hard-denies regardless of RBAC_ENFORCE. Mount on
 * the RBAC-management sub-routers (administrators/roles/permissions/…): those
 * are the boundary itself, so they never run in shadow mode.
 */
export const enforceRbacStrict = buildEnforceRbac(true);

export default enforceRbac;
