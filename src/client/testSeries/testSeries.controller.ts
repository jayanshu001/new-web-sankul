import { Request, Response } from "express";
import mongoose from "mongoose";
import { z } from "zod";
import { TestSeries } from "../../models/testSeries/TestSeries.model";
import { TestSeriesContentCategory } from "../../models/testSeries/TestSeriesContentCategory.model";
import { TestSeriesExam } from "../../models/testSeries/TestSeriesExam.model";
import { TestSeriesPrice } from "../../models/testSeries/TestSeriesPrice.model";
import { TestSeriesOrder } from "../../models/testSeries/TestSeriesOrder.model";
import { TestSeriesSubscription } from "../../models/testSeries/TestSeriesSubscription.model";
import { ExamResult } from "../../models/exam/ExamResult.model";
import { resolveLivePromo } from "../live-course/promo";
import {
  PackageCourseEbookOrderStatus,
  PackageCourseEbookOrderType,
  PaymentMethod,
} from "../../models/enums";
import { success, failure, getErrorMessage } from "../../utils/httpResponse";
import logger from "../../utils/logger";
import { computeDaysLeft } from "../../utils/planDuration";
import { buildShareUrl } from "../../deeplinking/shareRedirect";

const resolveBase = (req: Request) =>
  process.env.ORIGIN || `${req.protocol}://${req.get("host")}`;

const objectId = z.string().regex(/^[0-9a-fA-F]{24}$/, "Invalid id");
const isObjectId = (v: string) => mongoose.Types.ObjectId.isValid(v);

// GST + handling fee — overridable via env, sane defaults match the mockup
// (₹15 + ₹20 on a ₹280 base ≈ ₹315 total).
const GST_RATE = Number(process.env.TEST_SERIES_GST_PERCENT ?? "5") / 100;
const HANDLING_FEE = Number(process.env.TEST_SERIES_HANDLING_FEE ?? "20");

interface Breakdown {
  basePrice: number;        // plan price
  discountAmount: number;   // promo discount applied on basePrice
  netPrice: number;         // basePrice - discount
  gstAmount: number;        // GST on netPrice
  handlingFee: number;
  totalAmount: number;      // netPrice + gst + handlingFee
  promocodeId?: string | null;
}

function computeBreakdown(basePrice: number, discountAmount = 0, promocodeId: string | null = null): Breakdown {
  const netPrice = Math.max(0, basePrice - discountAmount);
  const gstAmount = Math.round(netPrice * GST_RATE);
  const totalAmount = netPrice + gstAmount + HANDLING_FEE;
  return {
    basePrice,
    discountAmount,
    netPrice,
    gstAmount,
    handlingFee: HANDLING_FEE,
    totalAmount,
    promocodeId,
  };
}

// ─── Discovery ───────────────────────────────────────────────────────────────

