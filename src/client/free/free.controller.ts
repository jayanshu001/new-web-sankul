import { Request, Response } from "express";
import mongoose, { Types } from "mongoose";
import { MONTH_LABELS, weekOfMonth, weekRange } from "../../utils/dateBuckets";
import { Package } from "../../models/course/Package.model";
import { Course } from "../../models/course/Course.model";
import { PackageVideoCategoryRelation } from "../../models/course/PackageVideoCategoryRelation.model";
import { VideoCategoryRelation } from "../../models/course/VideoCategoryRelation.model";
import { PackageCourseEbookPrice } from "../../models/course/PackageCourseEbookPrice.model";
import { PackageCourseSubscription } from "../../models/customer/PackageCourseSubscription.model";
import { Exam } from "../../models/exam/Exam.model";
import { ExamResult } from "../../models/exam/ExamResult.model";
import { ExamStatus, ExamType } from "../../models/enums";
import { Material } from "../../models/course/Material.model";
import { MaterialCategory } from "../../models/course/MaterialCategory.model";
import { getPurchasedMaterialIds, shapeMaterialForClient } from "../material/entitlement";
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
// Year → month → week drill-down, mirroring client/quizzes/daily and bucketed
// on the exam's scheduled `startAt` (NOT createdAt). Tests without a `startAt`
// are excluded by the `startAt <= endOfDay` gate, same as quizzes/daily — a free
// test only surfaces here once it has a scheduled date that has arrived.
// All params optional and applied progressively:
//   no params         -> years   [{ year, testsCount }]
//   ?year=YYYY         -> months  [{ year, month, label, testsCount }]
//   ?year&month        -> weeks   [{ week, label, startDate, endDate, testsCount }]
//   ?year&month&week   -> tests   (paginated; each item carries per-customer
//                                   attemptsCount / bestScore / isAttempted /
//                                   lastResult, matching quizzes/daily)
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
      // Only subject tests belong here; daily/mock/weekly are surfaced elsewhere.
      type: ExamType.SUBJECT,
      categoryId: { $in: examCategoryIds },
      // Bucket on the scheduled date. This gate also excludes tests with a null
      // `startAt` (and any scheduled in the future), matching quizzes/daily.
      startAt: { $lte: endOfDay },
    };
    if (search) baseMatch.title = { $regex: search, $options: "i" };

    // ── Level 1: years ──
    if (yearQ === undefined) {
      const rows = await Exam.aggregate([
        { $match: baseMatch },
        { $group: { _id: { $year: "$startAt" }, testsCount: { $sum: 1 } } },
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
        { $match: { ...baseMatch, startAt: { $gte: yearStart, $lte: upper } } },
        { $group: { _id: { $month: "$startAt" }, testsCount: { $sum: 1 } } },
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
        startAt: { $gte: monthStart, $lte: upper },
      }).select("startAt");

      const counts = new Map<number, number>();
      for (const e of exams) {
        if (!e.startAt) continue;
        const w = weekOfMonth(new Date(e.startAt as Date).getDate());
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

    const filter = { ...baseMatch, startAt: { $gte: weekStart, $lte: upper } };

    const [items, total] = await Promise.all([
      Exam.find(filter)
        .populate("categoryId", "_id title image")
        .sort({ orderBy: 1, startAt: -1 })
        .skip(skip)
        .limit(limitNum)
        .lean(),
      Exam.countDocuments(filter),
    ]);

    // Per-customer attempt stats, scoped to the page of exams just fetched.
    // Mirrors the contract on GET /client/quizzes/daily (level "tests"):
    // attemptsCount / bestScore / isAttempted / lastResult, sourced from
    // ExamResult (status:true = valid, non-invalidated results only).
    const customerId = req.user?.id;
    const statsByExam = new Map<string, { attemptsCount: number; bestScore: number; lastResult: any }>();
    if (customerId && items.length) {
      const cid = new mongoose.Types.ObjectId(customerId);
      const examIds = items.map((e: any) => e._id);
      const agg = await ExamResult.aggregate([
        { $match: { customerId: cid, examId: { $in: examIds }, status: true } },
        { $sort: { submittedAt: -1, attemptNumber: -1 } },
        {
          $group: {
            _id: "$examId",
            attemptsCount: { $sum: 1 },
            bestScore: { $max: "$score" },
            last: { $first: "$$ROOT" },
          },
        },
      ]);
      for (const row of agg) {
        statsByExam.set(String(row._id), {
          attemptsCount: row.attemptsCount,
          bestScore: row.bestScore,
          lastResult: {
            _id: row.last._id,
            attemptNumber: row.last.attemptNumber,
            score: row.last.score,
            timing: row.last.timing,
            submittedAt: row.last.submittedAt,
          },
        });
      }
    }

    const decoratedItems = items.map((e: any) => {
      const s = statsByExam.get(String(e._id));
      return {
        ...e,
        attemptsCount: s?.attemptsCount ?? 0,
        bestScore: s?.bestScore ?? 0,
        isAttempted: (s?.attemptsCount ?? 0) > 0,
        lastResult: s?.lastResult ?? null,
      };
    });

    logger.info("listFreeTests success", { traceId, level: "tests", year: yearQ, month: monthQ, week: weekQ, total });
    return res.status(200).json({
      success: true,
      data: { level: "tests", year: yearQ, month: monthQ, week: weekQ, items: decoratedItems },
      pagination: { total, page: pageNum, limit: limitNum, totalPages: Math.ceil(total / limitNum) },
    });
  } catch (e: any) {
    logger.error("listFreeTests failed", { traceId, error: getErrorMessage(e), stack: e.stack });
    return res.status(500).json({ success: false, message: e.message });
  }
};

