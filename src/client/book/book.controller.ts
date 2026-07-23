import { Request, Response } from "express";
// Fully migrated to SQL (book-order module) — no mongoose / models imports.
import { BookOrderStatus } from "../../shared/enums";
import { generateBookReceipt } from "../../libs/core/generate";
import logger from "../../utils/logger";
import { getErrorMessage } from "../../utils/httpResponse";
import { buildShareUrl } from "../../deeplinking/shareRedirect";
import { buildTrackingUrl, COURIER } from "../../config/courier";
import { fetchLiveAWBData } from "../../libs/courier/tracking";
import { parseListQuery, buildPagination } from "../../utils/listQuery";
import {
  listBooksData,
  getBookById,
} from "../../modules/catalog-book/catalog-book.service";
import {
  getActiveCartState,
  getPurchasedBookIdSet,
  parseBookOrderId,
  getOrderTrackingMysql,
  getOrderTrackingLiveMysql,
  listMyOrdersMysql,
  getMyOrderByIdMysql,
} from "../../modules/book-order/book-order.service";
import {
  fetchTrendingBooksOnly as fetchTrendingBooksOnlySql,
  fetchTrendingEbooksOnly as fetchTrendingEbooksOnlySql,
} from "../../modules/client-trending/client-trending.service";
import { pick, pickList, omit, omitList } from "../../utils/pick";

// Client payload slimming (api-optimization audit) — drop fields the RN app never reads.
const BOOK_LIST_OMIT = [
  "qty", "isPurchased", "weight", "dynamicLink", "orderBy",
  "isTrending", "status", "key", "isPaid", "daysLeft", "updatedAt",
] as const;
const BOOK_DETAIL_OMIT = [
  "isMagazine", "isCombo", "isNew", "isPurchased", "weight", "dynamicLink",
  "orderBy", "isTrending", "status", "key", "isPaid", "daysLeft", "updatedAt",
] as const;
const TRENDING_EBOOK_KEEP = ["_id", "name", "image", "thumbnail"] as const;

const resolveBase = (req: Request) =>
  process.env.ORIGIN || `${req.protocol}://${req.get("host")}`;

// ─── Catalogue ────────────────────────────────────────────────────────────────

export const listBooks = async (req: Request, res: Response) => {
  const traceId = req.traceId;
  const customerId = req.user?.id;
  logger.info("listBooks invoked", { traceId, path: req.originalUrl, customerId });

  try {
    const { language } = req.query as Record<string, string>;
    const { search, page, limit, skip } = parseListQuery(req.query);

    // `type` is REQUIRED — each book category (magazine / combo / regular) is its
    // own independently searched + paginated list. magazine→isMagazine,
    // combo→isCombo, regular→neither flag set.
    const type = String(req.query.type ?? "").trim().toLowerCase();
    if (type !== "magazine" && type !== "combo" && type !== "regular") {
      return res.status(422).json({ success: false, message: "Invalid or missing type. Use one of: magazine, combo, regular." });
    }

    // ── MySQL book listing (catalog-book + book-order) ───────────
    // catalog-book supplies the data + computed fields; book-order supplies the
    // per-customer cart `qty`/`cartId` + `isPurchased`.
    const base = resolveBase(req);
    const buildShareLink = (bid: string) => buildShareUrl("books", bid, base);
    const custIdForToken = Number.isInteger(Number(customerId)) ? Number(customerId) : null;
    const { items: rows, total } = await listBooksData({ search, language, type, skip, take: limit }, buildShareLink, new Date(), custIdForToken);

    let cartId: string | null = null;
    let qtyByBookId = new Map<string, number>();
    let purchasedSet = new Set<string>();
    const customerIdInt = Number(customerId); // C3 seam
    if (customerId && Number.isInteger(customerIdInt)) {
      const cart = await getActiveCartState(customerIdInt);
      cartId = cart.cartId;
      qtyByBookId = cart.qtyByBookId;
      purchasedSet = await getPurchasedBookIdSet(customerIdInt);
    }

    const decoratedMysql = rows.map((b) => ({
      ...b,
      qty: qtyByBookId.get(b._id) ?? 0,
      isPurchased: purchasedSet.has(b._id),
    }));
    logger.info("listBooks success (mysql)", { traceId, customerId, type, count: decoratedMysql.length });
    return res.status(200).json({ success: true, data: { books: omitList(decoratedMysql, BOOK_LIST_OMIT) }, pagination: buildPagination(total, page, limit) });
  } catch (error: any) {
    logger.error("listBooks failed", { traceId, customerId, error: getErrorMessage(error), stack: error.stack });
    return res.status(500).json({ success: false, message: error.message });
  }
};

