// Course catalog: course detail page (cached shared block plus live per-customer data).
import { prisma } from "../../config/prisma";
import { computeDaysLeft } from "../../utils/planDuration";
import { listActivePricesByCourses } from "../commerce-price/commerce-price.service";
import { listActiveForCoursesOrPlans } from "../commerce-subscription/commerce-subscription.service";
import { populateExamCountdowns } from "../exam-countdown/exam-countdown.service";
import { examInCategoriesWhere } from "../catalog-exam/exam-category-pivot.where";
import { byOrderThenCreatedAt } from "../../utils/catalogOrder";
import cache, { CacheDomain } from "../../libs/cache";
import { CacheEntity } from "../../middlewares/flushGroups";
import { CACHE_TTL } from "../../config/cacheTtl";

const sid = (n: number | null | undefined) => (n == null ? null : String(n));

/** Descendant ids (incl. root); ws_material_category uses `parent`, ws_exam_category `parent_id`. */
const descendantCategoryIds = async (table: string, parentCol: string, rootId: number): Promise<number[]> => {
  const rows = await prisma.$queryRawUnsafe<{ id: number }[]>(
    `WITH RECURSIVE tree (id) AS (
       SELECT ${rootId}
       UNION
       SELECT c.id FROM ${table} c JOIN tree t ON c.${parentCol} = t.id
     )
     SELECT id FROM tree`
  );
  return rows.map((r) => Number(r.id));
};

/**
 * The caller-independent part of the detail page, cached because it is the
 * expensive part (a dozen+ queries). Per-video `progress` and
 * `isPurchased`/`daysLeft` are excluded and computed live in `buildCourseDetailsSql`.
 */
const buildCourseDetailsShared = async (courseId: number) => {
  const course = await prisma.course.findFirst({
    where: { id: courseId, status: true },
    include: {
      subject: true,
      educator: true,
      materialCategoryCourse: true,
      examCategoryCourse: true,
    },
  });
  if (!course) return null;

  const { reachableCategoryIds } = await import("../catalog-category-tree/category-tree.service");

  // Rows only; per-video progress is merged in live by the caller.
  let videoBlock: { category: any; list: any[] } | null = null;
  if (course.videoCategoryId) {
    const videoCat = await prisma.videoCategory.findFirst({ where: { id: course.videoCategoryId } });
    if (videoCat) {
      const reachable = await reachableCategoryIds("course", courseId);
      const [count, childCount, list] = await Promise.all([
        prisma.video.count({ where: { videoCategoryId: { in: [...reachable] }, status: true } }),
        prisma.videoCategoryRelation.count({ where: { parent: videoCat.id } }),
        prisma.video.findMany({ where: { videoCategoryId: videoCat.id, status: true }, orderBy: [{ order: "asc" }, { created_at: "asc" }] }),
      ]);
      const rows = list.map((v) => ({ ...v, _id: String(v.id), videoCategoryId: sid(v.videoCategoryId) }));
      videoBlock = { category: { ...videoCat, _id: String(videoCat.id), havingChildDirectory: childCount > 0, count }, list: rows };
    }
  }

  const matRefs = [...course.materialCategoryCourse].sort(byOrderThenCreatedAt);
  const matCatIds = matRefs.map((r) => r.materialCategoryId).filter((n): n is number => n != null);
  const matCats = matCatIds.length
    ? await prisma.materialCategory.findMany({ where: { id: { in: matCatIds }, status: true } })
    : [];
  const matById = new Map(matCats.map((c) => [c.id, c]));
  const materials: any[] = [];
  for (const ref of matRefs) {
    if (ref.materialCategoryId == null) continue;
    const cat = matById.get(ref.materialCategoryId);
    if (!cat) continue;
    const ids = await descendantCategoryIds("ws_material_category", "parent", cat.id);
    const [count, childCount] = await Promise.all([
      prisma.material.count({ where: { materialCategoryId: { in: ids }, status: true } }),
      prisma.materialCategory.count({ where: { parent: cat.id, status: true } }),
    ]);
    materials.push({ category: { ...cat, _id: String(cat.id), havingChildDirectory: childCount > 0, count } });
  }

  const examRefs = [...course.examCategoryCourse].sort(byOrderThenCreatedAt);
  const examCatIds = examRefs.map((r) => r.examCategoryId).filter((n): n is number => n != null);
  const examCats = examCatIds.length
    ? await prisma.examCategory.findMany({ where: { id: { in: examCatIds }, status: true } })
    : [];
  const examById = new Map(examCats.map((c) => [c.id, c]));
  const tests: any[] = [];
  for (const ref of examRefs) {
    if (ref.examCategoryId == null) continue;
    const cat = examById.get(ref.examCategoryId);
    if (!cat) continue;
    const ids = await descendantCategoryIds("ws_exam_category", "parent_id", cat.id);
    const [count, childCount] = await Promise.all([
      // Exam.status is boolean; true = published.
      prisma.exam.count({
        where: { AND: [examInCategoriesWhere(ids), { status: true }] },
      }),
      prisma.examCategory.count({ where: { parent: cat.id, status: true } }),
    ]);
    tests.push({ category: { ...cat, _id: String(cat.id), title: cat.name, havingChildDirectory: childCount > 0, count } });
  }

  const allPlans = await listActivePricesByCourses([courseId]);
  const plans = {
    withMaterial: allPlans.filter((p) => p.withMaterial === true),
    withoutMaterial: allPlans.filter((p) => p.withMaterial === false),
  };

  // Populates the row's JSON id-array columns, preserving order.
  const ec = await populateExamCountdowns(course as any);

  const courseDto: any = {
    ...course,
    _id: String(course.id),
    subject: course.subject ? { ...course.subject, _id: String(course.subject.id) } : null,
    educator: course.educator ? { ...course.educator, _id: String(course.educator.id) } : null,
    examCountdownIds: ec.examCountdownIds,
    examCountdownCategoryIds: ec.examCountdownCategoryIds,
  };
  delete courseDto.materialCategoryCourse;
  delete courseDto.examCategoryCourse;
  delete courseDto.courseSubjectCategoryId;
  delete courseDto.examCountdownCategoryId;

  return {
    course: courseDto,
    scope: { kind: "course", id: String(course.id) },
    videoBlock,
    materials,
    tests,
    plans,
    allPlans,
  };
};

