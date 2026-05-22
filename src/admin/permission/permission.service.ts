// src/admin/permission/permission.service.ts
//
// Permission catalog reads are the hottest in the admin API — every role/user
// edit screen pulls the full tree, and the admin React app polls list/tree on
// page change. We cache the catalog with a 30-minute TTL and bust on any
// write (create/update/delete).

import mongoose from "mongoose";
import { Permission } from "../../models/admin/Permission.model";
import { PermissionCategory } from "../../models/admin/PermissionCategory.model";
import { Role } from "../../models/admin/Role.model";
import { AdminUser } from "../../models/admin/AdminUser.model";
import { sortFieldMap } from "./permission.validation";
import { HttpError } from "../../middlewares/errorHandler";
import cache from "../../libs/cache";

const assertObjectId = (id: string, label: string): void => {
  if (!mongoose.Types.ObjectId.isValid(id)) {
    throw new HttpError(400, `Invalid ${label} id`);
  }
};

const toItem = (p: any, roleCount?: number) => {
  const cat =
    p.categoryId && typeof p.categoryId === "object" && p.categoryId._id
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

const listKey = (filter: any, page: number, perPage: number, sort: any) =>
  cache.key("permission", "catalog", `list:${cache.hashFilter({ filter, page, perPage, sort })}`);
const detailKey = (id: string) => cache.key("permission", "catalog", `detail:${id}`);
const treeKey = () => cache.key("permission", "catalog", "tree");

const invalidatePermissionCaches = async (permissionId?: string) => {
  const keys: string[] = [treeKey()];
  if (permissionId) keys.push(detailKey(permissionId));
  await Promise.all([
    cache.invalidate(...keys),
    cache.invalidateByPrefix(cache.key("permission", "catalog", "list:")),
  ]);
};

// ──────────────────────────────────────────────────────────────────────────────
// List + detail + tree
// ──────────────────────────────────────────────────────────────────────────────

export interface ListPermissionsInput {
  guard?: string;
  category_id?: string;
  search?: string;
  page: number;
  per_page: number;
  sort_by: keyof typeof sortFieldMap;
  sort_dir: "asc" | "desc";
}

export const listPermissions = async (input: ListPermissionsInput) => {
  const { guard, category_id, search, page, per_page, sort_by, sort_dir } = input;

  const filter: any = {};
  if (guard) filter.guardName = guard;
  if (category_id) filter.categoryId = category_id;
  if (search) filter.name = { $regex: search, $options: "i" };

  const sort: any = { [sortFieldMap[sort_by]]: sort_dir === "asc" ? 1 : -1 };
  const skip = (page - 1) * per_page;

  return cache.aside({
    key: listKey(filter, page, per_page, sort),
    ttlSeconds: 1800, // 30 minutes — catalog changes are rare
    load: async () => {
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

      return {
        items: items.map((p) => toItem(p, countMap.get(String(p._id)) || 0)),
        pagination: { page, per_page, total },
      };
    },
  });
};

export const getPermission = async (id: string, guard?: string) => {
  assertObjectId(id, "permission");
  const filter: any = { _id: id };
  if (guard) filter.guardName = guard;

  const perm = await Permission.findOne(filter)
    .populate("categoryId", "_id title slug")
    .lean();
  if (!perm) throw new HttpError(404, "Permission not found");

  const roles = await Role.find({ permissions: perm._id })
    .select("_id name guardName")
    .lean();

  return {
    ...toItem(perm),
    roles: roles.map((r: any) => ({ id: r._id, name: r.name, guard_name: r.guardName })),
  };
};

export const getPermissionsTree = async () => {
  return cache.aside({
    key: treeKey(),
    ttlSeconds: 1800,
    load: async () => {
      const all = await Permission.find()
        .select("_id name guardName categoryId")
        .populate("categoryId", "_id title slug order")
        .sort({ name: 1 })
        .lean();

      const tree: Record<
        string,
        Record<
          string,
          {
            id: any;
            title: string;
            slug: string;
            order: number;
            permissions: { id: any; name: string }[];
          }
        >
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
      return tree;
    },
  });
};

// ──────────────────────────────────────────────────────────────────────────────
// Mutations
// ──────────────────────────────────────────────────────────────────────────────

export interface CreatePermissionInput {
  name: string;
  guard: string;
  category_id: string;
}

export const createPermission = async (input: CreatePermissionInput) => {
  const { name, guard, category_id } = input;

  const categoryExists = await PermissionCategory.exists({
    _id: category_id,
    status: true,
  });
  if (!categoryExists)
    throw new HttpError(400, "Invalid or inactive permission category");

  const exists = await Permission.exists({ name, guardName: guard });
  if (exists)
    throw new HttpError(409, `Permission '${name}' already exists for guard '${guard}'`);

  try {
    const created = await Permission.create({
      name,
      guardName: guard,
      categoryId: category_id,
    });
    const populated = await Permission.findById(created._id)
      .populate("categoryId", "_id title slug")
      .lean();
    await invalidatePermissionCaches();
    return toItem(populated);
  } catch (error: any) {
    if (error?.code === 11000) {
      throw new HttpError(409, "Permission already exists for this guard");
    }
    throw error;
  }
};

export interface UpdatePermissionInput {
  name?: string;
  guard?: string;
  category_id?: string;
}

export const updatePermission = async (id: string, input: UpdatePermissionInput) => {
  assertObjectId(id, "permission");

  const perm = await Permission.findById(id);
  if (!perm) throw new HttpError(404, "Permission not found");

  const nextName = input.name ?? perm.name;
  const nextGuard = input.guard ?? perm.guardName;

  if (nextName !== perm.name || nextGuard !== perm.guardName) {
    const dupe = await Permission.exists({
      _id: { $ne: id },
      name: nextName,
      guardName: nextGuard,
    });
    if (dupe) {
      throw new HttpError(
        409,
        `Permission '${nextName}' already exists for guard '${nextGuard}'`
      );
    }
  }

  perm.name = nextName;
  perm.guardName = nextGuard;

  if (input.category_id) {
    const categoryExists = await PermissionCategory.exists({
      _id: input.category_id,
      status: true,
    });
    if (!categoryExists)
      throw new HttpError(400, "Invalid or inactive permission category");
    perm.categoryId = input.category_id as any;
  }

  try {
    await perm.save();
  } catch (error: any) {
    if (error?.code === 11000) {
      throw new HttpError(409, "Permission already exists for this guard");
    }
    throw error;
  }
  const populated = await Permission.findById(perm._id)
    .populate("categoryId", "_id title slug")
    .lean();
  await invalidatePermissionCaches(id);
  return toItem(populated);
};

export const deletePermission = async (id: string, guard?: string) => {
  assertObjectId(id, "permission");

  const filter: any = { _id: id };
  if (guard) filter.guardName = guard;

  const perm = await Permission.findOne(filter);
  if (!perm) throw new HttpError(404, "Permission not found");

  const [roleInUse, userInUse] = await Promise.all([
    Role.exists({ permissions: perm._id }),
    AdminUser.exists({ permissions: perm._id }),
  ]);
  if (roleInUse || userInUse) {
    throw new HttpError(
      409,
      "Permission is assigned to one or more roles or users and cannot be deleted"
    );
  }

  await perm.deleteOne();
  await invalidatePermissionCaches(id);
};

// ──────────────────────────────────────────────────────────────────────────────
// Roles for permission
// ──────────────────────────────────────────────────────────────────────────────

export const getRolesForPermission = async (id: string, guard?: string) => {
  assertObjectId(id, "permission");
  const exists = await Permission.exists({ _id: id });
  if (!exists) throw new HttpError(404, "Permission not found");

  const filter: any = { permissions: id };
  if (guard) filter.guardName = guard;

  const roles = await Role.find(filter)
    .select("_id name guardName createdAt updatedAt")
    .lean();

  return {
    roles: roles.map((r: any) => ({
      id: r._id,
      name: r.name,
      guard_name: r.guardName,
      created_at: r.createdAt,
      updated_at: r.updatedAt,
    })),
  };
};
