// Admin auth: Prisma queries for admin users, roles, permissions and access tokens.
import { prisma } from "../../config/prisma";
import type { Prisma } from "@prisma/client";
import { buildPrismaPrefixSearch } from "../../utils/searchFilter";

const buildAdminListWhere = (opts: {
  search?: string;
  status?: boolean;
  ids?: bigint[];
}): Prisma.AdminUserWhereInput => {
  const where: Prisma.AdminUserWhereInput = {};
  const search = buildPrismaPrefixSearch(opts.search, ["firstName", "lastName", "email"]);
  if (search) Object.assign(where, search);
  if (opts.status !== undefined) {
    where.status = opts.status ? "active" : "inactive";
  }
  if (opts.ids !== undefined) {
    where.id = { in: opts.ids };
  }
  return where;
};

/**
 * ws_users has no `role`/`deleted` column; roles and permissions come from the
 * spatie pivots (ws_model_has_roles / ws_model_has_permissions). Tokens live in
 * ws_admin_access_tokens.
 */
export const adminAuthRepository = {
  /** status enum '1' = active. */
  findActiveByEmail: (email: string) =>
    prisma.adminUser.findFirst({
      where: { email: email.toLowerCase().trim(), status: "active" },
    }),

  findActiveById: (id: bigint) =>
    prisma.adminUser.findFirst({ where: { id, status: "active" } }),

  findById: (id: bigint) =>
    prisma.adminUser.findUnique({ where: { id } }),

  touchLogin: (id: bigint, ip: string | undefined) =>
    prisma.adminUser.update({
      where: { id },
      data: { lastLoginDate: new Date(), ...(ip ? { lastLoginIp: ip } : {}) },
    }),

  updatePassword: (id: bigint, hashed: string) =>
    prisma.adminUser.update({
      where: { id },
      data: { password: hashed, updatedAt: new Date() },
    }),

  updateProfile: (
    id: bigint,
    data: { firstName?: string; lastName?: string; image?: string }
  ) =>
    prisma.adminUser.update({
      where: { id },
      data: {
        ...(data.firstName !== undefined ? { firstName: data.firstName } : {}),
        ...(data.lastName !== undefined ? { lastName: data.lastName } : {}),
        ...(data.image !== undefined ? { image: data.image } : {}),
        updatedAt: new Date(),
      },
    }),

  findRoles: async (adminId: bigint) => {
    const links = await prisma.adminModelHasRole.findMany({
      where: { modelId: adminId },
    });
    if (!links.length) return [];
    return prisma.adminRoleRow.findMany({
      where: { id: { in: links.map((l) => l.roleId) } },
    });
  },

  /** Batched role lookup ({ adminId → roles }) to avoid an N+1 across a page of messages. */
  findRolesForMany: async (adminIds: bigint[]): Promise<Map<string, { id: bigint; name: string }[]>> => {
    const out = new Map<string, { id: bigint; name: string }[]>();
    if (!adminIds.length) return out;
    const links = await prisma.adminModelHasRole.findMany({
      where: { modelId: { in: adminIds } },
    });
    if (!links.length) return out;
    const roleRows = await prisma.adminRoleRow.findMany({
      where: { id: { in: Array.from(new Set(links.map((l) => l.roleId))) } },
    });
    const roleById = new Map(roleRows.map((r) => [String(r.id), r]));
    for (const l of links) {
      const key = String(l.modelId);
      const role = roleById.get(String(l.roleId));
      if (!role) continue;
      const arr = out.get(key) ?? [];
      arr.push({ id: role.id, name: role.name });
      out.set(key, arr);
    }
    return out;
  },

  findDirectPermissions: async (adminId: bigint) => {
    const links = await prisma.adminModelHasPermission.findMany({
      where: { modelId: adminId },
    });
    if (!links.length) return [];
    return prisma.adminPermissionRow.findMany({
      where: { id: { in: links.map((l) => l.permissionId) } },
    });
  },

  findRolePermissions: async (roleIds: bigint[]) => {
    if (!roleIds.length) return [];
    const links = await prisma.adminRoleHasPermission.findMany({
      where: { roleId: { in: roleIds } },
    });
    if (!links.length) return [];
    const uniqueIds = Array.from(
      new Map(links.map((l) => [String(l.permissionId), l.permissionId])).values()
    );
    return prisma.adminPermissionRow.findMany({
      where: { id: { in: uniqueIds } },
    });
  },

  createToken: (input: {
    adminUserId: bigint;
    token: string;
    refreshToken: string;
    expiresAt: Date;
  }) =>
    prisma.adminAccessToken.create({
      data: {
        adminUserId: input.adminUserId,
        token: input.token,
        refreshToken: input.refreshToken,
        active: true,
        deleted: false,
        created_at: new Date(),
        expires_at: input.expiresAt,
      },
    }),

  findActiveTokenByRefresh: (refreshToken: string, adminUserId: bigint) =>
    prisma.adminAccessToken.findFirst({
      where: { refreshToken, adminUserId, active: true, deleted: false },
    }),

  /** `authenticate` rejects admin requests without a live token row. */
  findLiveTokenId: (adminUserId: bigint) =>
    prisma.adminAccessToken.findFirst({
      where: { adminUserId, active: true, deleted: false },
      select: { id: true },
    }),

  deactivateToken: (id: number) =>
    prisma.adminAccessToken.update({
      where: { id },
      data: { active: false, deleted: true },
    }),

  deactivateAllTokens: (adminUserId: bigint) =>
    prisma.adminAccessToken.updateMany({
      where: { adminUserId },
      data: { active: false, deleted: true },
    }),

  /** ws_users has no soft-delete column; "deleted" admins are status=inactive. */
  listAdmins: (opts: {
    search?: string;
    status?: boolean;
    ids?: bigint[];
    skip: number;
    take: number;
  }) =>
    prisma.adminUser.findMany({
      where: buildAdminListWhere(opts),
      orderBy: { createdAt: "desc" },
      skip: opts.skip,
      take: opts.take,
    }),

  countAdmins: (opts: { search?: string; status?: boolean; ids?: bigint[] }) =>
    prisma.adminUser.count({ where: buildAdminListWhere(opts) }),

  adminIdsWithRole: async (roleId: bigint) => {
    const links = await prisma.adminModelHasRole.findMany({ where: { roleId } });
    return links.map((l) => l.modelId);
  },

  findByEmail: (email: string) =>
    prisma.adminUser.findUnique({ where: { email: email.toLowerCase().trim() } }),

  createAdmin: (data: {
    firstName: string;
    lastName?: string | null;
    email: string;
    password: string;
    image: string;
    status: boolean;
    isDark: boolean;
  }) =>
    prisma.adminUser.create({
      data: {
        firstName: data.firstName,
        lastName: data.lastName ?? null,
        email: data.email.toLowerCase().trim(),
        password: data.password,
        image: data.image,
        status: data.status ? "active" : "inactive",
        isDark: data.isDark ? "dark" : "light",
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    }),

  updateAdmin: (
    id: bigint,
    data: {
      firstName?: string;
      lastName?: string | null;
      email?: string;
      password?: string;
      image?: string;
      status?: boolean;
      isDark?: boolean;
    }
  ) =>
    prisma.adminUser.update({
      where: { id },
      data: {
        ...(data.firstName !== undefined ? { firstName: data.firstName } : {}),
        ...(data.lastName !== undefined ? { lastName: data.lastName } : {}),
        ...(data.email !== undefined ? { email: data.email.toLowerCase().trim() } : {}),
        ...(data.password !== undefined ? { password: data.password } : {}),
        ...(data.image !== undefined ? { image: data.image } : {}),
        ...(data.status !== undefined ? { status: data.status ? "active" : "inactive" } : {}),
        ...(data.isDark !== undefined ? { isDark: data.isDark ? "dark" : "light" } : {}),
        updatedAt: new Date(),
      },
    }),

  setStatus: (id: bigint, status: boolean) =>
    prisma.adminUser.update({
      where: { id },
      data: { status: status ? "active" : "inactive", updatedAt: new Date() },
    }),

  /** Hard delete; access tokens and spatie pivots are cleared first to avoid orphans / FK errors. */
  deleteAdmin: (id: bigint, modelType: string) =>
    prisma.$transaction([
      prisma.adminAccessToken.deleteMany({ where: { adminUserId: id } }),
      prisma.adminModelHasRole.deleteMany({ where: { modelId: id, modelType } }),
      prisma.adminModelHasPermission.deleteMany({ where: { modelId: id, modelType } }),
      prisma.adminUser.delete({ where: { id } }),
    ]),

  setAdminRole: async (adminId: bigint, roleId: bigint, modelType: string) => {
    await prisma.adminModelHasRole.deleteMany({ where: { modelId: adminId, modelType } });
    await prisma.adminModelHasRole.create({
      data: { roleId, modelId: adminId, modelType },
    });
  },

  listRoles: () => prisma.adminRoleRow.findMany({ orderBy: { name: "asc" } }),

  roleExists: (roleId: bigint) =>
    prisma.adminRoleRow.findUnique({ where: { id: roleId } }),
};
