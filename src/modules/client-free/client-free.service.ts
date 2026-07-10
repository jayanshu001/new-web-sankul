/**
 * Free listings (free-tests / free-materials / free-videos / free-ebooks /
 * free-courses) — SQL (Prisma) branch. Gated behind `isMysqlModule("client-free")`.
 *
 * Mirrors src/client/free/free.controller.ts response shapes + status codes,
 * built on the already-migrated SQL catalog tables (ws_course / ws_package /
 * ws_exam / ws_material(_category) / ws_video(_category) / ws_ebook) and the
 * category-tree DAG resolver (catalog-category-tree).
 *
 * Two gates per listing (same as Mongo):
 *   (1) ASSIGNMENT — the category must be attached to SOME active product
 *       (course / package / live-course); orphan categories never surface.
 *   (2) FREE — the item itself is free:
 *         material  → isPaid = false                (ws_material.is_paid)
 *         video     → priceType = "free"            (ws_video.type)
 *         exam      → isPaid = false                (ws_exam.is_paid)
 *         ebook     → min active plan price == 0    (ws_ebook has no isPaid col)
 *         course    → purchase = "no"               (CourseFlag01 '0' = free)
 *         package   → (no isPaid col on ws_package → free-package set is empty;
 *                      documented catalog drift)
 *
 * Documented SQL drift vs Mongo (kept on Mongo / degraded, never invented):
 *  - MaterialCategory tree parent col = `parent`; ExamCategory parent = `parent_id`
 *    (mapped `parent`); VideoCategory tree walked via ws_video_category_relation
 *    through the catalog-category-tree DAG.
 *  - LiveCourse has NO material/exam category pivots on SQL and ws_video_category
 *    has no live_course_id column (Wave-6 drift). LiveCourse contributes ONLY its
 *    scalar `videoCategoryId` to the video-assignment gate; it can never be a
 *    free-materials or free-tests product on SQL.
 *  - ws_package has no isPaid col → free-courses' free package set is always
 *    empty (matches client-trending/client-search documented behaviour).
 *  - Exam category-image populate: Mongo populated categoryId{_id,title,image};
 *    SQL ExamCategory has `name` (not title) + image → mapped to {_id,title,image}.
 */
import { prisma } from "../../config/prisma";
import { computeDaysLeft } from "../../utils/planDuration";
import { isNewItem } from "../../utils/isNew";
import { descendantsOf } from "../catalog-category-tree/category-tree.service";
import { examInCategoriesWhere } from "../catalog-exam/exam-category-pivot.where";

export const CLIENT_FREE_MODULE = "client-free";
export const isClientFreeMysql = (): boolean => true;

export const parseFreeId = (id: string): number | null => {
  const n = Number(id);
  return Number.isInteger(n) && n > 0 ? n : null;
};

// Recursive descendant ids for a self-referencing category table (material/exam).
const descendantIds = async (table: string, parentCol: string, rootIds: number[]): Promise<number[]> => {
  const roots = [...new Set(rootIds.filter((n) => Number.isInteger(n) && n > 0))];
  if (!roots.length) return [];
  const seed = roots.map((id) => `SELECT ${id} AS id`).join(" UNION ALL ");
  const rows = await prisma.$queryRawUnsafe<{ id: number }[]>(
    `WITH RECURSIVE tree (id) AS (${seed} UNION SELECT c.id FROM ${table} c JOIN tree t ON c.${parentCol} = t.id) SELECT DISTINCT id FROM tree`
  );
  const out = new Set<number>(roots);
  for (const r of rows) out.add(Number(r.id));
  return [...out];
};

