// src/admin/permission/permission.service.ts
//
// Permission catalog domain logic. Reads/writes go through the admin-rbac
// SQL module (ws_permissions); category is derived from the permission name.

import { sortFieldMap } from "./permission.validation";
import { HttpError } from "../../middlewares/errorHandler";
import * as rbac from "../../modules/admin-rbac/admin-rbac.service";

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
  const { guard, search, category_id, page, per_page } = input;

  // ws_permissions; category is the FK (category_id filter) — the derived-from-name
  // `category` field on each row is separate. The controller builds the pagination
  // envelope from { items, total }.
  const { items, total } = await rbac.listPermissions({ guard, search, category_id, page, per_page });
  return { items, total };
};

export const getPermission = async (id: string, guard?: string) => {
  const numId = rbac.parseRbacId(id);
  if (!numId) throw new HttpError(400, "Invalid permission id");
  const data = await rbac.getRolesForPermission(numId);
  if (!data) throw new HttpError(404, "Permission not found");
  const perm = await rbac.getPermission(numId);
  if (guard && perm && perm.guard_name !== guard) throw new HttpError(404, "Permission not found");
  return { ...perm, roles: data.roles };
};

export const getPermissionsTree = async () => {
  return rbac.getPermissionsTree();
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
  const { name, guard } = input;

  // No category table; category derived from name.
  if (await rbac.permissionNameExists(name, guard)) {
    throw new HttpError(409, `Permission '${name}' already exists for guard '${guard}'`);
  }
  return rbac.createPermission(name, guard);
};

export interface UpdatePermissionInput {
  name?: string;
  guard?: string;
  category_id?: string;
}

export const updatePermission = async (id: string, input: UpdatePermissionInput) => {
  const numId = rbac.parseRbacId(id);
  if (!numId) throw new HttpError(400, "Invalid permission id");
  const existing = await rbac.getPermission(numId);
  if (!existing) throw new HttpError(404, "Permission not found");
  const nextName = input.name ?? existing.name;
  const nextGuard = input.guard ?? existing.guard_name;
  if ((nextName !== existing.name || nextGuard !== existing.guard_name) && (await rbac.permissionNameExists(nextName, nextGuard))) {
    throw new HttpError(409, `Permission '${nextName}' already exists for guard '${nextGuard}'`);
  }
  // category_id ignored on SQL (no category table; derived from name).
  return rbac.updatePermission(numId, { name: nextName, guard: nextGuard });
};

export const deletePermission = async (id: string, guard?: string) => {
  const numId = rbac.parseRbacId(id);
  if (!numId) throw new HttpError(400, "Invalid permission id");
  const perm = await rbac.getPermission(numId);
  if (!perm || (guard && perm.guard_name !== guard)) throw new HttpError(404, "Permission not found");
  const inUse = await rbac.getRolesForPermission(numId);
  if (inUse && inUse.roles.length) {
    throw new HttpError(409, "Permission is assigned to one or more roles or users and cannot be deleted");
  }
  await rbac.deletePermission(numId);
  return;
};

// ──────────────────────────────────────────────────────────────────────────────
// Roles for permission
// ──────────────────────────────────────────────────────────────────────────────

export const getRolesForPermission = async (id: string, guard?: string) => {
  const numId = rbac.parseRbacId(id);
  if (!numId) throw new HttpError(400, "Invalid permission id");
  const data = await rbac.getRolesForPermission(numId);
  if (!data) throw new HttpError(404, "Permission not found");
  const roles = guard ? data.roles.filter((r) => r.guard_name === guard) : data.roles;
  return { roles };
};
