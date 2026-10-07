// Educator auth: Prisma queries for educator login, tokens and the admin educator master.
import { prisma } from "../../config/prisma";
import type { Prisma } from "@prisma/client";
import { buildPrismaPrefixSearch } from "../../utils/searchFilter";

const ADMIN_SORT_COLUMN: Record<string, keyof Prisma.CourseEducatorOrderByWithRelationInput> = {
  createdAt: "createdAt",
  updatedAt: "updatedAt",
  name: "name",
  email: "email",
};

const buildAdminWhere = (opts: {
  search?: string;
  status?: boolean;
}): Prisma.CourseEducatorWhereInput => {
  // Soft-deleted rows are retained so `educator_id` references still resolve the
  // name; `deleted=1` only hides them from the admin list.
  const where: Prisma.CourseEducatorWhereInput = { deleted: false };
  const search = buildPrismaPrefixSearch(opts.search, ["name", "email"]);
  if (search) where.AND = search.AND;
  if (opts.status !== undefined) where.status = opts.status;
  return where;
};

export const educatorAuthRepository = {
  findActiveByEmail: (email: string) =>
    prisma.courseEducator.findFirst({
      where: { email: email.toLowerCase().trim(), status: true },
    }),

  findActiveById: (id: number) =>
    prisma.courseEducator.findFirst({ where: { id, status: true } }),

  /** Regardless of status (profile / change-password). */
  findById: (id: number) =>
    prisma.courseEducator.findUnique({ where: { id } }),

  updatePassword: (id: number, hashed: string) =>
    prisma.courseEducator.update({
      where: { id },
      data: { password: hashed, updatedAt: new Date() },
    }),

  updateProfile: (
    id: number,
    data: { name?: string; about?: string; image?: string }
  ) =>
    prisma.courseEducator.update({
      where: { id },
      data: {
        ...(data.name !== undefined ? { name: data.name } : {}),
        ...(data.about !== undefined ? { about: data.about } : {}),
        ...(data.image !== undefined ? { image: data.image } : {}),
        updatedAt: new Date(),
      },
    }),

  createToken: (input: {
    educatorId: number;
    token: string;
    refreshToken: string;
    expiresAt: Date;
  }) =>
    prisma.educatorAccessToken.create({
      data: {
        educatorId: input.educatorId,
        token: input.token,
        refreshToken: input.refreshToken,
        active: true,
        deleted: false,
        created_at: new Date(),
        expires_at: input.expiresAt,
      },
    }),

  findActiveTokenByRefresh: (refreshToken: string, educatorId: number) =>
    prisma.educatorAccessToken.findFirst({
      where: { refreshToken, educatorId, active: true, deleted: false },
    }),

  deactivateToken: (id: number) =>
    prisma.educatorAccessToken.update({
      where: { id },
      data: { active: false, deleted: true },
    }),

  deactivateAllTokens: (educatorId: number) =>
    prisma.educatorAccessToken.updateMany({
      where: { educatorId },
      data: { active: false, deleted: true },
    }),

  listAdmin: (opts: {
    search?: string;
    status?: boolean;
    sortBy: string;
    sortDir: "asc" | "desc";
    skip: number;
    take: number;
  }) =>
    prisma.courseEducator.findMany({
      where: buildAdminWhere(opts),
      // id tie-breaker: many legacy rows have NULL timestamps, which would make
      // pagination unstable.
      orderBy: [
        { [ADMIN_SORT_COLUMN[opts.sortBy] ?? "createdAt"]: opts.sortDir },
        { id: opts.sortDir },
      ],
      skip: opts.skip,
      take: opts.take,
    }),

  countAdmin: (opts: { search?: string; status?: boolean }) =>
    prisma.courseEducator.count({ where: buildAdminWhere(opts) }),

  // Exclude soft-deleted rows so a deleted educator's email can be reused.
  emailInUse: (email: string, exceptId?: number) =>
    prisma.courseEducator.findFirst({
      where: {
        email: email.toLowerCase().trim(),
        deleted: false,
        ...(exceptId ? { id: { not: exceptId } } : {}),
      },
      select: { id: true },
    }),

  createAdmin: (data: {
    name: string;
    email: string;
    password: string;
    image?: string | null;
    about?: string;
    status: boolean;
  }) =>
    prisma.courseEducator.create({
      data: {
        name: data.name,
        email: data.email.toLowerCase().trim(),
        password: data.password,
        image: data.image ?? null,
        about: data.about ?? "",
        view: 0,
        status: data.status,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    }),

  updateAdmin: (
    id: number,
    data: {
      name?: string;
      email?: string;
      password?: string;
      image?: string | null;
      about?: string;
      status?: boolean;
    }
  ) =>
    prisma.courseEducator.update({
      where: { id },
      data: {
        ...(data.name !== undefined ? { name: data.name } : {}),
        ...(data.email !== undefined ? { email: data.email.toLowerCase().trim() } : {}),
        ...(data.password !== undefined ? { password: data.password } : {}),
        ...(data.image !== undefined ? { image: data.image } : {}),
        ...(data.about !== undefined ? { about: data.about } : {}),
        ...(data.status !== undefined ? { status: data.status } : {}),
        updatedAt: new Date(),
      },
    }),

  /**
   * Soft delete + token revoke. The row is retained so educator references still
   * resolve the name; a hard delete would violate the ws_course.educator_id FK.
   */
  disableAdmin: async (id: number) => {
    await prisma.educatorAccessToken.updateMany({
      where: { educatorId: id },
      data: { active: false, deleted: true },
    });
    return prisma.courseEducator.update({
      where: { id },
      data: { deleted: true, status: false, updatedAt: new Date() },
    });
  },
};