// ── ASSIGNMENT resolver ───────────────────────────────────────────────────────
// Category ids assigned to ANY active product (paid OR free) — the assignment
// gate used by free-materials / free-videos / free-tests. Mirrors Mongo
// resolveAssignedCategoryIds. Video roots are expanded to their full subtree via
// the DAG; material/exam roots stay roots here (each endpoint expands its own).
const resolveAssignedCategoryIds = async () => {
  const [courses, liveCourses, matCourseRefs, matPkgRefs, examCourseRefs, examPkgRefs, pkgSubjects, pkgRels] =
    await Promise.all([
      prisma.course.findMany({ where: { status: true }, select: { id: true, videoCategoryId: true } }),
      prisma.liveCourse.findMany({ where: { status: true }, select: { id: true, videoCategoryId: true } }),
      prisma.materialCategoryCourse.findMany({ select: { materialCategoryId: true, courseId: true } }),
      prisma.materialCategoryPackage.findMany({ select: { materialCategoryId: true, packageId: true } }),
      prisma.examCategoryCourse.findMany({ select: { examCategoryId: true, courseId: true } }),
      prisma.examCategoryPackage.findMany({ select: { examCategoryId: true, packageId: true } }),
      prisma.packageSpecificSubject.findMany({ where: { status: true }, select: { subjectId: true } }),
      prisma.packageVideoCategoryRelation.findMany({ where: { status: true }, select: { videoCategoryRelationId: true } }),
    ]);

  const materialCategoryIds = new Set<number>();
  const examCategoryIds = new Set<number>();
  const videoRootIds = new Set<number>();

  for (const r of matCourseRefs) if (r.materialCategoryId != null) materialCategoryIds.add(r.materialCategoryId);
  for (const r of matPkgRefs) if (r.materialCategoryId != null) materialCategoryIds.add(r.materialCategoryId);
  for (const r of examCourseRefs) if (r.examCategoryId != null) examCategoryIds.add(r.examCategoryId);
  for (const r of examPkgRefs) if (r.examCategoryId != null) examCategoryIds.add(r.examCategoryId);

  for (const c of courses) if (c.videoCategoryId) videoRootIds.add(c.videoCategoryId);
  for (const lc of liveCourses) if (lc.videoCategoryId) videoRootIds.add(lc.videoCategoryId);
  for (const s of pkgSubjects) if (s.subjectId) videoRootIds.add(s.subjectId);

  if (pkgRels.length) {
    const relIds = [...new Set(pkgRels.map((r) => r.videoCategoryRelationId))];
    const rels = await prisma.videoCategoryRelation.findMany({ where: { id: { in: relIds } }, select: { parent: true, child: true } });
    for (const r of rels) { if (r.parent) videoRootIds.add(r.parent); if (r.child) videoRootIds.add(r.child); }
  }

  // Expand video roots to full subtree (videos live on leaves).
  const videoCategoryIds = videoRootIds.size ? new Set(await descendantsOf([...videoRootIds])) : new Set<number>();

  return {
    materialCategoryIds: [...materialCategoryIds],
    examCategoryIds: [...examCategoryIds],
    videoCategoryIds: [...videoCategoryIds],
  };
};