// GET /api/v1/client/free-materials
// Full recursive tree, TOP-grouped by the product (course / package /
// live-course) the categories are associated with — mirroring the app. BOTH
// free and PAID products are scanned; only their FREE materials are returned,
// so free content inside a paid product still shows here:
//   Product (e.g. "English Grammers")
//     └─ assigned category (e.g. "Current Affairs - Prasant Sir")        ← root
//          ├─ materials[]  (free PDFs directly under this category)
//          └─ children[]   (sub-categories, recursed to the bottom)
//               └─ materials[] / children[] ...
//
// Key model fact: a product references categories at the ASSIGNED (root) level;
// the actual free materials live on that root OR any descendant. So we expand
// each assigned root to its full subtree and hang free materials on whichever
// node owns them. Every node may carry BOTH its own materials AND children.
//
// Top level is PRODUCTS ONLY — a category is never a top-level card. A subtree
// (or product) with zero free materials anywhere is pruned. `search` matches
// the product title; pagination is over the product set.
//
// Node shape: { _id, title, image, materials: [...], children: [ node... ] }
// where each material is the same client shape as /materials/.../contents.
export const listFreeMaterials = async (req: Request, res: Response) => {
  const traceId = req.traceId;
  logger.info("listFreeMaterials invoked", { traceId, path: req.originalUrl, userId: req.user?.id });

  try {
    const { search } = req.query as Record<string, string>;
    const { pageNum, limitNum, skip } = paginate(req);

    // 1) Each product → the material-category roots it assigns. BOTH free and
    //    PAID products qualify — free materials sitting inside a paid product
    //    must still surface here. The product being paid never hides its free
    //    content; the per-material `isPaid:false` gate in step 3 is what decides
    //    inclusion. Only inactive products (active/status:false) are excluded.
    const [allPackages, allCourses, allLiveCourses] = await Promise.all([
      Package.find({ active: true }).select("_id name image materialCategories").lean(),
      Course.find({ status: true }).select("_id name image materialCategories").lean(),
      LiveCourse.find({ status: true }).select("_id name image materialCategories").lean(),
    ]);

    type ProductType = "course" | "package" | "live-course";
    const products: { _id: any; name: string; image: any; type: ProductType; rootIds: string[] }[] = [];
    const collectRoots = (refs: any[] | undefined): string[] => {
      const out: string[] = [];
      for (const ref of refs ?? []) {
        if (ref?.status !== false && ref?.category) out.push(String(ref.category));
      }
      return out;
    };
    for (const p of allPackages as any[]) products.push({ _id: p._id, name: p.name, image: p.image ?? null, type: "package", rootIds: collectRoots(p.materialCategories) });
    for (const c of allCourses as any[]) products.push({ _id: c._id, name: c.name, image: c.image ?? null, type: "course", rootIds: collectRoots(c.materialCategories) });
    for (const lc of allLiveCourses as any[]) products.push({ _id: lc._id, name: lc.name, image: lc.image ?? null, type: "live-course", rootIds: collectRoots(lc.materialCategories) });

    const allRootIds = [...new Set(products.flatMap((p) => p.rootIds))];
    if (!allRootIds.length) {
      return res.status(200).json({ success: true, data: [], pagination: { total: 0, page: pageNum, limit: limitNum, totalPages: 0 } });
    }

    // 2) Expand every assigned root to its full subtree (active categories only),
    //    walking parent → childCategoryIds breadth-first. Build:
    //    - catById:  id → {_id,title,image}
    //    - childrenOf: parentId → ordered child ids
    const catById = new Map<string, any>();
    const childrenOf = new Map<string, string[]>();

    let frontier = allRootIds.map((id) => new Types.ObjectId(id));
    const seen = new Set<string>(allRootIds);
    // Load the roots themselves first, then descend.
    let toLoad: Types.ObjectId[] = frontier;
    while (toLoad.length) {
      const batch = await MaterialCategory.find({ _id: { $in: toLoad }, status: true })
        .select("_id title image parent childCategoryIds order")
        .sort({ order: 1, title: 1 })
        .lean();
      const nextIds: Types.ObjectId[] = [];
      for (const cat of batch as any[]) {
        catById.set(String(cat._id), { _id: cat._id, title: cat.title, image: cat.image });
        const kids: string[] = (cat.childCategoryIds ?? []).map((k: any) => String(k));
        if (kids.length) childrenOf.set(String(cat._id), kids);
        for (const k of kids) {
          if (!seen.has(k)) { seen.add(k); nextIds.push(new Types.ObjectId(k)); }
        }
      }
      toLoad = nextIds;
    }

    // 3) Free-material counts + shaped materials per category, across the whole
    //    expanded set. free-materials is free-only, so every PDF is un-gated.
    const allCatIds = [...catById.keys()].map((id) => new Types.ObjectId(id));
    const materialsRaw = await Material.find({
      materialCategoryId: { $in: allCatIds },
      status: true,
      isPaid: false,
    })
      .select("_id title description thumbnail file directLink fileSize language isPreview isPaid materialCategoryId order createdAt")
      .sort({ order: 1, createdAt: -1 })
      .lean();
    const ownedIds = await getPurchasedMaterialIds(req.user?.id, materialsRaw as any);
    const materialsByCat = new Map<string, any[]>();
    for (const m of materialsRaw as any[]) {
      const key = String(m.materialCategoryId);
      if (!materialsByCat.has(key)) materialsByCat.set(key, []);
      materialsByCat.get(key)!.push(shapeMaterialForClient(m, ownedIds));
    }

    // 4) Recursively build a node. A node is kept only if it (or any descendant)
    //    holds ≥1 free material — empty branches are pruned. `materialCount` is
    //    the rolled-up total for the subtree (handy for the FE badge).
    const buildNode = (catId: string): any | null => {
      const cat = catById.get(catId);
      if (!cat) return null;
      const ownMaterials = materialsByCat.get(catId) ?? [];
      const children = (childrenOf.get(catId) ?? [])
        .map((childId) => buildNode(childId))
        .filter(Boolean) as any[];
      if (!ownMaterials.length && !children.length) return null;
      const materialCount = ownMaterials.length + children.reduce((n, c) => n + c.materialCount, 0);
      return {
        _id: cat._id,
        title: cat.title,
        image: cat.image,
        materialCount,
        materials: ownMaterials,
        children,
      };
    };

    // 5) Top level = products. Each product's `categories` = its assigned roots
    //    built into trees. Products that resolve to zero non-empty roots (no free
    //    material anywhere in their subtree) are dropped. A root assigned to more
    //    than one product appears under each — intentional.
    let groups = products
      .map((p) => {
        const categories = p.rootIds
          .map((rid) => buildNode(rid))
          .filter(Boolean) as any[];
        if (!categories.length) return null;
        return {
          _id: p._id,
          title: p.name,
          image: p.image,
          type: p.type,
          materialCount: categories.reduce((n, c) => n + c.materialCount, 0),
          categories,
        };
      })
      .filter(Boolean) as any[];

    if (search) {
      const re = new RegExp(search, "i");
      groups = groups.filter((g) => re.test(g.title));
    }

    const total = groups.length;
    const data = groups.slice(skip, skip + limitNum);

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
// Full recursive tree, TOP-grouped by the product (course / package /
// live-course) — the exact mirror of /free-materials, but for video categories.
// BOTH free and PAID products are scanned; only their FREE (priceType:"free")
// videos are returned, so free videos inside a paid product still show here:
//   Product (e.g. "English Grammers")
//     └─ assigned video category (root folder)
//          ├─ videos[]   (free, priceType:"free", directly under this folder)
//          └─ children[] (sub-folders, recursed to the bottom)
//
// Video↔product linkage differs from materials:
//   - Course / LiveCourse → scalar `videoCategoryId` (the root folder).
//   - Package → PackageVideoCategoryRelation → VideoCategoryRelation
//     (parent/child); the relation's parent (and child) are roots.
// Each root is expanded to its full subtree via `childCategoryIds`. Free videos
// (priceType:"free") are hung on whichever folder owns them; every node carries
// both `videos[]` and `children[]`. Empty branches are pruned; products with no
// free video anywhere are dropped. Listing metadata only — the FE fetches the
// encrypted stream from /v1/lecture for playback. `search` matches the product
// title; pagination is over the product set.
//
// Node shape: { _id, title, image, videoCount, videos: [...], children: [node] }
export const listFreeVideos = async (req: Request, res: Response) => {
  const traceId = req.traceId;
  logger.info("listFreeVideos invoked", { traceId, path: req.originalUrl, userId: req.user?.id });

  try {
    const { search } = req.query as Record<string, string>;
    const { pageNum, limitNum, skip } = paginate(req);

    // 1) Each product → the video-category roots it owns. BOTH free and PAID
    //    products qualify — free videos inside a paid product must still surface.
    //    The per-video `priceType:"free"` gate in step 3 decides inclusion; only
    //    inactive products (active/status:false) are excluded.
    const [allPackages, allCourses, allLiveCourses] = await Promise.all([
      Package.find({ active: true }).select("_id name image").lean(),
      Course.find({ status: true }).select("_id name image videoCategoryId").lean(),
      LiveCourse.find({ status: true }).select("_id name image videoCategoryId").lean(),
    ]);

    type ProductType = "course" | "package" | "live-course";
    const products: { _id: any; name: string; image: any; type: ProductType; rootIds: string[] }[] = [];

    for (const c of allCourses as any[]) {
      products.push({ _id: c._id, name: c.name, image: c.image ?? null, type: "course", rootIds: c.videoCategoryId ? [String(c.videoCategoryId)] : [] });
    }
    for (const lc of allLiveCourses as any[]) {
      products.push({ _id: lc._id, name: lc.name, image: lc.image ?? null, type: "live-course", rootIds: lc.videoCategoryId ? [String(lc.videoCategoryId)] : [] });
    }

    // Packages reach video roots through their active video-category relations.
    const allPkgIds = (allPackages as any[]).map((p) => p._id);
    const rootIdsByPkg = new Map<string, Set<string>>();
    if (allPkgIds.length) {
      const pkgRels = await PackageVideoCategoryRelation.find({ packageId: { $in: allPkgIds }, active: true })
        .select("packageId videoCategoryRelationId")
        .lean();
      const relIds = [...new Set((pkgRels as any[]).map((r) => String(r.videoCategoryRelationId)))].map((id) => new Types.ObjectId(id));
      const relById = new Map<string, any>();
      if (relIds.length) {
        const rels = await VideoCategoryRelation.find({ _id: { $in: relIds } }).select("parent child").lean();
        for (const r of rels as any[]) relById.set(String(r._id), r);
      }
      for (const pr of pkgRels as any[]) {
        const rel = relById.get(String(pr.videoCategoryRelationId));
        if (!rel) continue;
        const set = rootIdsByPkg.get(String(pr.packageId)) ?? new Set<string>();
        if (rel.parent) set.add(String(rel.parent));
        if (rel.child) set.add(String(rel.child));
        rootIdsByPkg.set(String(pr.packageId), set);
      }
    }
    for (const p of allPackages as any[]) {
      products.push({ _id: p._id, name: p.name, image: p.image ?? null, type: "package", rootIds: [...(rootIdsByPkg.get(String(p._id)) ?? [])] });
    }

    const allRootIds = [...new Set(products.flatMap((p) => p.rootIds))];
    if (!allRootIds.length) {
      return res.status(200).json({ success: true, data: [], pagination: { total: 0, page: pageNum, limit: limitNum, totalPages: 0 } });
    }

    // 2) Expand every root to its full subtree (active folders only), walking
    //    childCategoryIds breadth-first. Note VideoCategory uses `order_by`.
    const catById = new Map<string, any>();
    const childrenOf = new Map<string, string[]>();
    const seen = new Set<string>(allRootIds);
    let toLoad: Types.ObjectId[] = allRootIds.map((id) => new Types.ObjectId(id));
    while (toLoad.length) {
      const batch = await VideoCategory.find({ _id: { $in: toLoad }, status: true })
        .select("_id title image childCategoryIds order_by")
        .sort({ order_by: 1, title: 1 })
        .lean();
      const nextIds: Types.ObjectId[] = [];
      for (const cat of batch as any[]) {
        catById.set(String(cat._id), { _id: cat._id, title: cat.title, image: cat.image });
        const kids: string[] = (cat.childCategoryIds ?? []).map((k: any) => String(k));
        if (kids.length) childrenOf.set(String(cat._id), kids);
        for (const k of kids) {
          if (!seen.has(k)) { seen.add(k); nextIds.push(new Types.ObjectId(k)); }
        }
      }
      toLoad = nextIds;
    }

    // 3) Free videos across the whole expanded set, grouped by category. Listing
    //    metadata only (raw doc, same fields the old endpoint returned).
    const allCatIds = [...catById.keys()].map((id) => new Types.ObjectId(id));
    const videosRaw = await Video.find({
      videoCategoryId: { $in: allCatIds },
      status: true,
      priceType: "free",
    })
      .sort({ order: 1, createdAt: -1 })
      .lean();
    const videosByCat = new Map<string, any[]>();
    for (const v of videosRaw as any[]) {
      const key = String(v.videoCategoryId);
      if (!videosByCat.has(key)) videosByCat.set(key, []);
      videosByCat.get(key)!.push(v);
    }

    // 4) Recursively build a node; prune branches with no free video anywhere.
    const buildNode = (catId: string): any | null => {
      const cat = catById.get(catId);
      if (!cat) return null;
      const ownVideos = videosByCat.get(catId) ?? [];
      const children = (childrenOf.get(catId) ?? [])
        .map((childId) => buildNode(childId))
        .filter(Boolean) as any[];
      if (!ownVideos.length && !children.length) return null;
      const videoCount = ownVideos.length + children.reduce((n, c) => n + c.videoCount, 0);
      return { _id: cat._id, title: cat.title, image: cat.image, videoCount, videos: ownVideos, children };
    };

    // 5) Top level = products; categories = built roots; drop empty products.
    let groups = products
      .map((p) => {
        const categories = p.rootIds.map((rid) => buildNode(rid)).filter(Boolean) as any[];
        if (!categories.length) return null;
        return {
          _id: p._id,
          title: p.name,
          image: p.image,
          type: p.type,
          videoCount: categories.reduce((n, c) => n + c.videoCount, 0),
          categories,
        };
      })
      .filter(Boolean) as any[];

    if (search) {
      const re = new RegExp(search, "i");
      groups = groups.filter((g) => re.test(g.title));
    }

    const total = groups.length;
    const data = groups.slice(skip, skip + limitNum);

    logger.info("listFreeVideos success", { traceId, total, returned: data.length });
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
