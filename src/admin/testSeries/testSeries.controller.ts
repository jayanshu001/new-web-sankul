import { Request, Response } from "express";
import mongoose from "mongoose";
import { z } from "zod";
import { TestSeries } from "../../models/testSeries/TestSeries.model";
import { TestSeriesContentCategory } from "../../models/testSeries/TestSeriesContentCategory.model";
import { TestSeriesExam } from "../../models/testSeries/TestSeriesExam.model";
import { TestSeriesPrice } from "../../models/testSeries/TestSeriesPrice.model";
import { TestSeriesOrder } from "../../models/testSeries/TestSeriesOrder.model";
import { TestSeriesSubscription } from "../../models/testSeries/TestSeriesSubscription.model";
import { Exam } from "../../models/exam/Exam.model";
import { PackageCourseEbookPaymentType, PaymentMethod, PackageCourseEbookOrderStatus, PackageCourseEbookOrderType } from "../../models/enums";
import { success, failure, getErrorMessage } from "../../utils/httpResponse";
import { buildRegexCondition } from "../../utils/searchFilter";
import logger from "../../utils/logger";
import * as tsSql from "../../modules/admin-testseries/admin-testseries.service";
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

const isObjectId = (v: string) => mongoose.Types.ObjectId.isValid(v);

// The Customer model stores firstName/middleName/lastName, phoneNumber and
// emailAddress — there is no flat `name`/`phone`/`email`. The admin FE renders
// `name || phone || email || id`, so after populating the real fields we shape
// the customer into that contract (with a `name` composed from the name parts)
// so the table shows the customer's name instead of a bare ObjectId.
const POPULATE_CUSTOMER = "firstName middleName lastName phoneNumber emailAddress";
const shapeCustomer = (c: any) => {
  if (!c || typeof c !== "object") return c; // unpopulated (bare id) or null — leave as-is
  const name = [c.firstName, c.middleName, c.lastName]
    .filter((p) => typeof p === "string" && p.trim())
    .join(" ")
    .trim();
  return {
    _id: c._id,
    name: name || null,
    phone: c.phoneNumber ?? null,
    email: c.emailAddress ?? null,
  };
};
const withShapedCustomer = (rows: any[]) =>
  rows.map((r) => ({ ...r, customerId: shapeCustomer(r.customerId) }));

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

// During the migration window we accept either the array (`examCategoryIds`) or
// the legacy single field (`examCategoryId`) and keep both in sync on write, so
// old and new readers stay correct. Returns the props to persist, or {} when the
// caller sent neither (e.g. partial update untouched).
function resolveCategoryWrite(
  data: { examCategoryIds?: string[]; examCategoryId?: string | null }
): { examCategoryIds?: any[]; examCategoryId?: any } {
  if (data.examCategoryIds !== undefined) {
    const ids = data.examCategoryIds;
    return { examCategoryIds: ids, examCategoryId: ids[0] ?? null };
  }
  if (data.examCategoryId !== undefined) {
    const single = data.examCategoryId;
    return { examCategoryIds: single ? [single] : [], examCategoryId: single ?? null };
  }
  return {};
}

// Recompute denormalized paper count for a series.
async function recomputePaperCount(testSeriesId: string | mongoose.Types.ObjectId) {
  const count = await TestSeriesExam.countDocuments({ testSeriesId, status: true });
  await TestSeries.updateOne({ _id: testSeriesId }, { $set: { paperCount: count } });
}

// A paid series (isFree === false) must have at least one active price plan, so
// it never ends up unpurchasable. `isFreeNow` is the series' isFree AFTER this
// write (so a partial update that doesn't touch isFree falls back to current).
// Returns an error message to reject with, or null when the guard passes.
async function assertPaidHasPlan(
  testSeriesId: string | mongoose.Types.ObjectId,
  isFreeNow: boolean
): Promise<string | null> {
  if (isFreeNow) return null;
  const hasPlan = await TestSeriesPrice.exists({ testSeriesId, status: true });
  if (!hasPlan) {
    return "A paid test series must have at least one active price plan. Add a plan or mark the series free.";
  }
  return null;
}

// The default-plan preview each list row carries so the admin list doesn't have
// to fetch /prices per series. Default plan wins, else cheapest active plan.
async function buildDefaultPlanMap(seriesIds: mongoose.Types.ObjectId[]) {
  const map = new Map<string, any>();
  if (!seriesIds.length) return map;
  const plans = await TestSeriesPrice.find({
    testSeriesId: { $in: seriesIds },
    status: true,
  })
    .select("_id name durationDays price originalPrice isDefault status testSeriesId")
    .sort({ isDefault: -1, price: 1 })
    .lean();
  for (const p of plans as any[]) {
    const k = String(p.testSeriesId);
    if (!map.has(k)) {
      map.set(k, {
        _id: p._id,
        name: p.name ?? null,
        durationDays: p.durationDays,
        price: p.price,
        originalPrice: p.originalPrice ?? null,
        isDefault: p.isDefault,
        status: p.status,
      });
    }
  }
  return map;
}

// ─── Test Series CRUD ────────────────────────────────────────────────────────

// GET /api/v1/admin/test-series
export const listTestSeries = async (req: Request, res: Response) => {
  const traceId = req.traceId;
  logger.info("listTestSeries invoked", { traceId, path: req.originalUrl, userId: req.user?.id });

  try {
    const { search, status, examCategoryId, examCategoryIds, page = "1", limit = "20" } =
      req.query as Record<string, any>;

    if (tsSql.isAdminTestSeriesMysql()) {
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
    }

    const filter: any = {};
    { const c = buildRegexCondition(search); if (c) filter.title = c; }
    if (status === "true" || status === "false") filter.status = status === "true";

    // Accept `examCategoryId` (legacy single) or `examCategoryIds` (array via
    // repeated query param). Match against the new array field, and—during the
    // migration window—the legacy single field for not-yet-backfilled docs.
    const rawCats = examCategoryIds ?? examCategoryId;
    const catIds = (Array.isArray(rawCats) ? rawCats : rawCats ? [rawCats] : [])
      .map(String)
      .filter((c) => isObjectId(c));
    if (catIds.length) {
      filter.$or = [
        { examCategoryIds: { $in: catIds } },
        { examCategoryId: { $in: catIds } },
      ];
    }

    const p = Math.max(1, parseInt(page, 10) || 1);
    const l = Math.min(100, Math.max(1, parseInt(limit, 10) || 20));

    const [rows, total] = await Promise.all([
      TestSeries.find(filter)
        .sort({ orderBy: 1, createdAt: -1 })
        .skip((p - 1) * l)
        .limit(l)
        .lean(),
      TestSeries.countDocuments(filter),
    ]);

    // Attach a default-plan preview per row so the admin list doesn't fire a
    // /prices request per series.
    const defaultPlanByid = await buildDefaultPlanMap(rows.map((r) => r._id));
    const data = rows.map((r) => ({
      ...r,
      defaultPlan: defaultPlanByid.get(String(r._id)) ?? null,
    }));

    logger.info("listTestSeries success", { traceId, total });
    return success(res, { data, total, page: p, limit: l }, "Fetched.");
  } catch (err) {
    logger.error("listTestSeries failed", { traceId, error: getErrorMessage(err), stack: (err as Error).stack });
    return failure(res, "Failed to list test series.", 500);
  }
};

