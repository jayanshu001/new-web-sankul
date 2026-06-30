import { Request, Response } from "express";
import { Types } from "mongoose";
import { Package } from "../../models/course/Package.model";
import { Course } from "../../models/course/Course.model";
import { PackageVideoCategoryRelation } from "../../models/course/PackageVideoCategoryRelation.model";
import { VideoCategoryRelation } from "../../models/course/VideoCategoryRelation.model";
import { PackageCourseEbookPrice } from "../../models/course/PackageCourseEbookPrice.model";
import { PackageCourseSubscription } from "../../models/customer/PackageCourseSubscription.model";
import { LiveCourse } from "../../models/course/LiveCourse.model";
import { VideoCategory } from "../../models/course/VideoCategory.model";
import { collectCategoryTreeIds } from "../../utils/categoryTree";
import logger from "../../utils/logger";
import { getErrorMessage } from "../../utils/httpResponse";
import { computeDaysLeft } from "../../utils/planDuration";
import { buildShareUrl } from "../../deeplinking/shareRedirect";
import {
  freeTests as freeTestsSql,
  freeMaterials as freeMaterialsSql,
  freeVideos as freeVideosSql,
  freeEbooks as freeEbooksSql,
  freeCourses as freeCoursesSql,
} from "../../modules/client-free/client-free.service";

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

    const cid = req.user?.id ? Number(req.user.id) : null;
    const { pageNum, limitNum, skip } = paginate(req);
    const result = await freeTestsSql({
      customerId: Number.isInteger(cid) ? cid : null,
      search: search || null,
      year: yearQ, month: monthQ, week: weekQ,
      page: pageNum, limit: limitNum, skip,
    });
    const { pagination, ...data } = result as any;
    logger.info("listFreeTests success (sql)", { traceId, level: (result as any).level });
    const payload: any = { success: true, data };
    if (pagination) payload.pagination = pagination;
    return res.status(200).json(payload);
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

    const cid = req.user?.id ? Number(req.user.id) : null;
    const { data, total } = await freeMaterialsSql({
      customerId: Number.isInteger(cid) ? cid : null,
      search: search || null, page: pageNum, limit: limitNum, skip,
    });
    logger.info("listFreeMaterials success (sql)", { traceId, total, returned: data.length });
    return res.status(200).json({
      success: true, data,
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

    const { data, total } = await freeVideosSql({ search: search || null, page: pageNum, limit: limitNum, skip });
    logger.info("listFreeVideos success (sql)", { traceId, total, returned: data.length });
    return res.status(200).json({
      success: true, data,
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

    const cid = customerId ? Number(customerId) : null;
    const { data, total } = await freeEbooksSql({
      customerId: Number.isInteger(cid) ? cid : null,
      search: search || null, language: language || null,
      page: pageNum, limit: limitNum, skip, shareBase: resolveBase(req),
    });
    logger.info("listFreeEbooks success (sql)", { traceId, userId: customerId, total, returned: data.length });
    return res.status(200).json({
      success: true, data,
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

    const cid = req.user?.id ? Number(req.user.id) : null;
    const { data, total } = await freeCoursesSql({
      customerId: Number.isInteger(cid) ? cid : null,
      search: search || null, wantPaid,
      page: pageNum, limit: limitNum, skip, shareBase: baseUrl,
    });
    logger.info("listFreeCourses success (sql)", { traceId, type: wantPaid ? "paid" : "free", total, returned: data.length });
    return res.status(200).json({
      success: true, data,
      pagination: { total, page: pageNum, limit: limitNum, totalPages: Math.ceil(total / limitNum) },
    });
  } catch (e: any) {
    logger.error("listFreeCourses failed", { traceId, error: getErrorMessage(e), stack: e.stack });
    return res.status(500).json({ success: false, message: e.message });
  }
};
