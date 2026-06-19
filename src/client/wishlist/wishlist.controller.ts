import { Request, Response } from "express";
import mongoose from "mongoose";
import { z } from "zod";
import { Wishlist } from "../../models/customer/Wishlist.model";
import { Course } from "../../models/course/Course.model";
import { Package } from "../../models/course/Package.model";
import { Ebook } from "../../models/ebook/Ebook.model";
import { Book } from "../../models/book/Book.model";
import logger from "../../utils/logger";
import { getErrorMessage } from "../../utils/httpResponse";
import {
  isClientWishlistMysql,
  parseWlId,
  isWlType,
  itemExists,
  listWishlistMysql,
  addWishlistMysql,
  removeWishlistMysql,
  checkWishlistMysql,
} from "../../modules/client-wishlist/client-wishlist.service";

const isObjectId = (v: string) => mongoose.Types.ObjectId.isValid(v);

const typeToModel: Record<string, any> = {
  course: Course,
  package: Package,
  ebook: Ebook,
  book: Book,
};

const addSchema = z.object({
  itemType: z.enum(["course", "package", "ebook", "book"]),
  itemId: z.string().regex(/^[0-9a-fA-F]{24}$/),
});

// GET /api/v1/client/wishlist
export const listWishlist = async (req: Request, res: Response) => {
  const traceId = req.traceId;
  const userId = req.user?.id;
  logger.info("listWishlist invoked", { traceId, path: req.originalUrl, customerId: userId });

  try {
    if (!userId) { logger.warn("listWishlist unauthorized", { traceId }); return res.status(401).json({ success: false, message: "Unauthorized." }); }
    const { itemType } = req.query as Record<string, string>;

    // ─── SQL branch (int id-space) — gated on `client-wishlist` ───
    if (isClientWishlistMysql()) {
      const cidNum = parseWlId(String(userId));
      if (cidNum == null) return res.status(401).json({ success: false, message: "Unauthorized." });
      const typeFilter = itemType && isWlType(itemType) ? itemType : null;
      const { data, count } = await listWishlistMysql(cidNum, typeFilter);
      logger.info("listWishlist success (sql)", { traceId, customerId: userId, count });
      return res.status(200).json({ success: true, data, count });
    }

    const filter: any = { customerId: userId };
    if (itemType && typeToModel[itemType]) filter.itemType = itemType;

    const entries = await Wishlist.find(filter).sort({ createdAt: -1 }).lean();

    // Group by type and populate
    const grouped: Record<string, any[]> = { course: [], package: [], ebook: [], book: [] };
    entries.forEach((e) => {
      grouped[e.itemType].push(e);
    });

    const [courses, packages, ebooks, books] = await Promise.all([
      grouped.course.length
        ? Course.find({ _id: { $in: grouped.course.map((e) => e.itemId) } }).lean()
        : [],
      grouped.package.length
        ? Package.find({ _id: { $in: grouped.package.map((e) => e.itemId) } }).lean()
        : [],
      grouped.ebook.length
        ? Ebook.find({ _id: { $in: grouped.ebook.map((e) => e.itemId) } }).lean()
        : [],
      grouped.book.length
        ? Book.find({ _id: { $in: grouped.book.map((e) => e.itemId) } }).lean()
        : [],
    ]);

    const attachItem = (list: any[], entries: any[]) => {
      const byId: Record<string, any> = {};
      list.forEach((item) => (byId[String(item._id)] = item));
      return entries
        .map((e) => ({
          ...e,
          item: byId[String(e.itemId)] ?? null,
        }))
        .filter((e) => e.item);
    };

    const data = {
      courses: attachItem(courses, grouped.course),
      packages: attachItem(packages, grouped.package),
      ebooks: attachItem(ebooks, grouped.ebook),
      books: attachItem(books, grouped.book),
    };

    const totalCount = data.courses.length + data.packages.length + data.ebooks.length + data.books.length;
    logger.info("listWishlist success", { traceId, customerId: userId, count: totalCount });
    return res.status(200).json({
      success: true,
      data,
      count: totalCount,
    });
  } catch (e: any) {
    logger.error("listWishlist failed", { traceId, customerId: userId, error: getErrorMessage(e), stack: e.stack });
    return res.status(500).json({ success: false, message: e.message });
  }
};