// GET /api/v1/admin/test-series/:id
export const getTestSeriesById = async (req: Request, res: Response) => {
  const traceId = req.traceId;
  const id = String(req.params.id);
  logger.info("getTestSeriesById invoked", { traceId, path: req.originalUrl, id, userId: req.user?.id });

  try {
    if (tsSql.isAdminTestSeriesMysql()) {
      const nid = tsSql.parseAtsId(id);
      if (nid == null) { logger.warn("getTestSeriesById invalid id", { traceId, id }); return failure(res, "Invalid test series id.", 422); }
      const r = await tsSql.getTestSeriesById(nid);
      if (!r) { logger.warn("getTestSeriesById not found", { traceId, id }); return failure(res, "Test series not found.", 404); }
      logger.info("getTestSeriesById success", { traceId, id });
      return success(res, r, "Fetched.");
    }
    if (!isObjectId(id)) { logger.warn("getTestSeriesById invalid id", { traceId, id }); return failure(res, "Invalid test series id.", 422); }
    const series = await TestSeries.findById(id).lean();
    if (!series) { logger.warn("getTestSeriesById not found", { traceId, id }); return failure(res, "Test series not found.", 404); }

    const [contentCategories, prices, papers] = await Promise.all([
      TestSeriesContentCategory.find({ testSeriesId: id })
        .sort({ orderBy: 1, name: 1 })
        .lean(),
      TestSeriesPrice.find({ testSeriesId: id }).sort({ isDefault: -1, price: 1 }).lean(),
      TestSeriesExam.find({ testSeriesId: id })
        .sort({ orderBy: 1, createdAt: 1 })
        .populate("examId", "title durationMinutes questionCount language")
        .lean(),
    ]);

    logger.info("getTestSeriesById success", { traceId, id });
    return success(
      res,
      { series, contentCategories, prices, papers },
      "Fetched."
    );
  } catch (err) {
    logger.error("getTestSeriesById failed", { traceId, id, error: getErrorMessage(err), stack: (err as Error).stack });
    return failure(res, "Failed to fetch test series.", 500);
  }
};

// POST /api/v1/admin/test-series
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
    if (tsSql.isAdminTestSeriesMysql()) {
      const r = await tsSql.createTestSeries(data as any);
      logger.info("createTestSeries success", { traceId, id: r.series._id });
      return success(res, r, "Test series created.", 201);
    }
    // An explicit empty-string thumbnail means "no thumbnail" — drop it so the
    // doc is created without one rather than storing "".
    if (data.thumbnail === "") delete (data as any).thumbnail;
    const series = await TestSeries.create({ ...data, ...resolveCategoryWrite(data) });
    logger.info("createTestSeries success", { traceId, id: series._id });
    return success(res, { series }, "Test series created.", 201);
  } catch (err) {
    logger.error("createTestSeries failed", { traceId, error: getErrorMessage(err), stack: (err as Error).stack });
    return failure(res, "Failed to create test series.", 500);
  }
};

// PUT /api/v1/admin/test-series/:id
export const updateTestSeries = async (req: Request, res: Response) => {
  const traceId = req.traceId;
  const id = String(req.params.id);
  logger.info("updateTestSeries invoked", { traceId, path: req.originalUrl, id, userId: req.user?.id });

  try {
    const isSql = tsSql.isAdminTestSeriesMysql();
    if (!isSql && !isObjectId(id)) { logger.warn("updateTestSeries invalid id", { traceId, id }); return failure(res, "Invalid test series id.", 422); }
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

    if (isSql) {
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
    }

    const existing = await TestSeries.findById(id).select("isFree").lean();
    if (!existing) { logger.warn("updateTestSeries not found", { traceId, id }); return failure(res, "Test series not found.", 404); }

    // Paid series must have at least one active price plan. Evaluate against the
    // isFree value this update lands on (the incoming value if provided, else
    // the stored one). Guarded here (not on create) because plans are added via
    // the separate /prices endpoints AFTER the series exists.
    const isFreeNow = data.isFree !== undefined ? !!data.isFree : !!existing.isFree;
    const planErr = await assertPaidHasPlan(id, isFreeNow);
    if (planErr) { logger.warn("updateTestSeries paid-without-plan", { traceId, id }); return failure(res, planErr, 422); }

    // An empty-string thumbnail means "remove the thumbnail" — $unset it rather
    // than storing "". A missing thumbnail field still means "no change".
    const { thumbnail, ...rest } = data as any;
    const setOps: any = { ...rest, ...resolveCategoryWrite(data) };
    const updateDoc: any = { $set: setOps };
    if (thumbnail === "") {
      updateDoc.$unset = { thumbnail: "" };
    } else if (thumbnail !== undefined) {
      setOps.thumbnail = thumbnail;
    }

    const series = await TestSeries.findByIdAndUpdate(id, updateDoc, { new: true });
    if (!series) { logger.warn("updateTestSeries not found", { traceId, id }); return failure(res, "Test series not found.", 404); }
    logger.info("updateTestSeries success", { traceId, id });
    return success(res, { series }, "Test series updated.");
  } catch (err) {
    logger.error("updateTestSeries failed", { traceId, id, error: getErrorMessage(err), stack: (err as Error).stack });
    return failure(res, "Failed to update test series.", 500);
  }
};

