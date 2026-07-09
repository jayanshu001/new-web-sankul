import { Request, Response } from "express";
import { BookOrderStatus } from "../../shared/enums";
import {
  createBookSchema,
  updateBookSchema,
  reorderBooksSchema,
  updateOrderStatusSchema,
  setTrackingSchema,
  addTrackingEventSchema,
  updateSettingsSchema,
} from "./book.validation";
import logger from "../../utils/logger";
import { getErrorMessage } from "../../utils/httpResponse";
import * as adminBook from "../../modules/admin-book/admin-book.service";

// ─── Books CRUD ───────────────────────────────────────────────────────────────

export const getBooks = async (req: Request, res: Response) => {
  const traceId = req.traceId;
  logger.info("getBooks invoked", { traceId, path: req.originalUrl, userId: req.user?.id });

  try {
    const {
      search,
      status,
      language,
      isMagazine,
      isCombo,
      page = "1",
      limit = "20",
    } = req.query as Record<string, string>;

    const pageNum = Math.max(parseInt(page, 10) || 1, 1);
    const limitNum = Math.max(parseInt(limit, 10) || 20, 1);

    const { data, total } = await adminBook.listBooks({
      search,
      language,
      isMagazine: isMagazine === "true" ? true : isMagazine === "false" ? false : undefined,
      isCombo: isCombo === "true" ? true : isCombo === "false" ? false : undefined,
      status: status === "true" ? true : status === "false" ? false : undefined,
      page: pageNum,
      limit: limitNum,
    });
    logger.info("getBooks success (mysql)", { traceId, total });
    return res.status(200).json({
      success: true,
      data,
      pagination: { total, page: pageNum, limit: limitNum, totalPages: Math.ceil(total / limitNum) },
    });
  } catch (error: any) {
    logger.error("getBooks failed", { traceId, error: getErrorMessage(error), stack: error.stack });
    return res.status(500).json({ success: false, message: error.message });
  }
};

export const getBookById = async (req: Request, res: Response) => {
  const traceId = req.traceId;
  const id = req.params.id as string;
  logger.info("getBookById invoked", { traceId, path: req.originalUrl, id });

  try {
    const numId = adminBook.parseBookId(id);
    if (!numId) { logger.warn("getBookById invalid id", { traceId, id }); return res.status(400).json({ success: false, message: "Invalid book id." }); }
    const book = await adminBook.getBook(numId);
    if (!book) { logger.warn("getBookById not found (mysql)", { traceId, id }); return res.status(404).json({ success: false, message: "Book not found." }); }
    logger.info("getBookById success (mysql)", { traceId, id });
    return res.status(200).json({ success: true, data: book });
  } catch (error: any) {
    logger.error("getBookById failed", { traceId, id, error: getErrorMessage(error), stack: error.stack });
    return res.status(500).json({ success: false, message: error.message });
  }
};

// Maps an uploaded PDF field to the body key that stores its original
// (human-readable) filename — mirrors the Ebook model's demoFileName/bookFileName.
const PDF_FILENAME_KEY: Record<string, string> = {
  demoUrl: "demoFileName",
  bookUrl: "bookFileName",
};

const mergeUploadedFiles = (req: Request) => {
  const files = req.files as Record<string, Express.MulterS3.File[]> | undefined;
  if (!files) return;
  for (const field of ["image", "thumbnail", "demoUrl", "bookUrl"]) {
    const f = files[field]?.[0] as any;
    if (f?.location) req.body[field] = f.location;
    // The S3 key is timestamp-prefixed; preserve the original upload name so the
    // API can show "GPL Technical Book.pdf" instead of "1781000928537-demoUrl.pdf".
    const nameKey = PDF_FILENAME_KEY[field];
    if (nameKey && f?.originalname) req.body[nameKey] = f.originalname;
  }
};

// Multipart form-data flattens `field[0]=a&field[1]=b` (and the bare
// `field[]=a&field[]=b` form) into literal keys; reassemble them into a real
// array before validation. (The Zod schema also accepts a JSON-stringified
// array or a single string, so this only needs to handle the bracketed-key
// form.) Applies to every array-of-id field the frontend may send.
const ARRAY_BODY_FIELDS = ["packageIds", "examCountdownCategoryIds", "examCountdownIds"] as const;

