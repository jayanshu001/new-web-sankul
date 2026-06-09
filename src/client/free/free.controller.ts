import { Request, Response } from "express";
import { Types } from "mongoose";
import { MONTH_LABELS, weekOfMonth, weekRange } from "../../utils/dateBuckets";
import { Package } from "../../models/course/Package.model";
import { Course } from "../../models/course/Course.model";
import { PackageVideoCategoryRelation } from "../../models/course/PackageVideoCategoryRelation.model";
import { VideoCategoryRelation } from "../../models/course/VideoCategoryRelation.model";
import { PackageCourseEbookPrice } from "../../models/course/PackageCourseEbookPrice.model";
import { PackageCourseSubscription } from "../../models/customer/PackageCourseSubscription.model";
import { Exam } from "../../models/exam/Exam.model";
import { ExamStatus } from "../../models/enums";
import { Material } from "../../models/course/Material.model";
import { MaterialCategory } from "../../models/course/MaterialCategory.model";
import { LiveCourse } from "../../models/course/LiveCourse.model";
import { VideoCategory } from "../../models/course/VideoCategory.model";
import { collectCategoryTreeIds } from "../../utils/categoryTree";
import { Video } from "../../models/course/Video.model";
import { Ebook } from "../../models/ebook/Ebook.model";
import { EbookPrice } from "../../models/ebook/EbookPrice.model";
import { EbookSubscription } from "../../models/ebook/EbookSubscription.model";
import logger from "../../utils/logger";
import { getErrorMessage } from "../../utils/httpResponse";
import { computeDaysLeft } from "../../utils/planDuration";
import { buildShareUrl } from "../../deeplinking/shareRedirect";
import { isNewItem } from "../../utils/isNew";

const resolveBase = (req: Request) =>
  process.env.ORIGIN || `${req.protocol}://${req.get("host")}`;

// Resolve category ids reachable through any free package OR free course.
export async function resolveFreeCategoryIds() {
  const [freePackages, freeCourses] = await Promise.all([
    Package.find({ active: true, isPaid: false })
      .select("_id materialCategories examCategories specificSubjects")
      .lean(),
    Course.find({ status: true, isPaid: false })
      .select("_id materialCategories examCategories videoCategoryId")
      .lean(),
  ]);

  const materialCategoryIds = new Set<string>();
  const examCategoryIds = new Set<string>();
  const videoCategoryIds = new Set<string>();

  for (const p of freePackages as any[]) {
    for (const ref of p.materialCategories ?? []) {
      if (ref.status !== false && ref.category) materialCategoryIds.add(String(ref.category));
    }
    for (const ref of p.examCategories ?? []) {
      if (ref.status !== false && ref.category) examCategoryIds.add(String(ref.category));
    }
  }

  for (const c of freeCourses as any[]) {
    for (const ref of c.materialCategories ?? []) {
      if (ref.category) materialCategoryIds.add(String(ref.category));
    }
    for (const ref of c.examCategories ?? []) {
      if (ref.category) examCategoryIds.add(String(ref.category));
    }
    if (c.videoCategoryId) videoCategoryIds.add(String(c.videoCategoryId));
  }

  // Videos can also be reached via PackageVideoCategoryRelation → VideoCategoryRelation
  if (freePackages.length) {
    const pkgIds = freePackages.map((p: any) => p._id);
    const relations = await PackageVideoCategoryRelation.find({
      packageId: { $in: pkgIds },
      active: true,
    })
      .select("videoCategoryRelationId")
      .lean();

    if (relations.length) {
      const relIds = relations.map((r: any) => r.videoCategoryRelationId);
      const vcRelations = await VideoCategoryRelation.find({ _id: { $in: relIds } })
        .select("parent child")
        .lean();
      for (const r of vcRelations as any[]) {
        if (r.parent) videoCategoryIds.add(String(r.parent));
        if (r.child) videoCategoryIds.add(String(r.child));
      }
    }
  }

  return {
    materialCategoryIds: Array.from(materialCategoryIds).map((id) => new Types.ObjectId(id)),
    examCategoryIds: Array.from(examCategoryIds).map((id) => new Types.ObjectId(id)),
    videoCategoryIds: Array.from(videoCategoryIds).map((id) => new Types.ObjectId(id)),
  };
}

