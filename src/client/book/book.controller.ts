import { Request, Response } from "express";
import mongoose from "mongoose";
import { Book } from "../../models/book/Book.model";
import { BookCart } from "../../models/book/BookCart.model";
import { BookOrder } from "../../models/book/BookOrder.model";
import { BookSetting } from "../../models/book/BookSetting.model";
import { Ebook } from "../../models/ebook/Ebook.model";
import { EbookPrice } from "../../models/ebook/EbookPrice.model";
import { BookOrderStatus } from "../../models/enums";
import { generateBookReceipt } from "../../libs/core/generate";
import logger from "../../utils/logger";
import { getErrorMessage } from "../../utils/httpResponse";
import { buildShareUrl } from "../../deeplinking/shareRedirect";
import { buildTrackingUrl, COURIER } from "../../config/courier";
import { fetchLiveAWBData } from "../../libs/courier/tracking";

const resolveBase = (req: Request) =>
  process.env.ORIGIN || `${req.protocol}://${req.get("host")}`;

// ─── Catalogue ────────────────────────────────────────────────────────────────

export const listBooks = async (req: Request, res: Response) => {
  const traceId = req.traceId;
  const customerId = req.user?.id;
  logger.info("listBooks invoked", { traceId, path: req.originalUrl, customerId });

  try {
    const { search, language } = req.query as Record<string, string>;

    const filter: any = { status: true };
    if (search) {
      filter.$or = [
        { name: { $regex: search, $options: "i" } },
        { author: { $regex: search, $options: "i" } },
      ];
    }
    if (language) filter.language = language;

    const books = await Book.find(filter).sort({ orderBy: 1, createdAt: -1 });

    let cartMap = new Map<string, number>();
    let cartId: string | null = null;
    let purchasedSet = new Set<string>();
    if (customerId) {
      const cart = await BookCart.findOne({ customerId, status: true }).select("_id items");
      if (cart) {
        cartId = cart._id.toString();
        cart.items.forEach((i) => cartMap.set(i.bookId.toString(), i.qty));
      }
      // Books are permanent once delivered — any successful past order counts
      // as purchased. Matches the rule for /purchase-history/books.
      const purchasedIds = await BookOrder.distinct("items.bookId", {
        customerId,
        status: {
          $in: [BookOrderStatus.VERIFIED, BookOrderStatus.SHIPPED, BookOrderStatus.DELIVERED],
        },
      });
      purchasedSet = new Set(purchasedIds.map((id: any) => String(id)));
    }

    const base = resolveBase(req);
    const decorated = books.map((b) => {
      const doc = b.toObject();
      const idStr = b._id.toString();
      return {
        ...doc,
        qty: cartMap.get(idStr) ?? 0,
        key: b.isCombo ? "combo" : "individual",
        // Books are paid when they cost > 0 (discountedPrice 0 = free).
        isPaid: (doc.discountedPrice ?? 0) > 0,
        isPurchased: purchasedSet.has(idStr),
        // One-time purchase with no expiry, so there's no countdown.
        daysLeft: null,
        shareableLink: buildShareUrl("books", idStr, base),
      };
    });

    logger.info("listBooks success", { traceId, customerId, count: decorated.length });
    return res.status(200).json({ success: true, data: { cartId, books: decorated } });
  } catch (error: any) {
    logger.error("listBooks failed", { traceId, customerId, error: getErrorMessage(error), stack: error.stack });
    return res.status(500).json({ success: false, message: error.message });
  }
};

type TrendingOpts = { type?: string; search?: string; language?: string; limit?: number };

function resolveTrendingFlags(opts: TrendingOpts) {
  const wantFree = opts.type === "free";
  const wantPaid = opts.type === "paid" || !opts.type;
  const limitNum = Math.min(Math.max(opts.limit ?? 20, 1), 100);
  return { wantFree, wantPaid, limitNum };
}

export async function fetchTrendingBooksOnly(opts: TrendingOpts = {}) {
  const { wantFree, wantPaid, limitNum } = resolveTrendingFlags(opts);

  const bookFilter: any = { status: true, isTrending: true };
  if (opts.language) bookFilter.language = opts.language;
  if (opts.search) {
    const rx = { $regex: opts.search, $options: "i" };
    bookFilter.$or = [{ name: rx }, { author: rx }];
  }
  if (wantFree) bookFilter.discountedPrice = 0;
  else if (wantPaid) bookFilter.discountedPrice = { $gt: 0 };

  const books = await Book.find(bookFilter).sort({ orderBy: 1, createdAt: -1 }).lean();

  const items = books.slice(0, limitNum).map((b) => ({
    type: "book" as const,
    _id: b._id,
    name: b.name,
    description: b.description,
    author: b.author,
    language: b.language,
    image: b.image,
    thumbnail: b.thumbnail,
    demoUrl: b.demoUrl,
    isTrending: b.isTrending,
    isCombo: b.isCombo,
    isMagazine: b.isMagazine,
    listPrice: b.listPrice,
    discountedPrice: b.discountedPrice,
    shippingPrice: b.shippingPrice,
    pages: b.pages ?? 0,
    price: b.discountedPrice,
    isFree: b.discountedPrice === 0,
    createdAt: b.createdAt,
  }));

  return { type: wantFree ? "free" : "paid", items };
}

