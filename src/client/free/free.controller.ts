import { Request, Response } from "express";
import logger from "../../utils/logger";
import { getErrorMessage } from "../../utils/httpResponse";
import {
  freeTests as freeTestsSql,
  freeMaterials as freeMaterialsSql,
  freeVideos as freeVideosSql,
  freeEbooks as freeEbooksSql,
  freeCourses as freeCoursesSql,
} from "../../modules/client-free/client-free.service";
import { pickList } from "../../utils/pick";

const resolveBase = (req: Request) =>
  process.env.ORIGIN || `${req.protocol}://${req.get("host")}`;

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

    const customerId = req.user?.id ? Number(req.user.id) : null;
    const { data, total } = await freeVideosSql({ search: search || null, page: pageNum, limit: limitNum, skip, customerId: Number.isInteger(customerId) ? customerId : null });
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
    // Card DTO only — RN reads kind/_id/id/name/title/image/isPurchased. Drops the
    // full Prisma spread (plans/educator/subjects/shareableLink). See docs/api-optimization.
    return res.status(200).json({
      success: true,
      data: pickList(data as any[], ["kind", "_id", "id", "name", "title", "image", "isPurchased"]),
      pagination: { total, page: pageNum, limit: limitNum, totalPages: Math.ceil(total / limitNum) },
    });
  } catch (e: any) {
    logger.error("listFreeCourses failed", { traceId, error: getErrorMessage(e), stack: e.stack });
    return res.status(500).json({ success: false, message: e.message });
  }
};