// Resolve category ids that are ASSIGNED to ANY parent — course, package OR
// live-course — regardless of whether that parent is paid or free. This is the
// "assignment gate" for the free listings: a material/video/test only surfaces
// when its category is attached to some product (an unassigned/orphan category
// is never shown). The item's own free flag (isPaid:false / priceType:"free")
// is a SEPARATE gate applied by each endpoint. Video-category roots are
// expanded to their full subtree, since videos attach to leaf folders while
// parents assign the root folder.
export async function resolveAssignedCategoryIds() {
  const [packages, courses, liveCourses] = await Promise.all([
    Package.find({ active: true })
      .select("_id materialCategories examCategories specificSubjects")
      .lean(),
    Course.find({ status: true })
      .select("_id materialCategories examCategories videoCategoryId")
      .lean(),
    LiveCourse.find({ status: true })
      .select("_id materialCategories examCategories videoCategoryId")
      .lean(),
  ]);

  const materialCategoryIds = new Set<string>();
  const examCategoryIds = new Set<string>();
  const videoRootIds = new Set<string>();

  const indexRefs = (refs: any[] | undefined, target: Set<string>) => {
    for (const ref of refs ?? []) {
      if (ref?.status !== false && ref?.category) target.add(String(ref.category));
    }
  };

  for (const p of packages as any[]) {
    indexRefs(p.materialCategories, materialCategoryIds);
    indexRefs(p.examCategories, examCategoryIds);
  }
  for (const c of [...(courses as any[]), ...(liveCourses as any[])]) {
    indexRefs(c.materialCategories, materialCategoryIds);
    indexRefs(c.examCategories, examCategoryIds);
    if (c.videoCategoryId) videoRootIds.add(String(c.videoCategoryId));
  }

  // Videos reachable through a package's video-category relations.
  const pkgIds = (packages as any[]).map((p) => p._id);
  if (pkgIds.length) {
    const relations = await PackageVideoCategoryRelation.find({
      packageId: { $in: pkgIds },
      active: true,
    })
      .select("videoCategoryRelationId")
      .lean();
    if (relations.length) {
      const relIds = relations.map((r: any) => r.videoCategoryRelationId);
      const vcRelations = await VideoCategoryRelation.find({ _id: { $in: relIds } })
        .select("parent child")
        .lean();
      for (const r of vcRelations as any[]) {
        if (r.parent) videoRootIds.add(String(r.parent));
        if (r.child) videoRootIds.add(String(r.child));
      }
    }
  }

  // Expand each assigned video root to its full subtree (videos live on leaves).
  const videoCategoryIdSet = new Set<string>();
  if (videoRootIds.size) {
    const roots = await VideoCategory.find({
      _id: { $in: [...videoRootIds].map((id) => new Types.ObjectId(id)) },
    })
      .select("_id childCategoryIds")
      .lean();
    for (const root of roots as any[]) {
      const ids = await collectCategoryTreeIds(VideoCategory as any, root);
      for (const id of ids) videoCategoryIdSet.add(String(id));
    }
  }

  return {
    materialCategoryIds: Array.from(materialCategoryIds).map((id) => new Types.ObjectId(id)),
    examCategoryIds: Array.from(examCategoryIds).map((id) => new Types.ObjectId(id)),
    videoCategoryIds: Array.from(videoCategoryIdSet).map((id) => new Types.ObjectId(id)),
  };
}

function paginate(req: Request) {
  const { page = "1", limit = "20" } = req.query as Record<string, string>;
  const pageNum = Math.max(parseInt(page, 10) || 1, 1);
  const limitNum = Math.max(parseInt(limit, 10) || 20, 1);
  return { pageNum, limitNum, skip: (pageNum - 1) * limitNum };
}