const coerceArrayFields = (req: Request) => {
  const body = req.body as Record<string, any>;
  for (const field of ARRAY_BODY_FIELDS) {
    if (Array.isArray(body[field])) continue;
    const bracketKeys = Object.keys(body).filter((k) => k.startsWith(`${field}[`));
    if (!bracketKeys.length) continue;
    const arr = bracketKeys.map((k) => {
      const v = body[k];
      delete body[k];
      return v;
    });
    body[field] = arr.filter((v) => v !== "");
  }
};

export const createBook = async (req: Request, res: Response) => {
  const traceId = req.traceId;
  logger.info("createBook invoked", { traceId, path: req.originalUrl, userId: req.user?.id });

  try {
    mergeUploadedFiles(req);
    coerceArrayFields(req);
    const data = createBookSchema.parse(req.body);
    // Legacy single field is now a derived mirror of examCountdownCategoryIds[0]
    // (admin no longer sends a meaningful single value). Kept in sync so the one
    // remaining reader stays correct until the field is dropped. See
    // docs/MIGRATION_QUERY_CHANGES.md.
    (data as any).examCountdownCategoryId = data.examCountdownCategoryIds?.[0] ?? null;
    if (data.discountedPrice > data.listPrice) {
      logger.warn("createBook discount exceeds list", { traceId });
      return res.status(400).json({
        success: false,
        message: "Discounted price cannot exceed list price.",
      });
    }
    // C6: examCountdownIds/examCountdownCategoryIds NOW persist to ws_book JSON
    // columns (parseIdArray-normalised in the service). demoFileName now persists
    // too (ws_book.demo_file_name); isTrending persists to ws_book.is_trending.
    // Still dropped on SQL: packageIds/termsAndConditions/bookFileName/bookUrl —
    // books have no full-book PDF and those fields have no SQL columns.
    const created = await adminBook.createBook(data as any);
    logger.info("createBook success (mysql)", { traceId, bookId: created._id });
    return res.status(201).json({ success: true, data: created });
  } catch (error: any) {
    if (error.issues) { logger.warn("createBook validation failed", { traceId, issues: error.issues }); return res.status(400).json({ success: false, errors: error.issues }); }
    logger.error("createBook failed", { traceId, error: getErrorMessage(error), stack: error.stack });
    return res.status(500).json({ success: false, message: error.message });
  }
};

export const updateBook = async (req: Request, res: Response) => {
  const traceId = req.traceId;
  const id = req.params.id as string;
  logger.info("updateBook invoked", { traceId, path: req.originalUrl, id });

  try {
    const sqlId = adminBook.parseBookId(id);
    if (!sqlId) { logger.warn("updateBook invalid id", { traceId, id }); return res.status(400).json({ success: false, message: "Invalid book id." }); }
    mergeUploadedFiles(req);
    coerceArrayFields(req);
    const data = updateBookSchema.parse(req.body);
    // Keep the legacy single field in sync with examCountdownCategoryIds[0], but
    // ONLY when the array is present in this payload — otherwise an update that
    // doesn't touch countdowns would wipe the single field. See
    // docs/MIGRATION_QUERY_CHANGES.md.
    if (data.examCountdownCategoryIds !== undefined) {
      (data as any).examCountdownCategoryId = data.examCountdownCategoryIds[0] ?? null;
    } else {
      // Don't let a stale single value the admin still sends override the arrays.
      delete (data as any).examCountdownCategoryId;
    }
    if (
      data.discountedPrice !== undefined &&
      data.listPrice !== undefined &&
      data.discountedPrice > data.listPrice
    ) {
      logger.warn("updateBook discount exceeds list", { traceId, id });
      return res.status(400).json({
        success: false,
        message: "Discounted price cannot exceed list price.",
      });
    }
    const updated = await adminBook.updateBook(sqlId, data as any);
    if (!updated) { logger.warn("updateBook not found (mysql)", { traceId, id }); return res.status(404).json({ success: false, message: "Book not found." }); }
    logger.info("updateBook success (mysql)", { traceId, id });
    return res.status(200).json({ success: true, data: updated });
  } catch (error: any) {
    if (error.issues) { logger.warn("updateBook validation failed", { traceId, id, issues: error.issues }); return res.status(400).json({ success: false, errors: error.issues }); }
    logger.error("updateBook failed", { traceId, id, error: getErrorMessage(error), stack: error.stack });
    return res.status(500).json({ success: false, message: error.message });
  }
};

