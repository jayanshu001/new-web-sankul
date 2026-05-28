import { Request, Response } from "express";
import mongoose from "mongoose";
import { Book } from "../../models/book/Book.model";
import { BookOrder } from "../../models/book/BookOrder.model";
import { BookSetting } from "../../models/book/BookSetting.model";
import { Customer } from "../../models/customer/Customer.model";
import { BookOrderStatus } from "../../models/enums";
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

    const filter: any = {};
    if (search) {
      filter.$or = [
        { name: { $regex: search, $options: "i" } },
        { author: { $regex: search, $options: "i" } },
      ];
    }
    if (status === "true" || status === "false") filter.status = status === "true";
    if (language) filter.language = language;
    if (isMagazine === "true" || isMagazine === "false") filter.isMagazine = isMagazine === "true";
    if (isCombo === "true" || isCombo === "false") filter.isCombo = isCombo === "true";

    const pageNum = Math.max(parseInt(page, 10) || 1, 1);
    const limitNum = Math.max(parseInt(limit, 10) || 20, 1);
    const skip = (pageNum - 1) * limitNum;

    const [data, total] = await Promise.all([
      Book.find(filter).sort({ orderBy: 1, createdAt: -1 }).skip(skip).limit(limitNum),
      Book.countDocuments(filter),
    ]);

    logger.info("getBooks success", { traceId, total });
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
    if (!mongoose.Types.ObjectId.isValid(id)) { logger.warn("getBookById invalid id", { traceId, id }); return res.status(400).json({ success: false, message: "Invalid book id." }); }
    const book = await Book.findById(id).populate(
      "examCountdownCategoryId",
      "_id name colorHex"
    );
    if (!book) { logger.warn("getBookById not found", { traceId, id }); return res.status(404).json({ success: false, message: "Book not found." }); }
    logger.info("getBookById success", { traceId, id });
    return res.status(200).json({ success: true, data: book });
  } catch (error: any) {
    logger.error("getBookById failed", { traceId, id, error: getErrorMessage(error), stack: error.stack });
    return res.status(500).json({ success: false, message: error.message });
  }
};

const mergeUploadedFiles = (req: Request) => {
  const files = req.files as Record<string, Express.MulterS3.File[]> | undefined;
  if (!files) return;
  for (const field of ["image", "thumbnail", "demoUrl"]) {
    const f = files[field]?.[0] as any;
    if (f?.location) req.body[field] = f.location;
  }
};