// GET /api/v1/client/free-tests
// Year → month → week drill-down, mirroring client/quizzes/daily but bucketed
// on `createdAt` (free tests have no scheduled `startAt`). All params optional
// and applied progressively:
//   no params         -> years   [{ year, testsCount }]
//   ?year=YYYY         -> months  [{ year, month, label, testsCount }]
//   ?year&month        -> weeks   [{ week, label, startDate, endDate, testsCount }]
//   ?year&month&week   -> tests   (paginated list, original item shape)
// `search` (title regex) is honoured at every level so counts match the list.
export const listFreeTests = async (req: Request, res: Response) => {
  const traceId = req.traceId;
  logger.info("listFreeTests invoked", { traceId, path: req.originalUrl, userId: req.user?.id, query: req.query });

  try {
    const { search } = req.query as Record<string, string>;

    const yearQ = req.query.year ? Number(req.query.year) : undefined;
    const monthQ = req.query.month ? Number(req.query.month) : undefined;
    const weekQ = req.query.week ? Number(req.query.week) : undefined;

    // ── Validation (same rules as quizzes/daily) ──
    if (yearQ !== undefined && (!Number.isInteger(yearQ) || yearQ < 1970 || yearQ > 9999)) {
      return res.status(400).json({ success: false, message: "Invalid year." });
    }
    if (monthQ !== undefined && (!Number.isInteger(monthQ) || monthQ < 1 || monthQ > 12)) {
      return res.status(400).json({ success: false, message: "Invalid month (1-12)." });
    }
    if (weekQ !== undefined && (!Number.isInteger(weekQ) || weekQ < 1 || weekQ > 5)) {
      return res.status(400).json({ success: false, message: "Invalid week (1-5)." });
    }
    if (monthQ !== undefined && yearQ === undefined) {
      return res.status(400).json({ success: false, message: "`month` requires `year`." });
    }
    if (weekQ !== undefined && (yearQ === undefined || monthQ === undefined)) {
      return res.status(400).json({ success: false, message: "`week` requires `year` and `month`." });
    }

    const { examCategoryIds } = await resolveAssignedCategoryIds();

    const now = new Date();
    const endOfDay = new Date(now);
    endOfDay.setHours(23, 59, 59, 999);

    // Two gates: (1) ASSIGNMENT — the exam's category must be assigned to some
    // course/package/live-course (paid or free); orphan/unassigned exams never
    // show. (2) FREE — the exam itself must be free (isPaid:false). A paid exam
    // inside an assigned category is hidden.
    const baseMatch: any = {
      status: ExamStatus.PUBLISHED,
      isPaid: false,
      categoryId: { $in: examCategoryIds },
    };
    if (search) baseMatch.title = { $regex: search, $options: "i" };

    // ── Level 1: years ──
    if (yearQ === undefined) {
      const rows = await Exam.aggregate([
        { $match: baseMatch },
        { $group: { _id: { $year: "$createdAt" }, testsCount: { $sum: 1 } } },
        { $sort: { _id: -1 } },
        { $project: { _id: 0, year: "$_id", testsCount: 1 } },
      ]);
      logger.info("listFreeTests success", { traceId, level: "years", count: rows.length });
      return res.status(200).json({ success: true, data: { level: "years", items: rows } });
    }

    // ── Level 2: months in a year ──
    if (monthQ === undefined) {
      const yearStart = new Date(yearQ, 0, 1, 0, 0, 0, 0);
      const yearEnd = new Date(yearQ, 11, 31, 23, 59, 59, 999);
      const upper = yearEnd < endOfDay ? yearEnd : endOfDay;
      const rows = await Exam.aggregate([
        { $match: { ...baseMatch, createdAt: { $gte: yearStart, $lte: upper } } },
        { $group: { _id: { $month: "$createdAt" }, testsCount: { $sum: 1 } } },
        { $sort: { _id: 1 } },
        { $project: { _id: 0, month: "$_id", testsCount: 1 } },
      ]);
      const items = rows.map((r: any) => ({
        year: yearQ,
        month: r.month,
        label: MONTH_LABELS[r.month - 1],
        testsCount: r.testsCount,
      }));
      logger.info("listFreeTests success", { traceId, level: "months", year: yearQ, count: items.length });
      return res.status(200).json({ success: true, data: { level: "months", year: yearQ, items } });
    }

    // ── Level 3: weeks in a month ──
    if (weekQ === undefined) {
      const monthStart = new Date(yearQ, monthQ - 1, 1, 0, 0, 0, 0);
      const monthEnd = new Date(yearQ, monthQ, 0, 23, 59, 59, 999);
      const upper = monthEnd < endOfDay ? monthEnd : endOfDay;
      const exams = await Exam.find({
        ...baseMatch,
        createdAt: { $gte: monthStart, $lte: upper },
      }).select("createdAt");

      const counts = new Map<number, number>();
      for (const e of exams) {
        if (!e.createdAt) continue;
        const w = weekOfMonth(new Date(e.createdAt as Date).getDate());
        counts.set(w, (counts.get(w) ?? 0) + 1);
      }
      const items = Array.from(counts.entries())
        .sort((a, b) => a[0] - b[0])
        .map(([week, testsCount]) => {
          const { start, end } = weekRange(yearQ, monthQ, week);
          return { week, label: `Week ${week}`, startDate: start, endDate: end, testsCount };
        });
      logger.info("listFreeTests success", { traceId, level: "weeks", year: yearQ, month: monthQ, count: items.length });
      return res.status(200).json({
        success: true,
        data: { level: "weeks", year: yearQ, month: monthQ, items },
      });
    }

    // ── Level 4: tests in a week (paginated, original item shape) ──
    const { start: weekStart, end: weekEnd } = weekRange(yearQ, monthQ, weekQ);
    const upper = weekEnd < endOfDay ? weekEnd : endOfDay;
    const { pageNum, limitNum, skip } = paginate(req);

    const filter = { ...baseMatch, createdAt: { $gte: weekStart, $lte: upper } };

    const [items, total] = await Promise.all([
      Exam.find(filter)
        .populate("categoryId", "_id title image")
        .sort({ orderBy: 1, createdAt: -1 })
        .skip(skip)
        .limit(limitNum)
        .lean(),
      Exam.countDocuments(filter),
    ]);

    logger.info("listFreeTests success", { traceId, level: "tests", year: yearQ, month: monthQ, week: weekQ, total });
    return res.status(200).json({
      success: true,
      data: { level: "tests", year: yearQ, month: monthQ, week: weekQ, items },
      pagination: { total, page: pageNum, limit: limitNum, totalPages: Math.ceil(total / limitNum) },
    });
  } catch (e: any) {
    logger.error("listFreeTests failed", { traceId, error: getErrorMessage(e), stack: e.stack });
    return res.status(500).json({ success: false, message: e.message });
  }
};

