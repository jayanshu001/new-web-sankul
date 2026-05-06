import { Request, Response } from "express";
import mongoose from "mongoose";
import { Book } from "../../models/book/Book.model";
import { BookOrder } from "../../models/book/BookOrder.model";
import { BookSetting } from "../../models/book/BookSetting.model";
import { BookOrderStatus } from "../../models/enums";
import {
  createBookSchema,
  updateBookSchema,
  reorderBooksSchema,
  updateOrderStatusSchema,
  setTrackingSchema,
  updateSettingsSchema,
} from "./book.validation";

// ─── Books CRUD ───────────────────────────────────────────────────────────────

export const getBooks = async (req: Request, res: Response) => {
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

    return res.status(200).json({
      success: true,
      data,
      pagination: { total, page: pageNum, limit: limitNum, totalPages: Math.ceil(total / limitNum) },
    });
  } catch (error: any) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

export const getBookById = async (req: Request, res: Response) => {
  try {
    const id = req.params.id as string;
    if (!mongoose.Types.ObjectId.isValid(id))
      return res.status(400).json({ success: false, message: "Invalid book id." });
    const book = await Book.findById(id).populate(
      "examCountdownCategoryId",
      "_id name colorHex"
    );
    if (!book) return res.status(404).json({ success: false, message: "Book not found." });
    return res.status(200).json({ success: true, data: book });
  } catch (error: any) {
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
  try {
    mergeUploadedFiles(req);
    const data = createBookSchema.parse(req.body);
    if (data.examCountdownCategoryId && !mongoose.Types.ObjectId.isValid(data.examCountdownCategoryId))
      return res.status(400).json({ success: false, message: "Invalid examCountdownCategoryId." });
    (data as any).examCountdownCategoryId = data.examCountdownCategoryId || null;
    if (data.discountedPrice > data.listPrice) {
      return res.status(400).json({
        success: false,
        message: "Discounted price cannot exceed list price.",
      });
    }
    const book = await Book.create(data);
    return res.status(201).json({ success: true, data: book });
  } catch (error: any) {
    if (error.issues) return res.status(400).json({ success: false, errors: error.issues });
    return res.status(500).json({ success: false, message: error.message });
  }
};

export const updateBook = async (req: Request, res: Response) => {
  try {
    const id = req.params.id as string;
    if (!mongoose.Types.ObjectId.isValid(id))
      return res.status(400).json({ success: false, message: "Invalid book id." });
    mergeUploadedFiles(req);
    const data = updateBookSchema.parse(req.body);
    if (data.examCountdownCategoryId !== undefined) {
      if (data.examCountdownCategoryId && !mongoose.Types.ObjectId.isValid(data.examCountdownCategoryId))
        return res.status(400).json({ success: false, message: "Invalid examCountdownCategoryId." });
      (data as any).examCountdownCategoryId = data.examCountdownCategoryId || null;
    }
    if (
      data.discountedPrice !== undefined &&
      data.listPrice !== undefined &&
      data.discountedPrice > data.listPrice
    ) {
      return res.status(400).json({
        success: false,
        message: "Discounted price cannot exceed list price.",
      });
    }
    const book = await Book.findByIdAndUpdate(id, { $set: data }, { new: true });
    if (!book) return res.status(404).json({ success: false, message: "Book not found." });
    return res.status(200).json({ success: true, data: book });
  } catch (error: any) {
    if (error.issues) return res.status(400).json({ success: false, errors: error.issues });
    return res.status(500).json({ success: false, message: error.message });
  }
};

export const deleteBook = async (req: Request, res: Response) => {
  try {
    const id = req.params.id as string;
    if (!mongoose.Types.ObjectId.isValid(id))
      return res.status(400).json({ success: false, message: "Invalid book id." });
    const book = await Book.findByIdAndDelete(id);
    if (!book) return res.status(404).json({ success: false, message: "Book not found." });
    return res.status(200).json({ success: true, message: "Book deleted." });
  } catch (error: any) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

export const toggleBookStatus = async (req: Request, res: Response) => {
  try {
    const id = req.params.id as string;
    if (!mongoose.Types.ObjectId.isValid(id))
      return res.status(400).json({ success: false, message: "Invalid book id." });
    const book = await Book.findById(id).select("status");
    if (!book) return res.status(404).json({ success: false, message: "Book not found." });
    book.status = !book.status;
    await book.save();
    return res.status(200).json({ success: true, data: { status: book.status } });
  } catch (error: any) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

export const toggleBookTrending = async (req: Request, res: Response) => {
  try {
    const id = req.params.id as string;
    if (!mongoose.Types.ObjectId.isValid(id))
      return res.status(400).json({ success: false, message: "Invalid book id." });
    const book = await Book.findById(id).select("isTrending");
    if (!book) return res.status(404).json({ success: false, message: "Book not found." });
    book.isTrending = !book.isTrending;
    await book.save();
    return res.status(200).json({ success: true, data: { isTrending: book.isTrending } });
  } catch (error: any) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

export const reorderBooks = async (req: Request, res: Response) => {
  try {
    const { orders } = reorderBooksSchema.parse(req.body);
    const ops = orders
      .filter((o) => mongoose.Types.ObjectId.isValid(o.id))
      .map((o) => ({
        updateOne: { filter: { _id: o.id }, update: { $set: { orderBy: o.orderBy } } },
      }));
    if (!ops.length) return res.status(400).json({ success: false, message: "No valid ids." });
    await Book.bulkWrite(ops);
    return res.status(200).json({ success: true, message: "Book order updated." });
  } catch (error: any) {
    if (error.issues) return res.status(400).json({ success: false, errors: error.issues });
    return res.status(500).json({ success: false, message: error.message });
  }
};

// ─── Orders ───────────────────────────────────────────────────────────────────

export const getOrders = async (req: Request, res: Response) => {
  try {
    const {
      customerId,
      status,
      fromDate,
      toDate,
      search,
      page = "1",
      limit = "20",
    } = req.query as Record<string, string>;

    const filter: any = {};
    if (customerId && mongoose.Types.ObjectId.isValid(customerId)) filter.customerId = customerId;
    if (status && Object.values(BookOrderStatus).includes(status as BookOrderStatus))
      filter.status = status;
    if (search) filter.receiptId = { $regex: search, $options: "i" };
    if (fromDate || toDate) {
      filter.createdAt = {};
      if (fromDate) filter.createdAt.$gte = new Date(fromDate);
      if (toDate) filter.createdAt.$lte = new Date(toDate);
    }

    const pageNum = Math.max(parseInt(page, 10) || 1, 1);
    const limitNum = Math.max(parseInt(limit, 10) || 20, 1);
    const skip = (pageNum - 1) * limitNum;

    const [data, total] = await Promise.all([
      BookOrder.find(filter)
        .populate("customerId", "_id firstName lastName phoneNumber emailAddress")
        .populate("shippingId")
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limitNum),
      BookOrder.countDocuments(filter),
    ]);

    return res.status(200).json({
      success: true,
      data,
      pagination: { total, page: pageNum, limit: limitNum, totalPages: Math.ceil(total / limitNum) },
    });
  } catch (error: any) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

export const getOrderById = async (req: Request, res: Response) => {
  try {
    const id = req.params.id as string;
    if (!mongoose.Types.ObjectId.isValid(id))
      return res.status(400).json({ success: false, message: "Invalid order id." });

    const order = await BookOrder.findById(id)
      .populate("customerId", "_id firstName lastName phoneNumber emailAddress")
      .populate("shippingId")
      .populate("items.bookId", "_id name thumbnail author");
    if (!order) return res.status(404).json({ success: false, message: "Order not found." });
    return res.status(200).json({ success: true, data: order });
  } catch (error: any) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

export const updateOrderStatus = async (req: Request, res: Response) => {
  try {
    const id = req.params.id as string;
    if (!mongoose.Types.ObjectId.isValid(id))
      return res.status(400).json({ success: false, message: "Invalid order id." });

    const { status, remarks } = updateOrderStatusSchema.parse(req.body);

    const order = await BookOrder.findById(id);
    if (!order) return res.status(404).json({ success: false, message: "Order not found." });

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
        $set: update,
        $push: { "tracking.history": { status, note: remarks, at: now } },
      },
      { new: true }
    );

    return res.status(200).json({ success: true, data: updated });
  } catch (error: any) {
    if (error.issues) return res.status(400).json({ success: false, errors: error.issues });
    return res.status(500).json({ success: false, message: error.message });
  }
};

export const setOrderTracking = async (req: Request, res: Response) => {
  try {
    const id = req.params.id as string;
    if (!mongoose.Types.ObjectId.isValid(id))
      return res.status(400).json({ success: false, message: "Invalid order id." });

    const { trackingId, courier, status, note } = setTrackingSchema.parse(req.body);

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
            note: note ?? `Handed over to ${courier}`,
            at: new Date(),
          },
        },
      },
      { new: true }
    );
    if (!updated) return res.status(404).json({ success: false, message: "Order not found." });
    return res.status(200).json({ success: true, data: updated });
  } catch (error: any) {
    if (error.issues) return res.status(400).json({ success: false, errors: error.issues });
    return res.status(500).json({ success: false, message: error.message });
  }
};

// ─── Settings ─────────────────────────────────────────────────────────────────

export const getSettings = async (_req: Request, res: Response) => {
  try {
    let setting = await BookSetting.findOne({ key: "default" });
    if (!setting) setting = await BookSetting.create({ key: "default" });
    return res.status(200).json({ success: true, data: setting });
  } catch (error: any) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

export const updateSettings = async (req: Request, res: Response) => {
  try {
    const data = updateSettingsSchema.parse(req.body);
    const setting = await BookSetting.findOneAndUpdate(
      { key: "default" },
      { $set: data },
      { new: true, upsert: true, setDefaultsOnInsert: true }
    );
    return res.status(200).json({ success: true, data: setting });
  } catch (error: any) {
    if (error.issues) return res.status(400).json({ success: false, errors: error.issues });
    return res.status(500).json({ success: false, message: error.message });
  }
};
