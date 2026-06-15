import { Request, Response } from "express";
import mongoose from "mongoose";
import { Role } from "../../models/admin/Role.model";
import { Permission } from "../../models/admin/Permission.model";
import { AdminUser } from "../../models/admin/AdminUser.model";
import { buildRegexCondition } from "../../utils/searchFilter";
import {
  createRoleSchema,
  updateRoleSchema,
  listQuerySchema,
  guardOnlyQuerySchema,
  syncPermissionsSchema,
  sortFieldMap,
} from "./role.validation";

const formatZodErrors = (issues: any[]) =>
  issues.reduce<Record<string, string>>((acc, i) => {
    acc[i.path.join(".")] = i.message;
    return acc;
  }, {});

const toRoleListItem = (r: any) => ({
  id: r._id,
  name: r.name,
  guard_name: r.guardName,
  permission_count: Array.isArray(r.permissions) ? r.permissions.length : 0,
  created_at: r.createdAt,
  updated_at: r.updatedAt,
});

const toRoleDetail = (r: any, permissions: any[]) => ({
  id: r._id,
  name: r.name,
  guard_name: r.guardName,
  permissions: permissions.map((p) => ({
    id: p._id,
    name: p.name,
    guard_name: p.guardName,
  })),
  created_at: r.createdAt,
  updated_at: r.updatedAt,
});

// Validate that all provided permission ids exist and match the role's guard
async function validatePermissions(
  permissionIds: string[],
  guard: string
): Promise<{ ok: true; ids: mongoose.Types.ObjectId[] } | { ok: false; message: string }> {
  if (permissionIds.length === 0) return { ok: true, ids: [] };
  const unique = Array.from(new Set(permissionIds));
  const found = await Permission.find({
    _id: { $in: unique },
    guardName: guard,
  })
    .select("_id")
    .lean();
  if (found.length !== unique.length) {
    return {
      ok: false,
      message: `One or more permission_ids are invalid or do not belong to guard '${guard}'`,
    };
  }
  return { ok: true, ids: found.map((p: any) => p._id) };
}

// Determine if a role is assigned to any user (admin/educator/promoter).
// Educator and Promoter user models do not currently store role refs, so only
// AdminUser is checked. Extend this if those models grow a `roles` field.
async function isRoleInUse(roleId: mongoose.Types.ObjectId | string, guard: string) {
  if (guard === "web") {
    return Boolean(await AdminUser.exists({ roles: roleId }));
  }
  return false;
}

// GET /api/v1/admin/roles
export const listRoles = async (req: Request, res: Response) => {
  try {
    const parsed = listQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      return res.status(422).json({
        success: false,
        message: "Validation failed",
        errors: formatZodErrors(parsed.error.issues),
      });
    }
    const { guard, search, page, per_page, sort_by, sort_dir } = parsed.data;

    const filter: any = {};
    if (guard) filter.guardName = guard;
    {
      const c = buildRegexCondition(search);
      if (c) filter.name = c;
    }

    const sort: any = { [sortFieldMap[sort_by]]: sort_dir === "asc" ? 1 : -1 };
    const skip = (page - 1) * per_page;

    const [items, total] = await Promise.all([
      Role.find(filter).sort(sort).skip(skip).limit(per_page).lean(),
      Role.countDocuments(filter),
    ]);

    return res.status(200).json({
      success: true,
      data: {
        items: items.map(toRoleListItem),
        pagination: { page, per_page, total },
      },
    });
  } catch (error: any) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

// GET /api/v1/admin/roles/:id
export const getRole = async (req: Request, res: Response) => {
  try {
    const id = req.params.id as string;
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ success: false, message: "Invalid role id" });
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

    const role = await Role.findOne(filter)
      .populate("permissions", "_id name guardName")
      .lean();
    if (!role) return res.status(404).json({ success: false, message: "Role not found" });

    return res.status(200).json({
      success: true,
      data: toRoleDetail(role, (role.permissions as any[]) || []),
    });
  } catch (error: any) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

// POST /api/v1/admin/roles
export const createRole = async (req: Request, res: Response) => {
  const session = await mongoose.startSession();
  try {
    const parsed = createRoleSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(422).json({
        success: false,
        message: "Validation failed",
        errors: formatZodErrors(parsed.error.issues),
      });
    }
    const { name, guard, permission_ids } = parsed.data;

    const dupe = await Role.exists({ name, guardName: guard });
    if (dupe) {
      return res.status(409).json({
        success: false,
        message: `Role '${name}' already exists for guard '${guard}'`,
      });
    }

    const valid = await validatePermissions(permission_ids, guard);
    if (!valid.ok) {
      return res.status(422).json({ success: false, message: valid.message });
    }

    let created: any;
    try {
      session.startTransaction();
      [created] = await Role.create(
        [{ name, guardName: guard, permissions: valid.ids }],
        { session }
      );
      await session.commitTransaction();
    } catch (txErr: any) {
      await session.abortTransaction().catch(() => {});
      // Standalone Mongo (no replica set) fallback: create without txn
      if (txErr?.codeName === "IllegalOperation" || /Transaction/.test(txErr?.message || "")) {
        created = await Role.create({ name, guardName: guard, permissions: valid.ids });
      } else {
        throw txErr;
      }
    }

    const populated = await Role.findById(created._id)
      .populate("permissions", "_id name guardName")
      .lean();

    return res.status(201).json({
      success: true,
      message: "Role created successfully",
      data: toRoleDetail(populated, (populated?.permissions as any[]) || []),
    });
  } catch (error: any) {
    if (error.code === 11000) {
      return res.status(409).json({ success: false, message: "Role already exists for this guard" });
    }
    return res.status(500).json({ success: false, message: error.message });
  } finally {
    session.endSession();
  }
};

