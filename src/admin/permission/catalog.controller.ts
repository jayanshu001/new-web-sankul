import { Request, Response } from "express";
import { guardOnlyQuerySchema } from "./permission.validation";
import { getCatalogFromDb } from "../../modules/permission-catalog/permission-catalog.service";

// GET /api/v1/admin/permissions/catalog[?guard=web|educator|promoter]
//
// Rendered ENTIRELY from the database. A Spatie permission row is guard-scoped
// (a role can only hold permissions of its own guard), so the endpoint filters
// ws_permissions by `?guard=` and groups the rows under their ws_permission_category.
// - No `?guard=` → defaults to the `web` guard (backward compatible).
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

    const categories = await getCatalogFromDb(guard);

    return res.status(200).json({
      success: true,
      data: {
        guard,
        categories,
      },
    });
  } catch (error: any) {
    return res.status(500).json({ success: false, message: error.message });
  }
};