// DELETE /api/v1/admin/test-series/:id
// Refuses if any verified subscription points at this series — prevents
// stranding paying customers. Admins should toggle status off instead.
export const deleteTestSeries = async (req: Request, res: Response) => {
  const traceId = req.traceId;
  const id = String(req.params.id);
  logger.info("deleteTestSeries invoked", { traceId, path: req.originalUrl, id, userId: req.user?.id });

  try {
    if (tsSql.isAdminTestSeriesMysql()) {
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
    }
    if (!isObjectId(id)) { logger.warn("deleteTestSeries invalid id", { traceId, id }); return failure(res, "Invalid test series id.", 422); }
    const subCount = await TestSeriesSubscription.countDocuments({
      testSeriesId: id,
      status: true,
      endAt: { $gt: new Date() },
    });
    if (subCount > 0) {
      logger.warn("deleteTestSeries refused active subs", { traceId, id, subCount });
      return failure(
        res,
        `Cannot delete: ${subCount} active subscription(s) reference this series. Toggle status off instead.`,
        409
      );
    }
    await TestSeriesExam.deleteMany({ testSeriesId: id });
    await TestSeriesContentCategory.deleteMany({ testSeriesId: id });
    await TestSeriesPrice.deleteMany({ testSeriesId: id });
    const out = await TestSeries.findByIdAndDelete(id);
    if (!out) { logger.warn("deleteTestSeries not found", { traceId, id }); return failure(res, "Test series not found.", 404); }
    logger.info("deleteTestSeries success", { traceId, id });
    return success(res, { id }, "Test series deleted.");
  } catch (err) {
    logger.error("deleteTestSeries failed", { traceId, id, error: getErrorMessage(err), stack: (err as Error).stack });
    return failure(res, "Failed to delete test series.", 500);
  }
};

// ─── Content Categories ──────────────────────────────────────────────────────

// GET /api/v1/admin/test-series/:id/content-categories
export const listContentCategories = async (req: Request, res: Response) => {
  const traceId = req.traceId;
  const testSeriesId = String(req.params.id);
  logger.info("listContentCategories invoked", { traceId, path: req.originalUrl, testSeriesId, userId: req.user?.id });

  try {
    if (tsSql.isAdminTestSeriesMysql()) {
      const nid = tsSql.parseAtsId(testSeriesId);
      if (nid == null) { logger.warn("listContentCategories invalid id", { traceId, testSeriesId }); return failure(res, "Invalid test series id.", 422); }
      const r = await tsSql.listContentCategories(nid);
      logger.info("listContentCategories success", { traceId, testSeriesId, count: r.total });
      return success(res, r, "Fetched.");
    }
    if (!isObjectId(testSeriesId)) { logger.warn("listContentCategories invalid id", { traceId, testSeriesId }); return failure(res, "Invalid test series id.", 422); }
    const rows = await TestSeriesContentCategory.find({ testSeriesId })
      .sort({ orderBy: 1, name: 1 })
      .lean();
    logger.info("listContentCategories success", { traceId, testSeriesId, count: rows.length });
    return success(res, { data: rows, total: rows.length }, "Fetched.");
  } catch (err) {
    logger.error("listContentCategories failed", { traceId, testSeriesId, error: getErrorMessage(err), stack: (err as Error).stack });
    return failure(res, "Failed to list content categories.", 500);
  }
};

// POST /api/v1/admin/test-series/:id/content-categories
export const createContentCategory = async (req: Request, res: Response) => {
  const traceId = req.traceId;
  const testSeriesId = String(req.params.id);
  logger.info("createContentCategory invoked", { traceId, path: req.originalUrl, testSeriesId, userId: req.user?.id });

  try {
    const isSql = tsSql.isAdminTestSeriesMysql();
    let sqlSeriesId: number | null = null;
    if (isSql) {
      sqlSeriesId = tsSql.parseAtsId(testSeriesId);
      if (sqlSeriesId == null) { logger.warn("createContentCategory invalid id", { traceId, testSeriesId }); return failure(res, "Invalid test series id.", 422); }
      if (!(await tsSql.seriesExists(sqlSeriesId))) { logger.warn("createContentCategory series not found", { traceId, testSeriesId }); return failure(res, "Test series not found.", 404); }
    } else {
      if (!isObjectId(testSeriesId)) { logger.warn("createContentCategory invalid id", { traceId, testSeriesId }); return failure(res, "Invalid test series id.", 422); }
      if (!(await TestSeries.exists({ _id: testSeriesId }))) {
        logger.warn("createContentCategory series not found", { traceId, testSeriesId });
        return failure(res, "Test series not found.", 404);
      }
    }
    const file = req.file as any;
    if (file?.location) req.body.icon = file.location;
    let data: z.infer<typeof createContentCategorySchema>;
    try {
      data = createContentCategorySchema.parse(req.body);
    } catch (e) {
      if (e instanceof z.ZodError) { logger.warn("createContentCategory validation failed", { traceId, issues: e.issues }); return zodIssueResponse(res, e); }
      throw e;
    }
    if (isSql) {
      const r = await tsSql.createContentCategory(sqlSeriesId!, data as any);
      logger.info("createContentCategory success", { traceId, testSeriesId, categoryId: r.category._id });
      return success(res, r, "Content category created.", 201);
    }
    const cat = await TestSeriesContentCategory.create({ ...data, testSeriesId });
    logger.info("createContentCategory success", { traceId, testSeriesId, categoryId: cat._id });
    return success(res, { category: cat }, "Content category created.", 201);
  } catch (err) {
    logger.error("createContentCategory failed", { traceId, testSeriesId, error: getErrorMessage(err), stack: (err as Error).stack });
    return failure(res, "Failed to create content category.", 500);
  }
};

