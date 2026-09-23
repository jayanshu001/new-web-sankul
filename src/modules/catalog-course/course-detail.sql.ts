/**
 * buildCourseDetailsSql — SQL mirror of client/course/course.service.buildCourseDetails.
 * Composes the course-detail page from ws_course + relations. Gated with
 * `catalog-course` (course id-space is int here).
 *
 * Joins:
 *  - course + subject category + educator (Prisma relations)
 *  - videos[]: the course's videoCategoryId folder — subtree count via the
 *    catalog-category-tree DAG resolver; direct list + per-video progress badge
 *    (ws_lecture_progress)
 *  - materials[] / tests[]: ws_material_category_course / ws_exam_category_course
 *    pivots (same as admin-course); subtree counts via recursive CTE on the
 *    single-parent ws_material_category / ws_exam_category trees
 *  - plans: PackageCourseEbookPrice split by withMaterial
 *  - subscription: active course-or-plan sub → isPurchased + daysLeft
 *  - availablePromoCode: [] — PromoCode.appliesTo has no SQL model (C5 deferred;
 *    same accepted limitation as commerce-promocode)
 *
 * Mongo-only Course fields (materialCategories[]/examCategories[] embeds,
 * examCountdownCategoryId) are sourced from pivots / dropped — documented drift.
 */
import { prisma } from "../../config/prisma";
import { computeDaysLeft } from "../../utils/planDuration";
import { listActivePricesByCourses } from "../commerce-price/commerce-price.service";
import { listActiveForCoursesOrPlans } from "../commerce-subscription/commerce-subscription.service";
import { populateExamCountdowns } from "../exam-countdown/exam-countdown.service";
import { examInCategoriesWhere } from "../catalog-exam/exam-category-pivot.where";
import { byOrderThenCreatedAt } from "../../utils/catalogOrder";
import cache, { CacheDomain } from "../../libs/cache";
import { CacheEntity } from "../../middlewares/flushGroups";

const sid = (n: number | null | undefined) => (n == null ? null : String(n));

/**
 * All descendant ids (incl. the root) of a single-parent category tree.
 * `parentCol` differs per table: ws_material_category uses `parent`,
 * ws_exam_category uses `parent_id`.
 */
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
 * Everything about a course detail page that is IDENTICAL for every caller —
 * course/subject/educator metadata, material/test category summaries + counts,
 * plans, examCountdown attachments, and the video folder's row list (title/
 * topic/etc, NOT progress). Cached — this is the expensive part (a dozen+
 * queries) and none of it depends on who's asking.
 *
 * Deliberately EXCLUDES per-video `progress` and `isPurchased`/`daysLeft` —
 * those are computed live in `buildCourseDetailsSql` below on every request,
 * same reasoning as client/categories/categories.controller.ts's
 * listVideosByCategory split.
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

  // ── Videos: the course's root video folder + subtree count + direct list ──
  // (rows only — no progress; that's merged in live by the caller)
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

  // ── Materials: pivot → active categories + subtree material counts ──
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

  // ── Tests: pivot → active exam categories + subtree published-exam counts ──
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
      // Mongo filtered status:PUBLISHED; SQL Exam.status is Boolean → status=true.
      prisma.exam.count({
        where: { AND: [examInCategoriesWhere(ids), { status: true }] },
      }),
      prisma.examCategory.count({ where: { parent: cat.id, status: true } }),
    ]);
    tests.push({ category: { ...cat, _id: String(cat.id), title: cat.name, havingChildDirectory: childCount > 0, count } });
  }

  // ── Plans (split by material) ──
  const allPlans = await listActivePricesByCourses([courseId]);
  const plans = {
    withMaterial: allPlans.filter((p) => p.withMaterial === true),
    withoutMaterial: allPlans.filter((p) => p.withMaterial === false),
  };

  // ── Embedded examCountdown attachments (C6): populate the row's JSON int[]
  // columns to the Mongo .populate() shape, order preserved. ──
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
  // Legacy single field dropped on the SQL course detail (mirrors Mongo path).
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

export const buildCourseDetailsSql = async (
  courseId: number,
  customerId?: number
): Promise<any | null> => {
  const now = new Date();

  // Tagged CacheEntity.CatalogCourse — already flushed by admin course writes AND
  // by plan/price writes (see flushGroups.ts), same as the course-list cache.
  const shared = await cache.aside({
    key: cache.key(CacheDomain.Client, CacheEntity.CatalogCourse, `detail:${courseId}`),
    ttlSeconds: 60,
    load: () => buildCourseDetailsShared(courseId),
  });
  if (!shared) return null;
  const { course, scope, videoBlock, materials, tests, plans, allPlans } = shared;

  // ── Per-video progress — always live, merged onto the cached row list ──
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

  // ── Subscription → isPurchased + daysLeft — always live ──
  let isPurchased = false;
  let daysLeft: number | null = null;
  if (customerId) {
    const planIds = allPlans.map((p) => Number(p._id)).filter((n) => Number.isInteger(n));
    const subs = await listActiveForCoursesOrPlans(customerId, [courseId], planIds, now);
    if (subs.length) {
      isPurchased = true;
      // longest endAt wins; null endAt = lifetime
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
    availablePromoCode: [], // PromoCode.appliesTo has no SQL model (C5)
  };
};