// GET /api/v1/client/test-series
export const listTestSeries = async (req: Request, res: Response) => {
  const traceId = req.traceId;
  const customerId = req.user?.id;
  logger.info("listTestSeries invoked", { traceId, path: req.originalUrl, customerId });

  try {
    const { search, page = "1", limit = "20" } = req.query as Record<string, string>;
    const filter: any = { status: true };
    if (search) filter.title = { $regex: search, $options: "i" };

    const p = Math.max(1, parseInt(page, 10) || 1);
    const l = Math.min(50, Math.max(1, parseInt(limit, 10) || 20));

    const [rows, total] = await Promise.all([
      TestSeries.find(filter)
        .select("_id title description thumbnail language paperCount isFree orderBy")
        .sort({ orderBy: 1, createdAt: -1 })
        .skip((p - 1) * l)
        .limit(l)
        .lean(),
      TestSeries.countDocuments(filter),
    ]);

    // Default-price preview for the listing card.
    const seriesIds = rows.map((r) => r._id);
    const defaults = await TestSeriesPrice.find({
      testSeriesId: { $in: seriesIds },
      status: true,
    })
      .sort({ isDefault: -1, price: 1 })
      .lean();
    const defaultByid = new Map<string, any>();
    for (const p of defaults) {
      const k = String(p.testSeriesId);
      if (!defaultByid.has(k)) defaultByid.set(k, p);
    }

    // Latest-expiring active sub per series → daysLeft.
    const now = new Date();
    const latestEndAtByid = new Map<string, Date>();
    if (customerId && seriesIds.length) {
      const subs = await TestSeriesSubscription.find({
        customerId,
        testSeriesId: { $in: seriesIds },
        status: true,
        endAt: { $gt: now },
      })
        .select("testSeriesId endAt")
        .lean();
      for (const s of subs as any[]) {
        const k = String(s.testSeriesId);
        const prev = latestEndAtByid.get(k);
        if (!prev || (s.endAt as Date).getTime() > prev.getTime()) latestEndAtByid.set(k, s.endAt as Date);
      }
    }

    const base = resolveBase(req);
    const decorated = rows.map((r: any) => {
      const def = defaultByid.get(String(r._id));
      const discountPct =
        def?.originalPrice && def.originalPrice > def.price
          ? Math.round(((def.originalPrice - def.price) / def.originalPrice) * 100)
          : 0;
      const endAt = latestEndAtByid.get(String(r._id)) ?? null;
      return {
        ...r,
        defaultPlan: def
          ? {
              _id: def._id,
              durationDays: def.durationDays,
              price: def.price,
              originalPrice: def.originalPrice ?? null,
              discountPct,
            }
          : null,
        isPurchased: !!endAt,
        daysLeft: endAt ? computeDaysLeft(endAt, now) : null,
        shareableLink: buildShareUrl("test-series", String(r._id), base),
      };
    });

    logger.info("listTestSeries success", { traceId, customerId, total });
    return success(res, { data: decorated, total, page: p, limit: l }, "Fetched.");
  } catch (e: any) {
    logger.error("listTestSeries failed", { traceId, customerId, error: getErrorMessage(e), stack: e.stack });
    return failure(res, e.message ?? "Failed to fetch test series.", 500);
  }
};

// GET /api/v1/client/test-series/:id
export const getTestSeriesDetail = async (req: Request, res: Response) => {
  const traceId = req.traceId;
  const id = String(req.params.id);
  const customerId = req.user?.id;
  logger.info("getTestSeriesDetail invoked", { traceId, path: req.originalUrl, customerId, id });

  try {
    if (!isObjectId(id)) { logger.warn("getTestSeriesDetail invalid id", { traceId, id }); return failure(res, "Invalid test series id.", 422); }

    const series = await TestSeries.findOne({ _id: id, status: true }).lean();
    if (!series) { logger.warn("getTestSeriesDetail not found", { traceId, id }); return failure(res, "Test series not found.", 404); }

    const [contentCategories, prices] = await Promise.all([
      TestSeriesContentCategory.find({ testSeriesId: id, status: true })
        .sort({ orderBy: 1, name: 1 })
        .lean(),
      TestSeriesPrice.find({ testSeriesId: id, status: true })
        .sort({ isDefault: -1, price: 1 })
        .lean(),
    ]);

    let isPurchased = false;
    let activeSubscription: any = null;
    if (customerId) {
      activeSubscription = await TestSeriesSubscription.findOne({
        customerId,
        testSeriesId: id,
        status: true,
        endAt: { $gt: new Date() },
      })
        .sort({ endAt: -1 })
        .lean();
      isPurchased = !!activeSubscription;
    }

    const daysLeft = activeSubscription
      ? computeDaysLeft(activeSubscription.endAt ?? null)
      : null;

    logger.info("getTestSeriesDetail success", { traceId, customerId, id, isPurchased });
    const shareableLink = buildShareUrl("test-series", id, resolveBase(req));
    return success(
      res,
      { series: { ...series, shareableLink }, contentCategories, prices, isPurchased, activeSubscription, daysLeft, shareableLink },
      "Fetched."
    );
  } catch (e: any) {
    logger.error("getTestSeriesDetail failed", { traceId, customerId, id, error: getErrorMessage(e), stack: e.stack });
    return failure(res, e.message ?? "Failed.", 500);
  }
};