// GET /api/v1/client/free-materials
// Category cards GROUPED by their top-most ancestor. Every leaf category that
// has ≥1 free (isPaid:false) material is a `child`; that child is rolled up
// under its root ancestor (ancestors[0]) so the FE renders the whole tree
// architecture ("UPSC Preparations" → "Reasoning"/"Subject") rather than bare
// leaves. A free leaf with no ancestors IS its own top-level group (children:[]).
// Each child keeps `_id` (the leaf the FE drills into via
// /materials/categories/:id/contents), `lessonCount`, and the free
// course/package `parent`. `search` matches the GROUP (top) title; pagination
// is over the top-level group set.
export const listFreeMaterials = async (req: Request, res: Response) => {
  const traceId = req.traceId;
  logger.info("listFreeMaterials invoked", { traceId, path: req.originalUrl, userId: req.user?.id });

  try {
    const { search } = req.query as Record<string, string>;
    const { pageNum, limitNum, skip } = paginate(req);

    // 1) Two gates produce the candidate leaf categories:
    //   (a) ASSIGNMENT — the category must be assigned to some
    //       course/package/live-course (paid or free). Orphan/unassigned
    //       categories never show, even if they hold free materials.
    //   (b) FREE — the category must hold ≥1 free material (its own
    //       isPaid:false). The grouped count below is restricted to the
    //       assigned set so a category with only paid (or zero) free materials
    //       is excluded.
    const { materialCategoryIds: assignedMaterialCatIds } = await resolveAssignedCategoryIds();

    const grouped = assignedMaterialCatIds.length
      ? await Material.aggregate([
          {
            $match: {
              status: true,
              isPaid: false,
              materialCategoryId: { $in: assignedMaterialCatIds },
            },
          },
          { $group: { _id: "$materialCategoryId", lessonCount: { $sum: 1 } } },
        ])
      : [];
    const countByCategory = new Map<string, number>(
      grouped.map((g: any) => [String(g._id), g.lessonCount])
    );
    const candidateIds = grouped.map((g: any) => new Types.ObjectId(String(g._id)));

    if (!candidateIds.length) {
      return res.status(200).json({
        success: true,
        data: [],
        pagination: { total: 0, page: pageNum, limit: limitNum, totalPages: 0 },
      });
    }

    // 2) Resolve the active LEAF categories (with hierarchy fields) that hold
    // free materials. These become the children. No search filter here — search
    // applies to the top-level group title, resolved in step 5.
    const leafCategories = await MaterialCategory.find({
      _id: { $in: candidateIds },
      status: true,
    })
      .select("_id title image ancestors")
      .sort({ order: 1, title: 1 })
      .lean();

    if (!leafCategories.length) {
      return res.status(200).json({
        success: true,
        data: [],
        pagination: { total: 0, page: pageNum, limit: limitNum, totalPages: 0 },
      });
    }

    // 3) Map each leaf to the free course/package it belongs to (for the child
    // subtitle / routing). A category attached to several free parents resolves
    // to the first match; standalone free materials have parent: null.
    const [freePackages, freeCourses] = await Promise.all([
      Package.find({ active: true, isPaid: false }).select("_id name materialCategories").lean(),
      Course.find({ status: true, isPaid: false }).select("_id name materialCategories").lean(),
    ]);
    const parentByCategory = new Map<string, { _id: any; name: string; type: "course" | "package" }>();
    const indexParent = (p: any, type: "course" | "package") => {
      for (const ref of p.materialCategories ?? []) {
        if (!ref?.category) continue;
        const key = String(ref.category);
        if (!parentByCategory.has(key)) parentByCategory.set(key, { _id: p._id, name: p.name, type });
      }
    };
    for (const p of freePackages as any[]) indexParent(p, "package");
    for (const c of freeCourses as any[]) indexParent(c, "course");

    // 4) Determine each leaf's ROOT (top-most ancestor). ancestors[0] is the
    // root of the chain; a leaf with no ancestors is its own root. Collect the
    // distinct root ids that are NOT themselves free leaves so we can fetch
    // their title/image for the group header.
    const rootIdOf = (cat: any): string =>
      cat.ancestors?.length ? String(cat.ancestors[0]) : String(cat._id);

    const leafIdSet = new Set(leafCategories.map((c: any) => String(c._id)));
    const rootIdsToFetch = new Set<string>();
    for (const leaf of leafCategories as any[]) {
      const rid = rootIdOf(leaf);
      if (!leafIdSet.has(rid)) rootIdsToFetch.add(rid);
    }
    const fetchedRoots = rootIdsToFetch.size
      ? await MaterialCategory.find({ _id: { $in: [...rootIdsToFetch].map((id) => new Types.ObjectId(id)) } })
          .select("_id title image")
          .lean()
      : [];
    const rootById = new Map<string, any>();
    for (const r of fetchedRoots as any[]) rootById.set(String(r._id), r);
    // Roots that ARE free leaves themselves are already in leafCategories.
    for (const leaf of leafCategories as any[]) rootById.set(String(leaf._id), leaf);

    // 5) Build groups: one per root, children are the free leaves under it.
    // Group order follows first-seen leaf order (already sorted by order/title).
    const buildChild = (leaf: any) => ({
      _id: leaf._id,
      title: leaf.title,
      image: leaf.image,
      lessonCount: countByCategory.get(String(leaf._id)) ?? 0,
      parent: parentByCategory.get(String(leaf._id)) ?? null,
    });

    const groupByRoot = new Map<string, any>();
    for (const leaf of leafCategories as any[]) {
      const rid = rootIdOf(leaf);
      const isStandalone = rid === String(leaf._id);
      if (!groupByRoot.has(rid)) {
        const root = rootById.get(rid) ?? leaf;
        groupByRoot.set(rid, {
          _id: root._id,
          title: root.title,
          image: root.image,
          children: [] as any[],
        });
      }
      // A standalone free leaf IS its own card — no self-nesting under children.
      if (!isStandalone) groupByRoot.get(rid).children.push(buildChild(leaf));
    }

    // 6) Apply search on the GROUP (top) title, then paginate over groups.
    let allGroups = [...groupByRoot.values()];
    if (search) {
      const re = new RegExp(search, "i");
      allGroups = allGroups.filter((g) => re.test(g.title));
    }

    const total = allGroups.length;
    const data = allGroups.slice(skip, skip + limitNum);

    logger.info("listFreeMaterials success", { traceId, total, returned: data.length });
    return res.status(200).json({
      success: true,
      data,
      pagination: { total, page: pageNum, limit: limitNum, totalPages: Math.ceil(total / limitNum) },
    });
  } catch (e: any) {
    logger.error("listFreeMaterials failed", { traceId, error: getErrorMessage(e), stack: e.stack });
    return res.status(500).json({ success: false, message: e.message });
  }
};