// PUT /api/v1/admin/roles/:id
export const updateRole = async (req: Request, res: Response) => {
  const session = await mongoose.startSession();
  try {
    const id = req.params.id as string;
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ success: false, message: "Invalid role id" });
    }
    const parsed = updateRoleSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(422).json({
        success: false,
        message: "Validation failed",
        errors: formatZodErrors(parsed.error.issues),
      });
    }

    const role = await Role.findById(id);
    if (!role) return res.status(404).json({ success: false, message: "Role not found" });

    const nextName = parsed.data.name ?? role.name;
    const nextGuard = parsed.data.guard ?? role.guardName;

    if (nextName !== role.name || nextGuard !== role.guardName) {
      const dupe = await Role.exists({
        _id: { $ne: id },
        name: nextName,
        guardName: nextGuard,
      });
      if (dupe) {
        return res.status(409).json({
          success: false,
          message: `Role '${nextName}' already exists for guard '${nextGuard}'`,
        });
      }
    }

    let nextPermissionIds: mongoose.Types.ObjectId[] | undefined;
    if (parsed.data.permission_ids) {
      const valid = await validatePermissions(parsed.data.permission_ids, nextGuard);
      if (!valid.ok) {
        return res.status(422).json({ success: false, message: valid.message });
      }
      nextPermissionIds = valid.ids;
    } else if (parsed.data.guard && parsed.data.guard !== role.guardName) {
      // Guard changed but no new permission list provided: clear stale refs
      nextPermissionIds = [];
    }

    try {
      session.startTransaction();
      role.name = nextName;
      role.guardName = nextGuard;
      if (nextPermissionIds !== undefined) role.permissions = nextPermissionIds as any;
      await role.save({ session });
      await session.commitTransaction();
    } catch (txErr: any) {
      await session.abortTransaction().catch(() => {});
      if (txErr?.codeName === "IllegalOperation" || /Transaction/.test(txErr?.message || "")) {
        role.name = nextName;
        role.guardName = nextGuard;
        if (nextPermissionIds !== undefined) role.permissions = nextPermissionIds as any;
        await role.save();
      } else {
        throw txErr;
      }
    }

    const populated = await Role.findById(role._id)
      .populate("permissions", "_id name guardName")
      .lean();

    return res.status(200).json({
      success: true,
      message: "Role updated successfully",
      data: toRoleDetail(populated, (populated?.permissions as any[]) || []),
    });
  } catch (error: any) {
    if (error.code === 11000) {
      return res.status(409).json({ success: false, message: "Role already exists for this guard" });
    }
    return res.status(500).json({ success: false, message: error.message });
  } finally {
    session.endSession();
  }
};

// DELETE /api/v1/admin/roles/:id
export const deleteRole = async (req: Request, res: Response) => {
  try {
    const id = req.params.id as string;
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ success: false, message: "Invalid role id" });
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

    const role = await Role.findOne(filter);
    if (!role) return res.status(404).json({ success: false, message: "Role not found" });

    if (await isRoleInUse(role._id, role.guardName)) {
      return res.status(409).json({
        success: false,
        message: "Role is assigned to one or more users and cannot be deleted",
      });
    }

    await role.deleteOne();
    return res.status(200).json({ success: true, message: "Role deleted successfully", data: {} });
  } catch (error: any) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

// GET /api/v1/admin/roles/:id/permissions
export const getRolePermissions = async (req: Request, res: Response) => {
  try {
    const id = req.params.id as string;
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ success: false, message: "Invalid role id" });
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

    const role = await Role.findOne(filter)
      .populate("permissions", "_id name guardName")
      .lean();
    if (!role) return res.status(404).json({ success: false, message: "Role not found" });

    const assigned = (role.permissions as any[]) || [];
    const assignedIds = assigned.map((p) => p._id);
    const unassigned = await Permission.find({
      guardName: role.guardName,
      _id: { $nin: assignedIds },
    })
      .select("_id name guardName")
      .sort({ name: 1 })
      .lean();

    return res.status(200).json({
      success: true,
      data: {
        assigned: assigned.map((p) => ({ id: p._id, name: p.name, guard_name: p.guardName })),
        unassigned: unassigned.map((p) => ({ id: p._id, name: p.name, guard_name: p.guardName })),
      },
    });
  } catch (error: any) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

// PUT /api/v1/admin/roles/:id/permissions
export const syncRolePermissions = async (req: Request, res: Response) => {
  try {
    const id = req.params.id as string;
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ success: false, message: "Invalid role id" });
    }
    const parsed = syncPermissionsSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(422).json({
        success: false,
        message: "Validation failed",
        errors: formatZodErrors(parsed.error.issues),
      });
    }

    const role = await Role.findById(id);
    if (!role) return res.status(404).json({ success: false, message: "Role not found" });

    if (parsed.data.guard && parsed.data.guard !== role.guardName) {
      return res.status(422).json({
        success: false,
        message: `Provided guard '${parsed.data.guard}' does not match role guard '${role.guardName}'`,
      });
    }

    const valid = await validatePermissions(parsed.data.permission_ids, role.guardName);
    if (!valid.ok) {
      return res.status(422).json({ success: false, message: valid.message });
    }

    role.permissions = valid.ids as any;
    await role.save();

    const populated = await Role.findById(role._id)
      .populate("permissions", "_id name guardName")
      .lean();

    return res.status(200).json({
      success: true,
      message: "Role permissions synced successfully",
      data: toRoleDetail(populated, (populated?.permissions as any[]) || []),
    });
  } catch (error: any) {
    return res.status(500).json({ success: false, message: error.message });
  }
};