// POST /api/v1/client/wishlist
export const addToWishlist = async (req: Request, res: Response) => {
  const traceId = req.traceId;
  const userId = req.user?.id;
  logger.info("addToWishlist invoked", { traceId, path: req.originalUrl, customerId: userId });

  try {
    if (!userId) { logger.warn("addToWishlist unauthorized", { traceId }); return res.status(401).json({ success: false, message: "Unauthorized." }); }

    // ─── SQL branch (int id-space) — runs BEFORE addSchema (itemId is an int, not 24-hex) ───
    if (isClientWishlistMysql()) {
      const cidNum = parseWlId(String(userId));
      if (cidNum == null) return res.status(401).json({ success: false, message: "Unauthorized." });
      const itemType = String(req.body?.itemType ?? "");
      const itemIdNum = parseWlId(String(req.body?.itemId ?? ""));
      if (!isWlType(itemType) || itemIdNum == null) {
        logger.warn("addToWishlist validation failed (sql)", { traceId, customerId: userId, itemType, itemId: req.body?.itemId });
        return res.status(400).json({ success: false, message: "Invalid itemType or itemId." });
      }
      if (!(await itemExists(itemType, itemIdNum))) {
        logger.warn("addToWishlist item not found (sql)", { traceId, customerId: userId, itemType, itemId: itemIdNum });
        return res.status(404).json({ success: false, message: "Item not found." });
      }
      const outcome = await addWishlistMysql(cidNum, itemType, itemIdNum);
      logger.info("addToWishlist success (sql)", { traceId, customerId: userId, itemType, itemId: itemIdNum, outcome });
      if (outcome === "exists") return res.status(200).json({ success: true, message: "Already in wishlist." });
      return res.status(201).json({ success: true });
    }

    const { itemType, itemId } = addSchema.parse(req.body);

    const Model = typeToModel[itemType];
    const exists = await Model.exists({ _id: itemId });
    if (!exists) { logger.warn("addToWishlist item not found", { traceId, customerId: userId, itemType, itemId }); return res.status(404).json({ success: false, message: "Item not found." }); }

    try {
      const doc = await Wishlist.create({ customerId: userId, itemType, itemId });
      logger.info("addToWishlist success", { traceId, customerId: userId, itemType, itemId });
      return res.status(201).json({ success: true, data: doc });
    } catch (err: any) {
      if (err?.code === 11000) {
        logger.info("addToWishlist already exists", { traceId, customerId: userId, itemType, itemId });
        return res.status(200).json({ success: true, message: "Already in wishlist." });
      }
      throw err;
    }
  } catch (e: any) {
    if (e.issues) { logger.warn("addToWishlist validation failed", { traceId, customerId: userId, issues: e.issues }); return res.status(400).json({ success: false, errors: e.issues }); }
    logger.error("addToWishlist failed", { traceId, customerId: userId, error: getErrorMessage(e), stack: e.stack });
    return res.status(500).json({ success: false, message: e.message });
  }
};

