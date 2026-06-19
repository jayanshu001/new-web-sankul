/**
 * Educator dashboard — SQL data layer for GET /educator/dashboard. Gated behind
 * `isMysqlModule("educator-dashboard")`. The educator's courses/packages →
 * subscription counts + top-5 + recent subs.
 *
 * Drift: on SQL ws_package_course_subscription.packageId IS the package directly
 * (Mongo used packageId = plan id). So package subs match by packageId ∈ the
 * educator's package ids — no plan-id hop needed. Course relation is `educatorId`
 * (Course.courseEducatorId) and Package.educator_id.
 */
import { isMysqlModule } from "../../config/migration";
import { prisma } from "../../config/prisma";

export const isEducatorDashboardMysql = (): boolean => isMysqlModule("educator-dashboard");

export const parseEduId = (id: string): number | null => {
  const n = Number(id);
  return Number.isInteger(n) && n > 0 ? n : null;
};

export const buildEducatorDashboard = async (educatorId: number) => {
  const now = new Date();
  const [courses, packages] = await Promise.all([
    prisma.course.findMany({ where: { courseEducatorId: educatorId }, select: { id: true, name: true } }),
    prisma.package.findMany({ where: { educator_id: educatorId }, select: { id: true, name: true } }),
  ]);
  const courseIds = courses.map((c) => c.id);
  const packageIds = packages.map((p) => p.id);

  const [
    courseTotalSubs, courseActiveSubs, packageTotalSubs, packageActiveSubs,
    topCourseRows, topPackageRows, recentSubs,
  ] = await Promise.all([
    courseIds.length ? prisma.packageCourseSubscription.count({ where: { courseId: { in: courseIds } } }) : 0,
    courseIds.length ? prisma.packageCourseSubscription.count({ where: { courseId: { in: courseIds }, status: true, endAt: { gt: now } } }) : 0,
    packageIds.length ? prisma.packageCourseSubscription.count({ where: { packageId: { in: packageIds } } }) : 0,
    packageIds.length ? prisma.packageCourseSubscription.count({ where: { packageId: { in: packageIds }, status: true, endAt: { gt: now } } }) : 0,
    courseIds.length ? prisma.packageCourseSubscription.groupBy({ by: ["courseId"], where: { courseId: { in: courseIds } }, _count: { _all: true }, orderBy: { _count: { courseId: "desc" } }, take: 5 }) : [],
    packageIds.length ? prisma.packageCourseSubscription.groupBy({ by: ["packageId"], where: { packageId: { in: packageIds } }, _count: { _all: true }, orderBy: { _count: { packageId: "desc" } }, take: 5 }) : [],
    (courseIds.length || packageIds.length)
      ? prisma.packageCourseSubscription.findMany({
          where: { OR: [{ courseId: { in: courseIds } }, { packageId: { in: packageIds } }] },
          include: { customer: { select: { id: true, fullName: true, phoneNumber: true } }, course: { select: { id: true, name: true } } },
          orderBy: { createdAt: "desc" }, take: 10,
        })
      : [],
  ]);

  // top lists: attach course/package metadata
  const courseById = new Map(courses.map((c) => [c.id, c]));
  const packageById = new Map(packages.map((p) => [p.id, p]));
  const topCourses = (topCourseRows as any[]).map((r) => ({ _id: String(r.courseId), total: r._count._all, course: courseById.get(r.courseId) ? { _id: String(r.courseId), name: courseById.get(r.courseId)!.name } : null }));
  const topPackages = (topPackageRows as any[]).map((r) => ({ _id: String(r.packageId), total: r._count._all, package: packageById.get(r.packageId) ? { _id: String(r.packageId), name: packageById.get(r.packageId)!.name } : null }));

  return {
    summary: {
      coursesCount: courses.length,
      packagesCount: packages.length,
      courseTotalSubscriptions: courseTotalSubs,
      courseActiveSubscriptions: courseActiveSubs,
      packageTotalSubscriptions: packageTotalSubs,
      packageActiveSubscriptions: packageActiveSubs,
      totalSubscriptions: courseTotalSubs + packageTotalSubs,
      totalActiveSubscriptions: courseActiveSubs + packageActiveSubs,
    },
    topCourses,
    topPackages,
    recentSubscriptions: recentSubs,
  };
};
