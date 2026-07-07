import { adminAuthRepository } from "./admin-auth.repository";
import {
  toAdminListDto,
  type AdminListDto,
} from "./admin-auth.transformer";
import { invalidateAdminPermissions } from "./admin-permission-resolver";

/**
 * SQL (ws_users) administrator CRUD service. Used by the administrator
 * controller when `admin-auth` is a MySQL module. Roles/permissions are
 * resolved from the spatie pivots; the legacy `role` enum has no SQL column,
 * so a spatie role id (numeric) is the only persistable role on this branch.
 *
 * `MODEL_TYPE` is the Laravel morph class stored in ws_model_has_roles. The
 * existing rows use this exact string.
 */
export const ADMIN_MODEL_TYPE = "App\\Models\\User";

export const parseAdminBigId = (id: string): bigint | null => {
  try {
    const n = BigInt(id);
    return n > BigInt(0) ? n : null;
  } catch {
    return null;
  }
};

/** Resolve roles + direct permissions and build the list/detail DTO. */
const buildListDto = async (
  row: NonNullable<Awaited<ReturnType<typeof adminAuthRepository.findById>>>
): Promise<AdminListDto> => {
  const [roles, permissions] = await Promise.all([
    adminAuthRepository.findRoles(row.id),
    adminAuthRepository.findDirectPermissions(row.id),
  ]);
  return toAdminListDto(row, roles, permissions);
};

export const listAdministrators = async (opts: {
  search?: string;
  status?: boolean;
  roleId?: string;
  page: number;
  limit: number;
}): Promise<{ items: AdminListDto[]; total: number }> => {
  // Role filter: resolve admin ids carrying that spatie role first.
  let ids: bigint[] | undefined;
  if (opts.roleId) {
    const roleBig = parseAdminBigId(opts.roleId);
    ids = roleBig ? await adminAuthRepository.adminIdsWithRole(roleBig) : [];
    // No admin has this role → short-circuit to an empty page.
    if (!ids.length) return { items: [], total: 0 };
  }

  const skip = (opts.page - 1) * opts.limit;
  const [rows, total] = await Promise.all([
    adminAuthRepository.listAdmins({
      search: opts.search,
      status: opts.status,
      ids,
      skip,
      take: opts.limit,
    }),
    adminAuthRepository.countAdmins({ search: opts.search, status: opts.status, ids }),
  ]);

  const items = await Promise.all(rows.map(buildListDto));
  return { items, total };
};

export const getAdministrator = async (id: bigint): Promise<AdminListDto | null> => {
  const row = await adminAuthRepository.findById(id);
  return row ? buildListDto(row) : null;
};

export const emailInUse = async (email: string, exceptId?: bigint): Promise<boolean> => {
  const existing = await adminAuthRepository.findByEmail(email);
  if (!existing) return false;
  return exceptId === undefined || existing.id !== exceptId;
};

export const createAdministrator = async (data: {
  firstName: string;
  lastName?: string | null;
  email: string;
  passwordHash: string;
  image: string;
  status: boolean;
  isDark: boolean;
  roleId?: bigint;
}): Promise<AdminListDto> => {
  const row = await adminAuthRepository.createAdmin({
    firstName: data.firstName,
    lastName: data.lastName ?? null,
    email: data.email,
    password: data.passwordHash,
    image: data.image,
    status: data.status,
    isDark: data.isDark,
  });

  if (data.roleId !== undefined) {
    await adminAuthRepository.setAdminRole(row.id, data.roleId, ADMIN_MODEL_TYPE);
  }

  return buildListDto(row);
};

export const updateAdministrator = async (
  id: bigint,
  data: {
    firstName?: string;
    lastName?: string | null;
    email?: string;
    passwordHash?: string;
    image?: string;
    status?: boolean;
    isDark?: boolean;
    roleId?: bigint;
  }
): Promise<AdminListDto> => {
  const row = await adminAuthRepository.updateAdmin(id, {
    firstName: data.firstName,
    lastName: data.lastName,
    email: data.email,
    password: data.passwordHash,
    image: data.image,
    status: data.status,
    isDark: data.isDark,
  });

  if (data.roleId !== undefined) {
    await adminAuthRepository.setAdminRole(id, data.roleId, ADMIN_MODEL_TYPE);
    // Role reassignment changes this admin's effective permissions — drop the
    // cached set so the next request (and /auth/me) reflects it immediately.
    await invalidateAdminPermissions(id);
  }

  return buildListDto(row);
};

/**
 * Hard delete the administrator. `ws_users` has no soft-delete column, so to
 * remove it from the list (Mongo parity, where delete sets `deleted: true`) the
 * row is physically deleted along with its tokens + spatie role/permission
 * pivots.
 */
export const deleteAdministrator = async (id: bigint): Promise<void> => {
  await adminAuthRepository.deleteAdmin(id, ADMIN_MODEL_TYPE);
  await invalidateAdminPermissions(id);
};

export const setAdministratorStatus = async (
  id: bigint,
  status: boolean
): Promise<void> => {
  await adminAuthRepository.setStatus(id, status);
  if (!status) await adminAuthRepository.deactivateAllTokens(id);
};

export const listAssignableRoles = async () => {
  const roles = await adminAuthRepository.listRoles();
  return roles.map((r) => ({ _id: String(r.id), name: r.name, guardName: r.guardName }));
};

export const roleExists = async (roleId: bigint): Promise<boolean> =>
  !!(await adminAuthRepository.roleExists(roleId));
