import { Request, Response } from "express";
import { prisma } from "../../config/prisma";
import logger from "../../utils/logger";
import { getErrorMessage } from "../../utils/httpResponse";
import { buildTrackingUrl, COURIER } from "../../config/courier";
import { fetchLiveAWBData } from "../../libs/courier/tracking";
import {
  parsePhId,
  getEbookReceiptMysql,
  getBookReceiptMysql,
  getCourseReceiptMysql,
  getCourseReceiptBySubMysql,
  getLiveCourseReceiptMysql,
  getTestSeriesReceiptMysql,
  getTestSeriesReceiptBySubMysql,
  getSubscriptionTrackingMysql,
  getSubscriptionTrackingLiveMysql,
} from "../../modules/client-purchase-history/client-purchase-history.service";

// The /subscriptions/:id/receipt route serves several sources; the list emits prefixed
// ids to disambiguate here:
//   (plain)  = package/course ORDER id (each purchase incl. extensions)
//   "lc_"    = live-course subscription id
//   "ts_"    = test-series ORDER id
//   "pcs_"   = legacy package/course subscription (no order) — sub-based receipt
//   "tss_"   = legacy test-series subscription (no order) — sub-based receipt
const LIVE_ID_PREFIX = "lc_";
const TS_ID_PREFIX = "ts_";
const PCS_ID_PREFIX = "pcs_";
const TSS_ID_PREFIX = "tss_";

// Receipts return a uniform JSON shape so the frontend can render a receipt
// screen and (later) generate a PDF locally. Server-side PDF can be swapped
// in without changing the URL.
type ReceiptResponse = {
  kind: "book" | "course" | "ebook" | "package" | "live-course";
  receiptId: string;
  purchasedAt: Date;
  paidAt: Date | null;
  status: string;
  customer: { id: string };
  payment: {
    method: string;
    razorpayOrderId: string | null;
    razorpayPaymentId: string | null;
  };
  items: Array<{
    name: string;
    qty: number;
    unitPrice: number;
    lineTotal: number;
  }>;
  totals: {
    subTotal: number;
    shipping?: number;
    discount?: number;
    grandTotal: number;
    currency: "INR";
  };
  extra?: Record<string, any>;
};

// GET /api/v1/client/purchase-history/books/:id/receipt
export const getBookReceipt = async (req: Request, res: Response) => {
  const traceId = req.traceId;
  const userId = req.user?.id;
  const id = String(req.params.id || "");
  logger.info("getBookReceipt invoked", { traceId, path: req.originalUrl, customerId: userId, orderId: id });

  try {
    if (!userId) { logger.warn("getBookReceipt unauthorized", { traceId }); return res.status(401).json({ success: false, message: "Unauthorized." }); }

    // SQL int id-space: SQL order ids are ints, not 24-hex.
    const oid = parsePhId(id);
    const cidNum = parsePhId(String(userId));
    if (oid == null) { logger.warn("getBookReceipt invalid id (sql)", { traceId, customerId: userId, orderId: id }); return res.status(400).json({ success: false, message: "Invalid id." }); }
    if (cidNum == null) { return res.status(401).json({ success: false, message: "Unauthorized." }); }
    const data = await getBookReceiptMysql(oid, cidNum);
    if (!data) { logger.warn("getBookReceipt not found (sql)", { traceId, customerId: userId, orderId: id }); return res.status(404).json({ success: false, message: "Order not found." }); }
    logger.info("getBookReceipt success (sql)", { traceId, customerId: userId, orderId: id });
    return res.status(200).json({ success: true, data });
  } catch (e: any) {
    logger.error("getBookReceipt failed", { traceId, customerId: userId, orderId: id, error: getErrorMessage(e), stack: e.stack });
    return res.status(500).json({ success: false, message: e.message });
  }
};