// ── FREE-TESTS ───────────────────────────────────────────────────────────────
// Year → month → week drill-down bucketed on Exam.startAt. SUBJECT tests only,
// free (isPaid=false), in an assigned exam category, startAt <= endOfDay.
export const freeTests = async (opts: {
  customerId: number | null;
  search: string | null;
  year?: number; month?: number; week?: number;
  page: number; limit: number; skip: number;
}) => {
  const { examCategoryIds } = await resolveAssignedCategoryIds();
  if (!examCategoryIds.length) {
    // No assigned categories → empty at every level (matches Mongo empty $in).
    return emptyTestsLevel(opts);
  }

  const now = new Date();
  const endOfDay = new Date(now); endOfDay.setHours(23, 59, 59, 999);

  const baseWhere: any = {
    AND: [
      examInCategoriesWhere(examCategoryIds),
      { status: true, isPaid: false, type: "subject" as const, startAt: { lte: endOfDay } },
    ],
  };
  if (opts.search) baseWhere.AND.push({ name: { contains: opts.search } });

  const { year, month, week } = opts;

  // ── Level 1: years ──
  if (year === undefined) {
    const rows = await prisma.exam.findMany({ where: baseWhere, select: { startAt: true } });
    const counts = new Map<number, number>();
    for (const r of rows) { if (!r.startAt) continue; const y = r.startAt.getFullYear(); counts.set(y, (counts.get(y) ?? 0) + 1); }
    const items = [...counts.entries()].sort((a, b) => b[0] - a[0]).map(([y, testsCount]) => ({ year: y, testsCount }));
    return { level: "years" as const, items };
  }

  // ── Level 2: months in a year ──
  if (month === undefined) {
    const yearStart = new Date(year, 0, 1, 0, 0, 0, 0);
    const yearEnd = new Date(year, 11, 31, 23, 59, 59, 999);
    const upper = yearEnd < endOfDay ? yearEnd : endOfDay;
    const rows = await prisma.exam.findMany({ where: { ...baseWhere, startAt: { gte: yearStart, lte: upper } }, select: { startAt: true } });
    const counts = new Map<number, number>();
    for (const r of rows) { if (!r.startAt) continue; const m = r.startAt.getMonth() + 1; counts.set(m, (counts.get(m) ?? 0) + 1); }
    const { MONTH_LABELS } = await import("../../utils/dateBuckets");
    const items = [...counts.entries()].sort((a, b) => a[0] - b[0]).map(([m, testsCount]) => ({ year, month: m, label: MONTH_LABELS[m - 1], testsCount }));
    return { level: "months" as const, year, items };
  }

  // ── Level 3: weeks in a month ──
  if (week === undefined) {
    const monthStart = new Date(year, month - 1, 1, 0, 0, 0, 0);
    const monthEnd = new Date(year, month, 0, 23, 59, 59, 999);
    const upper = monthEnd < endOfDay ? monthEnd : endOfDay;
    const rows = await prisma.exam.findMany({ where: { ...baseWhere, startAt: { gte: monthStart, lte: upper } }, select: { startAt: true } });
    const { weekOfMonth, weekRange } = await import("../../utils/dateBuckets");
    const counts = new Map<number, number>();
    for (const r of rows) { if (!r.startAt) continue; const w = weekOfMonth(new Date(r.startAt).getDate()); counts.set(w, (counts.get(w) ?? 0) + 1); }
    const items = [...counts.entries()].sort((a, b) => a[0] - b[0]).map(([w, testsCount]) => {
      const { start, end } = weekRange(year, month, w);
      return { week: w, label: `Week ${w}`, startDate: start, endDate: end, testsCount };
    });
    return { level: "weeks" as const, year, month, items };
  }

  // ── Level 4: tests in a week (paginated) ──
  const { weekRange } = await import("../../utils/dateBuckets");
  const { start: weekStart, end: weekEnd } = weekRange(year, month, week);
  const upper = weekEnd < endOfDay ? weekEnd : endOfDay;
  const where = { ...baseWhere, startAt: { gte: weekStart, lte: upper } };

  const [exams, total] = await Promise.all([
    prisma.exam.findMany({
      where,
      orderBy: [{ order_by: "asc" }, { startAt: "desc" }],
      skip: opts.skip, take: opts.limit,
      include: { ExamCategory: { select: { id: true, name: true, image: true } } },
    }),
    prisma.exam.count({ where }),
  ]);

  // Per-customer attempt stats (status=true valid results), scoped to this page.
  const statsByExam = new Map<number, { attemptsCount: number; bestScore: number; lastResult: any }>();
  if (opts.customerId && exams.length) {
    const examIds = exams.map((e) => e.id);
    const results = await prisma.examResult.findMany({
      where: { customerId: opts.customerId, examId: { in: examIds }, status: true },
      orderBy: [{ created_at: "desc" }, { attempt: "desc" }],
      select: { id: true, examId: true, attempt: true, score: true, timing: true, created_at: true },
    });
    for (const r of results) {
      if (r.examId == null) continue;
      const prev = statsByExam.get(r.examId);
      const score = Number(r.score) || 0;
      if (!prev) {
        statsByExam.set(r.examId, {
          attemptsCount: 1, bestScore: score,
          lastResult: { _id: String(r.id), attemptNumber: r.attempt, score, timing: r.timing, submittedAt: r.created_at },
        });
      } else {
        prev.attemptsCount += 1;
        if (score > prev.bestScore) prev.bestScore = score;
        // results already ordered created_at desc → first seen is latest; keep it.
      }
    }
  }

  const items = exams.map((e) => {
    const s = statsByExam.get(e.id);
    return {
      _id: String(e.id),
      title: e.name,
      description: e.description ?? null,
      type: e.type,
      isPaid: e.isPaid,
      time: e.time,
      questions: e.numberOfQuestions,
      positiveMarks: Number(e.positiveMarks),
      negativeMarks: Number(e.negativeMarks),
      startAt: e.startAt,
      endAt: e.endAt,
      status: e.status,
      orderBy: e.order_by,
      createdAt: e.createAt ?? null,
      categoryId: e.ExamCategory ? { _id: String(e.ExamCategory.id), title: e.ExamCategory.name, image: e.ExamCategory.image } : null,
      attemptsCount: s?.attemptsCount ?? 0,
      bestScore: s?.bestScore ?? 0,
      isAttempted: (s?.attemptsCount ?? 0) > 0,
      lastResult: s?.lastResult ?? null,
    };
  });

  return {
    level: "tests" as const, year, month, week, items,
    pagination: { total, page: opts.page, limit: opts.limit, totalPages: Math.ceil(total / opts.limit) },
  };
};

const emptyTestsLevel = (opts: { year?: number; month?: number; week?: number; page: number; limit: number }) => {
  const { year, month, week } = opts;
  if (year === undefined) return { level: "years" as const, items: [] as any[] };
  if (month === undefined) return { level: "months" as const, year, items: [] as any[] };
  if (week === undefined) return { level: "weeks" as const, year, month, items: [] as any[] };
  return { level: "tests" as const, year, month, week, items: [] as any[], pagination: { total: 0, page: opts.page, limit: opts.limit, totalPages: 0 } };
};

