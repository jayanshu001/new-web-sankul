// Admin test series: HTTP handlers for series, papers, prices, subscriptions and orders.
import { Request, Response } from "express";
import { planInUseMessage } from "../../utils/planUsage";
import { PLAN_TERMS_FROZEN_MESSAGE } from "../../modules/admin-plan/admin-plan.service";
import { z } from "zod";
import { PaymentMethod, PackageCourseEbookOrderStatus, PackageCourseEbookOrderType } from "../../shared/enums";
import { success, failure, failureFrom, getErrorMessage } from "../../utils/httpResponse";
import logger from "../../utils/logger";
import * as tsSql from "../../modules/admin-testseries/admin-testseries.service";
import { flushUserRouteCache } from "../../middlewares/autoFlush";
import { isSuperAdmin } from "../../middlewares/requirePermission";
import { parseListQuery } from "../../utils/listQuery";
import {
  createTestSeriesSchema,
  updateTestSeriesSchema,
  createContentCategorySchema,
  updateContentCategorySchema,
  linkExamSchema,
  updateLinkSchema,
  createPriceSchema,
  updatePriceSchema,
  grantSubscriptionSchema,
  updateSubscriptionSchema,
} from "./testSeries.validation";
import { parseTestSeriesSubReportQuery } from "../../modules/report-query/report-query";