// PUT /api/v1/admin/test-series/content-categories/:categoryId
export const updateContentCategory = async (req: Request, res: Response) => {
  const traceId = req.traceId;
  const id = String(req.params.categoryId);
  logger.info("updateContentCategory invoked", { traceId, path: req.originalUrl, categoryId: id, userId: req.user?.id });

  try {
    const isSql = tsSql.isAdminTestSeriesMysql();
    if (!isSql && !isObjectId(id)) { logger.warn("updateContentCategory invalid id", { traceId, id }); return failure(res, "Invalid id.", 422); }
    const file = req.file as any;
    if (file?.location) req.body.icon = file.location;
    let data: z.infer<typeof updateContentCategorySchema>;
    try {
      data = updateContentCategorySchema.parse(req.body);
    } catch (e) {
      if (e instanceof z.ZodError) { logger.warn("updateContentCategory validation failed", { traceId, id, issues: e.issues }); return zodIssueResponse(res, e); }
      throw e;
    }
    if (isSql) {
      const nid = tsSql.parseAtsId(id);
      if (nid == null) { logger.warn("updateContentCategory invalid id", { traceId, id }); return failure(res, "Invalid id.", 422); }
      const r = await tsSql.updateContentCategory(nid, data as any);
      if (!r) { logger.warn("updateContentCategory not found", { traceId, id }); return failure(res, "Content category not found.", 404); }
      logger.info("updateContentCategory success", { traceId, id });
      return success(res, r, "Updated.");
    }
    const cat = await TestSeriesContentCategory.findByIdAndUpdate(id, data, { new: true });
    if (!cat) { logger.warn("updateContentCategory not found", { traceId, id }); return failure(res, "Content category not found.", 404); }
    logger.info("updateContentCategory success", { traceId, id });
    return success(res, { category: cat }, "Updated.");
  } catch (err) {
    logger.error("updateContentCategory failed", { traceId, id, error: getErrorMessage(err), stack: (err as Error).stack });
    return failure(res, "Failed to update content category.", 500);
  }
};

// DELETE /api/v1/admin/test-series/content-categories/:categoryId
// Refuses if any paper is still linked to this category.
export const deleteContentCategory = async (req: Request, res: Response) => {
  const traceId = req.traceId;
  const id = String(req.params.categoryId);
  logger.info("deleteContentCategory invoked", { traceId, path: req.originalUrl, categoryId: id, userId: req.user?.id });

  try {
    if (tsSql.isAdminTestSeriesMysql()) {
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
    }
    if (!isObjectId(id)) { logger.warn("deleteContentCategory invalid id", { traceId, id }); return failure(res, "Invalid id.", 422); }
    const linkCount = await TestSeriesExam.countDocuments({ contentCategoryId: id });
    if (linkCount > 0) {
      logger.warn("deleteContentCategory refused linked papers", { traceId, id, linkCount });
      return failure(
        res,
        `Cannot delete: ${linkCount} paper(s) linked to this category. Move or unlink them first.`,
        409
      );
    }
    const out = await TestSeriesContentCategory.findByIdAndDelete(id);
    if (!out) { logger.warn("deleteContentCategory not found", { traceId, id }); return failure(res, "Content category not found.", 404); }
    logger.info("deleteContentCategory success", { traceId, id });
    return success(res, { id }, "Deleted.");
  } catch (err) {
    logger.error("deleteContentCategory failed", { traceId, id, error: getErrorMessage(err), stack: (err as Error).stack });
    return failure(res, "Failed to delete content category.", 500);
  }
};

// ─── Series ↔ Exam linking ───────────────────────────────────────────────────

// GET /api/v1/admin/test-series/:id/papers
export const listPapers = async (req: Request, res: Response) => {
  const traceId = req.traceId;
  const testSeriesId = String(req.params.id);
  logger.info("listPapers invoked", { traceId, path: req.originalUrl, testSeriesId, userId: req.user?.id });

  try {
    if (tsSql.isAdminTestSeriesMysql()) {
      const nid = tsSql.parseAtsId(testSeriesId);
      if (nid == null) { logger.warn("listPapers invalid id", { traceId, testSeriesId }); return failure(res, "Invalid test series id.", 422); }
      const r = await tsSql.listPapers(nid);
      logger.info("listPapers success", { traceId, testSeriesId, count: r.total });
      return success(res, r, "Fetched.");
    }
    if (!isObjectId(testSeriesId)) { logger.warn("listPapers invalid id", { traceId, testSeriesId }); return failure(res, "Invalid test series id.", 422); }
    const rows = await TestSeriesExam.find({ testSeriesId })
      .sort({ orderBy: 1, createdAt: 1 })
      .populate("examId", "title durationMinutes questionCount language status")
      .populate("contentCategoryId", "name")
      .lean();
    logger.info("listPapers success", { traceId, testSeriesId, count: rows.length });
    return success(res, { data: rows, total: rows.length }, "Fetched.");
  } catch (err) {
    logger.error("listPapers failed", { traceId, testSeriesId, error: getErrorMessage(err), stack: (err as Error).stack });
    return failure(res, "Failed to list papers.", 500);
  }
};

