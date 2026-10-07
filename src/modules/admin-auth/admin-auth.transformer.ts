// Admin auth: admin user row to DTO mapping with derived role and permission keys.
import type {
  AdminUser,
  AdminRoleRow,
  AdminPermissionRow,
} from "@prisma/client";
import { AdminRole } from "../../shared/enums";

/**
 * Wildcard permission key for super-admins; the panel treats `permissions.includes("*")`
 * as all access. The API itself enforces roles, not permission keys.
 */
export const SUPER_ADMIN_PERMISSION_WILDCARD = "*";

/**
 * Login / refresh / profile-update DTO. `roles` and `permissions` are flat string
 * arrays; `permissions` is the effective, de-duplicated set of dotted catalog keys
 * (role grants + direct grants), e.g. ["books.edit"]. Super-admins get ["*"].
 */
export interface AdminDto {
  id: string;
  firstName: string;
  lastName: string;
  email: string;
  role: string;
  roles: string[];
  permissions: string[];
  /** Explicit "allow all" flag for the panel; equivalent to permissions ["*"] / super_admin. */
  isSuperAdmin: boolean;
  image: string;
  isDark: boolean;
}

/**
 * Derive the single `role` string from spatie role names: the highest-privilege
 * matching name, falling back to "admin".
 */
export const deriveRole = (roleNames: string[]): string => {
  const lower = roleNames.map((n) => n.toLowerCase());
  if (lower.some((n) => n.includes("super"))) return AdminRole.SUPER_ADMIN;
  if (lower.some((n) => n.includes("editor"))) return AdminRole.EDITOR;
  return AdminRole.ADMIN;
};

export interface AdminListDto {
  _id: string;
  firstName: string;
  lastName: string | null;
  email: string;
  role: string;
  roles: Array<{ _id: string; name: string; guardName: string }>;
  permissions: Array<{ _id: string; name: string }>;
  image: string;
  status: boolean;
  isDark: boolean;
  emailVerifiedAt: Date | null;
  lastLoginDate: Date | null;
  lastLoginIp: string | null;
  lastSeenAt: Date | null;
  createdAt: Date | null;
  updatedAt: Date | null;
}

export const toAdminListDto = (
  row: AdminUser,
  roles: AdminRoleRow[],
  permissions: AdminPermissionRow[]
): AdminListDto => ({
  _id: String(row.id),
  firstName: row.firstName,
  lastName: row.lastName ?? null,
  email: row.email,
  role: deriveRole(roles.map((r) => r.name)),
  roles: roles.map((r) => ({
    _id: String(r.id),
    name: r.name,
    guardName: r.guardName,
  })),
  permissions: permissions.map((p) => ({ _id: String(p.id), name: p.name })),
  image: row.image ?? "",
  status: row.status === "active",
  isDark: row.isDark === "dark",
  emailVerifiedAt: row.emailVerifiedAt ?? null,
  lastLoginDate: row.lastLoginDate ?? null,
  lastLoginIp: row.lastLoginIp ?? null,
  lastSeenAt: row.lastSeenAt ?? null,
  createdAt: row.createdAt ?? null,
  updatedAt: row.updatedAt ?? null,
});

export const toAdminDto = (
  row: AdminUser,
  roles: AdminRoleRow[],
  permissions: AdminPermissionRow[]
): AdminDto => {
  const roleNames = roles.map((r) => r.name);
  const role = deriveRole(roleNames);
  const isSuperAdmin = role === AdminRole.SUPER_ADMIN;
  // Super-admins get the wildcard; everyone else gets sorted, de-duplicated keys for
  // a stable payload.
  const permissionKeys = isSuperAdmin
    ? [SUPER_ADMIN_PERMISSION_WILDCARD]
    : Array.from(new Set(permissions.map((p) => p.name))).sort();
  return {
    id: String(row.id),
    firstName: row.firstName,
    lastName: row.lastName ?? "",
    email: row.email,
    role,
    roles: roleNames,
    permissions: permissionKeys,
    isSuperAdmin,
    image: row.image ?? "",
    isDark: row.isDark === "dark",
  };
};
