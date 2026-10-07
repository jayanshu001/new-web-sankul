// Admin permissions: guard-filtered permission catalog handler.
import { Request, Response } from "express";
import { guardOnlyQuerySchema } from "./permission.validation";
import { getCatalogFromDb } from "../../modules/permission-catalog/permission-catalog.service";

// Permissions are guard-scoped (a role can only hold permissions of its own guard),
// so the catalog is filtered by `?guard=` (default `web`) and grouped by category.
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
