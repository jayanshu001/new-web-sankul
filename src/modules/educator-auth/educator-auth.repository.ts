import { prisma } from "../../config/prisma";
import type { Prisma } from "@prisma/client";

const ADMIN_SORT_COLUMN: Record<string, keyof Prisma.CourseEducatorOrderByWithRelationInput> = {
  createdAt: "createdAt",
  updatedAt: "updatedAt",
  name: "name",
  email: "email",
};

/** Shared WHERE builder for the admin educator list + count. */
const buildAdminWhere = (opts: {
  search?: string;
  status?: boolean;
}): Prisma.CourseEducatorWhereInput => {
  // Soft-deleted educators are never listed (Mongo parity). The row is retained
  // so course/live-course/package/session `educator_id` references still resolve
  // the educator name; `deleted=1` just hides it from the admin list.
  const where: Prisma.CourseEducatorWhereInput = { deleted: false };
  if (opts.search) {
    const q = opts.search.trim();
    where.OR = [{ name: { contains: q } }, { email: { contains: q } }];
  }
  if (opts.status !== undefined) where.status = opts.status;
  return where;
};

/**
 * Prisma persistence for the educator-auth MySQL branch.
 * Educator entity: `ws_course_educator`; tokens: `ws_educator_access_tokens`.
 */
export const educatorAuthRepository = {
  /** Active educator by email (login lookup). */
  findActiveByEmail: (email: string) =>
    prisma.courseEducator.findFirst({
      where: { email: email.toLowerCase().trim(), status: true },
    }),

  /** Active educator by id (refresh). */
  findActiveById: (id: number) =>
    prisma.courseEducator.findFirst({ where: { id, status: true } }),

  /** Educator by id regardless of status (profile / change-password). */
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

  // ─── Tokens (ws_educator_access_tokens) ──────────────────────────────────
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

  // ─── Admin master CRUD (ws_course_educator) ──────────────────────────────
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
      // Secondary sort by id: many legacy rows share NULL created_at/updated_at,
      // so without a tie-breaker their order is arbitrary and pagination can
      // drift (a row appearing on two pages). id is unique → stable order.
      orderBy: [
        { [ADMIN_SORT_COLUMN[opts.sortBy] ?? "createdAt"]: opts.sortDir },
        { id: opts.sortDir },
      ],
      skip: opts.skip,
      take: opts.take,
    }),

  countAdmin: (opts: { search?: string; status?: boolean }) =>
    prisma.courseEducator.count({ where: buildAdminWhere(opts) }),

  // Exclude soft-deleted rows so a deleted educator's email frees up for reuse
  // (matches the Mongo partial unique index behavior).
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
   * Soft delete: set deleted=1 + status=false and revoke tokens, retaining the
   * row so course/live-course/package/session educator references still resolve
   * the name (hard delete would violate the ws_course.educator_id FK). The list
   * filters deleted=0, so the educator disappears from the admin list.
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