export const deleteBook = async (req: Request, res: Response) => {
  const traceId = req.traceId;
  const id = req.params.id as string;
  logger.info("deleteBook invoked", { traceId, path: req.originalUrl, id });

  try {
    const numId = adminBook.parseBookId(id);
    if (!numId) { logger.warn("deleteBook invalid id", { traceId, id }); return res.status(400).json({ success: false, message: "Invalid book id." }); }
    const ok = await adminBook.deleteBook(numId);
    if (!ok) { logger.warn("deleteBook not found (mysql)", { traceId, id }); return res.status(404).json({ success: false, message: "Book not found." }); }
    logger.info("deleteBook success (mysql)", { traceId, id });
    return res.status(200).json({ success: true, message: "Book deleted." });
  } catch (error: any) {
    logger.error("deleteBook failed", { traceId, id, error: getErrorMessage(error), stack: error.stack });
    return res.status(500).json({ success: false, message: error.message });
  }
};

export const toggleBookStatus = async (req: Request, res: Response) => {
  const traceId = req.traceId;
  const id = req.params.id as string;
  logger.info("toggleBookStatus invoked", { traceId, path: req.originalUrl, id });

  try {
    const numId = adminBook.parseBookId(id);
    if (!numId) { logger.warn("toggleBookStatus invalid id", { traceId, id }); return res.status(400).json({ success: false, message: "Invalid book id." }); }
    const newStatus = await adminBook.toggleBookStatus(numId);
    if (newStatus === null) { logger.warn("toggleBookStatus not found (mysql)", { traceId, id }); return res.status(404).json({ success: false, message: "Book not found." }); }
    logger.info("toggleBookStatus success (mysql)", { traceId, id, newStatus });
    return res.status(200).json({ success: true, data: { status: newStatus } });
  } catch (error: any) {
    logger.error("toggleBookStatus failed", { traceId, id, error: getErrorMessage(error), stack: error.stack });
    return res.status(500).json({ success: false, message: error.message });
  }
};

// ws_book.is_trending exists (Prisma `Book.isTrending`), so this mirrors
// toggleBookStatus.
export const toggleBookTrending = async (req: Request, res: Response) => {
  const traceId = req.traceId;
  const id = req.params.id as string;
  logger.info("toggleBookTrending invoked", { traceId, path: req.originalUrl, id });

  try {
    const numId = adminBook.parseBookId(id);
    if (!numId) { logger.warn("toggleBookTrending invalid id", { traceId, id }); return res.status(400).json({ success: false, message: "Invalid book id." }); }
    const newValue = await adminBook.toggleBookTrending(numId);
    if (newValue === null) { logger.warn("toggleBookTrending not found (mysql)", { traceId, id }); return res.status(404).json({ success: false, message: "Book not found." }); }
    logger.info("toggleBookTrending success (mysql)", { traceId, id, newValue });
    return res.status(200).json({ success: true, data: { isTrending: newValue } });
  } catch (error: any) {
    logger.error("toggleBookTrending failed", { traceId, id, error: getErrorMessage(error), stack: error.stack });
    return res.status(500).json({ success: false, message: error.message });
  }
};

export const reorderBooks = async (req: Request, res: Response) => {
  const traceId = req.traceId;
  logger.info("reorderBooks invoked", { traceId, path: req.originalUrl });

  try {
    const { orders } = reorderBooksSchema.parse(req.body);
    await adminBook.reorderBooks(orders);
    logger.info("reorderBooks success (mysql)", { traceId, count: orders.length });
    return res.status(200).json({ success: true, message: "Book order updated." });
  } catch (error: any) {
    if (error.issues) { logger.warn("reorderBooks validation failed", { traceId, issues: error.issues }); return res.status(400).json({ success: false, errors: error.issues }); }
    logger.error("reorderBooks failed", { traceId, error: getErrorMessage(error), stack: error.stack });
    return res.status(500).json({ success: false, message: error.message });
  }
};

// ─── Orders ───────────────────────────────────────────────────────────────────

