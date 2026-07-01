import { adminRbacRepository as repo } from "./admin-rbac.repository";

export const RBAC_MODULE = "admin-rbac";
export const isRbacMysql = (): boolean => true;

export const parseRbacId = (id: string): bigint | null => {
  try {
    const n = BigInt(id);
    return n > BigInt(0) ? n : null;
  } catch {
    return null;
  }
};

/** spatie permission names encode category as the prefix before the first dot. */
export const permissionCategory = (name: string): string => {
  const i = name.indexOf(".");
  return i === -1 ? name : name.slice(0, i);
};

const toPermissionDto = (p: { id: bigint; name: string; guardName: string }) => ({
  id: String(p.id),
  name: p.name,
  guard_name: p.guardName,
});

const toRoleDetail = (r: any, permissions: { id: bigint; name: string; guardName: string }[]) => ({
  id: String(r.id),
  name: r.name,
  guard_name: r.guardName,
  permissions: permissions.map(toPermissionDto),
  created_at: r.createdAt ?? null,
  updated_at: r.updatedAt ?? null,
});

// ─── Roles ────────────────────────────────────────────────────────────────────
export const listRoles = async (opts: {
  guard?: string; search?: string; page: number; per_page: number; sort_by: string; sort_dir: string;
}) => {
  const sortDir = opts.sort_dir === "asc" ? "asc" : "desc";
  const [rows, total] = await Promise.all([
    repo.listRoles({ guard: opts.guard, search: opts.search, sortBy: opts.sort_by, sortDir, skip: (opts.page - 1) * opts.per_page, take: opts.per_page }),
    repo.countRoles({ guard: opts.guard, search: opts.search }),
  ]);
  const counts = rows.length ? await repo.permissionCountsByRole(rows.map((r) => r.id)) : [];
  const countMap = new Map(counts.map((c: any) => [String(c.roleId), c._count.permissionId]));
  const items = rows.map((r) => ({
    id: String(r.id),
    name: r.name,
    guard_name: r.guardName,
    permission_count: countMap.get(String(r.id)) ?? 0,
    created_at: r.createdAt ?? null,
    updated_at: r.updatedAt ?? null,
  }));
  return { items, total };
};

export const getRole = async (id: bigint, guard?: string) => {
  const role = await repo.findRole(id);
  if (!role || (guard && role.guardName !== guard)) return null;
  const perms = await repo.permissionsForRole(id);
  return toRoleDetail(role, perms);
};

export const roleNameExists = (name: string, guard: string) =>
  repo.findRoleByNameGuard(name, guard).then(Boolean);

/** Validate permission ids exist + belong to guard. Returns bigint[] or null. */
export const validatePermissionIds = async (ids: string[], guard: string): Promise<bigint[] | null> => {
  if (!ids.length) return [];
  const unique = Array.from(new Set(ids));
  const parsed = unique.map(parseRbacId);
  if (parsed.some((p) => p === null)) return null;
  const bigs = parsed as bigint[];
  const found = await repo.findPermissionsByIdsGuard(bigs, guard);
  if (found.length !== bigs.length) return null;
  return found.map((f) => f.id);
};

export const createRole = async (name: string, guard: string, permissionIds: bigint[]) => {
  const role = await repo.createRole(name, guard);
  if (permissionIds.length) await repo.setRolePermissions(role.id, permissionIds);
  const perms = await repo.permissionsForRole(role.id);
  return toRoleDetail(role, perms);
};

export const updateRole = async (
  id: bigint,
  data: { name?: string; guard?: string; permissionIds?: bigint[] }
) => {
  await repo.updateRole(id, { ...(data.name !== undefined ? { name: data.name } : {}), ...(data.guard !== undefined ? { guardName: data.guard } : {}) });
  if (data.permissionIds !== undefined) await repo.setRolePermissions(id, data.permissionIds);
  const role = await repo.findRole(id);
  const perms = await repo.permissionsForRole(id);
  return toRoleDetail(role, perms);
};