// GET /api/v1/client/free-videos
export const listFreeVideos = async (req: Request, res: Response) => {
  const traceId = req.traceId;
  logger.info("listFreeVideos invoked", { traceId, path: req.originalUrl, userId: req.user?.id });

  try {
    const { search } = req.query as Record<string, string>;
    const { pageNum, limitNum, skip } = paginate(req);

    // Two gates: (1) ASSIGNMENT — the video's category must be assigned to some
    // course/package/live-course (paid or free); a video whose category isn't
    // attached to any product never shows. (2) FREE — the video itself must be
    // priceType:"free" (the same flag /v1/lecture honours for playback), so a
    // paid video inside an assigned category never leaks here.
    const { videoCategoryIds } = await resolveAssignedCategoryIds();

    const filter: any = {
      status: true,
      priceType: "free",
      videoCategoryId: { $in: videoCategoryIds },
    };
    if (search) filter.title = { $regex: search, $options: "i" };

    const [data, total] = await Promise.all([
      Video.find(filter)
        .populate("videoCategoryId", "_id title image")
        .sort({ order: 1, createdAt: -1 })
        .skip(skip)
        .limit(limitNum)
        .lean(),
      Video.countDocuments(filter),
    ]);

    logger.info("listFreeVideos success", { traceId, total });
    return res.status(200).json({
      success: true,
      data,
      pagination: { total, page: pageNum, limit: limitNum, totalPages: Math.ceil(total / limitNum) },
    });
  } catch (e: any) {
    logger.error("listFreeVideos failed", { traceId, error: getErrorMessage(e), stack: e.stack });
    return res.status(500).json({ success: false, message: e.message });
  }
};

