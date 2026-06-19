/**
 * Educator portal — SQL data layer for the educator course + package controllers
 * (listings, detail, per-item dashboard, subscribers). Gated behind
 * `isMysqlModule("educator-portal")`.
 *
 * Ownership: Course.courseEducatorId / Package.educator_id == educatorId.
 * Plans: PackageCourseEbookPrice by courseId / packageId. Subs:
 * ws_package_course_subscription by courseId / packageId (packageId IS the
 * package on SQL). Customer is single `fullName` + `phoneNumber`.
 */
import { isMysqlModule } from "../../config/migration";
import { prisma } from "../../config/prisma";

export const isEducatorPortalMysql = (): boolean => isMysqlModule("educator-portal");

export const parseEpId = (id: string): number | null => {
  const n = Number(id);
  return Number.isInteger(n) && n > 0 ? n : null;
};

const sid = (n: number | null | undefined) => (n == null ? null : String(n));
const planBuckets = (plans: any[]) => ({
  withMaterial: plans.filter((p) => p.withMaterial),
  withoutMaterial: plans.filter((p) => !p.withMaterial),
});

// ── COURSES ──────────────────────────────────────────────────────────────────
export const listMyCourses = async (educatorId: number) => {
  const courses = await prisma.course.findMany({
    where: { courseEducatorId: educatorId },
    include: { subject: true, educator: { select: { id: true, name: true, image: true } } },
  });
  const courseIds = courses.map((c) => c.id);
  const [plans, subCounts] = await Promise.all([
    courseIds.length ? prisma.packageCourseEbookPrice.findMany({ where: { courseId: { in: courseIds }, status: true }, orderBy: { duration: "asc" } }) : [],
    courseIds.length ? prisma.packageCourseSubscription.groupBy({ by: ["courseId"], where: { courseId: { in: courseIds } }, _count: { _all: true } }) : [],
  ]);
  // active counts need a separate grouped query (status=true)
  const activeCounts = courseIds.length
    ? await prisma.packageCourseSubscription.groupBy({ by: ["courseId"], where: { courseId: { in: courseIds }, status: true }, _count: { _all: true } })
    : [];
  const planByCourse = new Map<number, any[]>();
  for (const p of plans) { if (p.courseId == null) continue; (planByCourse.get(p.courseId) ?? planByCourse.set(p.courseId, []).get(p.courseId)!).push(p); }
  const totalBy = new Map((subCounts as any[]).map((r) => [r.courseId, r._count._all]));
  const activeBy = new Map((activeCounts as any[]).map((r) => [r.courseId, r._count._all]));

  return courses.map((c) => ({
    ...c, _id: String(c.id),
    subscriptionCount: totalBy.get(c.id) ?? 0,
    activeSubscriptions: activeBy.get(c.id) ?? 0,
    plans: planBuckets(planByCourse.get(c.id) ?? []),
  }));
};

export const getMyCourseDetail = async (educatorId: number, courseId: number) => {
  const course = await prisma.course.findFirst({
    where: { id: courseId, courseEducatorId: educatorId },
    include: { subject: true, educator: { select: { id: true, name: true, image: true } } },
  });
  if (!course) return null;
  const plans = await prisma.packageCourseEbookPrice.findMany({ where: { courseId, status: true }, orderBy: { duration: "asc" } });
  return { ...course, _id: String(course.id), plans };
};

export const getCourseDashboard = async (educatorId: number, courseId: number) => {
  const owned = await prisma.course.findFirst({ where: { id: courseId, courseEducatorId: educatorId }, select: { id: true } });
  if (!owned) return null;
  const now = new Date();
  const [totalSubs, activeSubs, expiredSubs, plansCount, recentSubs] = await Promise.all([
    prisma.packageCourseSubscription.count({ where: { courseId } }),
    prisma.packageCourseSubscription.count({ where: { courseId, status: true, endAt: { gt: now } } }),
    prisma.packageCourseSubscription.count({ where: { courseId, endAt: { lte: now } } }),
    prisma.packageCourseEbookPrice.count({ where: { courseId, status: true } }),
    prisma.packageCourseSubscription.findMany({ where: { courseId }, include: { customer: { select: { id: true, fullName: true, phoneNumber: true } } }, orderBy: { createdAt: "desc" }, take: 10 }),
  ]);
  return { totalSubscriptions: totalSubs, activeSubscriptions: activeSubs, expiredSubscriptions: expiredSubs, plansCount, recentSubscriptions: recentSubs };
};

