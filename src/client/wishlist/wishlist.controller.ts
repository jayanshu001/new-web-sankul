import { Request, Response } from "express";
import mongoose from "mongoose";
import { z } from "zod";
import { Wishlist } from "../../models/customer/Wishlist.model";
import { Course } from "../../models/course/Course.model";
import { Package } from "../../models/course/Package.model";
import { Ebook } from "../../models/ebook/Ebook.model";
import { Book } from "../../models/book/Book.model";

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
  try {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ success: false, message: "Unauthorized." });
    const { itemType } = req.query as Record<string, string>;

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

    return res.status(200).json({
      success: true,
      data,
      count:
        data.courses.length + data.packages.length + data.ebooks.length + data.books.length,
    });
  } catch (e: any) {
    return res.status(500).json({ success: false, message: e.message });
  }
};

// POST /api/v1/client/wishlist
export const addToWishlist = async (req: Request, res: Response) => {
  try {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ success: false, message: "Unauthorized." });

    const { itemType, itemId } = addSchema.parse(req.body);

    const Model = typeToModel[itemType];
    const exists = await Model.exists({ _id: itemId });
    if (!exists) return res.status(404).json({ success: false, message: "Item not found." });

    try {
      const doc = await Wishlist.create({ customerId: userId, itemType, itemId });
      return res.status(201).json({ success: true, data: doc });
    } catch (err: any) {
      if (err?.code === 11000) {
        return res.status(200).json({ success: true, message: "Already in wishlist." });
      }
      throw err;
    }
  } catch (e: any) {
    if (e.issues) return res.status(400).json({ success: false, errors: e.issues });
    return res.status(500).json({ success: false, message: e.message });
  }
};

// DELETE /api/v1/client/wishlist/:itemType/:itemId
export const removeFromWishlist = async (req: Request, res: Response) => {
  try {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ success: false, message: "Unauthorized." });
    const { itemType, itemId } = req.params as Record<string, string>;
    if (!typeToModel[itemType])
      return res.status(400).json({ success: false, message: "Invalid itemType." });
    if (!isObjectId(itemId))
      return res.status(400).json({ success: false, message: "Invalid itemId." });

    const deleted = await Wishlist.findOneAndDelete({
      customerId: userId,
      itemType,
      itemId,
    });
    if (!deleted) return res.status(404).json({ success: false, message: "Not in wishlist." });
    return res.status(200).json({ success: true, message: "Removed." });
  } catch (e: any) {
    return res.status(500).json({ success: false, message: e.message });
  }
};

// GET /api/v1/client/wishlist/check/:itemType/:itemId
export const checkWishlist = async (req: Request, res: Response) => {
  try {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ success: false, message: "Unauthorized." });
    const { itemType, itemId } = req.params as Record<string, string>;
    if (!typeToModel[itemType] || !isObjectId(itemId))
      return res.status(400).json({ success: false, message: "Invalid params." });

    const exists = await Wishlist.exists({ customerId: userId, itemType, itemId });
    return res.status(200).json({ success: true, data: { inWishlist: !!exists } });
  } catch (e: any) {
    return res.status(500).json({ success: false, message: e.message });
  }
};
