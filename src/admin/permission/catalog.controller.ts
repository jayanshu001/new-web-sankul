import { Request, Response } from "express";
import {
  CATALOG_VERSION,
  modulesForGuard,
  catalogKeysForGuard,
} from "./permissions.catalog";
import { guardOnlyQuerySchema } from "./permission.validation";
import { getStoredPermissionNames } from "../../modules/permission-catalog/permission-catalog.service";

// GET /api/v1/admin/permissions/catalog[?guard=web|educator|promoter]
//
// Guard-scoped: a Spatie role can only hold permissions of its own guard, so the
// RBAC "Manage Permissions" tree must request the catalog for that role's guard.
// - `?guard=promoter` → only the promoter guard's modules (Promoter Portal) and
//   the deprecated set computed against promoter-guard rows only.
// - No `?guard=` → defaults to the `web` guard (backward compatible: the existing
//   admin tree is entirely web-guard modules).
export const getPermissionCatalog = async (req: Request, res: Response) => {
  try {
    const parsed = guardOnlyQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      return res.status(422).json({
        success: false,
        message: "Invalid guard",
      });
    }

    const guard = parsed.data.guard ?? "web";

    const modules = modulesForGuard(guard);
    const liveKeys = catalogKeysForGuard(guard);

    // Surface deprecated keys still present in DB (for this guard) so admins can
    // clean up role assignments. No ObjectId guard needed (we only read `name`).
    const storedNames = await getStoredPermissionNames(guard);
    const deprecatedKeys = [...new Set(storedNames)].filter((k) => !liveKeys.has(k));

    return res.status(200).json({
      success: true,
      data: {
        version: CATALOG_VERSION,
        guard,
        modules,
        deprecated: deprecatedKeys.map((key) => ({ key, deprecated: true })),
      },
    });
  } catch (error: any) {
    return res.status(500).json({ success: false, message: error.message });
  }
};