const daysBetween = (from: Date, to: Date) =>
  Math.max(0, Math.ceil((to.getTime() - from.getTime()) / (1000 * 60 * 60 * 24)));

// GET /api/v1/client/free-ebooks
// Free ebooks listing. "Free" is decided per ebook by the admin-controlled
// `isPaid:false` field (the same flag surfaced by /client/ebooks) — NOT by
// price-plan presence. Response shape mirrors /client/ebooks so the FE can
// reuse the same ebook card (plans, isPurchased, daysLeft, isNew, shareableLink).
// `search` matches name/author; `language` filters by language. Paginated.
export const listFreeEbooks = async (req: Request, res: Response) => {
  const traceId = req.traceId;
  const customerId = req.user?.id;
  logger.info("listFreeEbooks invoked", { traceId, path: req.originalUrl, userId: customerId });

  try {
    const { search, language } = req.query as Record<string, string>;
    const { pageNum, limitNum, skip } = paginate(req);

    const filter: any = { status: true, isPaid: false };
    if (search) {
      filter.$or = [
        { name: { $regex: search, $options: "i" } },
        { author: { $regex: search, $options: "i" } },
      ];
    }
    if (language) filter.language = language;

    const [ebooks, total] = await Promise.all([
      Ebook.find(filter).sort({ order: 1, createdAt: -1 }).skip(skip).limit(limitNum).lean(),
      Ebook.countDocuments(filter),
    ]);

    const ebookIds = ebooks.map((e: any) => e._id);

    // Active price plans (a free ebook can still have a ₹0 plan) and the
    // user's currently-active subscriptions — same access rules as listEbooks.
    const now = new Date();
    const [plans, subs] = await Promise.all([
      ebookIds.length
        ? EbookPrice.find({ ebookId: { $in: ebookIds }, status: true }).sort({ duration: 1 }).lean()
        : Promise.resolve([] as any[]),
      customerId && ebookIds.length
        ? EbookSubscription.find({
            customerId,
            ebookId: { $in: ebookIds },
            status: true,
            endAt: { $gt: now },
          })
            .select("ebookId endAt")
            .lean()
        : Promise.resolve([] as any[]),
    ]);

    const plansByEbook: Record<string, any[]> = {};
    for (const p of plans as any[]) {
      (plansByEbook[String(p.ebookId)] ||= []).push(p);
    }

    // Latest active endAt wins, mirroring listEbooks.
    const activeByEbook = new Map<string, Date>();
    for (const s of subs as any[]) {
      const key = String(s.ebookId);
      const prev = activeByEbook.get(key);
      if (!prev || s.endAt.getTime() > prev.getTime()) activeByEbook.set(key, s.endAt);
    }

    const base = resolveBase(req);
    const data = ebooks.map((e: any) => {
      const endAt = activeByEbook.get(String(e._id)) || null;
      return {
        ...e,
        plans: plansByEbook[String(e._id)] || [],
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
        shareableLink: buildShareUrl("ebooks", String(e._id), base),
      };
    });

    logger.info("listFreeEbooks success", { traceId, userId: customerId, total, returned: data.length });
    return res.status(200).json({
      success: true,
      data,
      pagination: { total, page: pageNum, limit: limitNum, totalPages: Math.ceil(total / limitNum) },
    });
  } catch (e: any) {
    logger.error("listFreeEbooks failed", { traceId, error: getErrorMessage(e), stack: e.stack });
    return res.status(500).json({ success: false, message: e.message });
  }
};