// GET /api/v1/client/test-series/:id/papers
// Returns the papers grouped by content category. Each paper carries the
// customer's attempt state (`Start` vs `Retake`).
export const listSeriesPapers = async (req: Request, res: Response) => {
  const traceId = req.traceId;
  const id = String(req.params.id);
  const customerId = req.user?.id;
  logger.info("listSeriesPapers invoked", { traceId, path: req.originalUrl, customerId, id });

  try {
    if (!isObjectId(id)) { logger.warn("listSeriesPapers invalid id", { traceId, id }); return failure(res, "Invalid test series id.", 422); }

    if (!(await TestSeries.exists({ _id: id, status: true }))) { logger.warn("listSeriesPapers not found", { traceId, id }); return failure(res, "Test series not found.", 404); }

    // Check access — series-level subscription gates the "Start" buttons.
    let hasAccess = false;
    const series = await TestSeries.findById(id).select("isFree").lean();
    if (series?.isFree) {
      hasAccess = true;
    } else if (customerId) {
      const sub = await TestSeriesSubscription.exists({
        customerId,
        testSeriesId: id,
        status: true,
        endAt: { $gt: new Date() },
      });
      hasAccess = !!sub;
    }

    const links = await TestSeriesExam.find({ testSeriesId: id, status: true })
      .sort({ orderBy: 1, createdAt: 1 })
      .populate(
        "examId",
        "_id title durationMinutes questionCount positiveMarks negativeMarks language difficulty status"
      )
      .lean();

    // Customer's most-recent attempt per exam.
    let resultByExam = new Map<string, any>();
    if (customerId && links.length) {
      const examIds = links.map((l) => l.examId && (l.examId as any)._id).filter(Boolean);
      const results = await ExamResult.find({
        customerId,
        examId: { $in: examIds },
        status: true,
      })
        .select("examId score total success failed skip attempt attemptNumber timing updatedAt")
        .sort({ updatedAt: -1, attemptNumber: -1 })
        .lean();
      for (const r of results) {
        const k = String(r.examId);
        if (!resultByExam.has(k)) resultByExam.set(k, r);
      }
    }

    const categories = await TestSeriesContentCategory.find({
      testSeriesId: id,
      status: true,
    })
      .sort({ orderBy: 1, name: 1 })
      .lean();

    const grouped = categories.map((cat) => {
      const items = links
        .filter((l) => String(l.contentCategoryId) === String(cat._id))
        .map((l: any) => {
          const exam = l.examId;
          const prev = exam ? resultByExam.get(String(exam._id)) : null;
          return {
            linkId: l._id,
            exam,
            orderBy: l.orderBy,
            attemptState: prev ? "retake" : "start",
            lastResult: prev ?? null,
          };
        });
      return {
        _id: cat._id,
        name: cat.name,
        icon: cat.icon,
        orderBy: cat.orderBy,
        papers: items,
      };
    });

    logger.info("listSeriesPapers success", { traceId, customerId, id, hasAccess, categoryCount: grouped.length });
    return success(res, { hasAccess, categories: grouped }, "Fetched.");
  } catch (e: any) {
    logger.error("listSeriesPapers failed", { traceId, customerId, id, error: getErrorMessage(e), stack: e.stack });
    return failure(res, e.message ?? "Failed.", 500);
  }
};

// ─── Checkout ────────────────────────────────────────────────────────────────

const previewSchema = z.object({
  planId: objectId,
  promocode: z.string().trim().min(1).optional(),
});

