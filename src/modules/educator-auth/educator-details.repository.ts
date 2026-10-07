// Educator details: Prisma queries for an educator's courses, packages, folders and sessions.
import { prisma } from "../../config/prisma";

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
      select: { id: true, name: true, image: true, classType: true, status: true, ordered: true, createdAt: true },
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

  courseSubCounts: (courseIds: number[]) =>
    courseIds.length
      ? prisma.packageCourseSubscription.groupBy({ by: ["courseId"], where: { courseId: { in: courseIds }, status: true }, _count: { _all: true } })
      : Promise.resolve([]),
  packageSubCounts: (packageIds: number[]) =>
    packageIds.length
      ? prisma.packageCourseSubscription.groupBy({ by: ["packageId"], where: { packageId: { in: packageIds }, status: true }, _count: { _all: true } })
      : Promise.resolve([]),
  // Counts active subscription ROWS, not distinct customers: a renewal writes its
  // own active row, so one renewing customer can count twice. Package/course above
  // behave the same; change both to distinct-customer together or they disagree.
  liveCourseSubCounts: (liveCourseIds: number[]) =>
    liveCourseIds.length
      ? prisma.liveCourseSubscription.groupBy({ by: ["liveCourseId"], where: { liveCourseId: { in: liveCourseIds }, status: true }, _count: { _all: true } })
      : Promise.resolve([]),

  liveCoursesByIds: (ids: number[]) =>
    ids.length ? prisma.liveCourse.findMany({ where: { id: { in: ids } }, select: { id: true, name: true } }) : Promise.resolve([]),

  countCoursesByEducator: (educatorId: number) =>
    prisma.course.count({ where: { courseEducatorId: educatorId } }),
  pageCoursesByEducator: (educatorId: number, skip: number, take: number) =>
    prisma.course.findMany({
      where: { courseEducatorId: educatorId },
      select: { id: true, name: true, image: true, level: true, status: true, ordered: true, createdAt: true, purchase: true, is_featured: true },
      orderBy: { createdAt: "desc" }, skip, take,
    }),

  countLiveCoursesByEducator: (educatorId: number) =>
    prisma.liveCourse.count({ where: { educatorId } }),
  pageLiveCoursesByEducator: (educatorId: number, skip: number, take: number) =>
    prisma.liveCourse.findMany({
      where: { educatorId },
      select: { id: true, name: true, image: true, classType: true, status: true, ordered: true, createdAt: true },
      orderBy: { createdAt: "desc" }, skip, take,
    }),

  countPackagesByEducator: (educatorId: number) =>
    prisma.package.count({ where: { educator_id: educatorId } }),
  pagePackagesByEducator: (educatorId: number, skip: number, take: number) =>
    prisma.package.findMany({
      where: { educator_id: educatorId },
      select: { id: true, name: true, image: true, active: true, order_by: true, created_at: true },
      orderBy: { created_at: "desc" }, skip, take,
    }),

  // Root video categories only; live-course folders stay on the aggregate.
  countVideoCategoriesByEducator: (educatorId: number) =>
    prisma.videoCategory.count({ where: { educatorId, liveCourseId: null } }),
  pageVideoCategoriesByEducator: (educatorId: number, skip: number, take: number) =>
    prisma.videoCategory.findMany({
      where: { educatorId, liveCourseId: null },
      select: { id: true, title: true, slug: true, image: true, status: true, order_by: true, liveCourseId: true, created_at: true },
      orderBy: { created_at: "desc" }, skip, take,
    }),

  countLiveSessionsByEducator: (educatorId: number) =>
    prisma.liveSession.count({ where: { educatorId } }),
  pageLiveSessionsByEducator: (educatorId: number, skip: number, take: number) =>
    prisma.liveSession.findMany({
      where: { educatorId },
      select: { id: true, title: true, subject: true, status: true, scheduledAt: true, endAt: true, createdAt: true },
      orderBy: { createdAt: "desc" }, skip, take,
    }),
};
