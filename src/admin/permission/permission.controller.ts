import { Request, Response } from "express";
import mongoose from "mongoose";
import { Permission } from "../../models/admin/Permission.model";
import { PermissionCategory } from "../../models/admin/PermissionCategory.model";
import { Role } from "../../models/admin/Role.model";
import { AdminUser } from "../../models/admin/AdminUser.model";
import {
  createPermissionSchema,
  updatePermissionSchema,
  listQuerySchema,
  guardOnlyQuerySchema,
  sortFieldMap,
} from "./permission.validation";

const formatZodErrors = (issues: any[]) =>
  issues.reduce<Record<string, string>>((acc, i) => {
    acc[i.path.join(".")] = i.message;
    return acc;
  }, {});

const toItem = (p: any, roleCount?: number) => {
  const cat = p.categoryId && typeof p.categoryId === "object" && p.categoryId._id
    ? { id: p.categoryId._id, title: p.categoryId.title, slug: p.categoryId.slug }
    : p.categoryId
      ? { id: p.categoryId, title: null, slug: null }
      : null;
  return {
    id: p._id,
    name: p.name,
    guard_name: p.guardName,
    category: cat,
    ...(roleCount !== undefined ? { assigned_role_count: roleCount } : {}),
    created_at: p.createdAt,
    updated_at: p.updatedAt,
  };
};

// GET /api/v1/admin/permissions
export const listPermissions = async (req: Request, res: Response) => {
  try {
    const parsed = listQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      return res.status(422).json({
        success: false,
        message: "Validation failed",
        errors: formatZodErrors(parsed.error.issues),
      });
    }
    const { guard, category_id, search, page, per_page, sort_by, sort_dir } = parsed.data;

    const filter: any = {};
    if (guard) filter.guardName = guard;
    if (category_id) filter.categoryId = category_id;
    if (search) filter.name = { $regex: search, $options: "i" };

    const sort: any = { [sortFieldMap[sort_by]]: sort_dir === "asc" ? 1 : -1 };
    const skip = (page - 1) * per_page;

    const [items, total] = await Promise.all([
      Permission.find(filter)
        .populate("categoryId", "_id title slug")
        .sort(sort)
        .skip(skip)
        .limit(per_page)
        .lean(),
      Permission.countDocuments(filter),
    ]);

    const ids = items.map((p) => p._id);
    const roleCounts = await Role.aggregate([
      { $match: { permissions: { $in: ids } } },
      { $unwind: "$permissions" },
      { $match: { permissions: { $in: ids } } },
      { $group: { _id: "$permissions", count: { $sum: 1 } } },
    ]);
    const countMap = new Map(roleCounts.map((r: any) => [String(r._id), r.count]));

    return res.status(200).json({
      success: true,
      data: {
        items: items.map((p) => toItem(p, countMap.get(String(p._id)) || 0)),
        pagination: { page, per_page, total },
      },
    });
  } catch (error: any) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

// GET /api/v1/admin/permissions/:id
export const getPermission = async (req: Request, res: Response) => {
  try {
    const id = req.params.id as string;
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ success: false, message: "Invalid permission id" });
    }
    const guardParsed = guardOnlyQuerySchema.safeParse(req.query);
    if (!guardParsed.success) {
      return res.status(422).json({
        success: false,
        message: "Validation failed",
        errors: formatZodErrors(guardParsed.error.issues),
      });
    }

    const filter: any = { _id: id };
    if (guardParsed.data.guard) filter.guardName = guardParsed.data.guard;

    const perm = await Permission.findOne(filter)
      .populate("categoryId", "_id title slug")
      .lean();
    if (!perm) return res.status(404).json({ success: false, message: "Permission not found" });

    const roles = await Role.find({ permissions: perm._id })
      .select("_id name guardName")
      .lean();

    return res.status(200).json({
      success: true,
      data: {
        ...toItem(perm),
        roles: roles.map((r) => ({ id: r._id, name: r.name, guard_name: r.guardName })),
      },
    });
  } catch (error: any) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

// POST /api/v1/admin/permissions
export const createPermission = async (req: Request, res: Response) => {
  try {
    const parsed = createPermissionSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(422).json({
        success: false,
        message: "Validation failed",
        errors: formatZodErrors(parsed.error.issues),
      });
    }
    const { name, guard, category_id } = parsed.data;

    const categoryExists = await PermissionCategory.exists({ _id: category_id, status: true });
    if (!categoryExists) {
      return res
        .status(400)
        .json({ success: false, message: "Invalid or inactive permission category" });
    }

    const exists = await Permission.exists({ name, guardName: guard });
    if (exists) {
      return res.status(409).json({
        success: false,
        message: `Permission '${name}' already exists for guard '${guard}'`,
      });
    }

    const created = await Permission.create({ name, guardName: guard, categoryId: category_id });
    const populated = await Permission.findById(created._id)
      .populate("categoryId", "_id title slug")
      .lean();
    return res.status(201).json({
      success: true,
      message: "Permission created successfully",
      data: toItem(populated),
    });
  } catch (error: any) {
    if (error.code === 11000) {
      return res.status(409).json({ success: false, message: "Permission already exists for this guard" });
    }
    return res.status(500).json({ success: false, message: error.message });
  }
};

