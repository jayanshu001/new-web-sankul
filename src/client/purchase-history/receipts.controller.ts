import { Request, Response } from "express";
import { prisma } from "../../config/prisma";
import logger from "../../utils/logger";
import { getErrorMessage } from "../../utils/httpResponse";
import {
  parsePhId,
  getEbookReceiptMysql,
  getBookReceiptMysql,
  getCourseReceiptMysql,
  getLiveCourseReceiptMysql,
  getTestSeriesReceiptMysql,
} from "../../modules/client-purchase-history/client-purchase-history.service";

// Live-course and test-series subscriptions share the /subscriptions/:id/receipt route
// but live in separate tables (ws_live_course_subscription / ws_test_series_subscription),
// so the list emits "lc_"- / "ts_"-prefixed ids to disambiguate here.
const LIVE_ID_PREFIX = "lc_";
const TS_ID_PREFIX = "ts_";

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

    // Live-course ("lc_") and test-series ("ts_") subs use prefixed ids (separate
    // tables) — route them apart; unprefixed = package/course subscription.
    const isLive = id.startsWith(LIVE_ID_PREFIX);
    const isTs = id.startsWith(TS_ID_PREFIX);
    const sid = parsePhId(
      isLive ? id.slice(LIVE_ID_PREFIX.length) : isTs ? id.slice(TS_ID_PREFIX.length) : id
    );
    if (sid == null) { logger.warn("getCourseReceipt invalid id (sql)", { traceId, customerId: userId, subscriptionId: id }); return res.status(400).json({ success: false, message: "Invalid id." }); }

    const data = isLive
      ? await getLiveCourseReceiptMysql(sid, cidNum)
      : isTs
      ? await getTestSeriesReceiptMysql(sid, cidNum)
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
