import { Request, Response } from "express";
import { Permission } from "../../models/admin/Permission.model";
import {
  CATALOG_VERSION,
  PERMISSION_CATALOG,
  ALL_CATALOG_KEYS,
} from "./permissions.catalog";

// GET /api/v1/admin/permissions/catalog
export const getPermissionCatalog = async (_req: Request, res: Response) => {
  try {
    // Surface deprecated keys still present in DB so admins can clean roles.
    const dbRows = await Permission.find({}, { name: 1 }).lean();
    const dbKeys = new Set(dbRows.map((r) => r.name));

    const deprecatedKeys = [...dbKeys].filter((k) => !ALL_CATALOG_KEYS.has(k));

    return res.status(200).json({
      success: true,
      data: {
        version: CATALOG_VERSION,
        modules: PERMISSION_CATALOG,
        deprecated: deprecatedKeys.map((key) => ({ key, deprecated: true })),
      },
    });
  } catch (error: any) {
    return res.status(500).json({ success: false, message: error.message });
  }
};