// GET /api/v1/client/purchase-history/subscriptions/:id/receipt
export const getCourseReceipt = async (req: Request, res: Response) => {
  const traceId = req.traceId;
  const userId = req.user?.id;
  const id = String(req.params.id || "");
  logger.info("getCourseReceipt invoked", { traceId, path: req.originalUrl, customerId: userId, subscriptionId: id });

  try {
    if (!userId) { logger.warn("getCourseReceipt unauthorized", { traceId }); return res.status(401).json({ success: false, message: "Unauthorized." }); }

    const cidNum = parsePhId(String(userId));
    if (cidNum == null) { return res.status(401).json({ success: false, message: "Unauthorized." }); }

    // Route by id prefix (see the prefix table above). Order matters: check the longer
    // "tss_"/"pcs_" prefixes before "ts_".
    const isPcs = id.startsWith(PCS_ID_PREFIX);
    const isTss = id.startsWith(TSS_ID_PREFIX);
    const isLive = id.startsWith(LIVE_ID_PREFIX);
    const isTs = !isTss && id.startsWith(TS_ID_PREFIX);
    const raw = isPcs
      ? id.slice(PCS_ID_PREFIX.length)
      : isTss
      ? id.slice(TSS_ID_PREFIX.length)
      : isLive
      ? id.slice(LIVE_ID_PREFIX.length)
      : isTs
      ? id.slice(TS_ID_PREFIX.length)
      : id;
    const sid = parsePhId(raw);
    if (sid == null) { logger.warn("getCourseReceipt invalid id (sql)", { traceId, customerId: userId, subscriptionId: id }); return res.status(400).json({ success: false, message: "Invalid id." }); }

    const data = isLive
      ? await getLiveCourseReceiptMysql(sid, cidNum)
      : isTs
      ? await getTestSeriesReceiptMysql(sid, cidNum)
      : isPcs
      ? await getCourseReceiptBySubMysql(sid, cidNum)
      : isTss
      ? await getTestSeriesReceiptBySubMysql(sid, cidNum)
      : await getCourseReceiptMysql(sid, cidNum);
    if (!data) { logger.warn("getCourseReceipt not found (sql)", { traceId, customerId: userId, subscriptionId: id }); return res.status(404).json({ success: false, message: "Subscription not found." }); }
    logger.info("getCourseReceipt success (sql)", { traceId, customerId: userId, subscriptionId: id });
    return res.status(200).json({ success: true, data });
  } catch (e: any) {
    logger.error("getCourseReceipt failed", { traceId, customerId: userId, subscriptionId: id, error: getErrorMessage(e), stack: e.stack });
    return res.status(500).json({ success: false, message: e.message });
  }
};

// GET /api/v1/client/purchase-history/ebooks/:id/receipt
export const getEbookReceipt = async (req: Request, res: Response) => {
  const traceId = req.traceId;
  const userId = req.user?.id;
  const id = String(req.params.id || "");
  logger.info("getEbookReceipt invoked", { traceId, path: req.originalUrl, customerId: userId, orderId: id });

  try {
    if (!userId) { logger.warn("getEbookReceipt unauthorized", { traceId }); return res.status(401).json({ success: false, message: "Unauthorized." }); }

    // SQL int id-space: SQL order ids are ints, not 24-hex.
    const oid = parsePhId(id);
    const cidNum = parsePhId(String(userId));
    if (oid == null) { logger.warn("getEbookReceipt invalid id (sql)", { traceId, customerId: userId, orderId: id }); return res.status(400).json({ success: false, message: "Invalid id." }); }
    if (cidNum == null) { return res.status(401).json({ success: false, message: "Unauthorized." }); }
    const data = await getEbookReceiptMysql(oid, cidNum);
    if (!data) { logger.warn("getEbookReceipt not found (sql)", { traceId, customerId: userId, orderId: id }); return res.status(404).json({ success: false, message: "Order not found." }); }
    logger.info("getEbookReceipt success (sql)", { traceId, customerId: userId, orderId: id });
    return res.status(200).json({ success: true, data });
  } catch (e: any) {
    logger.error("getEbookReceipt failed", { traceId, customerId: userId, orderId: id, error: getErrorMessage(e), stack: e.stack });
    return res.status(500).json({ success: false, message: e.message });
  }
};