// ── FREE-MATERIALS ─────────────────────────────────────────────────────────────
// Recursive tree TOP-grouped by product; only FREE (isPaid=false) materials.
// LiveCourse omitted (no SQL material-category pivot — documented drift).
export const freeMaterials = async (opts: { customerId: number | null; search: string | null; page: number; limit: number; skip: number }) => {
  const [courses, packages, matCourseRefs, matPkgRefs] = await Promise.all([
    prisma.course.findMany({ where: { status: true }, select: { id: true, name: true, image: true } }),
    prisma.package.findMany({ where: { active: true }, select: { id: true, name: true, image: true } }),
    prisma.materialCategoryCourse.findMany({ orderBy: { order: "asc" }, select: { courseId: true, materialCategoryId: true } }),
    prisma.materialCategoryPackage.findMany({ orderBy: { order: "asc" }, select: { packageId: true, materialCategoryId: true } }),
  ]);

  type ProductType = "course" | "package";
  const products: { _id: number; name: string; image: string | null; type: ProductType; rootIds: number[] }[] = [];
  const rootsByCourse = new Map<number, number[]>();
  const rootsByPkg = new Map<number, number[]>();
  for (const r of matCourseRefs) if (r.courseId != null && r.materialCategoryId != null) (rootsByCourse.get(r.courseId) ?? rootsByCourse.set(r.courseId, []).get(r.courseId)!).push(r.materialCategoryId);
  for (const r of matPkgRefs) if (r.packageId != null && r.materialCategoryId != null) (rootsByPkg.get(r.packageId) ?? rootsByPkg.set(r.packageId, []).get(r.packageId)!).push(r.materialCategoryId);
  for (const c of courses) products.push({ _id: c.id, name: c.name ?? "", image: c.image ?? null, type: "course", rootIds: rootsByCourse.get(c.id) ?? [] });
  for (const p of packages) products.push({ _id: p.id, name: p.name, image: p.image ?? null, type: "package", rootIds: rootsByPkg.get(p.id) ?? [] });

  const allRootIds = [...new Set(products.flatMap((p) => p.rootIds))];
  if (!allRootIds.length) return { data: [] as any[], total: 0 };

  // Expand each root → full subtree; build catById + childrenOf.
  const allIds = await descendantIds("ws_material_category", "parent", allRootIds);
  const cats = await prisma.materialCategory.findMany({ where: { id: { in: allIds }, status: true }, orderBy: [{ order_by: "asc" }, { name: "asc" }], select: { id: true, name: true, image: true, parent: true } });
  const catById = new Map<number, any>();
  const childrenOf = new Map<number, number[]>();
  for (const c of cats) {
    catById.set(c.id, { _id: c.id, title: c.name, image: c.image });
    if (c.parent != null) (childrenOf.get(c.parent) ?? childrenOf.set(c.parent, []).get(c.parent)!).push(c.id);
  }

  // Free materials across the whole set, grouped by category.
  const catIds = [...catById.keys()];
  const materials = catIds.length
    ? await prisma.material.findMany({
        where: { materialCategoryId: { in: catIds }, status: true, isPaid: false },
        orderBy: [{ order_by: "asc" }, { created_at: "desc" }],
      })
    : [];

  const base = resolveSpacesBase();
  const materialsByCat = new Map<number, any[]>();
  for (const m of materials) {
    if (m.materialCategoryId == null) continue;
    (materialsByCat.get(m.materialCategoryId) ?? materialsByCat.set(m.materialCategoryId, []).get(m.materialCategoryId)!).push(shapeMaterial(m, base));
  }

  const buildNode = (catId: number): any | null => {
    const cat = catById.get(catId);
    if (!cat) return null;
    const ownMaterials = materialsByCat.get(catId) ?? [];
    const children = (childrenOf.get(catId) ?? []).map((cid) => buildNode(cid)).filter(Boolean) as any[];
    if (!ownMaterials.length && !children.length) return null;
    const materialCount = ownMaterials.length + children.reduce((n, c) => n + c.materialCount, 0);
    return { _id: String(cat._id), title: cat.title, image: cat.image, materialCount, materials: ownMaterials, children };
  };

  let groups = products.map((p) => {
    const categories = p.rootIds.map((rid) => buildNode(rid)).filter(Boolean) as any[];
    if (!categories.length) return null;
    return { _id: String(p._id), title: p.name, image: p.image, type: p.type, materialCount: categories.reduce((n, c) => n + c.materialCount, 0), categories };
  }).filter(Boolean) as any[];

  if (opts.search) { const s = opts.search.toLowerCase(); groups = groups.filter((g) => (g.title ?? "").toLowerCase().includes(s)); }

  const total = groups.length;
  const data = groups.slice(opts.skip, opts.skip + opts.limit);
  return { data, total };
};