// Shared filter mapping for the orders report list + its CSV/Excel exports, so all
// three honor the identical param contract (minus page/limit on the exports).
const parseOrderReportQuery = (q: Record<string, string>): adminBook.OrderReportQuery => ({
  customerId: q.customerId,
  bookId: q.bookId,
  status: q.status && Object.values(BookOrderStatus).includes(q.status as BookOrderStatus) ? q.status : undefined,
  state: q.state,
  // Accept both dateFrom/dateTo (report contract) and legacy fromDate/toDate.
  fromDate: q.dateFrom ?? q.fromDate,
  toDate: q.dateTo ?? q.toDate,
  search: q.search,
  sortBy: q.sortBy,
  sortOrder: q.sortOrder,
});

export const getOrders = async (req: Request, res: Response) => {
  const traceId = req.traceId;
  logger.info("getOrders invoked", { traceId, path: req.originalUrl });

  try {
    const q = req.query as Record<string, string>;
    const pageNum = Math.max(parseInt(q.page || "1", 10) || 1, 1);
    const limitNum = Math.max(parseInt(q.limit || "20", 10) || 20, 1);

    const { items, total } = await adminBook.listOrders({
      ...parseOrderReportQuery(q),
      page: pageNum,
      limit: limitNum,
    });
    logger.info("getOrders success (mysql)", { traceId, total });
    return res.status(200).json({
      success: true,
      items,
      pagination: { page: pageNum, limit: limitNum, total, totalPages: Math.ceil(total / limitNum) },
    });
  } catch (error: any) {
    logger.error("getOrders failed", { traceId, error: getErrorMessage(error), stack: error.stack });
    return res.status(500).json({ success: false, message: error.message });
  }
};

// GET /admin/books/orders/export/csv — entire filtered set, one row per book line.
export const exportOrdersCsv = async (req: Request, res: Response) => {
  const traceId = req.traceId;
  logger.info("exportOrdersCsv invoked", { traceId, path: req.originalUrl });

  try {
    const csv = await adminBook.buildOrdersCsv(parseOrderReportQuery(req.query as Record<string, string>));
    const filename = `book-orders-${new Date().toISOString().slice(0, 10)}.csv`;
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
    logger.info("exportOrdersCsv success (mysql)", { traceId });
    return res.status(200).send(csv);
  } catch (error: any) {
    logger.error("exportOrdersCsv failed", { traceId, error: getErrorMessage(error), stack: error.stack });
    return res.status(500).json({ success: false, message: error.message });
  }
};

// GET /admin/books/orders/export/excel — entire filtered set, one row per book line.
export const exportOrdersExcel = async (req: Request, res: Response) => {
  const traceId = req.traceId;
  logger.info("exportOrdersExcel invoked", { traceId, path: req.originalUrl });

  try {
    const buf = await adminBook.buildOrdersXlsx(parseOrderReportQuery(req.query as Record<string, string>));
    const filename = `book-orders-${new Date().toISOString().slice(0, 10)}.xlsx`;
    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
    logger.info("exportOrdersExcel success (mysql)", { traceId });
    return res.status(200).send(buf);
  } catch (error: any) {
    logger.error("exportOrdersExcel failed", { traceId, error: getErrorMessage(error), stack: error.stack });
    return res.status(500).json({ success: false, message: error.message });
  }
};

export const getOrderById = async (req: Request, res: Response) => {
  const traceId = req.traceId;
  const id = req.params.id as string;
  logger.info("getOrderById invoked", { traceId, path: req.originalUrl, id });

  try {
    const numId = adminBook.parseBookId(id);
    if (!numId) { logger.warn("getOrderById invalid id", { traceId, id }); return res.status(400).json({ success: false, message: "Invalid order id." }); }
    const order = await adminBook.getOrder(numId);
    if (!order) { logger.warn("getOrderById not found (mysql)", { traceId, id }); return res.status(404).json({ success: false, message: "Order not found." }); }
    logger.info("getOrderById success (mysql)", { traceId, id });
    return res.status(200).json({ success: true, data: order });
  } catch (error: any) {
    logger.error("getOrderById failed", { traceId, id, error: getErrorMessage(error), stack: error.stack });
    return res.status(500).json({ success: false, message: error.message });
  }
};

