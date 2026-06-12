import { prisma } from "../../config/prisma";

/**
 * Prisma persistence for the commerce · price MySQL branch
 * (`ws_package_course_ebook_price`, Phase 3a — read-only, flag OFF).
 *
 * Mirrors the Mongo access patterns observed across the client consumers:
 *  - single plan by id (payment/order/receipt flows)
 *  - plans for one or many owners (package/course/ebook), active-only,
 *    ordered by `duration` ascending (the package/dashboard plan listings)
 *  - plan ids only (`distinct("_id")` equivalents)
 *
 * All reads are read-only; writes belong to Phase 3b (`commerce-order`).
 */
export const commercePriceRepository = {
  /** Single plan by id (any status — callers filter as the Mongo path does). */
  findById: (id: number) =>
    prisma.packageCourseEbookPrice.findUnique({ where: { id } }),

  /** Single ACTIVE plan by id (mirrors `findOne({_id, status:true})`). */
  findActiveById: (id: number) =>
    prisma.packageCourseEbookPrice.findFirst({ where: { id, status: true } }),

  /** Plans by ids (mirrors `find({_id: {$in: [...]}})`). */
  findByIds: (ids: number[]) =>
    ids.length
      ? prisma.packageCourseEbookPrice.findMany({
          where: { id: { in: ids } },
          orderBy: [{ duration: "asc" }, { id: "asc" }],
        })
      : Promise.resolve([]),

  /** Active plans for a single package, ordered by duration asc. */
  listActiveByPackage: (packageId: number) =>
    prisma.packageCourseEbookPrice.findMany({
      where: { packageId, status: true },
      orderBy: [{ duration: "asc" }, { id: "asc" }],
    }),

  /** Active plans for a single course, ordered by duration asc. */
  listActiveByCourse: (courseId: number) =>
    prisma.packageCourseEbookPrice.findMany({
      where: { courseId, status: true },
      orderBy: [{ duration: "asc" }, { id: "asc" }],
    }),

  /** Active plans for a single ebook, ordered by duration asc. */
  listActiveByEbook: (ebookId: number) =>
    prisma.packageCourseEbookPrice.findMany({
      where: { ebookId, status: true },
      orderBy: [{ duration: "asc" }, { id: "asc" }],
    }),

  /** Active plans for many packages (mirrors `find({packageId:{$in}})`). */
  listActiveByPackages: (packageIds: number[]) =>
    packageIds.length
      ? prisma.packageCourseEbookPrice.findMany({
          where: { packageId: { in: packageIds }, status: true },
          orderBy: [{ duration: "asc" }, { id: "asc" }],
        })
      : Promise.resolve([]),

  /** Active plans for many courses. */
  listActiveByCourses: (courseIds: number[]) =>
    courseIds.length
      ? prisma.packageCourseEbookPrice.findMany({
          where: { courseId: { in: courseIds }, status: true },
          orderBy: [{ duration: "asc" }, { id: "asc" }],
        })
      : Promise.resolve([]),

  /** Active plans for many ebooks (mirrors `find({ebookId:{$in}})`). */
  listActiveByEbooks: (ebookIds: number[]) =>
    ebookIds.length
      ? prisma.packageCourseEbookPrice.findMany({
          where: { ebookId: { in: ebookIds }, status: true },
          orderBy: [{ duration: "asc" }, { id: "asc" }],
        })
      : Promise.resolve([]),
};