// GET /api/v1/client/books/trending?type=paid|free&language=&search=&limit=
export const listTrendingBooks = async (req: Request, res: Response) => {
  const traceId = req.traceId;
  logger.info("listTrendingBooks invoked", { traceId, path: req.originalUrl, userId: req.user?.id });

  try {
    const { type, language } = req.query as Record<string, string>;
    const { search, page, limit, skip } = parseListQuery(req.query);
    const wantFree = type === "free";

    // ── SQL branch (client-trending) ─────────────────────────────────────────
    // Combined trending: fetch books + ebooks from SQL (capped), merge by
    // createdAt desc — the merge is in-memory, so paginate the resolved array
    // via skip/take with `total` = full merged length.
    const custIdForToken = Number.isInteger(Number(req.user?.id)) ? Number(req.user?.id) : null;
    const [bookRes, ebookRes] = await Promise.all([
      fetchTrendingBooksOnlySql({ type, search, language, limit: 100, customerId: custIdForToken }),
      fetchTrendingEbooksOnlySql({ type, search, language, limit: 100 }),
    ]);
    const base = resolveBase(req);
    const mergedAll = [...bookRes.items, ...ebookRes.items]
      .sort((a, b) => new Date(b.createdAt as any).getTime() - new Date(a.createdAt as any).getTime());
    const total = mergedAll.length;
    const items = mergedAll
      .slice(skip, skip + limit)
      .map((item) => ({
        ...item,
        shareableLink: buildShareUrl(
          item.type === "ebook" ? "ebooks" : "books",
          String(item._id),
          base
        ),
      }));
    const resType = wantFree ? "free" : "paid";
    logger.info("listTrendingBooks success (mysql)", { traceId, type: resType, count: items.length });
    return res.status(200).json({
      success: true,
      data: { type: resType, items, total: items.length },
      pagination: buildPagination(total, page, limit),
    });
  } catch (error: any) {
    logger.error("listTrendingBooks failed", { traceId, error: getErrorMessage(error), stack: error.stack });
    return res.status(500).json({ success: false, message: error.message });
  }
};

// GET /api/v1/client/books/trending/books?type=paid|free&language=&search=&limit=
export const listTrendingBooksOnly = async (req: Request, res: Response) => {
  const traceId = req.traceId;
  logger.info("listTrendingBooksOnly invoked", { traceId, path: req.originalUrl, userId: req.user?.id });

  try {
    const { type, language } = req.query as Record<string, string>;
    const { search, page, limit, skip } = parseListQuery(req.query);
    const custIdForToken = Number.isInteger(Number(req.user?.id)) ? Number(req.user?.id) : null;
    const result = await fetchTrendingBooksOnlySql({ type, search, language, limit, skip, customerId: custIdForToken });

    const base = resolveBase(req);
    const items = result.items.map((item) => ({
      ...item,
      shareableLink: buildShareUrl("books", String(item._id), base),
    }));

    logger.info("listTrendingBooksOnly success", { traceId, type: result.type, count: items.length });
    return res.status(200).json({
      success: true,
      data: { type: result.type, items, total: items.length },
      pagination: buildPagination(result.total, page, limit),
    });
  } catch (error: any) {
    logger.error("listTrendingBooksOnly failed", { traceId, error: getErrorMessage(error), stack: error.stack });
    return res.status(500).json({ success: false, message: error.message });
  }
};

