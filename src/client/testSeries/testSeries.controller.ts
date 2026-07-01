import { Request, Response } from "express";
import { z } from "zod";
import { success, failure, getErrorMessage } from "../../utils/httpResponse";
import logger from "../../utils/logger";
import { buildShareUrl } from "../../deeplinking/shareRedirect";
import {
  parseCtsId,
  listTestSeriesMysql,
  listMySubscriptionsMysql,
  getTestSeriesDetailMysql,
  listSeriesPapersMysql,
} from "../../modules/client-testseries/client-testseries.service";
import { findPlanForOrder } from "../../modules/test-series-order/test-series-order.service";
import { resolvePromoForPlanSql } from "../../modules/promo-code/promo-code.service";

const resolveBase = (req: Request) =>
  process.env.ORIGIN || `${req.protocol}://${req.get("host")}`;

// Test series is charged at the raw plan price (minus any promo discount),
// matching the eBook flow — NO GST, NO handling fee. The gstAmount/handlingFee
// fields are kept in the breakdown (always 0) so the response shape is stable
// for the FE; they can be re-enabled later by reinstating the rates below.
const GST_RATE = 0;
const HANDLING_FEE = 0;

interface Breakdown {
  basePrice: number;        // plan price
  discountAmount: number;   // promo discount applied on basePrice
  netPrice: number;         // basePrice - discount
  gstAmount: number;        // GST on netPrice (0 — see note above)
  handlingFee: number;      // 0 — see note above
  totalAmount: number;      // netPrice + gst + handlingFee  (== netPrice)
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

    // ─── SQL branch (int id-space) — gated on `client-testseries` ───
    const p = Math.max(1, parseInt(page, 10) || 1);
    const l = Math.min(50, Math.max(1, parseInt(limit, 10) || 20));
    const cidNum = customerId ? parseCtsId(String(customerId)) : null;
    const { data, total } = await listTestSeriesMysql({
      search: search?.trim() || null,
      page: p,
      limit: l,
      customerId: cidNum,
      now: new Date(),
      base: resolveBase(req),
      buildShareUrl,
    });
    logger.info("listTestSeries success (sql)", { traceId, customerId, total });
    return success(res, { data, total, page: p, limit: l }, "Fetched.");
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
    // ─── SQL branch (int id-space) ───
    const tsId = parseCtsId(id);
    if (tsId == null) { logger.warn("getTestSeriesDetail invalid id (sql)", { traceId, id }); return failure(res, "Invalid test series id.", 422); }
    const cidNum = customerId ? parseCtsId(String(customerId)) : null;
    const out = await getTestSeriesDetailMysql({ id: tsId, customerId: cidNum, now: new Date(), base: resolveBase(req), buildShareUrl });
    if (!out) { logger.warn("getTestSeriesDetail not found (sql)", { traceId, id }); return failure(res, "Test series not found.", 404); }
    logger.info("getTestSeriesDetail success (sql)", { traceId, customerId, id, isPurchased: out.isPurchased });
    return success(res, out, "Fetched.");
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
    // ─── SQL branch (int id-space) ───
    const tsId = parseCtsId(id);
    if (tsId == null) { logger.warn("listSeriesPapers invalid id (sql)", { traceId, id }); return failure(res, "Invalid test series id.", 422); }
    const cidNum = req.user?.id ? parseCtsId(String(req.user.id)) : null;
    const out = await listSeriesPapersMysql({ id: tsId, customerId: cidNum, now: new Date() });
    if (!out) { logger.warn("listSeriesPapers not found (sql)", { traceId, id }); return failure(res, "Test series not found.", 404); }
    logger.info("listSeriesPapers success (sql)", { traceId, customerId, id, isPaid: out.isPaid, hasAccess: out.hasAccess, categoryCount: out.categories.length });
    return success(res, { isPaid: out.isPaid, hasAccess: out.hasAccess, categories: out.categories }, "Fetched.");
  } catch (e: any) {
    logger.error("listSeriesPapers failed", { traceId, customerId, id, error: getErrorMessage(e), stack: e.stack });
    return failure(res, e.message ?? "Failed.", 500);
  }
};

// ─── Checkout ────────────────────────────────────────────────────────────────

const previewSchema = z.object({
  planId: z.coerce.number().int().positive(),
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

    // ─── SQL branch (int id-space) — planId is numeric ───
    const plan = await findPlanForOrder(body.planId);
    if (!plan) { logger.warn("previewCheckout plan not found", { traceId, customerId, planId: body.planId }); return failure(res, "Plan not found or inactive.", 404); }

    let discountAmount = 0;
    let promocodeId: string | null = null;
    let promoMeta: any = null;
    if (body.promocode) {
      const { result, error } = await resolvePromoForPlanSql(body.promocode, plan.price, {
        type: "testSeries",
        id: plan.testSeriesId,
      }, body.planId);
      if (error || !result) { logger.warn("previewCheckout promo rejected", { traceId, customerId, promocode: body.promocode, error }); return failure(res, error ?? "Invalid promo code.", 400); }
      discountAmount = result.discountAmount;
      promocodeId = result.promo ? String(result.promo._id) : null;
      promoMeta = {
        promocode: result.promo ? result.promo.promocode : body.promocode.trim().toUpperCase(),
        discountType: result.discountType,
        discountValue: result.discountValue,
        isReferral: false,
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
          _id: plan.id,
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

    // ─── SQL branch (int id-space) — gated on `client-testseries` ───
    const cidNum = parseCtsId(String(customerId));
    if (cidNum == null) return success(res, { data: [], total: 0 }, "Fetched.");
    const { data, total } = await listMySubscriptionsMysql({
      customerId: cidNum,
      now: new Date(),
      base: resolveBase(req),
      buildShareUrl,
    });
    logger.info("listMySubscriptions success (sql)", { traceId, customerId, count: total });
    return success(res, { data, total }, "Fetched.");
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