// ── FREE-VIDEOS ─────────────────────────────────────────────────────────────
// Recursive tree TOP-grouped by product; only FREE (priceType="free") videos.
export const freeVideos = async (opts: { search: string | null; page: number; limit: number; skip: number }) => {
  const [courses, liveCourses, packages, pkgRels] = await Promise.all([
    prisma.course.findMany({ where: { status: true }, select: { id: true, name: true, image: true, videoCategoryId: true } }),
    prisma.liveCourse.findMany({ where: { status: true }, select: { id: true, name: true, image: true, videoCategoryId: true } }),
    prisma.package.findMany({ where: { active: true }, select: { id: true, name: true, image: true } }),
    prisma.packageVideoCategoryRelation.findMany({ where: { status: true }, select: { packageId: true, videoCategoryRelationId: true } }),
  ]);

  type ProductType = "course" | "package" | "live-course";
  const products: { _id: number; name: string; image: string | null; type: ProductType; rootIds: number[] }[] = [];
  for (const c of courses) products.push({ _id: c.id, name: c.name ?? "", image: c.image ?? null, type: "course", rootIds: c.videoCategoryId ? [c.videoCategoryId] : [] });
  for (const lc of liveCourses) products.push({ _id: lc.id, name: lc.name, image: lc.image ?? null, type: "live-course", rootIds: lc.videoCategoryId ? [lc.videoCategoryId] : [] });

  // Packages reach video roots through their relations (parent + child).
  const rootIdsByPkg = new Map<number, Set<number>>();
  if (pkgRels.length) {
    const relIds = [...new Set(pkgRels.map((r) => r.videoCategoryRelationId))];
    const rels = await prisma.videoCategoryRelation.findMany({ where: { id: { in: relIds } }, select: { id: true, parent: true, child: true } });
    const relById = new Map(rels.map((r) => [r.id, r]));
    for (const pr of pkgRels) {
      const rel = relById.get(pr.videoCategoryRelationId);
      if (!rel) continue;
      const set = rootIdsByPkg.get(pr.packageId) ?? rootIdsByPkg.set(pr.packageId, new Set()).get(pr.packageId)!;
      if (rel.parent) set.add(rel.parent);
      if (rel.child) set.add(rel.child);
    }
  }
  for (const p of packages) products.push({ _id: p.id, name: p.name, image: p.image ?? null, type: "package", rootIds: [...(rootIdsByPkg.get(p.id) ?? [])] });

  const allRootIds = [...new Set(products.flatMap((p) => p.rootIds))];
  if (!allRootIds.length) return { data: [] as any[], total: 0 };

  // Expand every root to its subtree via the DAG; build catById + childrenOf
  // from ws_video_category_relation edges (restricted to the reachable set).
  const allIds = await descendantsOf(allRootIds);
  const [cats, edges] = await Promise.all([
    prisma.videoCategory.findMany({ where: { id: { in: allIds }, status: true }, orderBy: [{ order_by: "asc" }, { title: "asc" }], select: { id: true, title: true, image: true } }),
    prisma.videoCategoryRelation.findMany({ where: { parent: { in: allIds }, child: { in: allIds } }, orderBy: { order: "asc" }, select: { parent: true, child: true } }),
  ]);
  const catById = new Map<number, any>();
  for (const c of cats) catById.set(c.id, { _id: c.id, title: c.title, image: c.image });
  const childrenOf = new Map<number, number[]>();
  for (const e of edges) (childrenOf.get(e.parent) ?? childrenOf.set(e.parent, []).get(e.parent)!).push(e.child);

  // Free videos across the whole set, grouped by category.
  const catIds = [...catById.keys()];
  const videos = catIds.length
    ? await prisma.video.findMany({ where: { videoCategoryId: { in: catIds }, status: true, priceType: "free" as any }, orderBy: [{ order: "asc" }, { created_at: "desc" }] })
    : [];
  const videosByCat = new Map<number, any[]>();
  for (const v of videos) {
    if (v.videoCategoryId == null) continue;
    (videosByCat.get(v.videoCategoryId) ?? videosByCat.set(v.videoCategoryId, []).get(v.videoCategoryId)!).push(shapeVideo(v));
  }

  // Cycle-safe recursive node build (DAG may contain shared/multi-parent nodes).
  const buildNode = (catId: number, seen: Set<number>): any | null => {
    const cat = catById.get(catId);
    if (!cat || seen.has(catId)) return null;
    const next = new Set(seen); next.add(catId);
    const ownVideos = videosByCat.get(catId) ?? [];
    const children = (childrenOf.get(catId) ?? []).map((cid) => buildNode(cid, next)).filter(Boolean) as any[];
    if (!ownVideos.length && !children.length) return null;
    const videoCount = ownVideos.length + children.reduce((n, c) => n + c.videoCount, 0);
    return { _id: String(cat._id), title: cat.title, image: cat.image, videoCount, videos: ownVideos, children };
  };

  let groups = products.map((p) => {
    const categories = p.rootIds.map((rid) => buildNode(rid, new Set())).filter(Boolean) as any[];
    if (!categories.length) return null;
    return { _id: String(p._id), title: p.name, image: p.image, type: p.type, videoCount: categories.reduce((n, c) => n + c.videoCount, 0), categories };
  }).filter(Boolean) as any[];

  if (opts.search) { const s = opts.search.toLowerCase(); groups = groups.filter((g) => (g.title ?? "").toLowerCase().includes(s)); }

  const total = groups.length;
  const data = groups.slice(opts.skip, opts.skip + opts.limit);
  return { data, total };
};