export async function fetchTrendingEbooksOnly(opts: TrendingOpts = {}) {
  const { wantFree, wantPaid, limitNum } = resolveTrendingFlags(opts);

  const ebookFilter: any = { status: true, isTrending: true };
  if (opts.language) ebookFilter.language = opts.language;
  if (opts.search) {
    const rx = { $regex: opts.search, $options: "i" };
    ebookFilter.$or = [{ name: rx }, { author: rx }];
  }

  const ebooks = await Ebook.find(ebookFilter).sort({ order: 1, createdAt: -1 }).lean();

  const ebookIds = ebooks.map((e) => e._id);
  const plans = ebookIds.length
    ? await EbookPrice.find({ ebookId: { $in: ebookIds }, status: true }).sort({ duration: 1 }).lean()
    : [];
  const plansByEbook = new Map<string, any[]>();
  plans.forEach((p) => {
    const key = String(p.ebookId);
    const arr = plansByEbook.get(key) || [];
    arr.push(p);
    plansByEbook.set(key, arr);
  });

  const items = ebooks
    .map((e) => {
      const ePlans = plansByEbook.get(String(e._id)) || [];
      const minPrice = ePlans.length ? Math.min(...ePlans.map((p) => p.price ?? 0)) : 0;
      const isFree = minPrice === 0;
      if (wantFree && !isFree) return null;
      if (wantPaid && isFree) return null;
      return {
        type: "ebook" as const,
        _id: e._id,
        name: e.name,
        description: e.description,
        author: e.author,
        publisher: e.publisher,
        language: e.language,
        image: e.image,
        thumbnail: e.thumbnail,
        demoUrl: e.demoUrl,
        isTrending: e.isTrending,
        price: minPrice,
        isFree,
        plans: ePlans,
        createdAt: e.createdAt,
      };
    })
    .filter(Boolean)
    .slice(0, limitNum) as any[];

  return { type: wantFree ? "free" : "paid", items };
}

export async function fetchTrendingBookItems(opts: TrendingOpts = {}) {
  const { wantFree, limitNum } = resolveTrendingFlags(opts);
  const [{ items: bookItems }, { items: ebookItems }] = await Promise.all([
    fetchTrendingBooksOnly({ ...opts, limit: 100 }),
    fetchTrendingEbooksOnly({ ...opts, limit: 100 }),
  ]);

  const merged = [...bookItems, ...ebookItems]
    .sort((a, b) => new Date(b.createdAt as any).getTime() - new Date(a.createdAt as any).getTime())
    .slice(0, limitNum);

  return { type: wantFree ? "free" : "paid", items: merged };
}