export const createBook = async (req: Request, res: Response) => {
  const traceId = req.traceId;
  logger.info("createBook invoked", { traceId, path: req.originalUrl, userId: req.user?.id });

  try {
    mergeUploadedFiles(req);
    const data = createBookSchema.parse(req.body);
    if (data.examCountdownCategoryId && !mongoose.Types.ObjectId.isValid(data.examCountdownCategoryId)) { logger.warn("createBook invalid examCountdownCategoryId", { traceId }); return res.status(400).json({ success: false, message: "Invalid examCountdownCategoryId." }); }
    (data as any).examCountdownCategoryId = data.examCountdownCategoryId || null;
    if (data.discountedPrice > data.listPrice) {
      logger.warn("createBook discount exceeds list", { traceId });
      return res.status(400).json({
        success: false,
        message: "Discounted price cannot exceed list price.",
      });
    }
    const book = await Book.create(data);
    logger.info("createBook success", { traceId, bookId: book._id });
    return res.status(201).json({ success: true, data: book });
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
    if (!mongoose.Types.ObjectId.isValid(id)) { logger.warn("updateBook invalid id", { traceId, id }); return res.status(400).json({ success: false, message: "Invalid book id." }); }
    mergeUploadedFiles(req);
    const data = updateBookSchema.parse(req.body);
    if (data.examCountdownCategoryId !== undefined) {
      if (data.examCountdownCategoryId && !mongoose.Types.ObjectId.isValid(data.examCountdownCategoryId)) { logger.warn("updateBook invalid examCountdownCategoryId", { traceId, id }); return res.status(400).json({ success: false, message: "Invalid examCountdownCategoryId." }); }
      (data as any).examCountdownCategoryId = data.examCountdownCategoryId || null;
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
    const book = await Book.findByIdAndUpdate(id, { $set: data }, { new: true });
    if (!book) { logger.warn("updateBook not found", { traceId, id }); return res.status(404).json({ success: false, message: "Book not found." }); }
    logger.info("updateBook success", { traceId, id });
    return res.status(200).json({ success: true, data: book });
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
    if (!mongoose.Types.ObjectId.isValid(id)) { logger.warn("deleteBook invalid id", { traceId, id }); return res.status(400).json({ success: false, message: "Invalid book id." }); }
    const book = await Book.findByIdAndDelete(id);
    if (!book) { logger.warn("deleteBook not found", { traceId, id }); return res.status(404).json({ success: false, message: "Book not found." }); }
    logger.info("deleteBook success", { traceId, id });
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
    if (!mongoose.Types.ObjectId.isValid(id)) { logger.warn("toggleBookStatus invalid id", { traceId, id }); return res.status(400).json({ success: false, message: "Invalid book id." }); }
    const book = await Book.findById(id).select("status");
    if (!book) { logger.warn("toggleBookStatus not found", { traceId, id }); return res.status(404).json({ success: false, message: "Book not found." }); }
    book.status = !book.status;
    await book.save();
    logger.info("toggleBookStatus success", { traceId, id, newStatus: book.status });
    return res.status(200).json({ success: true, data: { status: book.status } });
  } catch (error: any) {
    logger.error("toggleBookStatus failed", { traceId, id, error: getErrorMessage(error), stack: error.stack });
    return res.status(500).json({ success: false, message: error.message });
  }
};

export const toggleBookTrending = async (req: Request, res: Response) => {
  const traceId = req.traceId;
  const id = req.params.id as string;
  logger.info("toggleBookTrending invoked", { traceId, path: req.originalUrl, id });

  try {
    if (!mongoose.Types.ObjectId.isValid(id)) { logger.warn("toggleBookTrending invalid id", { traceId, id }); return res.status(400).json({ success: false, message: "Invalid book id." }); }
    const book = await Book.findById(id).select("isTrending");
    if (!book) { logger.warn("toggleBookTrending not found", { traceId, id }); return res.status(404).json({ success: false, message: "Book not found." }); }
    book.isTrending = !book.isTrending;
    await book.save();
    logger.info("toggleBookTrending success", { traceId, id, newValue: book.isTrending });
    return res.status(200).json({ success: true, data: { isTrending: book.isTrending } });
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
    const ops = orders
      .filter((o) => mongoose.Types.ObjectId.isValid(o.id))
      .map((o) => ({
        updateOne: { filter: { _id: o.id }, update: { $set: { orderBy: o.orderBy } } },
      }));
    if (!ops.length) { logger.warn("reorderBooks no valid ids", { traceId }); return res.status(400).json({ success: false, message: "No valid ids." }); }
    await Book.bulkWrite(ops);
    logger.info("reorderBooks success", { traceId, count: ops.length });
    return res.status(200).json({ success: true, message: "Book order updated." });
  } catch (error: any) {
    if (error.issues) { logger.warn("reorderBooks validation failed", { traceId, issues: error.issues }); return res.status(400).json({ success: false, errors: error.issues }); }
    logger.error("reorderBooks failed", { traceId, error: getErrorMessage(error), stack: error.stack });
    return res.status(500).json({ success: false, message: error.message });
  }
};

// ─── Orders ───────────────────────────────────────────────────────────────────

export const getOrders = async (req: Request, res: Response) => {
  const traceId = req.traceId;
  logger.info("getOrders invoked", { traceId, path: req.originalUrl });

  try {
    const {
      customerId,
      status,
      fromDate,
      toDate,
      search,
      sortBy,
      sortOrder,
      page = "1",
      limit = "20",
    } = req.query as Record<string, string>;

    const filter: any = {};
    if (customerId && mongoose.Types.ObjectId.isValid(customerId)) filter.customerId = customerId;
    if (status && Object.values(BookOrderStatus).includes(status as BookOrderStatus))
      filter.status = status;
    if (fromDate || toDate) {
      filter.createdAt = {};
      if (fromDate) filter.createdAt.$gte = new Date(fromDate);
      if (toDate) filter.createdAt.$lte = new Date(toDate);
    }

    if (search) {
      const rx = new RegExp(search.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
      const [matchedCustomers, matchedBooks] = await Promise.all([
        Customer.find({
          $or: [{ firstName: rx }, { lastName: rx }, { phoneNumber: rx }],
        }).select("_id").lean(),
        Book.find({ name: rx }).select("_id").lean(),
      ]);
      filter.$or = [
        { receiptId: rx },
        { customerId: { $in: matchedCustomers.map((c) => c._id) } },
        { "items.bookId": { $in: matchedBooks.map((b) => b._id) } },
        { "items.name": rx },
      ];
    }

    const pageNum = Math.max(parseInt(page, 10) || 1, 1);
    const limitNum = Math.max(parseInt(limit, 10) || 20, 1);
    const skip = (pageNum - 1) * limitNum;

    const sortField = sortBy || "createdAt";
    const sortDir = sortOrder === "asc" ? 1 : -1;

    const [rows, total] = await Promise.all([
      BookOrder.find(filter)
        .populate({ path: "customerId", select: "_id firstName lastName phoneNumber" })
        .populate({ path: "items.bookId", select: "_id name image thumbnail" })
        .populate("shippingId")
        .sort({ [sortField]: sortDir })
        .skip(skip)
        .limit(limitNum)
        .lean(),
      BookOrder.countDocuments(filter),
    ]);

    const items = rows.map((r: any) => ({
      _id: r._id,
      receiptId: r.receiptId,
      customerId: r.customerId,
      shippingId: r.shippingId ?? null,
      amount: r.amount,
      status: r.status,
      items: (r.items || []).map((it: any) => ({
        bookId: it.bookId,
        name: it.name,
        qty: it.qty,
        price: it.price,
      })),
      createdAt: r.createdAt,
      updatedAt: r.updatedAt,
    }));

    logger.info("getOrders success", { traceId, total });
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

export const getOrderById = async (req: Request, res: Response) => {
  const traceId = req.traceId;
  const id = req.params.id as string;
  logger.info("getOrderById invoked", { traceId, path: req.originalUrl, id });

  try {
    if (!mongoose.Types.ObjectId.isValid(id)) { logger.warn("getOrderById invalid id", { traceId, id }); return res.status(400).json({ success: false, message: "Invalid order id." }); }

    const order = await BookOrder.findById(id)
      .populate("customerId", "_id firstName lastName phoneNumber emailAddress")
      .populate("shippingId")
      .populate("items.bookId", "_id name thumbnail author");
    if (!order) { logger.warn("getOrderById not found", { traceId, id }); return res.status(404).json({ success: false, message: "Order not found." }); }
    logger.info("getOrderById success", { traceId, id });
    return res.status(200).json({ success: true, data: order });
  } catch (error: any) {
    logger.error("getOrderById failed", { traceId, id, error: getErrorMessage(error), stack: error.stack });
    return res.status(500).json({ success: false, message: error.message });
  }
};

export const updateOrderStatus = async (req: Request, res: Response) => {
  const traceId = req.traceId;
  const id = req.params.id as string;
  logger.info("updateOrderStatus invoked", { traceId, path: req.originalUrl, id });

  try {
    if (!mongoose.Types.ObjectId.isValid(id)) { logger.warn("updateOrderStatus invalid id", { traceId, id }); return res.status(400).json({ success: false, message: "Invalid order id." }); }

    const { status, location, remarks } = updateOrderStatusSchema.parse(req.body);

    const order = await BookOrder.findById(id);
    if (!order) { logger.warn("updateOrderStatus not found", { traceId, id }); return res.status(404).json({ success: false, message: "Order not found." }); }

    const now = new Date();
    const update: any = { status };
    if (remarks) update.remarks = remarks;
    if (status === BookOrderStatus.VERIFIED && !order.paidAt) update.paidAt = now;
    if (status === BookOrderStatus.SHIPPED && !order.shippedAt) update.shippedAt = now;
    if (status === BookOrderStatus.DELIVERED && !order.deliveredAt) update.deliveredAt = now;
    if (status === BookOrderStatus.CANCELLED && !order.cancelledAt) update.cancelledAt = now;

    const updated = await BookOrder.findByIdAndUpdate(
      id,
      {
        $set: { ...update, "tracking.status": status },
        $push: { "tracking.history": { status, location, note: remarks, at: now } },
      },
      { new: true }
    );

    logger.info("updateOrderStatus success", { traceId, id, status });
    return res.status(200).json({ success: true, data: updated });
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
    if (!mongoose.Types.ObjectId.isValid(id)) { logger.warn("setOrderTracking invalid id", { traceId, id }); return res.status(400).json({ success: false, message: "Invalid order id." }); }

    const { trackingId, courier, status, location, note } = setTrackingSchema.parse(req.body);

    const updated = await BookOrder.findByIdAndUpdate(
      id,
      {
        $set: {
          "tracking.trackingId": trackingId,
          "tracking.courier": courier,
          "tracking.status": status ?? "shipped",
          status: BookOrderStatus.SHIPPED,
          shippedAt: new Date(),
        },
        $push: {
          "tracking.history": {
            status: status ?? "shipped",
            location,
            note: note ?? `Handed over to ${courier}`,
            at: new Date(),
          },
        },
      },
      { new: true }
    );
    if (!updated) { logger.warn("setOrderTracking not found", { traceId, id }); return res.status(404).json({ success: false, message: "Order not found." }); }
    logger.info("setOrderTracking success", { traceId, id, trackingId, courier });
    return res.status(200).json({ success: true, data: updated });
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
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ success: false, message: "Invalid order id." });
    }

    const { status, location, note, at } = addTrackingEventSchema.parse(req.body);
    const eventAt = at ?? new Date();

    const updated = await BookOrder.findByIdAndUpdate(
      id,
      {
        $set: { "tracking.status": status },
        $push: { "tracking.history": { status, location, note, at: eventAt } },
      },
      { new: true }
    );
    if (!updated) return res.status(404).json({ success: false, message: "Order not found." });

    logger.info("addOrderTrackingEvent success", { traceId, id, status });
    return res.status(200).json({ success: true, data: updated });
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
    let setting = await BookSetting.findOne({ key: "default" });
    if (!setting) setting = await BookSetting.create({ key: "default" });
    logger.info("getSettings success", { traceId });
    return res.status(200).json({ success: true, data: setting });
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
    const setting = await BookSetting.findOneAndUpdate(
      { key: "default" },
      { $set: data },
      { new: true, upsert: true, setDefaultsOnInsert: true }
    );
    logger.info("updateSettings success", { traceId });
    return res.status(200).json({ success: true, data: setting });
  } catch (error: any) {
    if (error.issues) { logger.warn("updateSettings validation failed", { traceId, issues: error.issues }); return res.status(400).json({ success: false, errors: error.issues }); }
    logger.error("updateSettings failed", { traceId, error: getErrorMessage(error), stack: error.stack });
    return res.status(500).json({ success: false, message: error.message });
  }
};
