import { Request, Response } from "express";
import { Model } from "mongoose";
import { Course } from "../../models/course/Course.model";
import { Package } from "../../models/course/Package.model";
import { Book } from "../../models/book/Book.model";
import { Ebook } from "../../models/ebook/Ebook.model";

const TYPE_TO_MODEL: Record<string, Model<any>> = {
  courses: Course,
  packages: Package,
  books: Book,
  ebooks: Ebook,
};

// Escape user input so a query like "C++" or "(2024)" doesn't blow up the regex.
function escapeRegex(input: string) {
  return input.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// GET /api/v1/client/search?q=&type=courses|packages|books|ebooks&page=&limit=
export const globalSearch = async (req: Request, res: Response) => {
  try {
    const { q, type } = req.query as Record<string, string>;
    const page = Math.max(parseInt(req.query.page as string, 10) || 1, 1);
    const limit = Math.min(Math.max(parseInt(req.query.limit as string, 10) || 10, 1), 50);

    if (!q || q.trim().length < 2) {
      return res
        .status(400)
        .json({ success: false, message: "Query 'q' must be at least 2 characters." });
    }
    const Model = TYPE_TO_MODEL[type];
    if (!Model) {
      return res.status(400).json({
        success: false,
        message: "Query 'type' must be one of: courses, packages, books, ebooks.",
      });
    }

    const filter = {
      status: true,
      name: { $regex: escapeRegex(q.trim()), $options: "i" },
    };
    const skip = (page - 1) * limit;

    const [items, total] = await Promise.all([
      Model.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit).lean(),
      Model.countDocuments(filter),
    ]);

    return res.status(200).json({
      success: true,
      data: {
        type,
        items,
        total,
        page,
        limit,
        hasMore: skip + items.length < total,
      },
    });
  } catch (error: any) {
    return res.status(500).json({ success: false, message: error.message });
  }
};