// ── FREE-EBOOKS ─────────────────────────────────────────────────────────────
// ws_ebook has no isPaid col → free = min active plan price == 0. Response shape
// mirrors /client/ebooks: plans / details / isPurchased / daysLeft / isNew /
// shareableLink.
export const freeEbooks = async (opts: { customerId: number | null; search: string | null; language: string | null; page: number; limit: number; skip: number; shareBase: string }) => {
  const where: any = { active: true };
  if (opts.search) where.OR = [{ name: { contains: opts.search } }, { author: { contains: opts.search } }];
  if (opts.language) where.language = opts.language as any;

  // Free is price-derived, so we can't paginate at the DB. Load active ebooks,
  // filter by min-plan-price==0, then paginate in memory.
  const allEbooks = await prisma.eBook.findMany({ where, orderBy: [{ orderby: "asc" }, { createdAt: "desc" }] });
  const allIds = allEbooks.map((e) => e.id);
  const allPlans = allIds.length ? await prisma.packageCourseEbookPrice.findMany({ where: { ebookId: { in: allIds }, status: true }, orderBy: { duration: "asc" } }) : [];
  const plansByEbook = new Map<number, any[]>();
  for (const p of allPlans) { if (p.ebookId == null) continue; (plansByEbook.get(p.ebookId) ?? plansByEbook.set(p.ebookId, []).get(p.ebookId)!).push(p); }

  const freeEbooks = allEbooks.filter((e) => {
    const ep = plansByEbook.get(e.id) ?? [];
    const min = ep.length ? Math.min(...ep.map((p) => Number(p.price) || 0)) : 0;
    return min === 0;
  });

  const total = freeEbooks.length;
  const pageEbooks = freeEbooks.slice(opts.skip, opts.skip + opts.limit);
  const pageIds = pageEbooks.map((e) => e.id);

  const now = new Date();
  const subEndByEbook = new Map<number, Date>();
  if (opts.customerId && pageIds.length) {
    const subs = await prisma.eBookSubscription.findMany({ where: { customerId: opts.customerId, ebookId: { in: pageIds }, status: true, endAt: { gt: now } }, select: { ebookId: true, endAt: true } });
    for (const s of subs) { if (s.ebookId == null || s.endAt == null) continue; const prev = subEndByEbook.get(s.ebookId); if (!prev || s.endAt > prev) subEndByEbook.set(s.ebookId, s.endAt); }
  }

  const { buildShareUrl } = await import("../../deeplinking/shareRedirect");
  const data = pageEbooks.map((e: any) => {
    const endAt = subEndByEbook.get(e.id) ?? null;
    return {
      ...e, _id: String(e.id),
      plans: plansByEbook.get(e.id) ?? [],
      details: [
        { id: 1, mainText: "Language", subText: e.language },
        { id: 2, mainText: "Author", subText: e.author },
        { id: 3, mainText: "Publisher", subText: e.publisher },
      ],
      isPaid: false,
      isPurchased: !!endAt,
      isNew: isNewItem(e.createdAt, now),
      subscriptionEndAt: endAt,
      daysLeft: endAt ? daysBetween(now, endAt) : null,
      shareableLink: buildShareUrl("ebooks", String(e.id), opts.shareBase),
    };
  });

  return { data, total };
};