// ─── Combined Courses + Packages listing (free by default) ──────────────────
// Enrich a set of Course docs with plans + isPurchased + daysLeft, mirroring
// paginateCoursesWithPlans in course.controller (same subscription rules).
async function enrichCoursesForList(courses: any[], customerId: string | undefined, baseUrl: string) {
  const courseIds = courses.map((c) => c._id);
  const plans = courseIds.length
    ? await PackageCourseEbookPrice.find({ courseId: { $in: courseIds }, status: true })
        .sort({ duration: 1 })
        .lean()
    : [];

  const plansByCourse = new Map<string, { withMaterial: any[]; withoutMaterial: any[] }>();
  for (const p of plans as any[]) {
    const key = String(p.courseId);
    let bucket = plansByCourse.get(key);
    if (!bucket) { bucket = { withMaterial: [], withoutMaterial: [] }; plansByCourse.set(key, bucket); }
    (p.withMaterial ? bucket.withMaterial : bucket.withoutMaterial).push(p);
  }

  // Per-course daysLeft: longest-lived active sub; lifetime (null endAt) wins.
  const endAtByCourse = new Map<string, Date | null>();
  const lifetime = new Set<string>();
  const now = new Date();
  if (customerId && courseIds.length) {
    const planIds = (plans as any[]).map((p) => p._id);
    const subs = await PackageCourseSubscription.find({
      customerId,
      paymentStatus: "verified",
      status: true,
      $and: [
        { $or: [{ endAt: null }, { endAt: { $gt: now } }] },
        { $or: [{ courseId: { $in: courseIds } }, { packageId: { $in: planIds } }] },
      ],
    })
      .select("courseId packageId endAt")
      .lean();
    const planToCourse = new Map<string, string>((plans as any[]).map((p) => [String(p._id), String(p.courseId)]));
    const upsert = (cid: string, endAt: Date | null) => {
      if (endAt === null) { lifetime.add(cid); endAtByCourse.set(cid, null); return; }
      if (lifetime.has(cid)) return;
      const prev = endAtByCourse.get(cid);
      if (!prev || endAt.getTime() > (prev as Date).getTime()) endAtByCourse.set(cid, endAt);
    };
    subs.forEach((s: any) => {
      const endAt: Date | null = s.endAt ?? null;
      if (s.courseId) upsert(String(s.courseId), endAt);
      const viaPlan = planToCourse.get(String(s.packageId));
      if (viaPlan) upsert(viaPlan, endAt);
    });
  }

  return courses.map((c: any) => {
    const cid = String(c._id);
    const isPurchased = endAtByCourse.has(cid);
    const endAt = lifetime.has(cid) ? null : (endAtByCourse.get(cid) ?? null);
    return {
      kind: "course" as const,
      ...c,
      isPaid: c.isPaid ?? true,
      isPurchased,
      daysLeft: isPurchased ? computeDaysLeft(endAt, now) : null,
      plans: plansByCourse.get(cid) ?? { withMaterial: [], withoutMaterial: [] },
      shareableLink: buildShareUrl("courses", cid, baseUrl),
    };
  });
}

// Enrich a set of Package docs, mirroring enrichPackages in package.controller.
async function enrichPackagesForList(packages: any[], customerId: string | undefined, baseUrl: string) {
  const packageIds = packages.map((p) => p._id);
  const now = new Date();

  // Owned map: packageId -> longest-lived active endAt (null = lifetime).
  const owned = new Map<string, Date | null>();
  if (customerId && packageIds.length) {
    const planIds = await PackageCourseEbookPrice.find({ packageId: { $in: packageIds } }).distinct("_id");
    const subs = await PackageCourseSubscription.find({
      customerId,
      status: true,
      paymentStatus: "verified",
      $and: [
        { $or: [{ endAt: null }, { endAt: { $gt: now } }] },
        { $or: [{ targetPackageId: { $in: packageIds } }, { packageId: { $in: planIds } }] },
      ],
    })
      .select("targetPackageId packageId endAt")
      .lean();
    const planToPackage = new Map<string, string>();
    if (subs.some((s: any) => s.packageId)) {
      const pls = await PackageCourseEbookPrice.find({ _id: { $in: subs.map((s: any) => s.packageId) } })
        .select("_id packageId")
        .lean();
      pls.forEach((pl: any) => planToPackage.set(String(pl._id), String(pl.packageId)));
    }
    const upsert = (pid: string, endAt: Date | null) => {
      if (!owned.has(pid)) { owned.set(pid, endAt); return; }
      const prev = owned.get(pid);
      if (prev === null || endAt === null) { owned.set(pid, null); return; }
      if (endAt.getTime() > (prev as Date).getTime()) owned.set(pid, endAt);
    };
    subs.forEach((s: any) => {
      const endAt: Date | null = s.endAt ?? null;
      if (s.targetPackageId) upsert(String(s.targetPackageId), endAt);
      const viaPlan = planToPackage.get(String(s.packageId));
      if (viaPlan) upsert(viaPlan, endAt);
    });
  }

  return Promise.all(
    packages.map(async (p: any) => {
      const [plans, subCount] = await Promise.all([
        PackageCourseEbookPrice.find({ packageId: p._id, status: true }).sort({ duration: 1 }).lean(),
        PackageCourseSubscription.countDocuments({ packageId: p._id, status: true }),
      ]);
      const pid = String(p._id);
      const isPurchased = owned.has(pid);
      return {
        kind: "package" as const,
        ...p,
        isPaid: p.isPaid ?? true,
        plans: {
          withMaterial: (plans as any[]).filter((pl) => pl.withMaterial),
          withoutMaterial: (plans as any[]).filter((pl) => !pl.withMaterial),
        },
        subscriberCount: subCount,
        isPurchased,
        daysLeft: isPurchased ? computeDaysLeft(owned.get(pid) ?? null, now) : null,
        shareableLink: buildShareUrl("packages", pid, baseUrl),
      };
    })
  );
}