// GET /api/v1/client/purchase-history/subscriptions/:id/tracking
// Shipment "Track Order" view for with-material package/course + live-course
// subscriptions. Same DTO + trackingUrl decoration as the Books tab
// (GET client/book/orders/:id/tracking), keyed by the same prefixed subscription
// `_id` the list emits ("lc_" = live, no prefix = package/course, "ts_" = never
// material). Non-material / non-owned subs → 404 so the FE button stays hidden.
export const getSubscriptionTracking = async (req: Request, res: Response) => {
  const traceId = req.traceId;
  const userId = req.user?.id;
  const id = String(req.params.id || "");
  logger.info("getSubscriptionTracking invoked", { traceId, path: req.originalUrl, customerId: userId, subscriptionId: id });

  try {
    if (!userId) return res.status(401).json({ success: false, message: "Unauthorized." });
    const cidNum = parsePhId(String(userId));
    if (cidNum == null) return res.status(401).json({ success: false, message: "Unauthorized." });

    const data = await getSubscriptionTrackingMysql(id, cidNum);
    if (!data) return res.status(404).json({ success: false, message: "Tracking not available for this order." });
    logger.info("getSubscriptionTracking success (sql)", { traceId, customerId: userId, subscriptionId: id });
    return res.status(200).json({ success: true, data: { ...data, trackingUrl: buildTrackingUrl(data.awb ?? undefined) } });
  } catch (e: any) {
    logger.error("getSubscriptionTracking failed", { traceId, customerId: userId, subscriptionId: id, error: getErrorMessage(e), stack: e.stack });
    return res.status(500).json({ success: false, message: e.message });
  }
};

// GET /api/v1/client/purchase-history/subscriptions/:id/tracking/live
// Live AWB status from the Tirupati courier API (mirrors the Books tab live path).
// Only meaningful for AWBs in the Tirupati range (>= INITIAL_Number); below-threshold
// (our synthetic AWBs) return 422 with the static trackingUrl so the FE falls back
// to the stored history.
export const getSubscriptionTrackingLive = async (req: Request, res: Response) => {
  const traceId = req.traceId;
  const userId = req.user?.id;
  const id = String(req.params.id || "");
  logger.info("getSubscriptionTrackingLive invoked", { traceId, path: req.originalUrl, customerId: userId, subscriptionId: id });

  try {
    if (!userId) return res.status(401).json({ success: false, message: "Unauthorized." });
    const cidNum = parsePhId(String(userId));
    if (cidNum == null) return res.status(401).json({ success: false, message: "Unauthorized." });

    const sub = await getSubscriptionTrackingLiveMysql(id, cidNum);
    if (!sub) return res.status(404).json({ success: false, message: "Order not found." });
    if (!sub.trackingId) return res.status(404).json({ success: false, message: "Tracking not available yet." });
    const awb = sub.trackingId;
    if (awb < COURIER.TIRUPATI.INITIAL_Number) {
      return res.status(422).json({
        success: false,
        message: "Live tracking is not available for this carrier. Use trackingUrl instead.",
        data: { trackingUrl: buildTrackingUrl(awb) },
      });
    }
    const awbData = await fetchLiveAWBData(awb);
    logger.info("getSubscriptionTrackingLive success (sql)", { traceId, customerId: userId, subscriptionId: id });
    return res.status(200).json({ success: true, data: awbData });
  } catch (e: any) {
    logger.error("getSubscriptionTrackingLive failed", { traceId, customerId: userId, subscriptionId: id, error: getErrorMessage(e), stack: e.stack });
    return res.status(502).json({ success: false, message: "Failed to fetch live tracking." });
  }
};

// Helper kept for the books-tab thumbnail lookup so the list endpoint stays lean.
// MySQL read (ws_book): SQL ids are ints; map keyed by string id → thumbnail||image||null.
export const lookupBookThumbnails = async (bookIds: string[]) => {
  if (!bookIds.length) return new Map<string, string | null>();
  const ids = bookIds
    .map((b) => Number(b))
    .filter((n) => Number.isInteger(n) && n > 0);
  if (!ids.length) return new Map<string, string | null>();
  const books = await prisma.book.findMany({
    where: { id: { in: ids } },
    select: { id: true, thumbnail: true, image: true },
  });
  return new Map<string, string | null>(
    books.map((b) => [String(b.id), b.thumbnail || b.image || null])
  );
};
