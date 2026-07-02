import type {
  AdminUser,
  AdminRoleRow,
  AdminPermissionRow,
} from "@prisma/client";
import { AdminRole } from "../../shared/enums";

/**
 * Wildcard permission key returned for super-admins. The panel treats
 * `permissions.includes("*")` as "all access" (super-admin bypasses per-permission
 * gating; the API itself enforces roles, not permission keys).
 */
export const SUPER_ADMIN_PERMISSION_WILDCARD = "*";

/**
 * Shape returned to the admin client on login / refresh / profile-update.
 *
 * `roles` and `permissions` are FLAT STRING arrays for the role-based UI:
 *  - `roles`       — all assigned role names, e.g. ["editor"].
 *  - `permissions` — the EFFECTIVE, de-duplicated permission KEYS the user has
 *                    (merged from role grants + direct grants), e.g.
 *                    ["books.edit","courses.view"]. Super-admins get ["*"].
 * These are the same dotted keys used in the Permissions catalog, so the UI's
 * `permissions.includes("books.edit")` checks line up exactly.
 */
export interface AdminDto {
  id: string;
  firstName: string;
  lastName: string;
  email: string;
  role: string;
  roles: string[];
  permissions: string[];
  image: string;
  isDark: boolean;
}

/**
 * Derive the legacy single `role` string from spatie role names. The Mongo
 * model carries an explicit `role` enum (super_admin/admin/editor); SQL only
 * has role rows, so we map the highest-privilege matching role name, falling
 * back to "admin".
 */
const deriveRole = (roleNames: string[]): string => {
  const lower = roleNames.map((n) => n.toLowerCase());
  if (lower.some((n) => n.includes("super"))) return AdminRole.SUPER_ADMIN;
  if (lower.some((n) => n.includes("editor"))) return AdminRole.EDITOR;
  return AdminRole.ADMIN;
};

/**
 * Shape returned by the administrator CRUD/list endpoints. Mirrors the Mongo
 * `PUBLIC_FIELDS` projection (uses `_id`, carries status + timestamps).
 */
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
  // Super-admins short-circuit to the wildcard; everyone else gets their
  // effective keys flattened, de-duplicated, and sorted for a stable payload.
  const permissionKeys =
    role === AdminRole.SUPER_ADMIN
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
    image: row.image ?? "",
    isDark: row.isDark === "dark",
  };
};