function zodIssueResponse(res: Response, err: z.ZodError) {
  const messages = err.issues.map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`);
  return failure(res, "Validation failed.", 422, { errors: messages });
}

// multipart/form-data clients may send the array as `examCategoryIds[]` (qs
// bracket notation), which multer leaves under that literal key. Collapse it
// onto `examCategoryIds` so validation sees a single shape. Mutates req.body.
function normalizeExamCategoryIds(body: Record<string, any>) {
  if (body["examCategoryIds[]"] !== undefined && body.examCategoryIds === undefined) {
    body.examCategoryIds = body["examCategoryIds[]"];
    delete body["examCategoryIds[]"];
  }
}

export const listTestSeries = async (req: Request, res: Response) => {
  const traceId = req.traceId;
  logger.info("listTestSeries invoked", { traceId, path: req.originalUrl, userId: req.user?.id });

  try {
    const { search, status, examCategoryId, examCategoryIds, page = "1", limit = "20" } =
      req.query as Record<string, any>;

    const p = Math.max(1, parseInt(page, 10) || 1);
    const l = Math.min(100, Math.max(1, parseInt(limit, 10) || 20));
    const rawCats = examCategoryIds ?? examCategoryId;
    const catIds = (Array.isArray(rawCats) ? rawCats : rawCats ? [rawCats] : [])
      .map((c) => tsSql.parseAtsId(String(c)))
      .filter((n): n is number => n != null);
    const r = await tsSql.listTestSeries({
      search: search?.trim() || null,
      status: status === "true" ? true : status === "false" ? false : null,
      catIds,
      page: p,
      limit: l,
    });
    logger.info("listTestSeries success", { traceId, total: r.total });
    return success(res, { data: r.data, total: r.total, page: p, limit: l }, "Fetched.");
  } catch (err) {
    logger.error("listTestSeries failed", { traceId, error: getErrorMessage(err), stack: (err as Error).stack });
    return failure(res, "Failed to list test series.", 500);
  }
};

export const getTestSeriesById = async (req: Request, res: Response) => {
  const traceId = req.traceId;
  const id = String(req.params.id);
  logger.info("getTestSeriesById invoked", { traceId, path: req.originalUrl, id, userId: req.user?.id });

  try {
    const nid = tsSql.parseAtsId(id);
    if (nid == null) { logger.warn("getTestSeriesById invalid id", { traceId, id }); return failure(res, "Invalid test series id.", 422); }
    const r = await tsSql.getTestSeriesById(nid);
    if (!r) { logger.warn("getTestSeriesById not found", { traceId, id }); return failure(res, "Test series not found.", 404); }
    logger.info("getTestSeriesById success", { traceId, id });
    return success(res, r, "Fetched.");
  } catch (err) {
    logger.error("getTestSeriesById failed", { traceId, id, error: getErrorMessage(err), stack: (err as Error).stack });
    return failure(res, "Failed to fetch test series.", 500);
  }
};

export const createTestSeries = async (req: Request, res: Response) => {
  const traceId = req.traceId;
  logger.info("createTestSeries invoked", { traceId, path: req.originalUrl, userId: req.user?.id });

  try {
    const file = req.file as any;
    if (file?.location) req.body.thumbnail = file.location;
    normalizeExamCategoryIds(req.body);
    let data: z.infer<typeof createTestSeriesSchema>;
    try {
      data = createTestSeriesSchema.parse(req.body);
    } catch (e) {
      if (e instanceof z.ZodError) { logger.warn("createTestSeries validation failed", { traceId, issues: e.issues }); return zodIssueResponse(res, e); }
      throw e;
    }
    const r = await tsSql.createTestSeries(data as any);
    logger.info("createTestSeries success", { traceId, id: r.series._id });
    return success(res, r, "Test series created.", 201);
  } catch (err) {
    logger.error("createTestSeries failed", { traceId, error: getErrorMessage(err), stack: (err as Error).stack });
    return failure(res, "Failed to create test series.", 500);
  }
};

export const updateTestSeries = async (req: Request, res: Response) => {
  const traceId = req.traceId;
  const id = String(req.params.id);
  logger.info("updateTestSeries invoked", { traceId, path: req.originalUrl, id, userId: req.user?.id });

  try {
    const file = req.file as any;
    if (file?.location) req.body.thumbnail = file.location;
    normalizeExamCategoryIds(req.body);
    let data: z.infer<typeof updateTestSeriesSchema>;
    try {
      data = updateTestSeriesSchema.parse(req.body);
    } catch (e) {
      if (e instanceof z.ZodError) { logger.warn("updateTestSeries validation failed", { traceId, id, issues: e.issues }); return zodIssueResponse(res, e); }
      throw e;
    }

    const nid = tsSql.parseAtsId(id);
    if (nid == null) { logger.warn("updateTestSeries invalid id", { traceId, id }); return failure(res, "Invalid test series id.", 422); }
    const cur = await tsSql.getSeriesIsFree(nid);
    if (!cur) { logger.warn("updateTestSeries not found", { traceId, id }); return failure(res, "Test series not found.", 404); }
    const isFreeNow = data.isFree !== undefined ? !!data.isFree : cur.isFree;
    if (!isFreeNow && !(await tsSql.hasActivePlan(nid))) {
      logger.warn("updateTestSeries paid-without-plan", { traceId, id });
      return failure(res, "A paid test series must have at least one active price plan. Add a plan or mark the series free.", 422);
    }
    const r = await tsSql.updateTestSeries(nid, data as any);
    if (!r) { logger.warn("updateTestSeries not found", { traceId, id }); return failure(res, "Test series not found.", 404); }
    logger.info("updateTestSeries success", { traceId, id });
    return success(res, r, "Test series updated.");
  } catch (err) {
    logger.error("updateTestSeries failed", { traceId, id, error: getErrorMessage(err), stack: (err as Error).stack });
    return failure(res, "Failed to update test series.", 500);
  }
};

// Refuses if any verified subscription points at this series, so paying
// customers are never stranded; admins should toggle status off instead.
export const deleteTestSeries = async (req: Request, res: Response) => {
  const traceId = req.traceId;
  const id = String(req.params.id);
  logger.info("deleteTestSeries invoked", { traceId, path: req.originalUrl, id, userId: req.user?.id });

  try {
    const nid = tsSql.parseAtsId(id);
    if (nid == null) { logger.warn("deleteTestSeries invalid id", { traceId, id }); return failure(res, "Invalid test series id.", 422); }
    const subCount = await tsSql.activeSubCount(nid, new Date());
    if (subCount > 0) {
      logger.warn("deleteTestSeries refused active subs", { traceId, id, subCount });
      return failure(res, `Cannot delete: ${subCount} active subscription(s) reference this series. Toggle status off instead.`, 409);
    }
    const ok = await tsSql.deleteTestSeries(nid);
    if (!ok) { logger.warn("deleteTestSeries not found", { traceId, id }); return failure(res, "Test series not found.", 404); }
    logger.info("deleteTestSeries success", { traceId, id });
    return success(res, { id }, "Test series deleted.");
  } catch (err) {
    logger.error("deleteTestSeries failed", { traceId, id, error: getErrorMessage(err), stack: (err as Error).stack });
    return failure(res, "Failed to delete test series.", 500);
  }
};

export const listContentCategories = async (req: Request, res: Response) => {
  const traceId = req.traceId;
  const testSeriesId = String(req.params.id);
  logger.info("listContentCategories invoked", { traceId, path: req.originalUrl, testSeriesId, userId: req.user?.id });

  try {
    const nid = tsSql.parseAtsId(testSeriesId);
    if (nid == null) { logger.warn("listContentCategories invalid id", { traceId, testSeriesId }); return failure(res, "Invalid test series id.", 422); }
    const { page, limit, skip } = parseListQuery(req.query, { defaultLimit: 10, maxLimit: 500 });
    const r = await tsSql.listContentCategories(nid, { skip, take: limit, page, limit });
    logger.info("listContentCategories success", { traceId, testSeriesId, count: r.pagination.total });
    return res.status(200).json({ success: true, data: r.data, pagination: r.pagination });
  } catch (err) {
    logger.error("listContentCategories failed", { traceId, testSeriesId, error: getErrorMessage(err), stack: (err as Error).stack });
    return failure(res, "Failed to list content categories.", 500);
  }
};

export const createContentCategory = async (req: Request, res: Response) => {
  const traceId = req.traceId;
  const testSeriesId = String(req.params.id);
  logger.info("createContentCategory invoked", { traceId, path: req.originalUrl, testSeriesId, userId: req.user?.id });

  try {
    const sqlSeriesId = tsSql.parseAtsId(testSeriesId);
    if (sqlSeriesId == null) { logger.warn("createContentCategory invalid id", { traceId, testSeriesId }); return failure(res, "Invalid test series id.", 422); }
    if (!(await tsSql.seriesExists(sqlSeriesId))) { logger.warn("createContentCategory series not found", { traceId, testSeriesId }); return failure(res, "Test series not found.", 404); }
    const file = req.file as any;
    if (file?.location) req.body.icon = file.location;
    let data: z.infer<typeof createContentCategorySchema>;
    try {
      data = createContentCategorySchema.parse(req.body);
    } catch (e) {
      if (e instanceof z.ZodError) { logger.warn("createContentCategory validation failed", { traceId, issues: e.issues }); return zodIssueResponse(res, e); }
      throw e;
    }
    const r = await tsSql.createContentCategory(sqlSeriesId, data as any);
    logger.info("createContentCategory success", { traceId, testSeriesId, categoryId: r.category._id });
    return success(res, r, "Content category created.", 201);
  } catch (err) {
    logger.error("createContentCategory failed", { traceId, testSeriesId, error: getErrorMessage(err), stack: (err as Error).stack });
    return failure(res, "Failed to create content category.", 500);
  }
};

export const updateContentCategory = async (req: Request, res: Response) => {
  const traceId = req.traceId;
  const id = String(req.params.categoryId);
  logger.info("updateContentCategory invoked", { traceId, path: req.originalUrl, categoryId: id, userId: req.user?.id });

  try {
    const file = req.file as any;
    if (file?.location) req.body.icon = file.location;
    let data: z.infer<typeof updateContentCategorySchema>;
    try {
      data = updateContentCategorySchema.parse(req.body);
    } catch (e) {
      if (e instanceof z.ZodError) { logger.warn("updateContentCategory validation failed", { traceId, id, issues: e.issues }); return zodIssueResponse(res, e); }
      throw e;
    }
    const nid = tsSql.parseAtsId(id);
    if (nid == null) { logger.warn("updateContentCategory invalid id", { traceId, id }); return failure(res, "Invalid id.", 422); }
    const r = await tsSql.updateContentCategory(nid, data as any);
    if (!r) { logger.warn("updateContentCategory not found", { traceId, id }); return failure(res, "Content category not found.", 404); }
    logger.info("updateContentCategory success", { traceId, id });
    return success(res, r, "Updated.");
  } catch (err) {
    logger.error("updateContentCategory failed", { traceId, id, error: getErrorMessage(err), stack: (err as Error).stack });
    return failure(res, "Failed to update content category.", 500);
  }
};

// Refuses if any paper is still linked to this category.
export const deleteContentCategory = async (req: Request, res: Response) => {
  const traceId = req.traceId;
  const id = String(req.params.categoryId);
  logger.info("deleteContentCategory invoked", { traceId, path: req.originalUrl, categoryId: id, userId: req.user?.id });

  try {
    const nid = tsSql.parseAtsId(id);
    if (nid == null) { logger.warn("deleteContentCategory invalid id", { traceId, id }); return failure(res, "Invalid id.", 422); }
    const linkCount = await tsSql.papersInCategory(nid);
    if (linkCount > 0) {
      logger.warn("deleteContentCategory refused linked papers", { traceId, id, linkCount });
      return failure(res, `Cannot delete: ${linkCount} paper(s) linked to this category. Move or unlink them first.`, 409);
    }
    const ok = await tsSql.deleteContentCategory(nid);
    if (!ok) { logger.warn("deleteContentCategory not found", { traceId, id }); return failure(res, "Content category not found.", 404); }
    logger.info("deleteContentCategory success", { traceId, id });
    return success(res, { id }, "Deleted.");
  } catch (err) {
    logger.error("deleteContentCategory failed", { traceId, id, error: getErrorMessage(err), stack: (err as Error).stack });
    return failure(res, "Failed to delete content category.", 500);
  }
};

export const listPapers = async (req: Request, res: Response) => {
  const traceId = req.traceId;
  const testSeriesId = String(req.params.id);
  logger.info("listPapers invoked", { traceId, path: req.originalUrl, testSeriesId, userId: req.user?.id });

  try {
    const nid = tsSql.parseAtsId(testSeriesId);
    if (nid == null) { logger.warn("listPapers invalid id", { traceId, testSeriesId }); return failure(res, "Invalid test series id.", 422); }
    const { search, page, limit, skip } = parseListQuery(req.query, { defaultLimit: 10, maxLimit: 500 });
    const r = await tsSql.listPapers(nid, { search, skip, take: limit, page, limit });
    logger.info("listPapers success", { traceId, testSeriesId, count: r.pagination.total });
    return res.status(200).json({ success: true, data: r.data, pagination: r.pagination });
  } catch (err) {
    logger.error("listPapers failed", { traceId, testSeriesId, error: getErrorMessage(err), stack: (err as Error).stack });
    return failure(res, "Failed to list papers.", 500);
  }
};

// Attach an exam to one of the series' content categories (409 if already linked).
export const linkPaper = async (req: Request, res: Response) => {
  const traceId = req.traceId;
  const testSeriesId = String(req.params.id);
  logger.info("linkPaper invoked", { traceId, path: req.originalUrl, testSeriesId, userId: req.user?.id });

  try {
    const sqlSeriesId = tsSql.parseAtsId(testSeriesId);
    if (sqlSeriesId == null) { logger.warn("linkPaper invalid id", { traceId, testSeriesId }); return failure(res, "Invalid test series id.", 422); }
    if (!(await tsSql.seriesExists(sqlSeriesId))) { logger.warn("linkPaper series not found", { traceId, testSeriesId }); return failure(res, "Test series not found.", 404); }

    let data: z.infer<typeof linkExamSchema>;
    try {
      data = linkExamSchema.parse(req.body);
    } catch (e) {
      if (e instanceof z.ZodError) { logger.warn("linkPaper validation failed", { traceId, issues: e.issues }); return zodIssueResponse(res, e); }
      throw e;
    }

    const catN = tsSql.parseAtsId(String(data.contentCategoryId));
    const examN = tsSql.parseAtsId(String(data.examId));
    if (catN == null || !(await tsSql.contentCategoryBelongsTo(catN, sqlSeriesId))) {
      logger.warn("linkPaper category mismatch", { traceId, contentCategoryId: data.contentCategoryId, testSeriesId });
      return failure(res, "Content category does not belong to this series.", 422);
    }
    if (examN == null || !(await tsSql.examExists(examN))) {
      logger.warn("linkPaper exam not found", { traceId, examId: data.examId });
      return failure(res, "Exam not found.", 404);
    }
    const r = await tsSql.linkPaper(sqlSeriesId, {
      contentCategoryId: catN,
      examId: examN,
      orderBy: data.orderBy,
      status: data.status,
    });
    if ("duplicate" in r) {
      logger.warn("linkPaper duplicate", { traceId, testSeriesId, examId: data.examId });
      return failure(res, "This exam is already linked to the series.", 409);
    }
    logger.info("linkPaper success", { traceId, testSeriesId, linkId: r.paper._id });
    return success(res, r, "Paper linked.", 201);
  } catch (err) {
    logger.error("linkPaper failed", { traceId, testSeriesId, error: getErrorMessage(err), stack: (err as Error).stack });
    return failure(res, "Failed to link paper.", 500);
  }
};

export const updatePaperLink = async (req: Request, res: Response) => {
  const traceId = req.traceId;
  const linkId = String(req.params.linkId);
  logger.info("updatePaperLink invoked", { traceId, path: req.originalUrl, linkId, userId: req.user?.id });

  try {
    let data: z.infer<typeof updateLinkSchema>;
    try {
      data = updateLinkSchema.parse(req.body);
    } catch (e) {
      if (e instanceof z.ZodError) { logger.warn("updatePaperLink validation failed", { traceId, linkId, issues: e.issues }); return zodIssueResponse(res, e); }
      throw e;
    }
    const nid = tsSql.parseAtsId(linkId);
    if (nid == null) { logger.warn("updatePaperLink invalid id", { traceId, linkId }); return failure(res, "Invalid id.", 422); }
    const link = await tsSql.getPaperLink(nid);
    if (!link) { logger.warn("updatePaperLink not found", { traceId, linkId }); return failure(res, "Paper link not found.", 404); }
    let catN: number | undefined;
    if (data.contentCategoryId !== undefined) {
      catN = tsSql.parseAtsId(String(data.contentCategoryId)) ?? undefined;
      if (catN == null || !(await tsSql.contentCategoryBelongsTo(catN, link.testSeriesId))) {
        logger.warn("updatePaperLink category mismatch", { traceId, linkId, contentCategoryId: data.contentCategoryId });
        return failure(res, "Content category does not belong to this series.", 422);
      }
    }
    const r = await tsSql.updatePaperLink(nid, { contentCategoryId: catN, orderBy: data.orderBy, status: data.status });
    logger.info("updatePaperLink success", { traceId, linkId });
    return success(res, r, "Updated.");
  } catch (err) {
    logger.error("updatePaperLink failed", { traceId, linkId, error: getErrorMessage(err), stack: (err as Error).stack });
    return failure(res, "Failed to update paper link.", 500);
  }
};

export const unlinkPaper = async (req: Request, res: Response) => {
  const traceId = req.traceId;
  const linkId = String(req.params.linkId);
  logger.info("unlinkPaper invoked", { traceId, path: req.originalUrl, linkId, userId: req.user?.id });

  try {
    const nid = tsSql.parseAtsId(linkId);
    if (nid == null) { logger.warn("unlinkPaper invalid id", { traceId, linkId }); return failure(res, "Invalid id.", 422); }
    const freed = await tsSql.unlinkPaper(nid);
    if (freed == null) { logger.warn("unlinkPaper not found", { traceId, linkId }); return failure(res, "Paper link not found.", 404); }
    logger.info("unlinkPaper success", { traceId, linkId });
    return success(res, { id: linkId }, "Unlinked.");
  } catch (err) {
    logger.error("unlinkPaper failed", { traceId, linkId, error: getErrorMessage(err), stack: (err as Error).stack });
    return failure(res, "Failed to unlink paper.", 500);
  }
};

export const listPrices = async (req: Request, res: Response) => {
  const traceId = req.traceId;
  const testSeriesId = String(req.params.id);
  logger.info("listPrices invoked", { traceId, path: req.originalUrl, testSeriesId, userId: req.user?.id });

  try {
    const nid = tsSql.parseAtsId(testSeriesId);
    if (nid == null) { logger.warn("listPrices invalid id", { traceId, testSeriesId }); return failure(res, "Invalid test series id.", 422); }
    const { page, limit, skip } = parseListQuery(req.query, { defaultLimit: 10, maxLimit: 500 });
    const r = await tsSql.listPrices(nid, { skip, take: limit, page, limit });
    logger.info("listPrices success", { traceId, testSeriesId, count: r.pagination.total });
    return res.status(200).json({ success: true, data: r.data, pagination: r.pagination });
  } catch (err) {
    logger.error("listPrices failed", { traceId, testSeriesId, error: getErrorMessage(err), stack: (err as Error).stack });
    return failure(res, "Failed to list prices.", 500);
  }
};

export const createPrice = async (req: Request, res: Response) => {
  const traceId = req.traceId;
  const testSeriesId = String(req.params.id);
  logger.info("createPrice invoked", { traceId, path: req.originalUrl, testSeriesId, userId: req.user?.id });

  try {
    const nid = tsSql.parseAtsId(testSeriesId);
    if (nid == null) { logger.warn("createPrice invalid id", { traceId, testSeriesId }); return failure(res, "Invalid test series id.", 422); }
    if (!(await tsSql.seriesExists(nid))) { logger.warn("createPrice series not found", { traceId, testSeriesId }); return failure(res, "Test series not found.", 404); }
    let data: z.infer<typeof createPriceSchema>;
    try {
      data = createPriceSchema.parse(req.body);
    } catch (e) {
      if (e instanceof z.ZodError) { logger.warn("createPrice validation failed", { traceId, issues: e.issues }); return zodIssueResponse(res, e); }
      throw e;
    }
    const r = await tsSql.createPrice(nid, data as any);
    logger.info("createPrice success", { traceId, testSeriesId, priceId: r.price._id });
    return success(res, r, "Price plan created.", 201);
  } catch (err) {
    logger.error("createPrice failed", { traceId, testSeriesId, error: getErrorMessage(err), stack: (err as Error).stack });
    return failure(res, "Failed to create price plan.", 500);
  }
};

export const updatePrice = async (req: Request, res: Response) => {
  const traceId = req.traceId;
  const priceId = String(req.params.priceId);
  logger.info("updatePrice invoked", { traceId, path: req.originalUrl, priceId, userId: req.user?.id });

  try {
    const nid = tsSql.parseAtsId(priceId);
    if (nid == null) { logger.warn("updatePrice invalid id", { traceId, priceId }); return failure(res, "Invalid price id.", 422); }
    let data: z.infer<typeof updatePriceSchema>;
    try {
      data = updatePriceSchema.parse(req.body);
    } catch (e) {
      if (e instanceof z.ZodError) { logger.warn("updatePrice validation failed", { traceId, priceId, issues: e.issues }); return zodIssueResponse(res, e); }
      throw e;
    }
    const r = await tsSql.updatePrice(nid, data as any);
    if (!r) { logger.warn("updatePrice not found", { traceId, priceId }); return failure(res, "Price plan not found.", 404); }
    if (r === "frozen_terms") { logger.warn("updatePrice frozen terms", { traceId, priceId }); return failure(res, PLAN_TERMS_FROZEN_MESSAGE, 422); }
    logger.info("updatePrice success", { traceId, priceId });
    return success(res, r, "Price plan updated.");
  } catch (err) {
    logger.error("updatePrice failed", { traceId, priceId, error: getErrorMessage(err), stack: (err as Error).stack });
    return failure(res, "Failed to update price plan.", 500);
  }
};

export const deletePrice = async (req: Request, res: Response) => {
  const traceId = req.traceId;
  const priceId = String(req.params.priceId);
  logger.info("deletePrice invoked", { traceId, path: req.originalUrl, priceId, userId: req.user?.id });

  try {
    const nid = tsSql.parseAtsId(priceId);
    if (nid == null) { logger.warn("deletePrice invalid id", { traceId, priceId }); return failure(res, "Invalid price id.", 422); }
    // ALL-TIME: an expired subscription pins the plan exactly as a live one does.
    const inUse = await tsSql.ordersForPlan(nid);
    if (inUse > 0) {
      logger.warn("deletePrice refused: plan in use", { traceId, priceId, inUse });
      return failure(res, planInUseMessage(inUse), 409);
    }
    const ok = await tsSql.deletePrice(nid);
    if (!ok) { logger.warn("deletePrice not found", { traceId, priceId }); return failure(res, "Price plan not found.", 404); }
    logger.info("deletePrice success", { traceId, priceId });
    return success(res, { id: priceId }, "Deleted.");
  } catch (err) {
    logger.error("deletePrice failed", { traceId, priceId, error: getErrorMessage(err), stack: (err as Error).stack });
    return failure(res, "Failed to delete price plan.", 500);
  }
};

export const listSubscriptions = async (req: Request, res: Response) => {
  const traceId = req.traceId;
  logger.info("listSubscriptions invoked", { traceId, path: req.originalUrl, userId: req.user?.id });

  try {
    // Hand-rolled top-level envelope { success, summary, data, pagination }, matching
    // the Course/Package subscription report (docs/REPORTS_SUBSCRIPTIONS_ADMIN.md).
    const q = req.query as Record<string, string>;
    const p = Math.max(1, parseInt(q.page ?? "1", 10) || 1);
    const l = Math.min(100, Math.max(1, parseInt(q.limit ?? "20", 10) || 20));

    const { summary, data, pagination } = await tsSql.listSubscriptions({
      ...parseTestSeriesSubReportQuery(q),
      page: p,
      limit: l,
    });
    logger.info("listSubscriptions success", { traceId, total: pagination.total });
    // Summary cards are super-admin only.
    return res.status(200).json({ success: true, summary: isSuperAdmin(req) ? summary : undefined, data, pagination });
  } catch (err) {
    logger.error("listSubscriptions failed", { traceId, error: getErrorMessage(err), stack: (err as Error).stack });
    return failureFrom(res, err, "Failed to list subscriptions.");
  }
};

// Exports the entire filtered set.
export const exportSubscriptionsCsv = async (req: Request, res: Response) => {
  const traceId = req.traceId;
  logger.info("exportSubscriptionsCsv invoked", { traceId, path: req.originalUrl, userId: req.user?.id });
  try {
    const csv = await tsSql.buildSubscriptionsCsv(parseTestSeriesSubReportQuery(req.query as Record<string, string>));
    const filename = `test-series-subscriptions-${new Date().toISOString().slice(0, 10)}.csv`;
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
    return res.status(200).send(csv);
  } catch (err) {
    logger.error("exportSubscriptionsCsv failed", { traceId, error: getErrorMessage(err), stack: (err as Error).stack });
    return failureFrom(res, err, "Failed to export subscriptions.");
  }
};

// Exports the entire filtered set.
export const exportSubscriptionsExcel = async (req: Request, res: Response) => {
  const traceId = req.traceId;
  logger.info("exportSubscriptionsExcel invoked", { traceId, path: req.originalUrl, userId: req.user?.id });
  try {
    const buf = await tsSql.buildSubscriptionsXlsx(parseTestSeriesSubReportQuery(req.query as Record<string, string>));
    const filename = `test-series-subscriptions-${new Date().toISOString().slice(0, 10)}.xlsx`;
    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
    return res.status(200).send(buf);
  } catch (err) {
    logger.error("exportSubscriptionsExcel failed", { traceId, error: getErrorMessage(err), stack: (err as Error).stack });
    return failureFrom(res, err, "Failed to export subscriptions.");
  }
};

// Admin-side free grant. With planId, durationDays is derived from the plan;
// otherwise the body must supply durationDays.
export const grantSubscription = async (req: Request, res: Response) => {
  const traceId = req.traceId;
  const testSeriesId = String(req.params.id);
  logger.info("grantSubscription invoked", { traceId, path: req.originalUrl, testSeriesId, userId: req.user?.id });

  try {
    const sqlSeriesId = tsSql.parseAtsId(testSeriesId);
    if (sqlSeriesId == null) { logger.warn("grantSubscription invalid id", { traceId, testSeriesId }); return failure(res, "Invalid test series id.", 422); }
    if (!(await tsSql.seriesExists(sqlSeriesId))) { logger.warn("grantSubscription series not found", { traceId, testSeriesId }); return failure(res, "Test series not found.", 404); }

    let data: z.infer<typeof grantSubscriptionSchema>;
    try {
      data = grantSubscriptionSchema.parse(req.body);
    } catch (e) {
      if (e instanceof z.ZodError) { logger.warn("grantSubscription validation failed", { traceId, issues: e.issues }); return zodIssueResponse(res, e); }
      throw e;
    }

    const customerN = tsSql.parseAtsId(String(data.customerId));
    if (customerN == null) { logger.warn("grantSubscription invalid customerId", { traceId, customerId: data.customerId }); return failure(res, "Invalid customerId.", 422); }
    const planN = data.planId != null ? tsSql.parseAtsId(String(data.planId)) : null;
    const r = await tsSql.grantSubscription(sqlSeriesId, {
      customerId: customerN,
      planId: planN,
      durationDays: data.durationDays,
      price: data.price,
      startAt: data.startAt,
      remarks: data.remarks,
      paymentMethod: data.paymentMethod,
      bankTransactionId: data.bankTransactionId ?? null,
      razorpayOrderId: data.razorpayOrderId ?? null,
      razorpayPaymentId: data.razorpayPaymentId ?? null,
      extend: data.extend,
      // Audit: acting admin from the JWT (never from the body).
      actingAdminId: tsSql.parseAtsId(String(req.user?.id ?? "")) ?? null,
    });
    if ("planNotFound" in r) { logger.warn("grantSubscription plan not found", { traceId, planId: data.planId }); return failure(res, "Plan not found.", 404); }
    if ("missingDuration" in r) { logger.warn("grantSubscription missing duration", { traceId, testSeriesId }); return failure(res, "durationDays is required (or supply planId).", 422); }
    // Client test-series list/detail cache `isPurchased` / `activeSubscription` per
    // user for 24h, and the entity sweep can't reach a per-user grant; without this
    // flush the buyer keeps seeing isPurchased:false until the key expires.
    await flushUserRouteCache(customerN);
    logger.info("grantSubscription success", { traceId, testSeriesId, customerId: data.customerId, subscriptionId: r.subscription._id });
    return success(res, { subscription: r.subscription }, "Subscription granted.", 201);
  } catch (err) {
    logger.error("grantSubscription failed", { traceId, testSeriesId, error: getErrorMessage(err), stack: (err as Error).stack });
    return failure(res, "Failed to grant subscription.", 500);
  }
};

// Single record with customer / test series / plan populated for the admin
// Subscription Details page.
export const getSubscription = async (req: Request, res: Response) => {
  const traceId = req.traceId;
  const id = String(req.params.subscriptionId);
  logger.info("getSubscription invoked", { traceId, path: req.originalUrl, subscriptionId: id, userId: req.user?.id });

  try {
    const nid = tsSql.parseAtsId(id);
    if (nid == null) { logger.warn("getSubscription invalid id", { traceId, id }); return failure(res, "Invalid id.", 422); }
    const r = await tsSql.getSubscriptionById(nid);
    if (r === "not_found") { logger.warn("getSubscription not found", { traceId, id }); return failure(res, "Subscription not found.", 404); }
    logger.info("getSubscription success", { traceId, id });
    return success(res, r, "Subscription fetched.");
  } catch (err) {
    logger.error("getSubscription failed", { traceId, id, error: getErrorMessage(err), stack: (err as Error).stack });
    return failure(res, "Failed to fetch subscription.", 500);
  }
};

export const updateSubscription = async (req: Request, res: Response) => {
  const traceId = req.traceId;
  const id = String(req.params.subscriptionId);
  logger.info("updateSubscription invoked", { traceId, path: req.originalUrl, subscriptionId: id, userId: req.user?.id });

  try {
    let data: z.infer<typeof updateSubscriptionSchema>;
    try {
      data = updateSubscriptionSchema.parse(req.body);
    } catch (e) {
      if (e instanceof z.ZodError) { logger.warn("updateSubscription validation failed", { traceId, id, issues: e.issues }); return zodIssueResponse(res, e); }
      throw e;
    }
    const nid = tsSql.parseAtsId(id);
    if (nid == null) { logger.warn("updateSubscription invalid id", { traceId, id }); return failure(res, "Invalid id.", 422); }
    // Revoke path (status:false / endAt pulled back) — resolve the owner before
    // mutating so the cache flush below mirrors the delete handler.
    const customerId = await tsSql.getSubscriptionCustomerId(nid);
    // Audit: acting admin from the JWT stamps updated_by.
    const r = await tsSql.updateSubscription(nid, { ...data, actingAdminId: tsSql.parseAtsId(String(req.user?.id ?? "")) ?? null } as any);
    if (!r) { logger.warn("updateSubscription not found", { traceId, id }); return failure(res, "Subscription not found.", 404); }
    // Test-series listings/details cache isPurchased per user for 24h; drop those
    // keys so the revoke is visible on the next request.
    if (customerId) await flushUserRouteCache(customerId);
    logger.info("updateSubscription success", { traceId, id });
    return success(res, r, "Updated.");
  } catch (err) {
    logger.error("updateSubscription failed", { traceId, id, error: getErrorMessage(err), stack: (err as Error).stack });
    return failure(res, "Failed to update subscription.", 500);
  }
};

export const deleteSubscription = async (req: Request, res: Response) => {
  const traceId = req.traceId;
  const id = String(req.params.subscriptionId);
  logger.info("deleteSubscription invoked", { traceId, path: req.originalUrl, subscriptionId: id, userId: req.user?.id });

  try {
    const nid = tsSql.parseAtsId(id);
    if (nid == null) { logger.warn("deleteSubscription invalid id", { traceId, id }); return failure(res, "Invalid id.", 422); }
    // Resolve the owner BEFORE deleting — the row is gone afterwards.
    const customerId = await tsSql.getSubscriptionCustomerId(nid);
    const ok = await tsSql.deleteSubscription(nid);
    if (!ok) { logger.warn("deleteSubscription not found", { traceId, id }); return failure(res, "Subscription not found.", 404); }
    if (customerId) await flushUserRouteCache(customerId);
    logger.info("deleteSubscription success", { traceId, id });
    return success(res, { id }, "Deleted.");
  } catch (err) {
    logger.error("deleteSubscription failed", { traceId, id, error: getErrorMessage(err), stack: (err as Error).stack });
    return failure(res, "Failed to delete subscription.", 500);
  }
};

export const listOrders = async (req: Request, res: Response) => {
  const traceId = req.traceId;
  logger.info("listOrders invoked", { traceId, path: req.originalUrl, userId: req.user?.id });

  try {
    const { testSeriesId, customerId, status, page = "1", limit = "20" } =
      req.query as Record<string, string>;
    const p = Math.max(1, parseInt(page, 10) || 1);
    const l = Math.min(100, Math.max(1, parseInt(limit, 10) || 20));

    const r = await tsSql.listOrders({
      testSeriesId: testSeriesId ? tsSql.parseAtsId(testSeriesId) : null,
      customerId: customerId ? tsSql.parseAtsId(customerId) : null,
      status: status || null,
      page: p,
      limit: l,
    });
    logger.info("listOrders success", { traceId, total: r.total });
    return success(res, { data: r.data, total: r.total, page: p, limit: l }, "Fetched.");
  } catch (err) {
    logger.error("listOrders failed", { traceId, error: getErrorMessage(err), stack: (err as Error).stack });
    return failure(res, "Failed to list orders.", 500);
  }
};

export const _PaymentMethod = PaymentMethod;
export const _OrderStatus = PackageCourseEbookOrderStatus;
export const _OrderType = PackageCourseEbookOrderType;

// POST /api/v1/admin/test-series/subscriptions/:subscriptionId/add-days
export const addSubscriptionDays = async (req: Request, res: Response) => {
  const traceId = req.traceId;
  const id = Number(req.params.subscriptionId);
  try {
    const input = req.body as { days: number; remark?: string };
    const actingAdminId = tsSql.parseAtsId(String(req.user?.id ?? "")) ?? null;
    const r = await tsSql.addSubscriptionDays(id, { ...input, actingAdminId });
    if (!r) return failure(res, "Subscription not found.", 404);
    if (r.customerId) await flushUserRouteCache(r.customerId);
    return success(res, { subscription: r.subscription }, "Days added.");
  } catch (err) {
    logger.error("addSubscriptionDays failed", { traceId, id, error: getErrorMessage(err), stack: (err as Error).stack });
    return failure(res, "Failed to add days.", 500);
  }
};
