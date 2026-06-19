import { Request, Response } from "express";
import mongoose from "mongoose";
import { PermissionCategory } from "../../models/admin/PermissionCategory.model";
import { Permission } from "../../models/admin/Permission.model";
import {
  createPermissionCategorySchema,
  updatePermissionCategorySchema,
  listQuerySchema,
  sortFieldMap,
} from "./permissionCategory.validation";
import { buildRegexCondition } from "../../utils/searchFilter";
import {
  isPermissionCategoryMysql,
  parsePcatId,
  listCategories as sqlListCategories,
  getCategory as sqlGetCategory,
  createCategory as sqlCreateCategory,
  updateCategory as sqlUpdateCategory,
  deleteCategory as sqlDeleteCategory,
} from "../../modules/permission-category/permission-category.service";

const formatZodErrors = (issues: any[]) =>
  issues.reduce<Record<string, string>>((acc, i) => {
    acc[i.path.join(".")] = i.message;
    return acc;
  }, {});

const toItem = (c: any, permissionCount?: number) => ({
  id: c._id,
  title: c.title,
  slug: c.slug,
  order: c.order,
  status: c.status,
  ...(permissionCount !== undefined ? { permission_count: permissionCount } : {}),
  created_at: c.createdAt,
  updated_at: c.updatedAt,
});

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

    if (isPermissionCategoryMysql()) {
      const result = await sqlListCategories({
        search,
        status,
        page,
        per_page,
        sortBy: sort_by,
        sortDir: sort_dir,
      });
      return res.status(200).json({ success: true, data: result });
    }

    const filter: any = {};
    if (typeof status === "boolean") filter.status = status;
    { const c = buildRegexCondition(search); if (c) filter.title = c; }

    const sort: any = { [sortFieldMap[sort_by]]: sort_dir === "asc" ? 1 : -1 };
    const skip = (page - 1) * per_page;

    const [items, total] = await Promise.all([
      PermissionCategory.find(filter).sort(sort).skip(skip).limit(per_page).lean(),
      PermissionCategory.countDocuments(filter),
    ]);

    const ids = items.map((c) => c._id);
    const counts = await Permission.aggregate([
      { $match: { categoryId: { $in: ids } } },
      { $group: { _id: "$categoryId", count: { $sum: 1 } } },
    ]);
    const countMap = new Map(counts.map((c: any) => [String(c._id), c.count]));

    return res.status(200).json({
      success: true,
      data: {
        items: items.map((c) => toItem(c, countMap.get(String(c._id)) || 0)),
        pagination: { page, per_page, total },
      },
    });
  } catch (error: any) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

// GET /api/v1/admin/permission-categories/:id
export const getPermissionCategory = async (req: Request, res: Response) => {
  try {
    const id = req.params.id as string;

    if (isPermissionCategoryMysql()) {
      const numId = parsePcatId(id);
      if (!numId) {
        return res.status(400).json({ success: false, message: "Invalid permission category id" });
      }
      const data = await sqlGetCategory(numId);
      if (!data) {
        return res.status(404).json({ success: false, message: "Permission category not found" });
      }
      return res.status(200).json({ success: true, data });
    }

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ success: false, message: "Invalid permission category id" });
    }
    const category = await PermissionCategory.findById(id).lean();
    if (!category) {
      return res.status(404).json({ success: false, message: "Permission category not found" });
    }
    const permissionCount = await Permission.countDocuments({ categoryId: id });
    return res.status(200).json({ success: true, data: toItem(category, permissionCount) });
  } catch (error: any) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

// POST /api/v1/admin/permission-categories
export const createPermissionCategory = async (req: Request, res: Response) => {
  try {
    const parsed = createPermissionCategorySchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(422).json({
        success: false,
        message: "Validation failed",
        errors: formatZodErrors(parsed.error.issues),
      });
    }
    const { title, slug, order, status } = parsed.data;

    if (isPermissionCategoryMysql()) {
      const result = await sqlCreateCategory({ title, slug, order, status });
      if (!result.ok) {
        return res.status(409).json({ success: false, message: `Slug '${slug}' already exists` });
      }
      return res.status(201).json({
        success: true,
        message: "Permission category created successfully",
        data: result.data,
      });
    }

    const exists = await PermissionCategory.exists({ slug });
    if (exists) {
      return res.status(409).json({ success: false, message: `Slug '${slug}' already exists` });
    }

    const created = await PermissionCategory.create({ title, slug, order, status });
    return res.status(201).json({
      success: true,
      message: "Permission category created successfully",
      data: toItem(created.toObject(), 0),
    });
  } catch (error: any) {
    if (error.code === 11000) {
      return res.status(409).json({ success: false, message: "Slug already exists" });
    }
    return res.status(500).json({ success: false, message: error.message });
  }
};

// PUT /api/v1/admin/permission-categories/:id
export const updatePermissionCategory = async (req: Request, res: Response) => {
  try {
    const id = req.params.id as string;
    const sqlMode = isPermissionCategoryMysql();
    const sqlId = sqlMode ? parsePcatId(id) : null;

    if (sqlMode) {
      if (!sqlId) {
        return res.status(400).json({ success: false, message: "Invalid permission category id" });
      }
    } else if (!mongoose.Types.ObjectId.isValid(id)) {
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

    if (sqlMode && sqlId) {
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
    }

    const category = await PermissionCategory.findById(id);
    if (!category) {
      return res.status(404).json({ success: false, message: "Permission category not found" });
    }

    if (parsed.data.slug && parsed.data.slug !== category.slug) {
      const dupe = await PermissionCategory.exists({ _id: { $ne: id }, slug: parsed.data.slug });
      if (dupe) {
        return res
          .status(409)
          .json({ success: false, message: `Slug '${parsed.data.slug}' already exists` });
      }
      category.slug = parsed.data.slug;
    }
    if (parsed.data.title !== undefined) category.title = parsed.data.title;
    if (parsed.data.order !== undefined) category.order = parsed.data.order;
    if (parsed.data.status !== undefined) category.status = parsed.data.status;

    await category.save();
    const permissionCount = await Permission.countDocuments({ categoryId: id });
    return res.status(200).json({
      success: true,
      message: "Permission category updated successfully",
      data: toItem(category.toObject(), permissionCount),
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

    if (isPermissionCategoryMysql()) {
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
    }

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ success: false, message: "Invalid permission category id" });
    }
    const category = await PermissionCategory.findById(id);
    if (!category) {
      return res.status(404).json({ success: false, message: "Permission category not found" });
    }

    const inUse = await Permission.exists({ categoryId: id });
    if (inUse) {
      return res.status(409).json({
        success: false,
        message: "Category has permissions assigned and cannot be deleted",
      });
    }

    await category.deleteOne();
    return res
      .status(200)
      .json({ success: true, message: "Permission category deleted successfully", data: {} });
  } catch (error: any) {
    return res.status(500).json({ success: false, message: error.message });
  }
};
