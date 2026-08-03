import { prisma } from "../../config/prisma";
import type { Prisma } from "@prisma/client";
import { buildPrismaSearch } from "../../utils/searchFilter";

/**
 * Prisma persistence for the admin-plan MySQL branch (ws_package_course_ebook_price).
 * One plan is owned by exactly ONE of course/package/ebook. ⚠ Unused owner ids
 * are stored as EITHER NULL or 0 (legacy mix) — treat NULL-or-0 as "not owned".
 * On write we set the chosen owner and 0 the other two (matches the dump's
 * dominant convention + keeps the single-default match simple).
 */
const OWNED = (v: number | null | undefined) => v != null && v > 0;

export const adminPlanRepository = {
  list: (opts: { entityType?: string; courseId?: number; packageId?: number; ebookId?: number; status?: boolean; isDefault?: boolean; withMaterial?: boolean; search?: string; sortBy?: string; sortDir?: "asc" | "desc"; skip: number; take: number }) => {
    const where = buildWhere(opts);
    return prisma.packageCourseEbookPrice.findMany({
      where,
      include: { Course: { select: { id: true, name: true } }, Package: { select: { id: true, name: true } }, EBook: { select: { id: true, name: true } } },
      orderBy: buildOrderBy(opts),
      skip: opts.skip,
      take: opts.take,
    });
  },
  count: (opts: { entityType?: string; courseId?: number; packageId?: number; ebookId?: number; status?: boolean; isDefault?: boolean; withMaterial?: boolean; search?: string }) =>
    prisma.packageCourseEbookPrice.count({ where: buildWhere(opts) }),

  findById: (id: number) =>
    prisma.packageCourseEbookPrice.findUnique({
      where: { id },
      include: { Course: { select: { id: true, name: true } }, Package: { select: { id: true, name: true } }, EBook: { select: { id: true, name: true } } },
    }),
  findBare: (id: number) => prisma.packageCourseEbookPrice.findUnique({ where: { id } }),

  promotedCount: (planId: number) => prisma.promotedPackageCourseEbook.count({ where: { planId } }),
  // Subscriptions reference the PLAN via `planId` (ws_package_course_subscription.pcb_id).
  // This used to filter on `packageId`, which compared a plan id against a package id and
  // so reported 0 for plans that really did have subscribers.
  subscriberCount: (planId: number) => prisma.packageCourseSubscription.count({ where: { planId } }),

  create: (data: Prisma.PackageCourseEbookPriceUncheckedCreateInput) =>
    prisma.packageCourseEbookPrice.create({ data }),
  update: (id: number, data: Prisma.PackageCourseEbookPriceUncheckedUpdateInput) =>
    prisma.packageCourseEbookPrice.update({ where: { id }, data }),
  delete: (id: number) => prisma.packageCourseEbookPrice.delete({ where: { id } }),
  deletePromotedForPlan: (planId: number) => prisma.promotedPackageCourseEbook.deleteMany({ where: { planId } }),
  deletePromotedForPlans: (planIds: number[]) => prisma.promotedPackageCourseEbook.deleteMany({ where: { planId: { in: planIds } } }),

  setStatus: (id: number, status: boolean) =>
    prisma.packageCourseEbookPrice.update({ where: { id }, data: { status, updated_at: new Date() } }),
  setStatusMany: (ids: number[], status: boolean) =>
    prisma.packageCourseEbookPrice.updateMany({ where: { id: { in: ids } }, data: { status, updated_at: new Date() } }),
  deleteMany: (ids: number[]) => prisma.packageCourseEbookPrice.deleteMany({ where: { id: { in: ids } } }),
  subscriberCountForPlans: (ids: number[]) => prisma.packageCourseSubscription.count({ where: { planId: { in: ids } } }),

  /** Flip all OTHER plans of the same owner to isDefault=false. owner = {key,id}. */
  clearSiblingDefaults: (key: "courseId" | "packageId" | "ebookId", ownerId: number, exceptId: number) =>
    prisma.packageCourseEbookPrice.updateMany({
      where: { [key]: ownerId, id: { not: exceptId } } as Prisma.PackageCourseEbookPriceWhereInput,
      data: { isDefault: false },
    }),
};

/**
 * Sort: query-driven when `sortBy` is one of the whitelisted columns (newest-id
 * tiebreaker for determinism); otherwise the legacy default
 * (default-plan first, then duration asc, then newest).
 */
function buildOrderBy(opts: { sortBy?: string; sortDir?: "asc" | "desc" }): Prisma.PackageCourseEbookPriceOrderByWithRelationInput[] {
  const dir: "asc" | "desc" = opts.sortDir === "asc" ? "asc" : "desc";
  switch (opts.sortBy) {
    case "name": return [{ name: dir }, { id: "desc" }];
    case "duration": return [{ duration: dir }, { id: "desc" }];
    case "price": return [{ price: dir }, { id: "desc" }];
    case "createdAt": return [{ created_at: dir }, { id: "desc" }];
    case "updatedAt": return [{ updated_at: dir }, { id: "desc" }];
    // Default: recently-added on top (newest id first).
    default: return [{ created_at: "desc" }, { id: "desc" }];
  }
}

function buildWhere(opts: { entityType?: string; courseId?: number; packageId?: number; ebookId?: number; status?: boolean; isDefault?: boolean; withMaterial?: boolean; search?: string }): Prisma.PackageCourseEbookPriceWhereInput {
  const where: Prisma.PackageCourseEbookPriceWhereInput = {};
  // entityType filter: "owned by" = id > 0 (NULL/0 = not owned).
  if (opts.entityType === "course") where.courseId = { gt: 0 };
  else if (opts.entityType === "package") where.packageId = { gt: 0 };
  else if (opts.entityType === "ebook") where.ebookId = { gt: 0 };
  if (opts.courseId !== undefined) where.courseId = opts.courseId;
  if (opts.packageId !== undefined) where.packageId = opts.packageId;
  if (opts.ebookId !== undefined) where.ebookId = opts.ebookId;
  if (opts.status !== undefined) where.status = opts.status;
  if (opts.isDefault !== undefined) where.isDefault = opts.isDefault;
  if (opts.withMaterial !== undefined) where.withMaterial = opts.withMaterial;
  const search = buildPrismaSearch(opts.search, ["name"]);
  if (search) Object.assign(where, search);
  return where;
}

export { OWNED };
