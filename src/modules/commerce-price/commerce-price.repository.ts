// Commerce prices: Prisma queries for package, course and ebook plan rows.
import { prisma } from "../../config/prisma";

export const commercePriceRepository = {
  /** Any status; callers filter. */
  findById: (id: number) =>
    prisma.packageCourseEbookPrice.findUnique({ where: { id } }),

  findActiveById: (id: number) =>
    prisma.packageCourseEbookPrice.findFirst({ where: { id, status: true } }),

  findByIds: (ids: number[]) =>
    ids.length
      ? prisma.packageCourseEbookPrice.findMany({
          where: { id: { in: ids } },
          orderBy: [{ duration: "asc" }, { id: "asc" }],
        })
      : Promise.resolve([]),

  listActiveByPackage: (packageId: number) =>
    prisma.packageCourseEbookPrice.findMany({
      where: { packageId, status: true },
      orderBy: [{ duration: "asc" }, { id: "asc" }],
    }),

  listActiveByCourse: (courseId: number) =>
    prisma.packageCourseEbookPrice.findMany({
      where: { courseId, status: true },
      orderBy: [{ duration: "asc" }, { id: "asc" }],
    }),

  listActiveByEbook: (ebookId: number) =>
    prisma.packageCourseEbookPrice.findMany({
      where: { ebookId, status: true },
      orderBy: [{ duration: "asc" }, { id: "asc" }],
    }),

  listActiveByPackages: (packageIds: number[]) =>
    packageIds.length
      ? prisma.packageCourseEbookPrice.findMany({
          where: { packageId: { in: packageIds }, status: true },
          orderBy: [{ duration: "asc" }, { id: "asc" }],
        })
      : Promise.resolve([]),

  listActiveByCourses: (courseIds: number[]) =>
    courseIds.length
      ? prisma.packageCourseEbookPrice.findMany({
          where: { courseId: { in: courseIds }, status: true },
          orderBy: [{ duration: "asc" }, { id: "asc" }],
        })
      : Promise.resolve([]),

  listActiveByEbooks: (ebookIds: number[]) =>
    ebookIds.length
      ? prisma.packageCourseEbookPrice.findMany({
          where: { ebookId: { in: ebookIds }, status: true },
          orderBy: [{ duration: "asc" }, { id: "asc" }],
        })
      : Promise.resolve([]),
};