// GET /api/v1/client/books/trending?type=paid|free&language=&search=&limit=
export const listTrendingBooks = async (req: Request, res: Response) => {
  const traceId = req.traceId;
  logger.info("listTrendingBooks invoked", { traceId, path: req.originalUrl, userId: req.user?.id });

  try {
    const { type, search, language, limit } = req.query as Record<string, string>;
    const wantFree = type === "free";
    const wantPaid = type === "paid" || !type; // default to paid
    const limitNum = Math.min(Math.max(parseInt(limit, 10) || 20, 1), 100);

    const bookFilter: any = { status: true, isTrending: true };
    const ebookFilter: any = { status: true, isTrending: true };
    if (language) {
      bookFilter.language = language;
      ebookFilter.language = language;
    }
    if (search) {
      const rx = { $regex: search, $options: "i" };
      bookFilter.$or = [{ name: rx }, { author: rx }];
      ebookFilter.$or = [{ name: rx }, { author: rx }];
    }
    if (wantFree) {
      bookFilter.discountedPrice = 0;
    } else if (wantPaid) {
      bookFilter.discountedPrice = { $gt: 0 };
    }

    const [books, ebooks] = await Promise.all([
      Book.find(bookFilter).sort({ orderBy: 1, createdAt: -1 }).lean(),
      Ebook.find(ebookFilter).sort({ order: 1, createdAt: -1 }).lean(),
    ]);

    // Resolve ebook pricing — an ebook is "free" if its lowest active plan price is 0 (or no plans).
    const ebookIds = ebooks.map((e) => e._id);
    const plans = ebookIds.length
      ? await EbookPrice.find({ ebookId: { $in: ebookIds }, status: true })
          .sort({ duration: 1 })
          .lean()
      : [];
    const plansByEbook = new Map<string, any[]>();
    plans.forEach((p) => {
      const key = String(p.ebookId);
      const arr = plansByEbook.get(key) || [];
      arr.push(p);
      plansByEbook.set(key, arr);
    });

    const ebookItems = ebooks
      .map((e) => {
        const ePlans = plansByEbook.get(String(e._id)) || [];
        const minPrice = ePlans.length ? Math.min(...ePlans.map((p) => p.price ?? 0)) : 0;
        const isFree = minPrice === 0;
        if (wantFree && !isFree) return null;
        if (wantPaid && isFree) return null;
        return {
          type: "ebook" as const,
          _id: e._id,
          name: e.name,
          description: e.description,
          author: e.author,
          publisher: e.publisher,
          language: e.language,
          image: e.image,
          thumbnail: e.thumbnail,
          demoUrl: e.demoUrl,
          isTrending: e.isTrending,
          price: minPrice,
          isFree,
          plans: ePlans,
          createdAt: e.createdAt,
        };
      })
      .filter(Boolean) as any[];

    const bookItems = books.map((b) => ({
      type: "book" as const,
      _id: b._id,
      name: b.name,
      description: b.description,
      author: b.author,
      language: b.language,
      image: b.image,
      thumbnail: b.thumbnail,
      demoUrl: b.demoUrl,
      isTrending: b.isTrending,
      isCombo: b.isCombo,
      isMagazine: b.isMagazine,
      listPrice: b.listPrice,
      discountedPrice: b.discountedPrice,
      shippingPrice: b.shippingPrice,
      price: b.discountedPrice,
      isFree: b.discountedPrice === 0,
      createdAt: b.createdAt,
    }));

    const base = resolveBase(req);
    const merged = [...bookItems, ...ebookItems]
      .sort((a, b) => new Date(b.createdAt as any).getTime() - new Date(a.createdAt as any).getTime())
      .slice(0, limitNum)
      .map((item) => ({
        ...item,
        shareableLink: buildShareUrl(
          item.type === "ebook" ? "ebooks" : "books",
          String(item._id),
          base
        ),
      }));

    logger.info("listTrendingBooks success", { traceId, type: wantFree ? "free" : "paid", count: merged.length });
    return res.status(200).json({
      success: true,
      data: { type: wantFree ? "free" : "paid", items: merged, total: merged.length },
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
    const { type, search, language, limit } = req.query as Record<string, string>;
    const limitNum = parseInt(limit, 10) || 20;
    const result = await fetchTrendingBooksOnly({ type, search, language, limit: limitNum });

    const base = resolveBase(req);
    const items = result.items.map((item) => ({
      ...item,
      shareableLink: buildShareUrl("books", String(item._id), base),
    }));

    logger.info("listTrendingBooksOnly success", { traceId, type: result.type, count: items.length });
    return res.status(200).json({
      success: true,
      data: { type: result.type, items, total: items.length },
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
    const { type, search, language, limit } = req.query as Record<string, string>;
    const limitNum = parseInt(limit, 10) || 20;
    const result = await fetchTrendingEbooksOnly({ type, search, language, limit: limitNum });

    const base = resolveBase(req);
    const items = result.items.map((item) => ({
      ...item,
      shareableLink: buildShareUrl("ebooks", String(item._id), base),
    }));

    logger.info("listTrendingEbooksOnly success", { traceId, type: result.type, count: items.length });
    return res.status(200).json({
      success: true,
      data: { type: result.type, items, total: items.length },
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
    if (!mongoose.Types.ObjectId.isValid(id)) {
      logger.warn("getBookDetail invalid id", { traceId, customerId, id });
      return res.status(400).json({ success: false, message: "Invalid book id." });
    }
    const book = await Book.findOne({ _id: id, status: true }).lean();
    if (!book) {
      logger.warn("getBookDetail not found", { traceId, customerId, id });
      return res.status(404).json({ success: false, message: "Book not found." });
    }

    let isPurchased = false;
    if (customerId) {
      const owned = await BookOrder.exists({
        customerId,
        "items.bookId": book._id,
        status: {
          $in: [BookOrderStatus.VERIFIED, BookOrderStatus.SHIPPED, BookOrderStatus.DELIVERED],
        },
      });
      isPurchased = !!owned;
    }

    logger.info("getBookDetail success", { traceId, customerId, id, isPurchased });
    return res.status(200).json({
      success: true,
      data: {
        ...book,
        pages: book.pages ?? 0,
        // Books are paid when they cost > 0 (discountedPrice 0 = free).
        isPaid: (book.discountedPrice ?? 0) > 0,
        isPurchased,
        // One-time purchase with no expiry, so there's no countdown.
        daysLeft: null,
        shareableLink: buildShareUrl("books", id, resolveBase(req)),
      },
    });
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

    const { status, page = "1", limit = "20" } = req.query as Record<string, string>;
    const filter: any = { customerId };
    if (status && Object.values(BookOrderStatus).includes(status as BookOrderStatus))
      filter.status = status;

    const pageNum = Math.max(parseInt(page, 10) || 1, 1);
    const limitNum = Math.max(parseInt(limit, 10) || 20, 1);
    const skip = (pageNum - 1) * limitNum;

    const [data, total] = await Promise.all([
      BookOrder.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limitNum),
      BookOrder.countDocuments(filter),
    ]);

    const decorated = data.map((o) => {
      const obj = o.toObject();
      return {
        ...obj,
        trackingUrl: buildTrackingUrl(obj.tracking?.trackingId),
      };
    });

    logger.info("listMyOrders success", { traceId, customerId, total, returned: decorated.length });
    return res.status(200).json({
      success: true,
      data: decorated,
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

    if (!mongoose.Types.ObjectId.isValid(id)) {
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

    if (!mongoose.Types.ObjectId.isValid(id)) {
      logger.warn("getMyOrderById invalid id", { traceId, customerId, id });
      return res.status(400).json({ success: false, message: "Invalid order id." });
    }

    const order = await BookOrder.findOne({ _id: id, customerId })
      .populate("shippingId")
      .populate("items.bookId", "_id name thumbnail author");
    if (!order) {
      logger.warn("getMyOrderById not found", { traceId, customerId, id });
      return res.status(404).json({ success: false, message: "Order not found." });
    }

    const obj = order.toObject();
    logger.info("getMyOrderById success", { traceId, customerId, orderId: id });
    return res.status(200).json({
      success: true,
      data: {
        ...obj,
        trackingUrl: buildTrackingUrl(obj.tracking?.trackingId),
      },
    });
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
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ success: false, message: "Invalid order id." });
    }

    const [order, settings] = await Promise.all([
      BookOrder.findOne({ _id: id, customerId }).populate("shippingId").lean(),
      BookSetting.findOne({ key: "default" }).lean(),
    ]);
    if (!order) return res.status(404).json({ success: false, message: "Order not found." });

    const ship: any = order.shippingId || {};
    const tracking = order.tracking || ({} as any);
    const history = (tracking.history || [])
      .slice()
      .sort((a: any, b: any) => new Date(a.at).getTime() - new Date(b.at).getTime())
      .map((h: any) => ({
        status: h.status,
        location: h.location || null,
        note: h.note || null,
        at: h.at,
      }));

    return res.status(200).json({
      success: true,
      data: {
        orderId: String(order._id),
        receiptId: order.receiptId,
        awb: tracking.trackingId || null,
        courier: tracking.courier || null,
        trackingUrl: buildTrackingUrl(tracking.trackingId),
        from: {
          city: settings?.originCity || null,
          hub: settings?.originHub || null,
        },
        to: {
          city: ship.city || null,
          hub: ship.address || null,
          pincode: ship.pincode || null,
        },
        consignee: ship.name || null,
        consigneePhone: ship.phone || null,
        bookedAt: order.paidAt || order.createdAt,
        currentStatus: tracking.status || order.status,
        orderStatus: order.status,
        shippedAt: order.shippedAt || null,
        deliveredAt: order.deliveredAt || null,
        history,
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
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ success: false, message: "Invalid order id." });
    }

    const order = await BookOrder.findOne({ _id: id, customerId })
      .select("status tracking.trackingId")
      .lean();
    if (!order) return res.status(404).json({ success: false, message: "Order not found." });

    // Only verified+ orders carry an allocated trackingId.
    if (order.status === BookOrderStatus.PENDING) {
      return res.status(409).json({ success: false, message: "Order not yet verified." });
    }

    const trackingId = order.tracking?.trackingId;
    if (!trackingId) {
      return res.status(404).json({ success: false, message: "Tracking not available yet." });
    }

    // Mahavir range has no live API.
    if (Number(trackingId) < COURIER.TIRUPATI.INITIAL_Number) {
      return res.status(422).json({
        success: false,
        message: "Live tracking is not available for this carrier. Use trackingUrl instead.",
        data: { trackingUrl: buildTrackingUrl(trackingId) },
      });
    }

    const awbData = await fetchLiveAWBData(trackingId);
    logger.info("getMyOrderTrackingLive success", { traceId, customerId, orderId: id });
    return res.status(200).json({ success: true, data: awbData });
  } catch (error: any) {
    logger.error("getMyOrderTrackingLive failed", { traceId, customerId, orderId: id, error: getErrorMessage(error), stack: error.stack });
    return res.status(502).json({ success: false, message: "Failed to fetch live tracking." });
  }
};