// POST /api/v1/admin/test-series/:id/papers
export const linkPaper = async (req: Request, res: Response) => {
  const traceId = req.traceId;
  const testSeriesId = String(req.params.id);
  logger.info("linkPaper invoked", { traceId, path: req.originalUrl, testSeriesId, userId: req.user?.id });

  try {
    const isSql = tsSql.isAdminTestSeriesMysql();
    let sqlSeriesId: number | null = null;
    if (isSql) {
      sqlSeriesId = tsSql.parseAtsId(testSeriesId);
      if (sqlSeriesId == null) { logger.warn("linkPaper invalid id", { traceId, testSeriesId }); return failure(res, "Invalid test series id.", 422); }
      if (!(await tsSql.seriesExists(sqlSeriesId))) { logger.warn("linkPaper series not found", { traceId, testSeriesId }); return failure(res, "Test series not found.", 404); }
    } else {
      if (!isObjectId(testSeriesId)) { logger.warn("linkPaper invalid id", { traceId, testSeriesId }); return failure(res, "Invalid test series id.", 422); }
      if (!(await TestSeries.exists({ _id: testSeriesId }))) {
        logger.warn("linkPaper series not found", { traceId, testSeriesId });
        return failure(res, "Test series not found.", 404);
      }
    }

    let data: z.infer<typeof linkExamSchema>;
    try {
      data = linkExamSchema.parse(req.body);
    } catch (e) {
      if (e instanceof z.ZodError) { logger.warn("linkPaper validation failed", { traceId, issues: e.issues }); return zodIssueResponse(res, e); }
      throw e;
    }

    if (isSql) {
      const catN = tsSql.parseAtsId(String(data.contentCategoryId));
      const examN = tsSql.parseAtsId(String(data.examId));
      if (catN == null || !(await tsSql.contentCategoryBelongsTo(catN, sqlSeriesId!))) {
        logger.warn("linkPaper category mismatch", { traceId, contentCategoryId: data.contentCategoryId, testSeriesId });
        return failure(res, "Content category does not belong to this series.", 422);
      }
      if (examN == null || !(await tsSql.examExists(examN))) {
        logger.warn("linkPaper exam not found", { traceId, examId: data.examId });
        return failure(res, "Exam not found.", 404);
      }
      const r = await tsSql.linkPaper(sqlSeriesId!, {
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
    }

    // Validate that contentCategoryId belongs to this series and the exam exists.
    const [catOk, examOk] = await Promise.all([
      TestSeriesContentCategory.exists({
        _id: data.contentCategoryId,
        testSeriesId,
      }),
      Exam.exists({ _id: data.examId }),
    ]);
    if (!catOk) { logger.warn("linkPaper category mismatch", { traceId, contentCategoryId: data.contentCategoryId, testSeriesId }); return failure(res, "Content category does not belong to this series.", 422); }
    if (!examOk) { logger.warn("linkPaper exam not found", { traceId, examId: data.examId }); return failure(res, "Exam not found.", 404); }

    try {
      const row = await TestSeriesExam.create({ ...data, testSeriesId });
      await recomputePaperCount(testSeriesId);
      logger.info("linkPaper success", { traceId, testSeriesId, linkId: row._id });
      return success(res, { paper: row }, "Paper linked.", 201);
    } catch (e: any) {
      if (e.code === 11000) {
        logger.warn("linkPaper duplicate", { traceId, testSeriesId, examId: data.examId });
        return failure(res, "This exam is already linked to the series.", 409);
      }
      throw e;
    }
  } catch (err) {
    logger.error("linkPaper failed", { traceId, testSeriesId, error: getErrorMessage(err), stack: (err as Error).stack });
    return failure(res, "Failed to link paper.", 500);
  }
};

// PUT /api/v1/admin/test-series/papers/:linkId
export const updatePaperLink = async (req: Request, res: Response) => {
  const traceId = req.traceId;
  const linkId = String(req.params.linkId);
  logger.info("updatePaperLink invoked", { traceId, path: req.originalUrl, linkId, userId: req.user?.id });

  try {
    const isSql = tsSql.isAdminTestSeriesMysql();
    if (!isSql && !isObjectId(linkId)) { logger.warn("updatePaperLink invalid id", { traceId, linkId }); return failure(res, "Invalid id.", 422); }
    let data: z.infer<typeof updateLinkSchema>;
    try {
      data = updateLinkSchema.parse(req.body);
    } catch (e) {
      if (e instanceof z.ZodError) { logger.warn("updatePaperLink validation failed", { traceId, linkId, issues: e.issues }); return zodIssueResponse(res, e); }
      throw e;
    }
    if (isSql) {
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
    }
    const existing = await TestSeriesExam.findById(linkId);
    if (!existing) { logger.warn("updatePaperLink not found", { traceId, linkId }); return failure(res, "Paper link not found.", 404); }

    if (data.contentCategoryId) {
      const catOk = await TestSeriesContentCategory.exists({
        _id: data.contentCategoryId,
        testSeriesId: existing.testSeriesId,
      });
      if (!catOk) { logger.warn("updatePaperLink category mismatch", { traceId, linkId, contentCategoryId: data.contentCategoryId }); return failure(res, "Content category does not belong to this series.", 422); }
    }

    Object.assign(existing, data);
    await existing.save();
    await recomputePaperCount(existing.testSeriesId);
    logger.info("updatePaperLink success", { traceId, linkId });
    return success(res, { paper: existing }, "Updated.");
  } catch (err) {
    logger.error("updatePaperLink failed", { traceId, linkId, error: getErrorMessage(err), stack: (err as Error).stack });
    return failure(res, "Failed to update paper link.", 500);
  }
};

// DELETE /api/v1/admin/test-series/papers/:linkId
export const unlinkPaper = async (req: Request, res: Response) => {
  const traceId = req.traceId;
  const linkId = String(req.params.linkId);
  logger.info("unlinkPaper invoked", { traceId, path: req.originalUrl, linkId, userId: req.user?.id });

  try {
    if (tsSql.isAdminTestSeriesMysql()) {
      const nid = tsSql.parseAtsId(linkId);
      if (nid == null) { logger.warn("unlinkPaper invalid id", { traceId, linkId }); return failure(res, "Invalid id.", 422); }
      const freed = await tsSql.unlinkPaper(nid);
      if (freed == null) { logger.warn("unlinkPaper not found", { traceId, linkId }); return failure(res, "Paper link not found.", 404); }
      logger.info("unlinkPaper success", { traceId, linkId });
      return success(res, { id: linkId }, "Unlinked.");
    }
    if (!isObjectId(linkId)) { logger.warn("unlinkPaper invalid id", { traceId, linkId }); return failure(res, "Invalid id.", 422); }
    const out = await TestSeriesExam.findByIdAndDelete(linkId);
    if (!out) { logger.warn("unlinkPaper not found", { traceId, linkId }); return failure(res, "Paper link not found.", 404); }
    await recomputePaperCount(out.testSeriesId);
    logger.info("unlinkPaper success", { traceId, linkId });
    return success(res, { id: linkId }, "Unlinked.");
  } catch (err) {
    logger.error("unlinkPaper failed", { traceId, linkId, error: getErrorMessage(err), stack: (err as Error).stack });
    return failure(res, "Failed to unlink paper.", 500);
  }
};

// ─── Prices ──────────────────────────────────────────────────────────────────

// GET /api/v1/admin/test-series/:id/prices
export const listPrices = async (req: Request, res: Response) => {
  const traceId = req.traceId;
  const testSeriesId = String(req.params.id);
  logger.info("listPrices invoked", { traceId, path: req.originalUrl, testSeriesId, userId: req.user?.id });

  try {
    if (tsSql.isAdminTestSeriesMysql()) {
      const nid = tsSql.parseAtsId(testSeriesId);
      if (nid == null) { logger.warn("listPrices invalid id", { traceId, testSeriesId }); return failure(res, "Invalid test series id.", 422); }
      const r = await tsSql.listPrices(nid);
      logger.info("listPrices success", { traceId, testSeriesId, count: r.total });
      return success(res, r, "Fetched.");
    }
    if (!isObjectId(testSeriesId)) { logger.warn("listPrices invalid id", { traceId, testSeriesId }); return failure(res, "Invalid test series id.", 422); }
    const rows = await TestSeriesPrice.find({ testSeriesId })
      .sort({ isDefault: -1, price: 1, createdAt: 1 })
      .lean();
    logger.info("listPrices success", { traceId, testSeriesId, count: rows.length });
    return success(res, { data: rows, total: rows.length }, "Fetched.");
  } catch (err) {
    logger.error("listPrices failed", { traceId, testSeriesId, error: getErrorMessage(err), stack: (err as Error).stack });
    return failure(res, "Failed to list prices.", 500);
  }
};

// POST /api/v1/admin/test-series/:id/prices
export const createPrice = async (req: Request, res: Response) => {
  const traceId = req.traceId;
  const testSeriesId = String(req.params.id);
  logger.info("createPrice invoked", { traceId, path: req.originalUrl, testSeriesId, userId: req.user?.id });

  const isSql = tsSql.isAdminTestSeriesMysql();
  if (isSql) {
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
  }

  const txn = await mongoose.startSession();
  try {
    if (!isObjectId(testSeriesId)) { logger.warn("createPrice invalid id", { traceId, testSeriesId }); return failure(res, "Invalid test series id.", 422); }
    if (!(await TestSeries.exists({ _id: testSeriesId }))) {
      logger.warn("createPrice series not found", { traceId, testSeriesId });
      return failure(res, "Test series not found.", 404);
    }

    let data: z.infer<typeof createPriceSchema>;
    try {
      data = createPriceSchema.parse(req.body);
    } catch (e) {
      if (e instanceof z.ZodError) { logger.warn("createPrice validation failed", { traceId, issues: e.issues }); return zodIssueResponse(res, e); }
      throw e;
    }

    txn.startTransaction();
    if (data.isDefault) {
      await TestSeriesPrice.updateMany(
        { testSeriesId, isDefault: true },
        { $set: { isDefault: false } },
        { session: txn }
      );
    }
    const [price] = await TestSeriesPrice.create([{ ...data, testSeriesId }], { session: txn });
    await txn.commitTransaction();
    logger.info("createPrice success", { traceId, testSeriesId, priceId: price._id });
    return success(res, { price: price.toObject() }, "Price plan created.", 201);
  } catch (err) {
    if (txn.inTransaction()) await txn.abortTransaction();
    logger.error("createPrice failed", { traceId, testSeriesId, error: getErrorMessage(err), stack: (err as Error).stack });
    return failure(res, "Failed to create price plan.", 500);
  } finally {
    txn.endSession();
  }
};

// PUT /api/v1/admin/test-series/prices/:priceId
export const updatePrice = async (req: Request, res: Response) => {
  const traceId = req.traceId;
  const priceId = String(req.params.priceId);
  logger.info("updatePrice invoked", { traceId, path: req.originalUrl, priceId, userId: req.user?.id });

  const isSql = tsSql.isAdminTestSeriesMysql();
  if (isSql) {
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
      logger.info("updatePrice success", { traceId, priceId });
      return success(res, r, "Price plan updated.");
    } catch (err) {
      logger.error("updatePrice failed", { traceId, priceId, error: getErrorMessage(err), stack: (err as Error).stack });
      return failure(res, "Failed to update price plan.", 500);
    }
  }

  const txn = await mongoose.startSession();
  try {
    if (!isObjectId(priceId)) { logger.warn("updatePrice invalid id", { traceId, priceId }); return failure(res, "Invalid price id.", 422); }
    let data: z.infer<typeof updatePriceSchema>;
    try {
      data = updatePriceSchema.parse(req.body);
    } catch (e) {
      if (e instanceof z.ZodError) { logger.warn("updatePrice validation failed", { traceId, priceId, issues: e.issues }); return zodIssueResponse(res, e); }
      throw e;
    }
    txn.startTransaction();
    const price = await TestSeriesPrice.findById(priceId).session(txn);
    if (!price) {
      await txn.abortTransaction();
      logger.warn("updatePrice not found", { traceId, priceId });
      return failure(res, "Price plan not found.", 404);
    }
    if (data.isDefault === true) {
      await TestSeriesPrice.updateMany(
        { testSeriesId: price.testSeriesId, isDefault: true, _id: { $ne: price._id } },
        { $set: { isDefault: false } },
        { session: txn }
      );
    }
    Object.assign(price, data);
    await price.save({ session: txn });
    await txn.commitTransaction();
    logger.info("updatePrice success", { traceId, priceId });
    return success(res, { price: price.toObject() }, "Price plan updated.");
  } catch (err) {
    if (txn.inTransaction()) await txn.abortTransaction();
    logger.error("updatePrice failed", { traceId, priceId, error: getErrorMessage(err), stack: (err as Error).stack });
    return failure(res, "Failed to update price plan.", 500);
  } finally {
    txn.endSession();
  }
};

// DELETE /api/v1/admin/test-series/prices/:priceId
export const deletePrice = async (req: Request, res: Response) => {
  const traceId = req.traceId;
  const priceId = String(req.params.priceId);
  logger.info("deletePrice invoked", { traceId, path: req.originalUrl, priceId, userId: req.user?.id });

  try {
    if (tsSql.isAdminTestSeriesMysql()) {
      const nid = tsSql.parseAtsId(priceId);
      if (nid == null) { logger.warn("deletePrice invalid id", { traceId, priceId }); return failure(res, "Invalid price id.", 422); }
      const subs = await tsSql.activeSubsForPlan(nid, new Date());
      if (subs > 0) {
        logger.warn("deletePrice refused active subs", { traceId, priceId, subs });
        return failure(res, `Cannot delete: ${subs} active subscription(s) reference this plan. Toggle status off instead.`, 409);
      }
      const ok = await tsSql.deletePrice(nid);
      if (!ok) { logger.warn("deletePrice not found", { traceId, priceId }); return failure(res, "Price plan not found.", 404); }
      logger.info("deletePrice success", { traceId, priceId });
      return success(res, { id: priceId }, "Deleted.");
    }
    if (!isObjectId(priceId)) { logger.warn("deletePrice invalid id", { traceId, priceId }); return failure(res, "Invalid price id.", 422); }
    const subs = await TestSeriesSubscription.countDocuments({
      planId: priceId,
      status: true,
      endAt: { $gt: new Date() },
    });
    if (subs > 0) {
      logger.warn("deletePrice refused active subs", { traceId, priceId, subs });
      return failure(
        res,
        `Cannot delete: ${subs} active subscription(s) reference this plan. Toggle status off instead.`,
        409
      );
    }
    const out = await TestSeriesPrice.findByIdAndDelete(priceId);
    if (!out) { logger.warn("deletePrice not found", { traceId, priceId }); return failure(res, "Price plan not found.", 404); }
    logger.info("deletePrice success", { traceId, priceId });
    return success(res, { id: priceId }, "Deleted.");
  } catch (err) {
    logger.error("deletePrice failed", { traceId, priceId, error: getErrorMessage(err), stack: (err as Error).stack });
    return failure(res, "Failed to delete price plan.", 500);
  }
};

// ─── Subscriptions / Orders (admin) ──────────────────────────────────────────

// GET /api/v1/admin/test-series/subscriptions
export const listSubscriptions = async (req: Request, res: Response) => {
  const traceId = req.traceId;
  logger.info("listSubscriptions invoked", { traceId, path: req.originalUrl, userId: req.user?.id });

  try {
    const { testSeriesId, customerId, status, page = "1", limit = "20" } =
      req.query as Record<string, string>;
    const p = Math.max(1, parseInt(page, 10) || 1);
    const l = Math.min(100, Math.max(1, parseInt(limit, 10) || 20));

    if (tsSql.isAdminTestSeriesMysql()) {
      const r = await tsSql.listSubscriptions({
        testSeriesId: testSeriesId ? tsSql.parseAtsId(testSeriesId) : null,
        customerId: customerId ? tsSql.parseAtsId(customerId) : null,
        status: status === "true" ? true : status === "false" ? false : null,
        page: p,
        limit: l,
      });
      logger.info("listSubscriptions success", { traceId, total: r.total });
      return success(res, { data: r.data, total: r.total, page: p, limit: l }, "Fetched.");
    }

    const filter: any = {};
    if (testSeriesId && isObjectId(testSeriesId)) filter.testSeriesId = testSeriesId;
    if (customerId && isObjectId(customerId)) filter.customerId = customerId;
    if (status === "true" || status === "false") filter.status = status === "true";

    const [rows, total] = await Promise.all([
      TestSeriesSubscription.find(filter)
        .sort({ createdAt: -1 })
        .skip((p - 1) * l)
        .limit(l)
        .populate("testSeriesId", "title")
        .populate("customerId", POPULATE_CUSTOMER)
        .lean(),
      TestSeriesSubscription.countDocuments(filter),
    ]);
    logger.info("listSubscriptions success", { traceId, total });
    return success(res, { data: withShapedCustomer(rows), total, page: p, limit: l }, "Fetched.");
  } catch (err) {
    logger.error("listSubscriptions failed", { traceId, error: getErrorMessage(err), stack: (err as Error).stack });
    return failure(res, "Failed to list subscriptions.", 500);
  }
};

// POST /api/v1/admin/test-series/:id/grant
// Admin-side free grant. If planId is given, durationDays is derived from the
// plan. Otherwise the body must supply durationDays explicitly.
export const grantSubscription = async (req: Request, res: Response) => {
  const traceId = req.traceId;
  const testSeriesId = String(req.params.id);
  logger.info("grantSubscription invoked", { traceId, path: req.originalUrl, testSeriesId, userId: req.user?.id });

  try {
    const isSql = tsSql.isAdminTestSeriesMysql();
    let sqlSeriesId: number | null = null;
    if (isSql) {
      sqlSeriesId = tsSql.parseAtsId(testSeriesId);
      if (sqlSeriesId == null) { logger.warn("grantSubscription invalid id", { traceId, testSeriesId }); return failure(res, "Invalid test series id.", 422); }
      if (!(await tsSql.seriesExists(sqlSeriesId))) { logger.warn("grantSubscription series not found", { traceId, testSeriesId }); return failure(res, "Test series not found.", 404); }
    } else {
      if (!isObjectId(testSeriesId)) { logger.warn("grantSubscription invalid id", { traceId, testSeriesId }); return failure(res, "Invalid test series id.", 422); }
      if (!(await TestSeries.exists({ _id: testSeriesId }))) {
        logger.warn("grantSubscription series not found", { traceId, testSeriesId });
        return failure(res, "Test series not found.", 404);
      }
    }

    let data: z.infer<typeof grantSubscriptionSchema>;
    try {
      data = grantSubscriptionSchema.parse(req.body);
    } catch (e) {
      if (e instanceof z.ZodError) { logger.warn("grantSubscription validation failed", { traceId, issues: e.issues }); return zodIssueResponse(res, e); }
      throw e;
    }

    if (isSql) {
      const customerN = tsSql.parseAtsId(String(data.customerId));
      if (customerN == null) { logger.warn("grantSubscription invalid customerId", { traceId, customerId: data.customerId }); return failure(res, "Invalid customerId.", 422); }
      const planN = data.planId != null ? tsSql.parseAtsId(String(data.planId)) : null;
      const r = await tsSql.grantSubscription(sqlSeriesId!, {
        customerId: customerN,
        planId: planN,
        durationDays: data.durationDays,
        price: data.price,
        startAt: data.startAt,
        remarks: data.remarks,
      });
      if ("planNotFound" in r) { logger.warn("grantSubscription plan not found", { traceId, planId: data.planId }); return failure(res, "Plan not found.", 404); }
      if ("missingDuration" in r) { logger.warn("grantSubscription missing duration", { traceId, testSeriesId }); return failure(res, "durationDays is required (or supply planId).", 422); }
      logger.info("grantSubscription success", { traceId, testSeriesId, customerId: data.customerId, subscriptionId: r.subscription._id });
      return success(res, { subscription: r.subscription }, "Subscription granted.", 201);
    }

    let durationDays = data.durationDays;
    let price = data.price ?? 0;
    if (data.planId) {
      const plan = await TestSeriesPrice.findById(data.planId);
      if (!plan) { logger.warn("grantSubscription plan not found", { traceId, planId: data.planId }); return failure(res, "Plan not found.", 404); }
      durationDays = durationDays ?? plan.durationDays;
      price = data.price ?? plan.price;
    }
    if (!durationDays || durationDays <= 0) {
      logger.warn("grantSubscription missing duration", { traceId, testSeriesId });
      return failure(res, "durationDays is required (or supply planId).", 422);
    }

    const startAt = data.startAt ? new Date(data.startAt) : new Date();
    const endAt = new Date(startAt);
    endAt.setDate(endAt.getDate() + durationDays);

    const sub = await TestSeriesSubscription.create({
      customerId: data.customerId,
      testSeriesId,
      planId: data.planId ?? null,
      price,
      startAt,
      endAt,
      paymentType: PackageCourseEbookPaymentType.BACKEND,
      remarks: data.remarks ?? null,
      status: true,
    });
    logger.info("grantSubscription success", { traceId, testSeriesId, customerId: data.customerId, subscriptionId: sub._id });
    return success(res, { subscription: sub }, "Subscription granted.", 201);
  } catch (err) {
    logger.error("grantSubscription failed", { traceId, testSeriesId, error: getErrorMessage(err), stack: (err as Error).stack });
    return failure(res, "Failed to grant subscription.", 500);
  }
};

// PUT /api/v1/admin/test-series/subscriptions/:subscriptionId
export const updateSubscription = async (req: Request, res: Response) => {
  const traceId = req.traceId;
  const id = String(req.params.subscriptionId);
  logger.info("updateSubscription invoked", { traceId, path: req.originalUrl, subscriptionId: id, userId: req.user?.id });

  try {
    const isSql = tsSql.isAdminTestSeriesMysql();
    if (!isSql && !isObjectId(id)) { logger.warn("updateSubscription invalid id", { traceId, id }); return failure(res, "Invalid id.", 422); }
    let data: z.infer<typeof updateSubscriptionSchema>;
    try {
      data = updateSubscriptionSchema.parse(req.body);
    } catch (e) {
      if (e instanceof z.ZodError) { logger.warn("updateSubscription validation failed", { traceId, id, issues: e.issues }); return zodIssueResponse(res, e); }
      throw e;
    }
    if (isSql) {
      const nid = tsSql.parseAtsId(id);
      if (nid == null) { logger.warn("updateSubscription invalid id", { traceId, id }); return failure(res, "Invalid id.", 422); }
      const r = await tsSql.updateSubscription(nid, data as any);
      if (!r) { logger.warn("updateSubscription not found", { traceId, id }); return failure(res, "Subscription not found.", 404); }
      logger.info("updateSubscription success", { traceId, id });
      return success(res, r, "Updated.");
    }
    const patch: any = {};
    if (data.endAt) patch.endAt = new Date(data.endAt);
    if (typeof data.status === "boolean") patch.status = data.status;
    if (typeof data.remarks === "string") patch.remarks = data.remarks;
    const sub = await TestSeriesSubscription.findByIdAndUpdate(id, patch, { new: true });
    if (!sub) { logger.warn("updateSubscription not found", { traceId, id }); return failure(res, "Subscription not found.", 404); }
    logger.info("updateSubscription success", { traceId, id });
    return success(res, { subscription: sub }, "Updated.");
  } catch (err) {
    logger.error("updateSubscription failed", { traceId, id, error: getErrorMessage(err), stack: (err as Error).stack });
    return failure(res, "Failed to update subscription.", 500);
  }
};

// DELETE /api/v1/admin/test-series/subscriptions/:subscriptionId
export const deleteSubscription = async (req: Request, res: Response) => {
  const traceId = req.traceId;
  const id = String(req.params.subscriptionId);
  logger.info("deleteSubscription invoked", { traceId, path: req.originalUrl, subscriptionId: id, userId: req.user?.id });

  try {
    if (tsSql.isAdminTestSeriesMysql()) {
      const nid = tsSql.parseAtsId(id);
      if (nid == null) { logger.warn("deleteSubscription invalid id", { traceId, id }); return failure(res, "Invalid id.", 422); }
      const ok = await tsSql.deleteSubscription(nid);
      if (!ok) { logger.warn("deleteSubscription not found", { traceId, id }); return failure(res, "Subscription not found.", 404); }
      logger.info("deleteSubscription success", { traceId, id });
      return success(res, { id }, "Deleted.");
    }
    if (!isObjectId(id)) { logger.warn("deleteSubscription invalid id", { traceId, id }); return failure(res, "Invalid id.", 422); }
    const out = await TestSeriesSubscription.findByIdAndDelete(id);
    if (!out) { logger.warn("deleteSubscription not found", { traceId, id }); return failure(res, "Subscription not found.", 404); }
    logger.info("deleteSubscription success", { traceId, id });
    return success(res, { id }, "Deleted.");
  } catch (err) {
    logger.error("deleteSubscription failed", { traceId, id, error: getErrorMessage(err), stack: (err as Error).stack });
    return failure(res, "Failed to delete subscription.", 500);
  }
};

// GET /api/v1/admin/test-series/orders
export const listOrders = async (req: Request, res: Response) => {
  const traceId = req.traceId;
  logger.info("listOrders invoked", { traceId, path: req.originalUrl, userId: req.user?.id });

  try {
    const { testSeriesId, customerId, status, page = "1", limit = "20" } =
      req.query as Record<string, string>;
    const p = Math.max(1, parseInt(page, 10) || 1);
    const l = Math.min(100, Math.max(1, parseInt(limit, 10) || 20));

    if (tsSql.isAdminTestSeriesMysql()) {
      const r = await tsSql.listOrders({
        testSeriesId: testSeriesId ? tsSql.parseAtsId(testSeriesId) : null,
        customerId: customerId ? tsSql.parseAtsId(customerId) : null,
        status: status || null,
        page: p,
        limit: l,
      });
      logger.info("listOrders success", { traceId, total: r.total });
      return success(res, { data: r.data, total: r.total, page: p, limit: l }, "Fetched.");
    }

    const filter: any = {};
    if (testSeriesId && isObjectId(testSeriesId)) filter.testSeriesId = testSeriesId;
    if (customerId && isObjectId(customerId)) filter.customerId = customerId;
    if (status) filter.status = status;
    const [rows, total] = await Promise.all([
      TestSeriesOrder.find(filter)
        .sort({ createdAt: -1 })
        .skip((p - 1) * l)
        .limit(l)
        .populate("testSeriesId", "title")
        .populate("customerId", POPULATE_CUSTOMER)
        .lean(),
      TestSeriesOrder.countDocuments(filter),
    ]);
    logger.info("listOrders success", { traceId, total });
    return success(res, { data: withShapedCustomer(rows), total, page: p, limit: l }, "Fetched.");
  } catch (err) {
    logger.error("listOrders failed", { traceId, error: getErrorMessage(err), stack: (err as Error).stack });
    return failure(res, "Failed to list orders.", 500);
  }
};

// Re-export enums consumed by routes (none needed externally; placeholder).
export const _PaymentMethod = PaymentMethod;
export const _OrderStatus = PackageCourseEbookOrderStatus;
export const _OrderType = PackageCourseEbookOrderType;