// GET /api/v1/client/books/trending/ebooks?type=paid|free&language=&search=&limit=
export const listTrendingEbooksOnly = async (req: Request, res: Response) => {
  const traceId = req.traceId;
  logger.info("listTrendingEbooksOnly invoked", { traceId, path: req.originalUrl, userId: req.user?.id });

  try {
    const { type, language } = req.query as Record<string, string>;
    const { search, page, limit, skip } = parseListQuery(req.query);
    const result = await fetchTrendingEbooksOnlySql({ type, search, language, limit, skip });

    // Ultra-slim free ebook cards — RN reads only _id/name/image/thumbnail.
    const items = pickList(result.items, TRENDING_EBOOK_KEEP);

    logger.info("listTrendingEbooksOnly success", { traceId, type: result.type, count: items.length });
    return res.status(200).json({
      success: true,
      data: { type: result.type, items, total: items.length },
      pagination: buildPagination(result.total, page, limit),
    });
  } catch (error: any) {
    logger.error("listTrendingEbooksOnly failed", { traceId, error: getErrorMessage(error), stack: error.stack });
    return res.status(500).json({ success: false, message: error.message });
  }
};

export const getBookDetail = async (req: Request, res: Response) => {
  const traceId = req.traceId;
  const customerId = req.user?.id;
  const id = req.params.id as string;
  logger.info("getBookDetail invoked", { traceId, path: req.originalUrl, customerId, id });

  try {
    // ── MySQL book detail (catalog-book + book-order) ────────────
    // A MySQL book id is an int.
    const bookIdInt = Number(id);
    if (!Number.isInteger(bookIdInt) || bookIdInt <= 0) {
      logger.warn("getBookDetail invalid id (mysql)", { traceId, customerId, id });
      return res.status(400).json({ success: false, message: "Invalid book id." });
    }
    const base = resolveBase(req);
    const custIdForToken = Number.isInteger(Number(customerId)) ? Number(customerId) : null;
    const dto = await getBookById(bookIdInt, (bid) => buildShareUrl("books", bid, base), new Date(), custIdForToken);
    if (!dto) {
      logger.warn("getBookDetail not found (mysql)", { traceId, customerId, id });
      return res.status(404).json({ success: false, message: "Book not found." });
    }
    let isPurchased = false;
    const customerIdInt = Number(customerId); // C3 seam
    if (customerId && Number.isInteger(customerIdInt)) {
      const purchased = await getPurchasedBookIdSet(customerIdInt);
      isPurchased = purchased.has(dto._id);
    }
    logger.info("getBookDetail success (mysql)", { traceId, customerId, id, isPurchased });
    return res.status(200).json({ success: true, data: omit({ ...dto, isPurchased }, BOOK_DETAIL_OMIT) });
  } catch (error: any) {
    logger.error("getBookDetail failed", { traceId, customerId, id, error: getErrorMessage(error), stack: error.stack });
    return res.status(500).json({ success: false, message: error.message });
  }
};

// Shipping has moved to POST /api/v1/client/cart/shipping (src/client/cart/*).
// Place-order has moved to POST /api/v1/client/payment/create-order
// (src/client/payment/payment.controller.ts).

// ─── Orders (customer view) ───────────────────────────────────────────────────