export const roleInUse = (id: bigint) => repo.roleInUse(id);
export const deleteRole = (id: bigint) => repo.deleteRole(id);

export const getRolePermissions = async (id: bigint, guard?: string) => {
  const role = await repo.findRole(id);
  if (!role || (guard && role.guardName !== guard)) return null;
  const assigned = await repo.permissionsForRole(id);
  const assignedIds = new Set(assigned.map((p) => String(p.id)));
  const all = await repo.listPermissions({ guard: role.guardName });
  const unassigned = all.filter((p) => !assignedIds.has(String(p.id)));
  return {
    role: toRoleDetail(role, assigned),
    assigned: assigned.map(toPermissionDto),
    unassigned: unassigned.map(toPermissionDto),
  };
};

export const syncRolePermissions = async (id: bigint, permissionIds: bigint[]) => {
  await repo.setRolePermissions(id, permissionIds);
  const role = await repo.findRole(id);
  const perms = await repo.permissionsForRole(id);
  return toRoleDetail(role, perms);
};

// ─── Permissions ────────────────────────────────────────────────────────────
export const listPermissions = async (opts: { guard?: string; search?: string; page?: number; per_page?: number }) => {
  if (opts.page && opts.per_page) {
    const [rows, total] = await Promise.all([
      repo.listPermissions({ guard: opts.guard, search: opts.search, skip: (opts.page - 1) * opts.per_page, take: opts.per_page }),
      repo.countPermissions({ guard: opts.guard, search: opts.search }),
    ]);
    return { items: rows.map((p) => ({ ...toPermissionDto(p), category: permissionCategory(p.name) })), total };
  }
  const rows = await repo.listPermissions({ guard: opts.guard, search: opts.search });
  return { items: rows.map((p) => ({ ...toPermissionDto(p), category: permissionCategory(p.name) })), total: rows.length };
};

export const getPermission = async (id: bigint) => {
  const p = await repo.findPermission(id);
  return p ? { ...toPermissionDto(p), category: permissionCategory(p.name) } : null;
};

export const permissionNameExists = (name: string, guard: string) =>
  repo.findPermissionByNameGuard(name, guard).then(Boolean);

export const createPermission = async (name: string, guard: string) => {
  const p = await repo.createPermission(name, guard);
  return { ...toPermissionDto(p), category: permissionCategory(p.name) };
};

export const updatePermission = async (id: bigint, data: { name?: string; guard?: string }) => {
  const p = await repo.updatePermission(id, { ...(data.name !== undefined ? { name: data.name } : {}), ...(data.guard !== undefined ? { guardName: data.guard } : {}) });
  return { ...toPermissionDto(p), category: permissionCategory(p.name) };
};

export const deletePermission = async (id: bigint) => {
  await repo.removePermissionFromAllRoles(id);
  await repo.deletePermission(id);
};

export const getRolesForPermission = async (id: bigint) => {
  const p = await repo.findPermission(id);
  if (!p) return null;
  const links = await repo.roleIdsForPermission(id);
  if (!links.length) return { permission: toPermissionDto(p), roles: [] };
  const roleIds = links.map((l) => l.roleId);
  const roles = await Promise.all(roleIds.map((rid) => repo.findRole(rid)));
  return {
    permission: toPermissionDto(p),
    roles: roles.filter(Boolean).map((r: any) => ({ id: String(r.id), name: r.name, guard_name: r.guardName })),
  };
};

/** Permission tree grouped by derived category (prefix before first dot). */
export const getPermissionsTree = async (guard?: string) => {
  const rows = await repo.listPermissions({ guard });
  const tree = new Map<string, ReturnType<typeof toPermissionDto>[]>();
  for (const p of rows) {
    const cat = permissionCategory(p.name);
    if (!tree.has(cat)) tree.set(cat, []);
    tree.get(cat)!.push(toPermissionDto(p));
  }
  return Array.from(tree.entries()).map(([category, permissions]) => ({ category, permissions }));
};

export { toPermissionDto, toRoleDetail };