// ── FREE-COURSES ─────────────────────────────────────────────────────────────
// Combined Courses + Packages; free by default (?type=paid for paid). Course
// free = purchase="no". Package has no isPaid col → free-package set empty (so
// the free listing returns courses only); paid listing returns all packages.
export const freeCourses = async (opts: { customerId: number | null; search: string | null; wantPaid: boolean; page: number; limit: number; skip: number; shareBase: string }) => {
  const courseWhere: any = { status: true, purchase: opts.wantPaid ? ("yes" as any) : ("no" as any) };
  // Package: no isPaid col. Free request → no packages; paid request → all active.
  const packageWhere: any | null = opts.wantPaid ? { active: true } : null;
  if (opts.search) { courseWhere.name = { contains: opts.search }; if (packageWhere) packageWhere.name = { contains: opts.search }; }

  const [courses, packages] = await Promise.all([
    prisma.course.findMany({
      where: courseWhere,
      orderBy: [{ ordered: "asc" }, { createdAt: "desc" }],
      include: {
        educator: { select: { id: true, name: true } },
        subject: { select: { id: true, title: true } },
        VideoCategory: { select: { id: true, title: true } },
      },
    }),
    packageWhere
      ? prisma.package.findMany({ where: packageWhere, orderBy: [{ order_by: "asc" }, { created_at: "desc" }], include: { packageType: { select: { id: true, name: true } } } })
      : Promise.resolve([] as any[]),
  ]);

  const [enrichedCourses, enrichedPackages] = await Promise.all([
    enrichCourses(courses, opts.customerId, opts.shareBase),
    enrichPackages(packages, opts.customerId, opts.shareBase),
  ]);

  const merged = [...enrichedCourses, ...enrichedPackages].sort(
    (a, b) => new Date(b.createdAt ?? b.created_at ?? 0).getTime() - new Date(a.createdAt ?? a.created_at ?? 0).getTime()
  );
  const total = merged.length;
  const data = merged.slice(opts.skip, opts.skip + opts.limit);
  return { data, total };
};

// ── enrich helpers (mirror enrichCoursesForList / enrichPackagesForList) ────────
const enrichCourses = async (courses: any[], customerId: number | null, baseUrl: string) => {
  const courseIds = courses.map((c) => c.id);
  const now = new Date();
  const plans = courseIds.length
    ? await prisma.packageCourseEbookPrice.findMany({ where: { courseId: { in: courseIds }, status: true }, orderBy: { duration: "asc" } })
    : [];
  const plansByCourse = new Map<number, { withMaterial: any[]; withoutMaterial: any[] }>();
  for (const p of plans) { if (p.courseId == null) continue; const b = plansByCourse.get(p.courseId) ?? plansByCourse.set(p.courseId, { withMaterial: [], withoutMaterial: [] }).get(p.courseId)!; (p.withMaterial ? b.withMaterial : b.withoutMaterial).push(p); }

  const { courseDaysLeft } = await resolveOwnedEndAt(customerId, courseIds, []);
  const { buildShareUrl } = await import("../../deeplinking/shareRedirect");
  return courses.map((c) => ({
    kind: "course" as const,
    ...c, _id: String(c.id),
    isPaid: c.purchase != null ? c.purchase !== "no" : true,
    isPurchased: courseDaysLeft.has(c.id),
    daysLeft: courseDaysLeft.get(c.id) ?? null,
    plans: plansByCourse.get(c.id) ?? { withMaterial: [], withoutMaterial: [] },
    shareableLink: buildShareUrl("courses", String(c.id), baseUrl),
  }));
};

const enrichPackages = async (packages: any[], customerId: number | null, baseUrl: string) => {
  if (!packages.length) return [];
  const packageIds = packages.map((p) => p.id);
  const { packageDaysLeft } = await resolveOwnedEndAt(customerId, [], packageIds);
  const { buildShareUrl } = await import("../../deeplinking/shareRedirect");
  return Promise.all(packages.map(async (p) => {
    const [plans, subCount] = await Promise.all([
      prisma.packageCourseEbookPrice.findMany({ where: { packageId: p.id, status: true }, orderBy: { duration: "asc" } }),
      prisma.packageCourseSubscription.count({ where: { packageId: p.id, status: true } }),
    ]);
    return {
      kind: "package" as const,
      ...p, _id: String(p.id),
      isPaid: true,
      plans: { withMaterial: plans.filter((pl) => pl.withMaterial), withoutMaterial: plans.filter((pl) => !pl.withMaterial) },
      subscriberCount: subCount,
      isPurchased: packageDaysLeft.has(p.id),
      daysLeft: packageDaysLeft.get(p.id) ?? null,
    };
  }));
};