export const listMyOrders = async (req: Request, res: Response) => {
  const traceId = req.traceId;
  const customerId = req.user?.id;
  logger.info("listMyOrders invoked", { traceId, path: req.originalUrl, customerId });

  try {
    if (!customerId) {
      logger.warn("listMyOrders unauthorized", { traceId });
      return res.status(401).json({ success: false, message: "Unauthorized." });
    }

    const cid = parseBookOrderId(String(customerId));
    if (cid == null) {
      logger.warn("listMyOrders unauthorized", { traceId });
      return res.status(401).json({ success: false, message: "Unauthorized." });
    }

    const { status, page = "1", limit = "20" } = req.query as Record<string, string>;
    const statusFilter =
      status && Object.values(BookOrderStatus).includes(status as BookOrderStatus)
        ? status
        : undefined;

    const pageNum = Math.max(parseInt(page, 10) || 1, 1);
    const limitNum = Math.max(parseInt(limit, 10) || 20, 1);

    const { data, total } = await listMyOrdersMysql(cid, {
      status: statusFilter,
      page: pageNum,
      limit: limitNum,
    });

    logger.info("listMyOrders success", { traceId, customerId, total, returned: data.length });
    return res.status(200).json({
      success: true,
      data,
      pagination: { total, page: pageNum, limit: limitNum, totalPages: Math.ceil(total / limitNum) },
    });
  } catch (error: any) {
    logger.error("listMyOrders failed", { traceId, customerId, error: getErrorMessage(error), stack: error.stack });
    return res.status(500).json({ success: false, message: error.message });
  }
};

export const getMyOrderInvoice = async (req: Request, res: Response) => {
  const traceId = req.traceId;
  const customerId = req.user?.id;
  const id = req.params.id as string;
  logger.info("getMyOrderInvoice invoked", { traceId, path: req.originalUrl, customerId, orderId: id });

  try {
    if (!customerId) {
      logger.warn("getMyOrderInvoice unauthorized", { traceId });
      return res.status(401).json({ success: false, message: "Unauthorized." });
    }

    // SQL int order id (MySQL id-space); the receipt builder re-validates ownership.
    if (parseBookOrderId(id) == null) {
      logger.warn("getMyOrderInvoice invalid id", { traceId, customerId, id });
      return res.status(400).json({ success: false, message: "Invalid order id." });
    }

    const pdf = await generateBookReceipt(id, customerId);
    res.set({
      "Content-Type": "application/pdf",
      "Content-Length": String(pdf.length),
    });
    logger.info("getMyOrderInvoice success", { traceId, customerId, orderId: id, bytes: pdf.length });
    return res.send(pdf);
  } catch (error: any) {
    const msg = error?.message || "Failed to generate invoice.";
    const code = /not found|invalid|not been paid/i.test(msg) ? 404 : 500;
    if (code === 500) {
      logger.error("getMyOrderInvoice failed", { traceId, customerId, orderId: id, error: getErrorMessage(error), stack: error.stack });
    } else {
      logger.warn("getMyOrderInvoice client error", { traceId, customerId, orderId: id, msg });
    }
    return res.status(code).json({ success: false, message: msg });
  }
};

export const getMyOrderById = async (req: Request, res: Response) => {
  const traceId = req.traceId;
  const customerId = req.user?.id;
  const id = req.params.id as string;
  logger.info("getMyOrderById invoked", { traceId, path: req.originalUrl, customerId, orderId: id });

  try {
    if (!customerId) {
      logger.warn("getMyOrderById unauthorized", { traceId });
      return res.status(401).json({ success: false, message: "Unauthorized." });
    }

    const oid = parseBookOrderId(id);
    const cid = parseBookOrderId(String(customerId));
    if (oid == null || cid == null) {
      logger.warn("getMyOrderById invalid id", { traceId, customerId, id });
      return res.status(400).json({ success: false, message: "Invalid order id." });
    }

    const data = await getMyOrderByIdMysql(oid, cid);
    if (!data) {
      logger.warn("getMyOrderById not found", { traceId, customerId, id });
      return res.status(404).json({ success: false, message: "Order not found." });
    }

    logger.info("getMyOrderById success", { traceId, customerId, orderId: id });
    return res.status(200).json({ success: true, data });
  } catch (error: any) {
    logger.error("getMyOrderById failed", { traceId, customerId, orderId: id, error: getErrorMessage(error), stack: error.stack });
    return res.status(500).json({ success: false, message: error.message });
  }
};