export const getCourseSubscribers = async (educatorId: number, courseId: number, skip: number, take: number) => {
  const owned = await prisma.course.findFirst({ where: { id: courseId, courseEducatorId: educatorId }, select: { id: true } });
  if (!owned) return null;
  const [data, total] = await Promise.all([
    prisma.packageCourseSubscription.findMany({ where: { courseId }, include: { customer: { select: { id: true, fullName: true, phoneNumber: true, emailAddress: true } } }, orderBy: { createdAt: "desc" }, skip, take }),
    prisma.packageCourseSubscription.count({ where: { courseId } }),
  ]);
  return { data, total };
};

// ── PACKAGES ─────────────────────────────────────────────────────────────────
export const listMyPackages = async (educatorId: number) => {
  const packages = await prisma.package.findMany({ where: { educator_id: educatorId } });
  const packageIds = packages.map((p) => p.id);
  const [plans, subCounts, activeCounts] = await Promise.all([
    packageIds.length ? prisma.packageCourseEbookPrice.findMany({ where: { packageId: { in: packageIds }, status: true }, orderBy: { duration: "asc" } }) : [],
    packageIds.length ? prisma.packageCourseSubscription.groupBy({ by: ["packageId"], where: { packageId: { in: packageIds } }, _count: { _all: true } }) : [],
    packageIds.length ? prisma.packageCourseSubscription.groupBy({ by: ["packageId"], where: { packageId: { in: packageIds }, status: true }, _count: { _all: true } }) : [],
  ]);
  const planByPkg = new Map<number, any[]>();
  for (const p of plans) { if (p.packageId == null) continue; (planByPkg.get(p.packageId) ?? planByPkg.set(p.packageId, []).get(p.packageId)!).push(p); }
  const totalBy = new Map((subCounts as any[]).map((r) => [r.packageId, r._count._all]));
  const activeBy = new Map((activeCounts as any[]).map((r) => [r.packageId, r._count._all]));
  return packages.map((p) => ({
    ...p, _id: String(p.id),
    subscriptionCount: totalBy.get(p.id) ?? 0,
    activeSubscriptions: activeBy.get(p.id) ?? 0,
    plans: planBuckets(planByPkg.get(p.id) ?? []),
  }));
};

export const getMyPackageDetail = async (educatorId: number, packageId: number) => {
  const pkg = await prisma.package.findFirst({ where: { id: packageId, educator_id: educatorId } });
  if (!pkg) return null;
  const plans = await prisma.packageCourseEbookPrice.findMany({ where: { packageId, status: true }, orderBy: { duration: "asc" } });
  return { ...pkg, _id: String(pkg.id), plans };
};

export const getPackageDashboard = async (educatorId: number, packageId: number) => {
  const owned = await prisma.package.findFirst({ where: { id: packageId, educator_id: educatorId }, select: { id: true } });
  if (!owned) return null;
  const now = new Date();
  const [totalSubs, activeSubs, expiredSubs, plansCount, recentSubs] = await Promise.all([
    prisma.packageCourseSubscription.count({ where: { packageId } }),
    prisma.packageCourseSubscription.count({ where: { packageId, status: true, endAt: { gt: now } } }),
    prisma.packageCourseSubscription.count({ where: { packageId, endAt: { lte: now } } }),
    prisma.packageCourseEbookPrice.count({ where: { packageId, status: true } }),
    prisma.packageCourseSubscription.findMany({ where: { packageId }, include: { customer: { select: { id: true, fullName: true, phoneNumber: true } } }, orderBy: { createdAt: "desc" }, take: 10 }),
  ]);
  return { totalSubscriptions: totalSubs, activeSubscriptions: activeSubs, expiredSubscriptions: expiredSubs, plansCount, recentSubscriptions: recentSubs };
};

export const getPackageSubscribers = async (educatorId: number, packageId: number, skip: number, take: number) => {
  const owned = await prisma.package.findFirst({ where: { id: packageId, educator_id: educatorId }, select: { id: true } });
  if (!owned) return null;
  const [data, total] = await Promise.all([
    prisma.packageCourseSubscription.findMany({ where: { packageId }, include: { customer: { select: { id: true, fullName: true, phoneNumber: true, emailAddress: true } } }, orderBy: { createdAt: "desc" }, skip, take }),
    prisma.packageCourseSubscription.count({ where: { packageId } }),
  ]);
  return { data, total };
};
