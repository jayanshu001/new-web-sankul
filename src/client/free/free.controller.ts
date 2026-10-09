// Client free content: HTTP handlers for free tests, materials, videos, ebooks, courses.
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

// Year → month → week drill-down like quizzes/daily, bucketed on scheduled `startAt`
// (not createdAt); tests without an arrived `startAt` are excluded.
//   no params        -> years  [{ year, testsCount }]
//   ?year            -> months [{ year, month, label, testsCount }]
//   ?year&month      -> weeks  [{ week, label, startDate, endDate, testsCount }]
//   ?year&month&week -> tests  (paginated, with per-customer attempt stats)
// `search` applies at every level so counts match the list.
export const listFreeTests = async (req: Request, res: Response) => {
  const traceId = req.traceId;
  logger.info("listFreeTests invoked", { traceId, path: req.originalUrl, userId: req.user?.id, query: req.query });

  try {
    const { search } = req.query as Record<string, string>;

    const yearQ = req.query.year ? Number(req.query.year) : undefined;
    const monthQ = req.query.month ? Number(req.query.month) : undefined;
    const weekQ = req.query.week ? Number(req.query.week) : undefined;

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
    logger.info("listFreeTests success", { traceId, level: (result as any).level });
    const payload: any = { success: true, data };
    if (pagination) payload.pagination = pagination;
    return res.status(200).json(payload);
  } catch (e: any) {
    logger.error("listFreeTests failed", { traceId, error: getErrorMessage(e), stack: e.stack });
    return res.status(500).json({ success: false, message: e.message });
  }
};

// Recursive tree grouped by product (course / package / live-course). Free and
// paid products are scanned; only FREE materials are returned. Products reference
// categories at the assigned root; materials live on the root or any descendant,
// so each root is expanded to its subtree and every node may carry both
// `materials` and `children`. Top level is products only; empty subtrees are
// pruned. `search` matches product title; pagination is over products.
// Node: { _id, title, image, materials: [...], children: [node] }
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
    logger.info("listFreeMaterials success", { traceId, total, returned: data.length });
    return res.status(200).json({
      success: true, data,
      pagination: { total, page: pageNum, limit: limitNum, totalPages: Math.ceil(total / limitNum) },
    });
  } catch (e: any) {
    logger.error("listFreeMaterials failed", { traceId, error: getErrorMessage(e), stack: e.stack });
    return res.status(500).json({ success: false, message: e.message });
  }
};

// Video-category mirror of /free-materials: only priceType "free" videos, from
// free and paid products. Linkage differs from materials:
//   - Course / LiveCourse → scalar `videoCategoryId` (root folder).
//   - Package → PackageVideoCategoryRelation → VideoCategoryRelation (parent and child are roots).
// Roots expand via `childCategoryIds`; empty branches/products are pruned.
// Metadata only — playback comes from /v1/lecture.
// Node: { _id, title, image, videoCount, videos: [...], children: [node] }
export const listFreeVideos = async (req: Request, res: Response) => {
  const traceId = req.traceId;
  logger.info("listFreeVideos invoked", { traceId, path: req.originalUrl, userId: req.user?.id });

  try {
    const { search } = req.query as Record<string, string>;
    const { pageNum, limitNum, skip } = paginate(req);

    const customerId = req.user?.id ? Number(req.user.id) : null;
    const { data, total } = await freeVideosSql({ search: search || null, page: pageNum, limit: limitNum, skip, customerId: Number.isInteger(customerId) ? customerId : null });
    logger.info("listFreeVideos success", { traceId, total, returned: data.length });
    return res.status(200).json({
      success: true, data,
      pagination: { total, page: pageNum, limit: limitNum, totalPages: Math.ceil(total / limitNum) },
    });
  } catch (e: any) {
    logger.error("listFreeVideos failed", { traceId, error: getErrorMessage(e), stack: e.stack });
    return res.status(500).json({ success: false, message: e.message });
  }
};

// "Free" = admin-controlled `isPaid:false` (not price-plan presence). Shape mirrors
// /client/ebooks so the FE reuses the same card. `search` matches name/author.
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
    logger.info("listFreeEbooks success", { traceId, userId: customerId, total, returned: data.length });
    return res.status(200).json({
      success: true, data,
      pagination: { total, page: pageNum, limit: limitNum, totalPages: Math.ceil(total / limitNum) },
    });
  } catch (e: any) {
    logger.error("listFreeEbooks failed", { traceId, error: getErrorMessage(e), stack: e.stack });
    return res.status(500).json({ success: false, message: e.message });
  }
};

// FREE by default; `?type=paid` for the paid set. Rows are tagged `kind`
// ("course" | "package"); paginated over the merged set.
export const listFreeCourses = async (req: Request, res: Response) => {
  const traceId = req.traceId;
  logger.info("listFreeCourses invoked", { traceId, path: req.originalUrl, userId: req.user?.id, query: req.query });

  try {
    const { search } = req.query as Record<string, string>;
    const typeQ = String(req.query.type ?? "free").toLowerCase();
    const wantPaid = typeQ === "paid";
    const isPaidValue = wantPaid;

    const { pageNum, limitNum, skip } = paginate(req);
    const baseUrl = resolveBase(req);

    const cid = req.user?.id ? Number(req.user.id) : null;
    const { data, total } = await freeCoursesSql({
      customerId: Number.isInteger(cid) ? cid : null,
      search: search || null, wantPaid,
      page: pageNum, limit: limitNum, skip, shareBase: baseUrl,
    });
    logger.info("listFreeCourses success", { traceId, type: wantPaid ? "paid" : "free", total, returned: data.length });
    // Card DTO only — RN reads kind/_id/id/name/title/image/isPurchased.
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
