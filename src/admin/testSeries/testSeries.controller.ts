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
import logger from "../../utils/logger";
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

function zodIssueResponse(res: Response, err: z.ZodError) {
  const messages = err.issues.map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`);
  return failure(res, "Validation failed.", 422, { errors: messages });
}

// Recompute denormalized paper count for a series.
async function recomputePaperCount(testSeriesId: string | mongoose.Types.ObjectId) {
  const count = await TestSeriesExam.countDocuments({ testSeriesId, status: true });
  await TestSeries.updateOne({ _id: testSeriesId }, { $set: { paperCount: count } });
}

// ─── Test Series CRUD ────────────────────────────────────────────────────────

// GET /api/v1/admin/test-series
export const listTestSeries = async (req: Request, res: Response) => {
  const traceId = req.traceId;
  logger.info("listTestSeries invoked", { traceId, path: req.originalUrl, userId: req.user?.id });

  try {
    const { search, status, examCategoryId, page = "1", limit = "20" } =
      req.query as Record<string, string>;
    const filter: any = {};
    if (search) filter.title = { $regex: search, $options: "i" };
    if (status === "true" || status === "false") filter.status = status === "true";
    if (examCategoryId && isObjectId(examCategoryId)) filter.examCategoryId = examCategoryId;

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

    logger.info("listTestSeries success", { traceId, total });
    return success(res, { data: rows, total, page: p, limit: l }, "Fetched.");
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
    let data: z.infer<typeof createTestSeriesSchema>;
    try {
      data = createTestSeriesSchema.parse(req.body);
    } catch (e) {
      if (e instanceof z.ZodError) { logger.warn("createTestSeries validation failed", { traceId, issues: e.issues }); return zodIssueResponse(res, e); }
      throw e;
    }
    const series = await TestSeries.create(data);
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
    if (!isObjectId(id)) { logger.warn("updateTestSeries invalid id", { traceId, id }); return failure(res, "Invalid test series id.", 422); }
    const file = req.file as any;
    if (file?.location) req.body.thumbnail = file.location;
    let data: z.infer<typeof updateTestSeriesSchema>;
    try {
      data = updateTestSeriesSchema.parse(req.body);
    } catch (e) {
      if (e instanceof z.ZodError) { logger.warn("updateTestSeries validation failed", { traceId, id, issues: e.issues }); return zodIssueResponse(res, e); }
      throw e;
    }
    const series = await TestSeries.findByIdAndUpdate(id, data, { new: true });
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
    if (!isObjectId(testSeriesId)) { logger.warn("createContentCategory invalid id", { traceId, testSeriesId }); return failure(res, "Invalid test series id.", 422); }
    if (!(await TestSeries.exists({ _id: testSeriesId }))) {
      logger.warn("createContentCategory series not found", { traceId, testSeriesId });
      return failure(res, "Test series not found.", 404);
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
    if (!isObjectId(id)) { logger.warn("updateContentCategory invalid id", { traceId, id }); return failure(res, "Invalid id.", 422); }
    const file = req.file as any;
    if (file?.location) req.body.icon = file.location;
    let data: z.infer<typeof updateContentCategorySchema>;
    try {
      data = updateContentCategorySchema.parse(req.body);
    } catch (e) {
      if (e instanceof z.ZodError) { logger.warn("updateContentCategory validation failed", { traceId, id, issues: e.issues }); return zodIssueResponse(res, e); }
      throw e;
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
    if (!isObjectId(testSeriesId)) { logger.warn("linkPaper invalid id", { traceId, testSeriesId }); return failure(res, "Invalid test series id.", 422); }
    if (!(await TestSeries.exists({ _id: testSeriesId }))) {
      logger.warn("linkPaper series not found", { traceId, testSeriesId });
      return failure(res, "Test series not found.", 404);
    }

    let data: z.infer<typeof linkExamSchema>;
    try {
      data = linkExamSchema.parse(req.body);
    } catch (e) {
      if (e instanceof z.ZodError) { logger.warn("linkPaper validation failed", { traceId, issues: e.issues }); return zodIssueResponse(res, e); }
      throw e;
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
    if (!isObjectId(linkId)) { logger.warn("updatePaperLink invalid id", { traceId, linkId }); return failure(res, "Invalid id.", 422); }
    let data: z.infer<typeof updateLinkSchema>;
    try {
      data = updateLinkSchema.parse(req.body);
    } catch (e) {
      if (e instanceof z.ZodError) { logger.warn("updatePaperLink validation failed", { traceId, linkId, issues: e.issues }); return zodIssueResponse(res, e); }
      throw e;
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
    const filter: any = {};
    if (testSeriesId && isObjectId(testSeriesId)) filter.testSeriesId = testSeriesId;
    if (customerId && isObjectId(customerId)) filter.customerId = customerId;
    if (status === "true" || status === "false") filter.status = status === "true";

    const p = Math.max(1, parseInt(page, 10) || 1);
    const l = Math.min(100, Math.max(1, parseInt(limit, 10) || 20));

    const [rows, total] = await Promise.all([
      TestSeriesSubscription.find(filter)
        .sort({ createdAt: -1 })
        .skip((p - 1) * l)
        .limit(l)
        .populate("testSeriesId", "title")
        .populate("customerId", "name phone email")
        .lean(),
      TestSeriesSubscription.countDocuments(filter),
    ]);
    logger.info("listSubscriptions success", { traceId, total });
    return success(res, { data: rows, total, page: p, limit: l }, "Fetched.");
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
    if (!isObjectId(testSeriesId)) { logger.warn("grantSubscription invalid id", { traceId, testSeriesId }); return failure(res, "Invalid test series id.", 422); }
    if (!(await TestSeries.exists({ _id: testSeriesId }))) {
      logger.warn("grantSubscription series not found", { traceId, testSeriesId });
      return failure(res, "Test series not found.", 404);
    }

    let data: z.infer<typeof grantSubscriptionSchema>;
    try {
      data = grantSubscriptionSchema.parse(req.body);
    } catch (e) {
      if (e instanceof z.ZodError) { logger.warn("grantSubscription validation failed", { traceId, issues: e.issues }); return zodIssueResponse(res, e); }
      throw e;
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
    if (!isObjectId(id)) { logger.warn("updateSubscription invalid id", { traceId, id }); return failure(res, "Invalid id.", 422); }
    let data: z.infer<typeof updateSubscriptionSchema>;
    try {
      data = updateSubscriptionSchema.parse(req.body);
    } catch (e) {
      if (e instanceof z.ZodError) { logger.warn("updateSubscription validation failed", { traceId, id, issues: e.issues }); return zodIssueResponse(res, e); }
      throw e;
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
    const filter: any = {};
    if (testSeriesId && isObjectId(testSeriesId)) filter.testSeriesId = testSeriesId;
    if (customerId && isObjectId(customerId)) filter.customerId = customerId;
    if (status) filter.status = status;
    const p = Math.max(1, parseInt(page, 10) || 1);
    const l = Math.min(100, Math.max(1, parseInt(limit, 10) || 20));
    const [rows, total] = await Promise.all([
      TestSeriesOrder.find(filter)
        .sort({ createdAt: -1 })
        .skip((p - 1) * l)
        .limit(l)
        .populate("testSeriesId", "title")
        .populate("customerId", "name phone email")
        .lean(),
      TestSeriesOrder.countDocuments(filter),
    ]);
    logger.info("listOrders success", { traceId, total });
    return success(res, { data: rows, total, page: p, limit: l }, "Fetched.");
  } catch (err) {
    logger.error("listOrders failed", { traceId, error: getErrorMessage(err), stack: (err as Error).stack });
    return failure(res, "Failed to list orders.", 500);
  }
};

// Re-export enums consumed by routes (none needed externally; placeholder).
export const _PaymentMethod = PaymentMethod;
export const _OrderStatus = PackageCourseEbookOrderStatus;
export const _OrderType = PackageCourseEbookOrderType;