/** Per-customer active endAt (days left) for course/package ids (longest wins; null=lifetime). */
const resolveOwnedEndAt = async (customerId: number | null, courseIds: number[], packageIds: number[]) => {
  const courseDaysLeft = new Map<number, number | null>();
  const packageDaysLeft = new Map<number, number | null>();
  if (!customerId || (!courseIds.length && !packageIds.length)) return { courseDaysLeft, packageDaysLeft };
  const now = new Date();

  // plan-id → owning course / package (a sub can point at a plan rather than the entity).
  const [coursePlans, packagePlans] = await Promise.all([
    courseIds.length ? prisma.packageCourseEbookPrice.findMany({ where: { courseId: { in: courseIds } }, select: { id: true, courseId: true } }) : [],
    packageIds.length ? prisma.packageCourseEbookPrice.findMany({ where: { packageId: { in: packageIds } }, select: { id: true, packageId: true } }) : [],
  ]);
  const planToCourse = new Map<number, number>();
  for (const p of coursePlans) if (p.courseId != null) planToCourse.set(p.id, p.courseId);
  const planToPackage = new Map<number, number>();
  for (const p of packagePlans) if (p.packageId != null) planToPackage.set(p.id, p.packageId);
  const planIds = [...planToCourse.keys(), ...planToPackage.keys()];

  const subs = await prisma.packageCourseSubscription.findMany({
    where: {
      customerId, status: true,
      AND: [
        { OR: [{ endAt: null }, { endAt: { gt: now } }] },
        { OR: [
          ...(courseIds.length ? [{ courseId: { in: courseIds } }] : []),
          ...(packageIds.length ? [{ packageId: { in: packageIds } }] : []),
          ...(planIds.length ? [{ planId: { in: planIds } }] : []),
        ] },
      ],
    },
    select: { courseId: true, packageId: true, planId: true, endAt: true },
  });

  const upsert = (map: Map<number, number | null>, key: number | null, endAt: Date | null) => {
    if (key == null) return;
    const dl = endAt == null ? null : computeDaysLeft(endAt, now);
    if (!map.has(key)) { map.set(key, dl); return; }
    const prev = map.get(key)!;
    if (prev === null || dl === null) { map.set(key, null); return; } // lifetime wins
    if (dl > prev) map.set(key, dl);
  };
  for (const s of subs) {
    const e = s.endAt ?? null;
    if (s.courseId != null) upsert(courseDaysLeft, s.courseId, e);
    if (s.packageId != null) upsert(packageDaysLeft, s.packageId, e);
    if (s.planId != null) {
      const viaCourse = planToCourse.get(s.planId); if (viaCourse != null) upsert(courseDaysLeft, viaCourse, e);
      const viaPkg = planToPackage.get(s.planId); if (viaPkg != null) upsert(packageDaysLeft, viaPkg, e);
    }
  }
  return { courseDaysLeft, packageDaysLeft };
};

// ── shaping helpers ────────────────────────────────────────────────────────────
const daysBetween = (from: Date, to: Date) => Math.max(0, Math.ceil((to.getTime() - from.getTime()) / 86_400_000));

const resolveSpacesBase = (): string => (process.env.SPACES_PUBLIC_BASE || process.env.SPACES_CDN_URL || process.env.ORIGIN || "").replace(/\/$/, "");

// Client material shape (mirrors shapeMaterialForClient: free-only listing so
// isLocked is always false). file/directLink resolved to absolute when relative.
const shapeMaterial = (m: any, base: string) => {
  const resolve = (u: string | null): string | null => {
    if (!u) return null;
    return /^https?:\/\//i.test(u) ? u : `${base}/${String(u).replace(/^\//, "")}`;
  };
  return {
    _id: String(m.id),
    title: m.name,
    description: m.description ?? null,
    thumbnail: m.thumbnail ?? null,
    file: resolve(m.file) ?? "",
    directLink: m.direct_link ?? "",
    fileSize: m.fileSize != null ? Number(m.fileSize) : null,
    language: m.language ?? null,
    isPreview: m.isPreview,
    isPaid: false,        // free-only listing
    isPurchased: true,    // free material is always accessible
    materialCategoryId: m.materialCategoryId != null ? String(m.materialCategoryId) : null,
    order: m.order_by,
    createdAt: m.created_at ?? null,
  };
};

const shapeVideo = (v: any) => ({
  _id: String(v.id),
  title: v.title,
  topic: v.topic,
  platform: v.platform,
  priceType: v.priceType,
  vimeo_id: v.vimeo_id ?? null,
  aws_id: v.aws_id ?? null,
  youtube_id: v.youtube_id ?? null,
  slug: v.slug,
  order: v.order,
  status: v.status,
  videoCategoryId: v.videoCategoryId != null ? String(v.videoCategoryId) : null,
  createdAt: v.created_at ?? null,
});