// PUT /api/v1/admin/permissions/:id
export const updatePermission = async (req: Request, res: Response) => {
  try {
    const id = req.params.id as string;
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ success: false, message: "Invalid permission id" });
    }
    const parsed = updatePermissionSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(422).json({
        success: false,
        message: "Validation failed",
        errors: formatZodErrors(parsed.error.issues),
      });
    }

    const perm = await Permission.findById(id);
    if (!perm) return res.status(404).json({ success: false, message: "Permission not found" });

    const nextName = parsed.data.name ?? perm.name;
    const nextGuard = parsed.data.guard ?? perm.guardName;

    if (nextName !== perm.name || nextGuard !== perm.guardName) {
      const dupe = await Permission.exists({
        _id: { $ne: id },
        name: nextName,
        guardName: nextGuard,
      });
      if (dupe) {
        return res.status(409).json({
          success: false,
          message: `Permission '${nextName}' already exists for guard '${nextGuard}'`,
        });
      }
    }

    perm.name = nextName;
    perm.guardName = nextGuard;

    if (parsed.data.category_id) {
      const categoryExists = await PermissionCategory.exists({
        _id: parsed.data.category_id,
        status: true,
      });
      if (!categoryExists) {
        return res
          .status(400)
          .json({ success: false, message: "Invalid or inactive permission category" });
      }
      perm.categoryId = parsed.data.category_id as any;
    }

    await perm.save();
    const populated = await Permission.findById(perm._id)
      .populate("categoryId", "_id title slug")
      .lean();

    return res.status(200).json({
      success: true,
      message: "Permission updated successfully",
      data: toItem(populated),
    });
  } catch (error: any) {
    if (error.code === 11000) {
      return res.status(409).json({ success: false, message: "Permission already exists for this guard" });
    }
    return res.status(500).json({ success: false, message: error.message });
  }
};

// DELETE /api/v1/admin/permissions/:id
export const deletePermission = async (req: Request, res: Response) => {
  try {
    const id = req.params.id as string;
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ success: false, message: "Invalid permission id" });
    }
    const guardParsed = guardOnlyQuerySchema.safeParse(req.query);
    if (!guardParsed.success) {
      return res.status(422).json({
        success: false,
        message: "Validation failed",
        errors: formatZodErrors(guardParsed.error.issues),
      });
    }

    const filter: any = { _id: id };
    if (guardParsed.data.guard) filter.guardName = guardParsed.data.guard;

    const perm = await Permission.findOne(filter);
    if (!perm) return res.status(404).json({ success: false, message: "Permission not found" });

    const [roleInUse, userInUse] = await Promise.all([
      Role.exists({ permissions: perm._id }),
      AdminUser.exists({ permissions: perm._id }),
    ]);
    if (roleInUse || userInUse) {
      return res.status(409).json({
        success: false,
        message: "Permission is assigned to one or more roles or users and cannot be deleted",
      });
    }

    await perm.deleteOne();
    return res.status(200).json({ success: true, message: "Permission deleted successfully", data: {} });
  } catch (error: any) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

// GET /api/v1/admin/permissions/:id/roles
export const getRolesForPermission = async (req: Request, res: Response) => {
  try {
    const id = req.params.id as string;
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ success: false, message: "Invalid permission id" });
    }
    const guardParsed = guardOnlyQuerySchema.safeParse(req.query);
    if (!guardParsed.success) {
      return res.status(422).json({
        success: false,
        message: "Validation failed",
        errors: formatZodErrors(guardParsed.error.issues),
      });
    }

    const exists = await Permission.exists({ _id: id });
    if (!exists) return res.status(404).json({ success: false, message: "Permission not found" });

    const filter: any = { permissions: id };
    if (guardParsed.data.guard) filter.guardName = guardParsed.data.guard;

    const roles = await Role.find(filter).select("_id name guardName createdAt updatedAt").lean();
    return res.status(200).json({
      success: true,
      data: {
        roles: roles.map((r) => ({
          id: r._id,
          name: r.name,
          guard_name: r.guardName,
          created_at: r.createdAt,
          updated_at: r.updatedAt,
        })),
      },
    });
  } catch (error: any) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

// GET /api/v1/admin/permissions/tree
export const getPermissionsTree = async (_req: Request, res: Response) => {
  try {
    const all = await Permission.find()
      .select("_id name guardName categoryId")
      .populate("categoryId", "_id title slug order")
      .sort({ name: 1 })
      .lean();

    const tree: Record<
      string,
      Record<string, { id: any; title: string; slug: string; order: number; permissions: { id: any; name: string }[] }>
    > = {};

    for (const p of all) {
      const guard = p.guardName;
      const cat: any = p.categoryId;
      if (!cat || typeof cat !== "object") continue;
      const slug = cat.slug || "general";
      tree[guard] ??= {};
      tree[guard][slug] ??= {
        id: cat._id,
        title: cat.title,
        slug,
        order: cat.order ?? 0,
        permissions: [],
      };
      tree[guard][slug].permissions.push({ id: p._id, name: p.name });
    }
    return res.status(200).json({ success: true, data: tree });
  } catch (error: any) {
    return res.status(500).json({ success: false, message: error.message });
  }
};
