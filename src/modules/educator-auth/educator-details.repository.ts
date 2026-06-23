import { prisma } from "../../config/prisma";

/**
 * Prisma persistence for the admin educator-details aggregate (MySQL branch).
 * Read-only aggregation over already-migrated tables — no new tables. Each of the
 * educator's associations (courses / live courses / packages / video categories /
 * live sessions) is fetched by its `educator_id`, plus subscriber counts grouped
 * by the association id, so the transformer can emit the Mongo DTO shape.
 */
export const educatorDetailsRepository = {
  coursesByEducator: (educatorId: number) =>
    prisma.course.findMany({
      where: { courseEducatorId: educatorId },
      select: { id: true, name: true, image: true, level: true, status: true, ordered: true, createdAt: true, purchase: true, is_featured: true },
      orderBy: { createdAt: "desc" },
    }),
  liveCoursesByEducator: (educatorId: number) =>
    prisma.liveCourse.findMany({
      where: { educatorId },
      select: { id: true, name: true, image: true, level: true, classType: true, status: true, ordered: true, createdAt: true },
      orderBy: { createdAt: "desc" },
    }),
  packagesByEducator: (educatorId: number) =>
    prisma.package.findMany({
      where: { educator_id: educatorId },
      select: { id: true, name: true, image: true, active: true, order_by: true, created_at: true },
      orderBy: { created_at: "desc" },
    }),
  videoCategoriesByEducator: (educatorId: number) =>
    prisma.videoCategory.findMany({
      where: { educatorId },
      select: { id: true, title: true, slug: true, image: true, status: true, order_by: true, liveCourseId: true, created_at: true },
      orderBy: { created_at: "desc" },
    }),
  liveSessionsByEducator: (educatorId: number) =>
    prisma.liveSession.findMany({
      where: { educatorId },
      select: { id: true, title: true, subject: true, status: true, scheduledAt: true, endAt: true, createdAt: true },
      orderBy: { createdAt: "desc" },
    }),

  // ── subscriber counts (active = status true), grouped by association id ──────
  courseSubCounts: (courseIds: number[]) =>
    courseIds.length
      ? prisma.packageCourseSubscription.groupBy({ by: ["courseId"], where: { courseId: { in: courseIds }, status: true }, _count: { _all: true } })
      : Promise.resolve([]),
  packageSubCounts: (packageIds: number[]) =>
    packageIds.length
      ? prisma.packageCourseSubscription.groupBy({ by: ["packageId"], where: { packageId: { in: packageIds }, status: true }, _count: { _all: true } })
      : Promise.resolve([]),
  liveCourseSubCounts: (liveCourseIds: number[]) =>
    liveCourseIds.length
      ? prisma.liveCourseSubscription.groupBy({ by: ["liveCourseId"], where: { liveCourseId: { in: liveCourseIds }, status: true }, _count: { _all: true } })
      : Promise.resolve([]),

  // live-course names for the recording-folder (video category) association
  liveCoursesByIds: (ids: number[]) =>
    ids.length ? prisma.liveCourse.findMany({ where: { id: { in: ids } }, select: { id: true, name: true } }) : Promise.resolve([]),
};