// Shipment-tracking view for the post-payment screen. Shape matches the UI:
// summary (from / to / consignee / booked-on / awb) + ordered history with
// per-event location lines.
export const getMyOrderTracking = async (req: Request, res: Response) => {
  const traceId = req.traceId;
  const customerId = req.user?.id;
  const id = req.params.id as string;
  logger.info("getMyOrderTracking invoked", { traceId, path: req.originalUrl, customerId, orderId: id });

  try {
    if (!customerId) return res.status(401).json({ success: false, message: "Unauthorized." });

    const oid = parseBookOrderId(id);
    const cid = parseBookOrderId(String(customerId));
    if (oid == null || cid == null) return res.status(400).json({ success: false, message: "Invalid order id." });
    const data = await getOrderTrackingMysql(oid, cid);
    if (!data) return res.status(404).json({ success: false, message: "Order not found." });
    // Slim tracking DTO — drop fields the RN app never reads (trackingUrl/receiptId/courier/hubs/pincode/shipped/delivered/orderStatus).
    const { from, to, ...rest } = data;
    return res.status(200).json({
      success: true,
      data: {
        ...omit(rest, ["receiptId", "courier", "shippedAt", "deliveredAt", "orderStatus"]),
        from: pick(from, ["city"]),
        to: pick(to, ["city"]),
      },
    });
  } catch (error: any) {
    logger.error("getMyOrderTracking failed", { traceId, customerId, orderId: id, error: getErrorMessage(error), stack: error.stack });
    return res.status(500).json({ success: false, message: error.message });
  }
};

// Live AWB status polled from the Tirupati courier API (Point 4 of
// book-order-courier-tracking.md). Two-step: Redis-cached token, then AWB data.
// Only meaningful for trackingIds in the Tirupati range (>= INITIAL_Number) —
// Mahavir has no API, so below-threshold ids return a 422 with a hint to use
// the static trackingUrl instead.
export const getMyOrderTrackingLive = async (req: Request, res: Response) => {
  const traceId = req.traceId;
  const customerId = req.user?.id;
  const id = req.params.id as string;
  logger.info("getMyOrderTrackingLive invoked", { traceId, path: req.originalUrl, customerId, orderId: id });

  try {
    if (!customerId) return res.status(401).json({ success: false, message: "Unauthorized." });

    const oid = parseBookOrderId(id);
    const cid = parseBookOrderId(String(customerId));
    if (oid == null || cid == null) return res.status(400).json({ success: false, message: "Invalid order id." });
    const sqlOrder = await getOrderTrackingLiveMysql(oid, cid);
    if (!sqlOrder) return res.status(404).json({ success: false, message: "Order not found." });
    if (sqlOrder.status === BookOrderStatus.PENDING) return res.status(409).json({ success: false, message: "Order not yet verified." });
    if (!sqlOrder.trackingId) return res.status(404).json({ success: false, message: "Tracking not available yet." });
    const awb = sqlOrder.trackingId; // number (BigInt→number in the service)
    if (awb < COURIER.TIRUPATI.INITIAL_Number) {
      return res.status(422).json({
        success: false,
        message: "Live tracking is not available for this carrier. Use trackingUrl instead.",
        data: { trackingUrl: buildTrackingUrl(awb) },
      });
    }
    const awbData = await fetchLiveAWBData(awb);
    logger.info("getMyOrderTrackingLive success (sql)", { traceId, customerId, orderId: id });
    return res.status(200).json({ success: true, data: awbData });
  } catch (error: any) {
    logger.error("getMyOrderTrackingLive failed", { traceId, customerId, orderId: id, error: getErrorMessage(error), stack: error.stack });
    return res.status(502).json({ success: false, message: "Failed to fetch live tracking." });
  }
};