// POST /api/v1/client/test-series/checkout/preview
// Returns the price breakdown (matches the "Order Summary" card in the mockup).
// Does not create any rows. Promo is re-validated server-side at create-order.
export const previewCheckout = async (req: Request, res: Response) => {
  const traceId = req.traceId;
  const customerId = req.user?.id;
  logger.info("previewCheckout invoked", { traceId, path: req.originalUrl, customerId });

  try {
    if (!customerId) { logger.warn("previewCheckout unauthorized", { traceId }); return failure(res, "Unauthorized.", 401); }

    let body: z.infer<typeof previewSchema>;
    try {
      body = previewSchema.parse(req.body);
    } catch (e: any) {
      logger.warn("previewCheckout validation failed", { traceId, customerId, issues: e.issues });
      return failure(res, "Validation failed.", 422, { errors: e.issues });
    }

    const plan = await TestSeriesPrice.findOne({ _id: body.planId, status: true });
    if (!plan) { logger.warn("previewCheckout plan not found", { traceId, customerId, planId: body.planId }); return failure(res, "Plan not found or inactive.", 404); }

    let discountAmount = 0;
    let promocodeId: string | null = null;
    let promoMeta: any = null;
    if (body.promocode) {
      const { result, error } = await resolveLivePromo(body.promocode, plan.price, {
        type: "liveCourse",
        id: String(plan.testSeriesId),
      });
      if (error || !result) { logger.warn("previewCheckout promo rejected", { traceId, customerId, promocode: body.promocode, error }); return failure(res, error ?? "Invalid promo code.", 400); }
      discountAmount = result.discountAmount;
      promocodeId = String(result.promo._id);
      promoMeta = {
        promocode: result.promo.promocode,
        discountType: result.discountType,
        discountValue: result.discountValue,
      };
    }

    const bd = computeBreakdown(plan.price, discountAmount, promocodeId);
    const startAt = new Date();
    const validUntil = new Date(startAt);
    validUntil.setDate(validUntil.getDate() + plan.durationDays);

    logger.info("previewCheckout success", { traceId, customerId, planId: body.planId, total: bd.totalAmount });
    return success(
      res,
      {
        plan: {
          _id: plan._id,
          testSeriesId: plan.testSeriesId,
          durationDays: plan.durationDays,
          price: plan.price,
          originalPrice: plan.originalPrice ?? null,
        },
        breakdown: bd,
        promo: promoMeta,
        validUntil,
      },
      "Preview computed."
    );
  } catch (e: any) {
    logger.error("previewCheckout failed", { traceId, customerId, error: getErrorMessage(e), stack: e.stack });
    return failure(res, e.message ?? "Failed to preview checkout.", 500);
  }
};

// ─── My subscriptions ────────────────────────────────────────────────────────

// GET /api/v1/client/test-series/my/subscriptions
export const listMySubscriptions = async (req: Request, res: Response) => {
  const traceId = req.traceId;
  const customerId = req.user?.id;
  logger.info("listMySubscriptions invoked", { traceId, path: req.originalUrl, customerId });

  try {
    if (!customerId) { logger.warn("listMySubscriptions unauthorized", { traceId }); return failure(res, "Unauthorized.", 401); }
    const subs = await TestSeriesSubscription.find({ customerId, status: true })
      .sort({ endAt: -1 })
      .populate("testSeriesId", "title thumbnail paperCount")
      .lean();
    const now = new Date();
    const base = resolveBase(req);
    const data = subs.map((s: any) => {
      const endAt = s.endAt ? new Date(s.endAt) : null;
      const isActive = !!(endAt && endAt > now);
      const ts = s.testSeriesId;
      const tsWithShare = ts && ts._id
        ? { ...ts, shareableLink: buildShareUrl("test-series", String(ts._id), base) }
        : ts;
      return {
        ...s,
        testSeriesId: tsWithShare,
        isActive,
        daysLeft: isActive ? computeDaysLeft(endAt, now) : 0,
      };
    });
    logger.info("listMySubscriptions success", { traceId, customerId, count: data.length });
    return success(res, { data, total: data.length }, "Fetched.");
  } catch (e: any) {
    logger.error("listMySubscriptions failed", { traceId, customerId, error: getErrorMessage(e), stack: e.stack });
    return failure(res, e.message ?? "Failed.", 500);
  }
};

// Helpers shared with payment controller
export const _shared = {
  computeBreakdown,
  GST_RATE,
  HANDLING_FEE,
};
