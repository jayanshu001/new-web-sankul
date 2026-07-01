import { prisma } from "../../config/prisma";
import { computeDaysLeft } from "../../utils/planDuration";

/**
 * Client educator detail (profile + their active courses with plans + per-course
 * daysLeft). Composes already-migrated tables: ws_course_educator,
 * ws_course, ws_package_course_ebook_price (plans), ws_package_course_subscription
 * (entitlement). Read-only. View-counter bump is fire-and-forget.
 */
export const CLIENT_EDUCATOR_MODULE = "client-educator";
export const isClientEducatorMysql = (): boolean => true;

export const parseEducatorId = (id: string): number | null => {
  const n = Number(id);
  return Number.isInteger(n) && n > 0 ? n : null;
};

const num = (v: unknown): number => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

export const getEducatorWithCourses = async (
  educatorId: number,
  customerId: number | null,
  buildShare: (kind: string, id: string) => string
) => {
  const educator = await prisma.courseEducator.findFirst({ where: { id: educatorId, status: true } });
  if (!educator) return null;

  const courses = await prisma.course.findMany({
    where: { status: true, courseEducatorId: educatorId },
    include: {
      educator: { select: { id: true, name: true, image: true } },
      subject: { select: { id: true, title: true } },
    },
    orderBy: { id: "desc" },
  });

  const courseIds = courses.map((c) => c.id);
  const plans = courseIds.length
    ? await prisma.packageCourseEbookPrice.findMany({ where: { courseId: { in: courseIds }, status: true }, orderBy: { duration: "asc" } })
    : [];

  const plansByCourse = new Map<string, { withMaterial: any[]; withoutMaterial: any[] }>();
  for (const p of plans) {
    const key = String(p.courseId);
    let b = plansByCourse.get(key);
    if (!b) { b = { withMaterial: [], withoutMaterial: [] }; plansByCourse.set(key, b); }
    (p.withMaterial ? b.withMaterial : b.withoutMaterial).push(p);
  }

  // Per-course daysLeft: latest active sub wins; lifetime (null endAt) beats dated.
  const now = new Date();
  const life = new Set<string>();
  const latest = new Map<string, Date>();
  if (customerId && courseIds.length) {
    const planIds = plans.map((p) => p.id);
    const planToCourse = new Map<string, string>(plans.map((p) => [String(p.id), String(p.courseId)]));
    const subs = await prisma.packageCourseSubscription.findMany({
      where: {
        customerId,
        status: true,
        OR: [{ courseId: { in: courseIds } }, { packageId: { in: planIds } }],
        AND: [{ OR: [{ endAt: null }, { endAt: { gt: now } }] }],
      },
      select: { courseId: true, packageId: true, endAt: true },
    });
    const upsert = (key: string, endAt: Date | null) => {
      if (endAt === null) { life.add(key); return; }
      if (life.has(key)) return;
      const prev = latest.get(key);
      if (!prev || endAt.getTime() > prev.getTime()) latest.set(key, endAt);
    };
    for (const s of subs) {
      if (s.courseId != null) upsert(String(s.courseId), s.endAt ?? null);
      const viaPlan = planToCourse.get(String(s.packageId));
      if (viaPlan) upsert(viaPlan, s.endAt ?? null);
    }
  }

  const coursesWithPlans = courses.map((c) => {
    const key = String(c.id);
    const isLifetime = life.has(key);
    const endAt = latest.get(key);
    return {
      _id: key,
      name: c.name,
      image: c.image ?? null,
      courseEducatorId: c.educator ? { _id: String(c.educator.id), name: c.educator.name, image: c.educator.image ?? null } : null,
      courseSubjectCategoryId: c.subject ? { _id: String(c.subject.id), title: c.subject.title } : null,
      plans: plansByCourse.get(key) ?? { withMaterial: [], withoutMaterial: [] },
      daysLeft: isLifetime ? null : (endAt ? computeDaysLeft(endAt, now) : null),
      shareableLink: buildShare("courses", key),
    };
  });

  // Fire-and-forget view bump.
  prisma.courseEducator.update({ where: { id: educatorId }, data: { view: { increment: 1 } } }).catch(() => {});

  const shareableLink = buildShare("educators", String(educatorId));
  return {
    educator: {
      _id: String(educator.id),
      name: educator.name,
      email: educator.email,
      image: educator.image ?? "",
      about: educator.about ?? "",
      view: num(educator.view),
      shareableLink,
    },
    courses: coursesWithPlans,
    totalCourses: coursesWithPlans.length,
    shareableLink,
  };
};