// ⚠ NOT REPRESENTABLE ON SQL (no SQL twin): updateOrderStatus /
// setOrderTracking / addOrderTrackingEvent used to write the embedded
// `tracking.history[]` array + paidAt/shippedAt/deliveredAt/cancelledAt
// timestamps in Mongo. SQL `ws_book_tracking` is a single flat row per AWB
// (status varchar(10), no history/location/note/courier columns) and
// ws_book_order has only created/updated/order_date — the full
// SHIPPED→DELIVERED→CANCELLED lifecycle + event history is not representable.
// (book-order's verify path already writes the one "verified" tracking row.)
// These handlers validate their input and return 501 until the SQL schema
// grows the required columns. See NEEDS-MANUAL-PORT.
export const updateOrderStatus = async (req: Request, res: Response) => {
  const traceId = req.traceId;
  const id = req.params.id as string;
  logger.info("updateOrderStatus invoked", { traceId, path: req.originalUrl, id });

  try {
    updateOrderStatusSchema.parse(req.body);
    logger.warn("updateOrderStatus not supported on MySQL backend", { traceId, id });
    return res.status(501).json({
      success: false,
      message: "Order status transitions are not supported on the MySQL backend.",
    });
  } catch (error: any) {
    if (error.issues) { logger.warn("updateOrderStatus validation failed", { traceId, id, issues: error.issues }); return res.status(400).json({ success: false, errors: error.issues }); }
    logger.error("updateOrderStatus failed", { traceId, id, error: getErrorMessage(error), stack: error.stack });
    return res.status(500).json({ success: false, message: error.message });
  }
};

export const setOrderTracking = async (req: Request, res: Response) => {
  const traceId = req.traceId;
  const id = req.params.id as string;
  logger.info("setOrderTracking invoked", { traceId, path: req.originalUrl, id });

  try {
    setTrackingSchema.parse(req.body);
    logger.warn("setOrderTracking not supported on MySQL backend", { traceId, id });
    return res.status(501).json({
      success: false,
      message: "Order tracking is not supported on the MySQL backend.",
    });
  } catch (error: any) {
    if (error.issues) { logger.warn("setOrderTracking validation failed", { traceId, id, issues: error.issues }); return res.status(400).json({ success: false, errors: error.issues }); }
    logger.error("setOrderTracking failed", { traceId, id, error: getErrorMessage(error), stack: error.stack });
    return res.status(500).json({ success: false, message: error.message });
  }
};

export const addOrderTrackingEvent = async (req: Request, res: Response) => {
  const traceId = req.traceId;
  const id = req.params.id as string;
  logger.info("addOrderTrackingEvent invoked", { traceId, path: req.originalUrl, id });

  try {
    addTrackingEventSchema.parse(req.body);
    logger.warn("addOrderTrackingEvent not supported on MySQL backend", { traceId, id });
    return res.status(501).json({
      success: false,
      message: "Order tracking events are not supported on the MySQL backend.",
    });
  } catch (error: any) {
    if (error.issues) return res.status(400).json({ success: false, errors: error.issues });
    logger.error("addOrderTrackingEvent failed", { traceId, id, error: getErrorMessage(error), stack: error.stack });
    return res.status(500).json({ success: false, message: error.message });
  }
};

// ─── Settings ─────────────────────────────────────────────────────────────────

export const getSettings = async (_req: Request, res: Response) => {
  const traceId = _req.traceId;
  logger.info("getSettings invoked", { traceId, path: _req.originalUrl });

  try {
    const data = await adminBook.getBookSettings();
    logger.info("getSettings success (mysql)", { traceId });
    return res.status(200).json({ success: true, data });
  } catch (error: any) {
    logger.error("getSettings failed", { traceId, error: getErrorMessage(error), stack: error.stack });
    return res.status(500).json({ success: false, message: error.message });
  }
};

export const updateSettings = async (req: Request, res: Response) => {
  const traceId = req.traceId;
  logger.info("updateSettings invoked", { traceId, path: req.originalUrl });

  try {
    const data = updateSettingsSchema.parse(req.body);
    const updated = await adminBook.updateBookSettings(data as any);
    logger.info("updateSettings success (mysql)", { traceId });
    return res.status(200).json({ success: true, data: updated });
  } catch (error: any) {
    if (error.issues) { logger.warn("updateSettings validation failed", { traceId, issues: error.issues }); return res.status(400).json({ success: false, errors: error.issues }); }
    logger.error("updateSettings failed", { traceId, error: getErrorMessage(error), stack: error.stack });
    return res.status(500).json({ success: false, message: error.message });
  }
};