// GET /api/v1/client/free-courses
// Combined Courses + Packages listing. FREE by default; pass `?type=paid` for
// the paid set (or `?type=free` explicitly). Each row is tagged `kind`
// ("course" | "package") so the FE can render/route correctly. Optional
// `search` matches name. Paginated over the merged set (combined total).
export const listFreeCourses = async (req: Request, res: Response) => {
  const traceId = req.traceId;
  logger.info("listFreeCourses invoked", { traceId, path: req.originalUrl, userId: req.user?.id, query: req.query });

  try {
    const { search } = req.query as Record<string, string>;
    // Default free; ?type=paid → paid only; ?type=free → free (explicit).
    const typeQ = String(req.query.type ?? "free").toLowerCase();
    const wantPaid = typeQ === "paid";
    const isPaidValue = wantPaid; // true → paid, false → free

    const { pageNum, limitNum, skip } = paginate(req);
    const baseUrl = resolveBase(req);
    const nameRegex = search ? { $regex: search, $options: "i" } : undefined;

    const courseFilter: any = { status: true, isPaid: isPaidValue };
    const packageFilter: any = { active: true, isPaid: isPaidValue };
    if (nameRegex) { courseFilter.name = nameRegex; packageFilter.name = nameRegex; }

    // Fetch both matching sets, then merge → sort → paginate over the union so
    // `total`/`totalPages` reflect the combined count. Mirrors the merge-then-
    // slice approach used by listBooksAndEbooksByExamCountdownCategory.
    const [courses, packages] = await Promise.all([
      Course.find(courseFilter)
        .populate("courseEducatorId", "_id name")
        .populate("courseSubjectCategoryId", "_id title")
        .populate("videoCategoryId", "_id title")
        .sort({ ordered: 1, createdAt: -1 })
        .lean(),
      Package.find(packageFilter)
        .populate("packageTypeId", "_id name")
        .populate("goalId", "_id title")
        .sort({ order: 1, createdAt: -1 })
        .lean(),
    ]);

    const [enrichedCourses, enrichedPackages] = await Promise.all([
      enrichCoursesForList(courses, req.user?.id, baseUrl),
      enrichPackagesForList(packages, req.user?.id, baseUrl),
    ]);

    // Newest-first across both kinds for a stable merged order.
    const merged = [...enrichedCourses, ...enrichedPackages].sort(
      (a: any, b: any) =>
        new Date(b.createdAt as any).getTime() - new Date(a.createdAt as any).getTime()
    );

    const total = merged.length;
    const list = merged.slice(skip, skip + limitNum);

    logger.info("listFreeCourses success", {
      traceId,
      type: wantPaid ? "paid" : "free",
      courses: enrichedCourses.length,
      packages: enrichedPackages.length,
      total,
      returned: list.length,
    });
    return res.status(200).json({
      success: true,
      data: list,
      pagination: { total, page: pageNum, limit: limitNum, totalPages: Math.ceil(total / limitNum) },
    });
  } catch (e: any) {
    logger.error("listFreeCourses failed", { traceId, error: getErrorMessage(e), stack: e.stack });
    return res.status(500).json({ success: false, message: e.message });
  }
};
