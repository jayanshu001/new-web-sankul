import { Request, Response } from "express";
import {
  updatePermissionCategorySchema,
  listQuerySchema,
} from "./permissionCategory.validation";
import {
  parsePcatId,
  listCategories as sqlListCategories,
  getCategory as sqlGetCategory,
  updateCategory as sqlUpdateCategory,
  deleteCategory as sqlDeleteCategory,
} from "../../modules/permission-category/permission-category.service";

const formatZodErrors = (issues: any[]) =>
  issues.reduce<Record<string, string>>((acc, i) => {
    acc[i.path.join(".")] = i.message;
    return acc;
  }, {});

// GET /api/v1/admin/permission-categories
export const listPermissionCategories = async (req: Request, res: Response) => {
  try {
    const parsed = listQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      return res.status(422).json({
        success: false,
        message: "Validation failed",
        errors: formatZodErrors(parsed.error.issues),
      });
    }
    const { search, status, page, per_page, sort_by, sort_dir } = parsed.data;

    const result = await sqlListCategories({
      search,
      status,
      page,
      per_page,
      sortBy: sort_by,
      sortDir: sort_dir,
    });
    // House-standard list envelope: `data` is the page array, `pagination` a
    // sibling with total + totalPages. See permissions-categories-list-server-side.md.
    const total = result.pagination.total;
    return res.status(200).json({
      success: true,
      data: result.items,
      pagination: { total, page, limit: per_page, totalPages: Math.ceil(total / per_page) },
    });
  } catch (error: any) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

// GET /api/v1/admin/permission-categories/:id
export const getPermissionCategory = async (req: Request, res: Response) => {
  try {
    const id = req.params.id as string;

    const numId = parsePcatId(id);
    if (!numId) {
      return res.status(400).json({ success: false, message: "Invalid permission category id" });
    }
    const data = await sqlGetCategory(numId);
    if (!data) {
      return res.status(404).json({ success: false, message: "Permission category not found" });
    }
    return res.status(200).json({ success: true, data });
  } catch (error: any) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

// PUT /api/v1/admin/permission-categories/:id
export const updatePermissionCategory = async (req: Request, res: Response) => {
  try {
    const id = req.params.id as string;
    const sqlId = parsePcatId(id);

    if (!sqlId) {
      return res.status(400).json({ success: false, message: "Invalid permission category id" });
    }
    const parsed = updatePermissionCategorySchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(422).json({
        success: false,
        message: "Validation failed",
        errors: formatZodErrors(parsed.error.issues),
      });
    }

    const result = await sqlUpdateCategory(sqlId, {
      title: parsed.data.title,
      slug: parsed.data.slug,
      order: parsed.data.order,
      status: parsed.data.status,
    });
    if (!result.ok) {
      if (result.code === "not_found") {
        return res
          .status(404)
          .json({ success: false, message: "Permission category not found" });
      }
      return res
        .status(409)
        .json({ success: false, message: `Slug '${parsed.data.slug}' already exists` });
    }
    return res.status(200).json({
      success: true,
      message: "Permission category updated successfully",
      data: result.data,
    });
  } catch (error: any) {
    if (error.code === 11000) {
      return res.status(409).json({ success: false, message: "Slug already exists" });
    }
    return res.status(500).json({ success: false, message: error.message });
  }
};

// DELETE /api/v1/admin/permission-categories/:id
export const deletePermissionCategory = async (req: Request, res: Response) => {
  try {
    const id = req.params.id as string;

    const numId = parsePcatId(id);
    if (!numId) {
      return res.status(400).json({ success: false, message: "Invalid permission category id" });
    }
    const result = await sqlDeleteCategory(numId);
    if (!result.ok) {
      if (result.code === "not_found") {
        return res
          .status(404)
          .json({ success: false, message: "Permission category not found" });
      }
      return res.status(409).json({
        success: false,
        message: "Category has permissions assigned and cannot be deleted",
      });
    }
    return res
      .status(200)
      .json({ success: true, message: "Permission category deleted successfully", data: {} });
  } catch (error: any) {
    return res.status(500).json({ success: false, message: error.message });
  }
};
