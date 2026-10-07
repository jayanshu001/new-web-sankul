// Course catalog: Prisma queries.
import { prisma } from "../../config/prisma";
import { buildPrismaSearch } from "../../utils/searchFilter";

export const catalogCourseRepository = {
  listActiveCategories: () =>
    prisma.courseSubjectCategory.findMany({
      where: { status: true },
      orderBy: [{ order: "asc" }, { createdAt: "asc" }],
    }),

  paginateActiveCategories: (args: { search?: string; skip: number; take: number }) => {
    const where = {
      status: true,
      ...(buildPrismaSearch(args.search, ["title"]) ?? {}),
    };
    return Promise.all([
      prisma.courseSubjectCategory.findMany({
        where,
        orderBy: [{ order: "asc" as const }, { createdAt: "asc" as const }],
        skip: args.skip,
        take: args.take,
      }),
      prisma.courseSubjectCategory.count({ where }),
    ]);
  },

  countActiveCoursesByCategory: (categoryIds: number[]) =>
    prisma.course.groupBy({
      by: ["courseSubjectCategoryId"],
      where: { status: true, courseSubjectCategoryId: { in: categoryIds } },
      _count: { _all: true },
    }),

  findCourseById: (id: number) =>
    prisma.course.findFirst({ where: { id, status: true } }),

  listActiveCourses: (opts?: { search?: string }) =>
    prisma.course.findMany({
      where: {
        status: true,
        ...(buildPrismaSearch(opts?.search, ["name", "description"]) ?? {}),
      },
      orderBy: [{ ordered: "asc" }, { createdAt: "asc" }],
    }),

  listActiveCoursesByCategory: (categoryId: number) =>
    prisma.course.findMany({
      where: { status: true, courseSubjectCategoryId: categoryId },
      orderBy: [{ ordered: "asc" }, { createdAt: "asc" }],
    }),

  paginateActiveCourses: (args: {
    where: {
      isPopular?: boolean;
      search?: string;
      categoryId?: number;
    };
    orderBy: { field: "createdAt" | "ordered" | "name"; dir: "asc" | "desc" };
    skip: number;
    take: number;
  }) => {
    const where = {
      status: true,
      ...(args.where.isPopular != null
        ? { is_featured: args.where.isPopular ? ("yes" as const) : ("no" as const) }
        : {}),
      ...(args.where.categoryId != null
        ? { courseSubjectCategoryId: args.where.categoryId }
        : {}),
      ...(buildPrismaSearch(args.where.search, ["name", "description"]) ?? {}),
    };
    return Promise.all([
      prisma.course.findMany({
        where,
        // Chosen field first, then `created_at ASC` (or id when the field is createdAt) as tiebreaker.
        orderBy: [
          { [args.orderBy.field]: args.orderBy.dir },
          args.orderBy.field === "createdAt" ? { id: "asc" as const } : { createdAt: "asc" as const },
        ],
        skip: args.skip,
        take: args.take,
        include: {
          educator: { select: { id: true, name: true } },
          subject: { select: { id: true, title: true } },
          VideoCategory: { select: { id: true, title: true } },
        },
      }),
      prisma.course.count({ where }),
    ]);
  },
};