// DELETE /api/v1/client/wishlist/:itemType/:itemId
export const removeFromWishlist = async (req: Request, res: Response) => {
  const traceId = req.traceId;
  const userId = req.user?.id;
  const { itemType, itemId } = req.params as Record<string, string>;
  logger.info("removeFromWishlist invoked", { traceId, path: req.originalUrl, customerId: userId, itemType, itemId });

  try {
    if (!userId) { logger.warn("removeFromWishlist unauthorized", { traceId }); return res.status(401).json({ success: false, message: "Unauthorized." }); }
    if (!typeToModel[itemType]) { logger.warn("removeFromWishlist invalid itemType", { traceId, customerId: userId, itemType }); return res.status(400).json({ success: false, message: "Invalid itemType." }); }

    // ─── SQL branch (int id-space) — runs BEFORE the ObjectId guard ───
    if (isClientWishlistMysql()) {
      const cidNum = parseWlId(String(userId));
      const itemIdNum = parseWlId(String(itemId));
      if (cidNum == null) return res.status(401).json({ success: false, message: "Unauthorized." });
      if (!isWlType(itemType) || itemIdNum == null) return res.status(400).json({ success: false, message: "Invalid itemId." });
      const removed = await removeWishlistMysql(cidNum, itemType, itemIdNum);
      if (!removed) { logger.warn("removeFromWishlist not found (sql)", { traceId, customerId: userId, itemType, itemId }); return res.status(404).json({ success: false, message: "Not in wishlist." }); }
      logger.info("removeFromWishlist success (sql)", { traceId, customerId: userId, itemType, itemId });
      return res.status(200).json({ success: true, message: "Removed." });
    }

    if (!isObjectId(itemId)) { logger.warn("removeFromWishlist invalid itemId", { traceId, customerId: userId, itemId }); return res.status(400).json({ success: false, message: "Invalid itemId." }); }

    const deleted = await Wishlist.findOneAndDelete({
      customerId: userId,
      itemType,
      itemId,
    });
    if (!deleted) { logger.warn("removeFromWishlist not found", { traceId, customerId: userId, itemType, itemId }); return res.status(404).json({ success: false, message: "Not in wishlist." }); }
    logger.info("removeFromWishlist success", { traceId, customerId: userId, itemType, itemId });
    return res.status(200).json({ success: true, message: "Removed." });
  } catch (e: any) {
    logger.error("removeFromWishlist failed", { traceId, customerId: userId, itemType, itemId, error: getErrorMessage(e), stack: e.stack });
    return res.status(500).json({ success: false, message: e.message });
  }
};

// GET /api/v1/client/wishlist/check/:itemType/:itemId
export const checkWishlist = async (req: Request, res: Response) => {
  const traceId = req.traceId;
  const userId = req.user?.id;
  const { itemType, itemId } = req.params as Record<string, string>;
  logger.info("checkWishlist invoked", { traceId, path: req.originalUrl, customerId: userId, itemType, itemId });

  try {
    if (!userId) { logger.warn("checkWishlist unauthorized", { traceId }); return res.status(401).json({ success: false, message: "Unauthorized." }); }

    // ─── SQL branch (int id-space) — runs BEFORE the ObjectId guard ───
    if (isClientWishlistMysql()) {
      const cidNum = parseWlId(String(userId));
      const itemIdNum = parseWlId(String(itemId));
      if (cidNum == null) return res.status(401).json({ success: false, message: "Unauthorized." });
      if (!isWlType(itemType) || itemIdNum == null) { logger.warn("checkWishlist invalid params (sql)", { traceId, customerId: userId, itemType, itemId }); return res.status(400).json({ success: false, message: "Invalid params." }); }
      const inWishlist = await checkWishlistMysql(cidNum, itemType, itemIdNum);
      logger.info("checkWishlist success (sql)", { traceId, customerId: userId, itemType, itemId, inWishlist });
      return res.status(200).json({ success: true, data: { inWishlist } });
    }

    if (!typeToModel[itemType] || !isObjectId(itemId)) { logger.warn("checkWishlist invalid params", { traceId, customerId: userId, itemType, itemId }); return res.status(400).json({ success: false, message: "Invalid params." }); }

    const exists = await Wishlist.exists({ customerId: userId, itemType, itemId });
    logger.info("checkWishlist success", { traceId, customerId: userId, itemType, itemId, inWishlist: !!exists });
    return res.status(200).json({ success: true, data: { inWishlist: !!exists } });
  } catch (e: any) {
    logger.error("checkWishlist failed", { traceId, customerId: userId, itemType, itemId, error: getErrorMessage(e), stack: e.stack });
    return res.status(500).json({ success: false, message: e.message });
  }
};