// Shared detail cached 60s; per-video progress and purchase state merged live.
export const buildCourseDetailsSql = async (
  courseId: number,
  customerId?: number
): Promise<any | null> => {
  const now = new Date();

  // CacheEntity.CatalogCourse is flushed by admin course and plan/price writes.
  const shared = await cache.aside({
    key: cache.key(CacheDomain.Client, CacheEntity.CatalogCourse, `detail:${courseId}`),
    ttlSeconds: CACHE_TTL.CATALOG_SHARED,
    load: () => buildCourseDetailsShared(courseId),
  });
  if (!shared) return null;
  const { course, scope, videoBlock, materials, tests, plans, allPlans } = shared;

  // Per-video progress is always live, merged onto the cached rows.
  const videos: any[] = [];
  if (videoBlock) {
    let progByVideo = new Map<number, any>();
    if (customerId && videoBlock.list.length) {
      const rows = await prisma.lectureProgress.findMany({
        where: { customerId, videoId: { in: videoBlock.list.map((v: any) => v.id) } },
        select: { videoId: true, positionSec: true, durationSec: true, completed: true, completedAt: true, lastWatchedAt: true },
      });
      progByVideo = new Map(rows.map((r) => [r.videoId!, r]));
    }
    const listWithProgress = videoBlock.list.map((v: any) => {
      const p = progByVideo.get(v.id);
      return {
        ...v,
        progress: p ? { positionSec: p.positionSec ?? 0, durationSec: p.durationSec ?? 0, completed: !!p.completed, completedAt: p.completedAt ?? null, lastWatchedAt: p.lastWatchedAt ?? null } : null,
      };
    });
    videos.push({ category: videoBlock.category, list: listWithProgress });
  }

  let isPurchased = false;
  let daysLeft: number | null = null;
  if (customerId) {
    const planIds = allPlans.map((p) => Number(p._id)).filter((n) => Number.isInteger(n));
    const subs = await listActiveForCoursesOrPlans(customerId, [courseId], planIds, now);
    if (subs.length) {
      isPurchased = true;
      const hasLifetime = subs.some((s) => s.endAt == null);
      daysLeft = hasLifetime ? null : computeDaysLeft(subs.reduce<Date | null>((best, s) => {
        const e = s.endAt ?? null;
        if (!e) return best;
        return !best || e.getTime() > best.getTime() ? e : best;
      }, null), now);
    }
  }

  return {
    course: { ...course, isPurchased, daysLeft },
    scope,
    videos,
    materials,
    tests,
    plans,
    availablePromoCode: [],
  };
};
