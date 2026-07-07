import { prisma } from "../../config/prisma";
import type { Prisma } from "@prisma/client";

/**
 * Prisma persistence for the admin-rbac MySQL branch (spatie tables).
 * ws_roles / ws_permissions / ws_role_has_permissions (pivot). admin-auth
 * already READS ws_roles + ws_model_has_roles; this adds management writes.
 *
 * ⚠ No ws_permission_categories table in SQL — "category" is derived from the
 * permission name prefix (text before the first dot). The standalone
 * permissionCategory CRUD controller stays on Mongo.
 *
 * ids are bigint unsigned in MySQL; current values are small so we surface them
 * as Number in the service (consistent with commerce-educator's choice).
 */
export const adminRbacRepository = {
  // ─── Roles ────────────────────────────────────────────────────────────────
  listRoles: (opts: { guard?: string; search?: string; sortBy: string; sortDir: "asc" | "desc"; skip: number; take: number }) => {
    const where: Prisma.AdminRoleRowWhereInput = {};
    if (opts.guard) where.guardName = opts.guard;
    if (opts.search) where.name = { contains: opts.search.trim() };
    const col = opts.sortBy === "name" ? "name" : opts.sortBy === "updated_at" ? "updatedAt" : opts.sortBy === "created_at" ? "createdAt" : "id";
    return prisma.adminRoleRow.findMany({ where, orderBy: { [col]: opts.sortDir }, skip: opts.skip, take: opts.take });
  },
  countRoles: (opts: { guard?: string; search?: string }) => {
    const where: Prisma.AdminRoleRowWhereInput = {};
    if (opts.guard) where.guardName = opts.guard;
    if (opts.search) where.name = { contains: opts.search.trim() };
    return prisma.adminRoleRow.count({ where });
  },
  findRole: (id: bigint) => prisma.adminRoleRow.findUnique({ where: { id } }),
  findRoleByNameGuard: (name: string, guard: string) =>
    prisma.adminRoleRow.findFirst({ where: { name, guardName: guard }, select: { id: true } }),
  createRole: (name: string, guard: string) =>
    prisma.adminRoleRow.create({ data: { name, guardName: guard, createdAt: new Date(), updatedAt: new Date() } }),
  updateRole: (id: bigint, data: { name?: string; guardName?: string }) =>
    prisma.adminRoleRow.update({ where: { id }, data: { ...data, updatedAt: new Date() } }),
  /** Delete a role + its pivot rows (no DB cascade in the legacy schema). */
  deleteRole: (id: bigint) =>
    prisma.$transaction([
      prisma.adminRoleHasPermission.deleteMany({ where: { roleId: id } }),
      prisma.adminModelHasRole.deleteMany({ where: { roleId: id } }),
      prisma.adminRoleRow.delete({ where: { id } }),
    ]),

  /** Is this role assigned to any model (admin user)? Blocks delete. */
  roleInUse: (roleId: bigint) =>
    prisma.adminModelHasRole.findFirst({ where: { roleId }, select: { roleId: true } }).then(Boolean),

  // ─── Permissions ──────────────────────────────────────────────────────────
  listPermissions: (opts: { guard?: string; search?: string; categoryId?: number; skip?: number; take?: number }) => {
    const where: Prisma.AdminPermissionRowWhereInput = {};
    if (opts.guard) where.guardName = opts.guard;
    if (opts.categoryId !== undefined) where.categoryId = opts.categoryId;
    if (opts.search) where.name = { contains: opts.search.trim() };
    return prisma.adminPermissionRow.findMany({
      where, orderBy: { name: "asc" },
      ...(opts.take !== undefined ? { skip: opts.skip ?? 0, take: opts.take } : {}),
    });
  },
  countPermissions: (opts: { guard?: string; search?: string; categoryId?: number }) => {
    const where: Prisma.AdminPermissionRowWhereInput = {};
    if (opts.guard) where.guardName = opts.guard;
    if (opts.categoryId !== undefined) where.categoryId = opts.categoryId;
    if (opts.search) where.name = { contains: opts.search.trim() };
    return prisma.adminPermissionRow.count({ where });
  },
  findPermission: (id: bigint) => prisma.adminPermissionRow.findUnique({ where: { id } }),
  findPermissionByNameGuard: (name: string, guard: string) =>
    prisma.adminPermissionRow.findFirst({ where: { name, guardName: guard }, select: { id: true } }),
  /** Validate that all ids exist and belong to the guard. Returns the found ids. */
  findPermissionsByIdsGuard: (ids: bigint[], guard: string) =>
    prisma.adminPermissionRow.findMany({ where: { id: { in: ids }, guardName: guard }, select: { id: true } }),
  findPermissionsByIds: (ids: bigint[]) =>
    prisma.adminPermissionRow.findMany({ where: { id: { in: ids } } }),
  createPermission: (name: string, guard: string) =>
    prisma.adminPermissionRow.create({ data: { name, guardName: guard, createdAt: new Date(), updatedAt: new Date() } }),
  updatePermission: (id: bigint, data: { name?: string; guardName?: string }) =>
    prisma.adminPermissionRow.update({ where: { id }, data: { ...data, updatedAt: new Date() } }),
  deletePermission: (id: bigint) => prisma.adminPermissionRow.delete({ where: { id } }),

  // ─── Pivot (ws_role_has_permissions) ───────────────────────────────────────
  /** Permission ids attached to a role. */
  permissionIdsForRole: (roleId: bigint) =>
    prisma.adminRoleHasPermission.findMany({ where: { roleId }, select: { permissionId: true } }),
  /** Full permission rows attached to a role. */
  permissionsForRole: async (roleId: bigint) => {
    const links = await prisma.adminRoleHasPermission.findMany({ where: { roleId } });
    if (!links.length) return [];
    return prisma.adminPermissionRow.findMany({ where: { id: { in: links.map((l) => l.permissionId) } }, orderBy: { name: "asc" } });
  },
  /** Role ids that have a given permission. */
  roleIdsForPermission: (permissionId: bigint) =>
    prisma.adminRoleHasPermission.findMany({ where: { permissionId }, select: { roleId: true } }),
  /** Replace a role's permissions (delete all + insert) in one transaction. */
  setRolePermissions: (roleId: bigint, permissionIds: bigint[]) =>
    prisma.$transaction([
      prisma.adminRoleHasPermission.deleteMany({ where: { roleId } }),
      ...(permissionIds.length
        ? [prisma.adminRoleHasPermission.createMany({ data: permissionIds.map((pid) => ({ roleId, permissionId: pid })) })]
        : []),
    ]),
  /** Count of permissions per role (for the list view's permission_count). */
  permissionCountsByRole: (roleIds: bigint[]) =>
    prisma.adminRoleHasPermission.groupBy({ by: ["roleId"], where: { roleId: { in: roleIds } }, _count: { permissionId: true } }),
  /**
   * Assigned permission rows for MANY roles at once → Map<roleId(string),
   * {id,name}[]>. Two queries regardless of N (links + permission rows), so the
   * roles LIST can embed each role's permissions without an N+1. `name` is the
   * catalog key (ws_permissions.name is seeded to catalog keys). Sorted by key.
   */
  permissionsForRoles: async (roleIds: bigint[]): Promise<Map<string, { id: string; name: string }[]>> => {
    const out = new Map<string, { id: string; name: string }[]>();
    if (!roleIds.length) return out;
    const links = await prisma.adminRoleHasPermission.findMany({ where: { roleId: { in: roleIds } } });
    if (!links.length) return out;
    const permIds = [...new Set(links.map((l) => l.permissionId))];
    const perms = await prisma.adminPermissionRow.findMany({
      where: { id: { in: permIds } },
      select: { id: true, name: true },
      orderBy: { name: "asc" },
    });
    const permById = new Map(perms.map((p) => [String(p.id), { id: String(p.id), name: p.name }]));
    for (const l of links) {
      const p = permById.get(String(l.permissionId));
      if (!p) continue;
      const key = String(l.roleId);
      const arr = out.get(key) ?? [];
      arr.push(p);
      out.set(key, arr);
    }
    // Keep each role's list stable (by catalog key).
    for (const arr of out.values()) arr.sort((a, b) => a.name.localeCompare(b.name));
    return out;
  },
  removePermissionFromAllRoles: (permissionId: bigint) =>
    prisma.adminRoleHasPermission.deleteMany({ where: { permissionId } }),
};
